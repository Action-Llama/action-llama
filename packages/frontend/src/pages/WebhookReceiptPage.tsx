import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import { ResultBadge } from "../components/Badge";
import { getWebhookReceipt, replayWebhook } from "../lib/api";
import type { WebhookReceiptDetail } from "../lib/api";
import { fmtDateTime, shortId } from "../lib/format";

function prettyJson(raw: string | undefined): string {
  if (!raw) return "\u2014";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** Try to extract content-type from stored headers JSON */
function getContentType(headersJson: string | undefined): string | undefined {
  if (!headersJson) return undefined;
  try {
    const h = JSON.parse(headersJson) as Record<string, string>;
    return h["content-type"] ?? h["Content-Type"];
  } catch {
    return undefined;
  }
}

/**
 * Decode the body based on content-type.
 * - application/x-www-form-urlencoded: decode params, and if any value is JSON, parse it
 * - application/json: pretty-print
 * - base64-encoded content: attempt decode
 * Returns null if the body is already best shown as-is (i.e. it's plain JSON).
 */
function decodeBody(
  body: string | undefined,
  headersJson: string | undefined,
): { label: string; content: string } | null {
  if (!body) return null;

  const ct = getContentType(headersJson)?.toLowerCase() ?? "";

  // Form-encoded: decode URL params and try to parse JSON values within
  if (ct.includes("application/x-www-form-urlencoded")) {
    try {
      const params = new URLSearchParams(body);
      const decoded: Record<string, unknown> = {};
      for (const [key, value] of params.entries()) {
        try {
          decoded[key] = JSON.parse(value);
        } catch {
          decoded[key] = value;
        }
      }
      return {
        label: "Decoded Body (form-urlencoded)",
        content: JSON.stringify(decoded, null, 2),
      };
    } catch {
      // fall through
    }
  }

  // If the body is not valid JSON but looks like base64, try decoding it
  if (ct.includes("application/json")) return null; // already pretty-printed as JSON

  try {
    JSON.parse(body);
    return null; // valid JSON — raw section already handles it
  } catch {
    // Not JSON — try base64
    if (/^[A-Za-z0-9+/\n\r]+=*$/.test(body.trim()) && body.trim().length > 20) {
      try {
        const decoded = atob(body.trim().replace(/\s/g, ""));
        // Check if decoded content is printable
        if (/^[\x20-\x7E\t\n\r]*$/.test(decoded)) {
          try {
            const asJson = JSON.parse(decoded);
            return {
              label: "Decoded Body (base64)",
              content: JSON.stringify(asJson, null, 2),
            };
          } catch {
            return { label: "Decoded Body (base64)", content: decoded };
          }
        }
      } catch {
        // invalid base64
      }
    }
  }

  return null;
}

export function WebhookReceiptPage() {
  const { receiptId } = useParams<{ receiptId: string }>();
  const [receipt, setReceipt] = useState<WebhookReceiptDetail | null | undefined>(undefined);
  const [replayResult, setReplayResult] = useState<string | null>(null);
  const [replayError, setReplayError] = useState<string | null>(null);
  const [replaying, setReplaying] = useState(false);

  useEffect(() => {
    if (!receiptId) return;
    getWebhookReceipt(receiptId)
      .then((data) => setReceipt(data.receipt))
      .catch(() => setReceipt(null));
  }, [receiptId]);

  const handleReplay = useCallback(async () => {
    if (!receiptId) return;
    setReplayResult(null);
    setReplayError(null);
    setReplaying(true);
    try {
      const result = await replayWebhook(receiptId);
      setReplayResult(`Replayed: ${result.matched} matched, ${result.skipped} skipped`);
    } catch (err) {
      setReplayError(err instanceof Error ? err.message : "Replay failed");
    } finally {
      setReplaying(false);
    }
  }, [receiptId]);

  if (!receiptId) return null;

  if (receipt === undefined) {
    return (
      <div className="text-center py-12 text-slate-500 dark:text-slate-400">
        Loading...
      </div>
    );
  }

  if (receipt === null) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Link
            to="/dashboard/triggers"
            className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Receipt not found</h1>
        </div>
      </div>
    );
  }

  const canReplay = !!(receipt.headers || receipt.body);
  const resultForBadge = receipt.status === "processed" ? "completed" : "dead-letter";
  const decoded = decodeBody(receipt.body, receipt.headers);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link
            to="/dashboard/triggers"
            className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white font-mono">
              {shortId(receipt.id)}
            </h1>
            <div className="text-xs text-slate-500 dark:text-slate-400">Webhook Receipt</div>
          </div>
          <ResultBadge result={resultForBadge} />
        </div>
        <div className="flex items-center gap-2">
          {replayResult && (
            <span className="text-xs text-green-600 dark:text-green-400">{replayResult}</span>
          )}
          {replayError && (
            <span className="text-xs text-red-600 dark:text-red-400">{replayError}</span>
          )}
          <button
            onClick={handleReplay}
            disabled={!canReplay || replaying}
            className="px-3 py-1.5 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white transition-colors"
          >
            {replaying ? "Replaying..." : "Replay"}
          </button>
        </div>
      </div>

      {/* Info cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 p-4">
          <h2 className="text-sm font-medium text-slate-900 dark:text-white mb-3">Receipt Info</h2>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Source</dt>
              <dd className="text-slate-700 dark:text-slate-300">{receipt.source}</dd>
            </div>
            {receipt.eventSummary && (
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Event</dt>
                <dd className="text-slate-700 dark:text-slate-300">{receipt.eventSummary}</dd>
              </div>
            )}
            {receipt.deliveryId && (
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Delivery ID</dt>
                <dd className="text-slate-700 dark:text-slate-300 font-mono text-xs">{receipt.deliveryId}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Timestamp</dt>
              <dd className="text-slate-700 dark:text-slate-300">{fmtDateTime(receipt.timestamp)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Status</dt>
              <dd><ResultBadge result={resultForBadge} /></dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500 dark:text-slate-400">Matched Agents</dt>
              <dd className="text-slate-700 dark:text-slate-300">{receipt.matchedAgents}</dd>
            </div>
            {receipt.deadLetterReason && (
              <div className="flex justify-between">
                <dt className="text-slate-500 dark:text-slate-400">Dead Letter Reason</dt>
                <dd className="text-red-600 dark:text-red-400 text-xs">{receipt.deadLetterReason}</dd>
              </div>
            )}
            <div className="flex flex-col gap-1 pt-1 border-t border-slate-200 dark:border-slate-800">
              <dt className="text-slate-500 dark:text-slate-400">Receipt ID</dt>
              <dd className="text-slate-700 dark:text-slate-300 font-mono text-xs break-all">{receipt.id}</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Headers */}
      <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-medium text-slate-900 dark:text-white">Headers</h2>
        </div>
        <div className="p-3 bg-slate-950">
          <pre className="text-xs font-mono text-slate-300 whitespace-pre-wrap break-all">
            {receipt.headers ? prettyJson(receipt.headers) : "\u2014"}
          </pre>
        </div>
      </div>

      {/* Decoded Body — shown when body needs decoding (form-encoded, base64) */}
      {decoded && (
        <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
            <h2 className="text-sm font-medium text-slate-900 dark:text-white">{decoded.label}</h2>
          </div>
          <div className="bg-slate-950 p-3 max-h-96 overflow-y-auto">
            <pre className="text-xs font-mono text-slate-300 whitespace-pre-wrap break-all">
              {decoded.content}
            </pre>
          </div>
        </div>
      )}

      {/* Raw Body */}
      <div className="bg-slate-50 dark:bg-slate-900 rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-800">
          <h2 className="text-sm font-medium text-slate-900 dark:text-white">{decoded ? "Raw Body" : "Body"}</h2>
        </div>
        <div className="bg-slate-950 p-3 max-h-96 overflow-y-auto">
          <pre className="text-xs font-mono text-slate-300 whitespace-pre-wrap break-all">
            {receipt.body ? prettyJson(receipt.body) : "\u2014"}
          </pre>
        </div>
      </div>
    </div>
  );
}
