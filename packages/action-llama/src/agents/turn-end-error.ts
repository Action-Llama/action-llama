export function extractTurnEndError(event: unknown): string | undefined {
  if (!event || typeof event !== "object") return undefined;

  const record = event as Record<string, unknown>;
  const candidates = [
    record.errorMessage,
    record.error_message,
    record.error,
    record.message,
  ];

  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  const result = record.result;
  if (result && typeof result === "object") {
    return extractTurnEndError(result);
  }

  return undefined;
}
