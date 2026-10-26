// The OCN Node's address, from the build (`EXPO_PUBLIC_OCN_NODE_URL`, one value per build profile, story 3.4 Q4).
// The address is not a secret: it is read by the app and never stored. Plain HTTP is allowed only for a Node on
// this machine or on the Android emulator's host alias (10.0.2.2); anything else must be HTTPS.

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "10.0.2.2"]);

export type NodeAddress = { ok: true; url: string } | { ok: false; reason: string };

/**
 * Checks a configured address and returns it without a trailing slash. Never echoes the value in a reason. Plain HTTP
 * is accepted only in a development build (review P10), localhost and the emulator's host included; any other build
 * needs HTTPS.
 */
export function nodeAddressOf(
  raw: string | undefined,
  options: { readonly development: boolean },
): NodeAddress {
  const text = raw?.trim() ?? "";
  if (text === "") return { ok: false, reason: "No OCN Node is set for this build." };
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return { ok: false, reason: "The OCN Node address for this build is not a web address." };
  }
  if (
    parsed.search !== "" ||
    parsed.hash !== "" ||
    (parsed.pathname !== "/" && parsed.pathname !== "")
  ) {
    return {
      ok: false,
      reason: "The OCN Node address for this build should be only the address, with no path.",
    };
  }
  if (parsed.protocol === "https:") return { ok: true, url: parsed.origin };
  if (parsed.protocol === "http:" && options.development && LOCAL_HOSTS.has(parsed.hostname)) {
    return { ok: true, url: parsed.origin };
  }
  return { ok: false, reason: "The OCN Node address must use HTTPS in this build." };
}

/** Whether this is a development build (Metro sets `__DEV__`). Absent outside React Native, so tests see false. */
export const isDevelopmentBuild = (): boolean => typeof __DEV__ !== "undefined" && __DEV__ === true;

/** The address of this build. Expo replaces the literal at build time. */
export const NODE_ADDRESS = nodeAddressOf(process.env.EXPO_PUBLIC_OCN_NODE_URL, {
  development: isDevelopmentBuild(),
});
