// Attachment hashes (matrix: file matches / differs / no hash recorded). `verifyAttachment` is pure
// over the injected SHA-512. The expected digests are the golden vectors, computed by Python hashlib.
import { describe, expect, it } from "vite-plus/test";
import { ATTACHMENT_MESSAGES, verifyAttachment, webCryptoSha512 } from "../src/index.js";
import { hexToBytes, vectors } from "./vectors.js";

describe("verifyAttachment", () => {
  for (const file of vectors.attachments) {
    it(`reads verified for ${file.name}`, async () => {
      const result = await verifyAttachment(
        hexToBytes(file.bytesHex),
        file.sha512,
        webCryptoSha512,
      );
      expect(result).toEqual({ status: "verified" });
    });

    it(`reads does not match when ${file.name} is changed`, async () => {
      const changed = new Uint8Array([...hexToBytes(file.bytesHex), 0x21]);
      const result = await verifyAttachment(changed, file.sha512, webCryptoSha512);
      expect(result).toEqual({ status: "does_not_match" });
    });
  }

  it("says can't be checked when no hash is recorded", async () => {
    const [file] = vectors.attachments;
    if (!file) throw new Error("missing vector");
    const bytes = hexToBytes(file.bytesHex);
    expect(await verifyAttachment(bytes, undefined, webCryptoSha512)).toEqual({
      status: "cannot_check",
    });
    expect(await verifyAttachment(bytes, "", webCryptoSha512)).toEqual({ status: "cannot_check" });
  });

  it("says can't be checked for a recorded hash that is not 128 lowercase hex characters", async () => {
    const [file] = vectors.attachments;
    if (!file) throw new Error("missing vector");
    const bytes = hexToBytes(file.bytesHex);
    expect(await verifyAttachment(bytes, file.sha512.toUpperCase(), webCryptoSha512)).toEqual({
      status: "cannot_check",
    });
    expect(await verifyAttachment(bytes, file.sha512.slice(2), webCryptoSha512)).toEqual({
      status: "cannot_check",
    });
  });

  it("uses the plain words a person sees", () => {
    expect(ATTACHMENT_MESSAGES).toEqual({
      verified: "verified",
      does_not_match: "does not match",
      cannot_check: "can't be checked",
    });
  });
});
