// The community's space: its key and the resource every capability in it applies to.

const COMMUNITY_KEY = /^[0-9a-f]{64}$/;

/** A community key is 32 random bytes as 64 lowercase hex characters (the event envelope's `space`). */
export function isCommunityKey(value: unknown): value is string {
  return typeof value === "string" && COMMUNITY_KEY.test(value);
}

/** Makes a new community key from the given random bytes (32 are used). */
export function newCommunityKey(randomBytes: (length: number) => Uint8Array): string {
  return toHex(randomBytes(32));
}

/** The resource a community's capabilities apply to: `ocn:space/<key>`. */
export function spaceUri(key: string): string {
  return `ocn:space/${key}`;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
