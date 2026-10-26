// The app's production HMAC-SHA512 (AGENTS rule 6, story 2.7). It must give the golden commitments that the
// Node and the events package give, so a commitment computed on either side matches. The phone never holds a
// community secret; this is the injected function for any screen that needs to check a commitment.
import golden from "@shopong/events/vectors/golden.json" with { type: "json" };
import { describe, expect, it } from "vite-plus/test";
import { hmacSha512 } from "./hmac";

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++)
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

const toHex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

describe("hmacSha512", () => {
  it("matches the RFC 4231 test case 1 digest", async () => {
    const key = new Uint8Array(20).fill(0x0b);
    const mac = await hmacSha512(key, new TextEncoder().encode("Hi There"));
    expect(toHex(mac)).toBe(
      "87aa7cdea5ef619d4ff0b4241a1d6cb02379f4e2ce4ec2787ad0b30545e17cdedaa833b7d6b8a702038b274eaea3f4e4be9d914eeb61f1702e696c203a126854",
    );
  });

  it("gives the golden commitments of the events vectors", async () => {
    for (const v of golden.commitments) {
      const mac = await hmacSha512(hexToBytes(v.secretHex), new TextEncoder().encode(v.value));
      expect(toHex(mac)).toBe(v.commitment);
    }
  });
});
