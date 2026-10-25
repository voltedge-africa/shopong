/** The words OpenUI reserves for its own action steps and built-in calls. */
const RESERVED = new Set(["Action", "Run", "Set", "Reset", "OpenUrl", "ToAssistant"]);

/**
 * The OpenUI Lang name of a capability tool: `message.send` becomes `MessageSend`, written
 * `@MessageSend()` in a screen. OpenUI action names are PascalCase words, so a dotted tool name
 * cannot be used as it is.
 */
export function actionNameOf(tool: string): string {
  const name = tool
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== "")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name) || RESERVED.has(name)) {
    throw new Error(`the tool name "${tool}" cannot be written as an OpenUI action`);
  }
  return name;
}
