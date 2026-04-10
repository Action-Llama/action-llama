import { describe, it, expect, vi } from "vitest";
import { readFile, writeFile, type Transport } from "../../src/transport/transport.js";

function makeTransport(overrides?: Partial<Transport>): Transport & {
  readFiles: ReturnType<typeof vi.fn>;
  writeFiles: ReturnType<typeof vi.fn>;
} {
  const transport = {
    exec: vi.fn(),
    readFiles: vi.fn(),
    writeFiles: vi.fn(),
    close: vi.fn(),
    ...overrides,
  } as Transport & {
    readFiles: ReturnType<typeof vi.fn>;
    writeFiles: ReturnType<typeof vi.fn>;
  };

  return transport;
}

describe("readFile", () => {
  it("returns the file contents when the transport provides the path", async () => {
    const transport = makeTransport({
      readFiles: vi.fn(async (paths: string[]) => {
        expect(paths).toEqual(["/workspace/notes.txt"]);
        return new Map([["/workspace/notes.txt", Buffer.from("hello world")]]);
      }),
    });

    const content = await readFile(transport, "/workspace/notes.txt");

    expect(content.toString()).toBe("hello world");
    expect(transport.readFiles).toHaveBeenCalledTimes(1);
  });

  it("throws a not found error when the transport omits the file", async () => {
    const transport = makeTransport({
      readFiles: vi.fn(async () => new Map()),
    });

    await expect(readFile(transport, "/workspace/missing.txt")).rejects.toThrow(
      "File not found: /workspace/missing.txt",
    );
    expect(transport.readFiles).toHaveBeenCalledWith(["/workspace/missing.txt"]);
  });
});

describe("writeFile", () => {
  it("wraps the path and content in a single-entry map", async () => {
    const transport = makeTransport({
      writeFiles: vi.fn(async (files: Map<string, Buffer>) => {
        expect(files.size).toBe(1);
        expect(Array.from(files.entries())).toEqual([["/workspace/output.txt", Buffer.from("data")]]);
      }),
    });

    const content = Buffer.from("data");
    await writeFile(transport, "/workspace/output.txt", content);

    expect(transport.writeFiles).toHaveBeenCalledTimes(1);
    expect(transport.writeFiles.mock.calls[0][0].get("/workspace/output.txt")).toBe(content);
  });
});
