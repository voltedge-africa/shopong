// Signed requests (story 2.5): a caller proves it holds its identity key; any change to a signed field, or
// another person's key, is refused. Signing and checking use the real adapter.
import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { webCryptoSha512 } from "@shopong/events";
import type { Did } from "@shopong/ports";
import { describe, expect, it } from "vite-plus/test";
import {
  isRequestNonce,
  requestBytes,
  signRequest,
  verifyRequestSignature,
  type RequestHeaders,
  type RequestParts,
} from "./request-proof.js";

const NONCE = "n0nce-value_1234567890";
const TIME = 1_793_000_000_000;

async function caller() {
  const auth = new IsoUcanCapabilityAuth();
  const actor = await auth.createIdentity();
  const parts: RequestParts = {
    method: "post",
    path: "/authority/check",
    body: '{"required":{"with":"ocn:space/x","can":"payment/approve"}}',
    nonce: NONCE,
    time: TIME,
    actor,
  };
  const headers = await signRequest(auth, parts, webCryptoSha512);
  if (!headers.ok) throw new Error(headers.error.message);
  return { auth, actor, parts, headers: headers.value };
}

/** The parts the Node rebuilds from a request it received, and the signature it was sent with. */
function received(
  parts: RequestParts,
  headers: RequestHeaders,
  override: Partial<RequestParts> = {},
) {
  return {
    parts: { ...parts, time: Number(headers["x-ocn-time"]), ...override },
    signature: headers["x-ocn-signature"] as never,
  };
}

describe("signed requests", () => {
  it("a request signed by its actor verifies", async () => {
    const c = await caller();
    const r = received(c.parts, c.headers);
    expect(await verifyRequestSignature(c.auth, r.parts, r.signature, webCryptoSha512)).toBe(true);
  });

  it("any change to a signed field is refused", async () => {
    const c = await caller();
    const changes: Partial<RequestParts>[] = [
      { body: '{"required":{"with":"ocn:space/x","can":"member/invite"}}' },
      { path: "/authority/checks" },
      { method: "PUT" },
      { nonce: "another-nonce-value-99" },
      { time: TIME + 1 },
      { actor: "did:key:z6MkNotSigned" as Did },
    ];
    for (const change of changes) {
      const r = received(c.parts, c.headers, change);
      expect(await verifyRequestSignature(c.auth, r.parts, r.signature, webCryptoSha512)).toBe(
        false,
      );
    }
  });

  it("another person's key does not verify the request", async () => {
    const c = await caller();
    const mallory = await new IsoUcanCapabilityAuth().createIdentity();
    const r = received(c.parts, c.headers, { actor: mallory });
    expect(await verifyRequestSignature(c.auth, r.parts, r.signature, webCryptoSha512)).toBe(false);
  });

  it("the signed bytes are the same on every device, and differ when any line moves", async () => {
    const c = await caller();
    const a = await requestBytes(c.parts, webCryptoSha512);
    const b = await requestBytes({ ...c.parts }, webCryptoSha512);
    expect(a).toEqual(b);
    const moved = await requestBytes(
      { ...c.parts, method: "POST\n/authority/check" },
      webCryptoSha512,
    );
    expect(moved).not.toEqual(a);
  });

  it("a nonce must be 16 to 128 URL-safe characters", () => {
    expect(isRequestNonce(NONCE)).toBe(true);
    expect(isRequestNonce("short")).toBe(false);
    expect(isRequestNonce("has space in it, not ok!!")).toBe(false);
    expect(isRequestNonce("x".repeat(129))).toBe(false);
  });

  it("refuses to sign with a key this adapter does not hold, or a malformed nonce", async () => {
    const c = await caller();
    const stranger = { ...c.parts, actor: "did:key:z6MkNotOurs" as Did };
    const refused = await signRequest(c.auth, stranger, webCryptoSha512);
    expect(refused.ok ? undefined : refused.error.code).toBe("unknown_issuer");
    const badNonce = await signRequest(c.auth, { ...c.parts, nonce: "x" }, webCryptoSha512);
    expect(badNonce.ok ? undefined : badNonce.error.code).toBe("invalid_request");
  });
});
