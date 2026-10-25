/**
 * The two themes a shipped page can dress in. They are the themes of the app's PanelUI theme,
 * so a page follows the app's own theme state.
 */
export type ThemeMode = "light" | "dark";

/** Tell a shipped page which theme to dress in; the page restyles itself when it hears it. */
export function themeMessage(mode: ThemeMode): { type: "theme"; mode: ThemeMode } {
  return { type: "theme", mode };
}

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
