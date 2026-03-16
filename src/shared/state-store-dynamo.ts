import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  UpdateTimeToLiveCommand,
} from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  QueryCommand,
} from "@aws-sdk/lib-dynamodb";
import type { StateStore } from "./state-store.js";

/**
 * DynamoDB-backed StateStore for cloud mode.
 *
 * Table schema:
 *   PK  = `pk` (String)  — namespace
 *   SK  = `sk` (String)  — key
 *   TTL = `expiresAt` (Number, epoch seconds) — auto-deleted by DynamoDB
 *
 * Use `DynamoStateStore.create()` which ensures the table exists before
 * returning the store instance.
 */
export class DynamoStateStore implements StateStore {
  private doc: DynamoDBDocumentClient;
  private tableName: string;

  private constructor(client: DynamoDBClient, tableName: string) {
    this.doc = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
    this.tableName = tableName;
  }

  /**
   * Create a DynamoStateStore, ensuring the table exists (creates it if missing).
   */
  static async create(region: string, tableName: string): Promise<DynamoStateStore> {
    const client = new DynamoDBClient({ region });
    const store = new DynamoStateStore(client, tableName);
    await store.ensureTable(client);
    return store;
  }

  // --- StateStore interface ---

  async get<T>(ns: string, key: string): Promise<T | null> {
    const res = await this.doc.send(
      new GetCommand({
        TableName: this.tableName,
        Key: { pk: ns, sk: key },
        ProjectionExpression: "#v, expiresAt",
        ExpressionAttributeNames: { "#v": "value" },
      })
    );
    if (!res.Item) return null;
    // DynamoDB TTL is best-effort — check locally too.
    if (res.Item.expiresAt && (res.Item.expiresAt as number) <= nowSec()) return null;
    return JSON.parse(res.Item.value as string) as T;
  }

  async set<T>(ns: string, key: string, value: T, opts?: { ttl?: number }): Promise<void> {
    const item: Record<string, unknown> = {
      pk: ns,
      sk: key,
      value: JSON.stringify(value),
    };
    if (opts?.ttl) {
      item.expiresAt = nowSec() + opts.ttl;
    }
    await this.doc.send(new PutCommand({ TableName: this.tableName, Item: item }));
  }

  async delete(ns: string, key: string): Promise<void> {
    await this.doc.send(
      new DeleteCommand({ TableName: this.tableName, Key: { pk: ns, sk: key } })
    );
  }

  async deleteAll(ns: string): Promise<void> {
    // DynamoDB has no batch-delete-by-partition — query then delete individually.
    const items = await this.queryPartition(ns);
    await Promise.all(
      items.map((item) =>
        this.doc.send(
          new DeleteCommand({ TableName: this.tableName, Key: { pk: ns, sk: item.sk } })
        )
      )
    );
  }

  async list<T>(ns: string): Promise<Array<{ key: string; value: T }>> {
    const now = nowSec();
    const items = await this.queryPartition(ns);
    return items
      .filter((item) => !item.expiresAt || (item.expiresAt as number) > now)
      .map((item) => ({
        key: item.sk as string,
        value: JSON.parse(item.value as string) as T,
      }));
  }

  async close(): Promise<void> {
    this.doc.destroy();
  }

  // --- Internals ---

  private async queryPartition(ns: string): Promise<Record<string, unknown>[]> {
    const results: Record<string, unknown>[] = [];
    let exclusiveStartKey: Record<string, unknown> | undefined;

    do {
      const res = await this.doc.send(
        new QueryCommand({
          TableName: this.tableName,
          KeyConditionExpression: "pk = :pk",
          ExpressionAttributeValues: { ":pk": ns },
          ...(exclusiveStartKey ? { ExclusiveStartKey: exclusiveStartKey } : {}),
        })
      );
      if (res.Items) results.push(...(res.Items as Record<string, unknown>[]));
      exclusiveStartKey = res.LastEvaluatedKey as Record<string, unknown> | undefined;
    } while (exclusiveStartKey);

    return results;
  }

  /**
   * Ensure the DynamoDB table exists. Creates it with PAY_PER_REQUEST billing
   * and enables TTL if the table is new.
   */
  private async ensureTable(client: DynamoDBClient): Promise<void> {
    try {
      await client.send(new DescribeTableCommand({ TableName: this.tableName }));
      return; // table exists
    } catch (err: any) {
      if (err.name !== "ResourceNotFoundException") throw err;
    }

    await client.send(
      new CreateTableCommand({
        TableName: this.tableName,
        KeySchema: [
          { AttributeName: "pk", KeyType: "HASH" },
          { AttributeName: "sk", KeyType: "RANGE" },
        ],
        AttributeDefinitions: [
          { AttributeName: "pk", AttributeType: "S" },
          { AttributeName: "sk", AttributeType: "S" },
        ],
        BillingMode: "PAY_PER_REQUEST",
      })
    );

    // Wait for ACTIVE status (usually a few seconds with on-demand billing).
    for (let i = 0; i < 60; i++) {
      const desc = await client.send(new DescribeTableCommand({ TableName: this.tableName }));
      if (desc.Table?.TableStatus === "ACTIVE") break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    // Enable TTL on expiresAt attribute.
    try {
      await client.send(
        new UpdateTimeToLiveCommand({
          TableName: this.tableName,
          TimeToLiveSpecification: { Enabled: true, AttributeName: "expiresAt" },
        })
      );
    } catch {
      // TTL may already be enabled or not yet available — non-fatal.
    }
  }
}

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}
