/** The one thing every shipped page says: it has loaded and can be sent its data. */
export function isReadyMessage(raw: unknown): boolean {
  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return false;
    }
  }
  return (
    typeof value === "object" && value !== null && (value as { type?: unknown }).type === "ready"
  );
}
