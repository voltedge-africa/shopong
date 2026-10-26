// The record component: the SharedRecord adapter on Autobase, held by the Node on its data folder (story 3.2).
// The Node's own identity is a placeholder DID derived from the master key until the identity epic gives the Node one.

import { createHmac } from "node:crypto";
import { join } from "node:path";
import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import { openAutobaseRecord, type AutobaseSharedRecord } from "@shopong/record-autobase";
import type { Did } from "@shopong/ports";
import type { NodeComponent } from "./components.ts";
import { ConfigError, type ResolvedSecrets } from "./secrets.ts";

export const RECORD_MASTER_KEY = "RECORD_MASTER_KEY";
export const RECORD_DIR = "record";

/** Decodes the master key from its hex secret, or refuses it by name (never by value). */
export function masterKeyOf(secrets: ResolvedSecrets): Buffer {
  const hex = secrets.get(RECORD_MASTER_KEY) ?? "";
  // One repeated digit (all zeros included) is a placeholder, not a key.
  const shaped = /^[0-9a-fA-F]{64}$/u.test(hex) && !/^(.)\1{63}$/u.test(hex);
  if (!shaped) {
    throw new ConfigError(
      `${RECORD_MASTER_KEY} must be 64 hex characters (32 bytes), not a placeholder or one repeated digit`,
      [RECORD_MASTER_KEY],
    );
  }
  return Buffer.from(hex, "hex");
}

/** The Node's placeholder DID: stable for a given master key, and not a real identity yet. */
export function nodeDid(masterKey: Uint8Array): Did {
  const digest = createHmac("sha512", masterKey).update("ocn/node/v1/did", "utf8").digest();
  return `did:ocn:node-${digest.subarray(0, 16).toString("hex")}` as Did;
}

/**
 * The Node's own `did:key` identity, derived from the master key, for signing the money postings it mirrors into the
 * record (story 4.6). Not the record's writer identity (`nodeDid`), which is a placeholder of another kind.
 */
export async function nodeIdentityOf(masterKey: Uint8Array): Promise<Did> {
  const seed = createHmac("sha512", masterKey)
    .update("ocn/node/v1/identity", "utf8")
    .digest()
    .subarray(0, 32);
  return new IsoUcanCapabilityAuth({ identitySeed: new Uint8Array(seed) }).createIdentity();
}

export interface OpenedRecord {
  readonly record: AutobaseSharedRecord<unknown>;
  readonly component: NodeComponent;
}

/** Opens the record under `<dataDir>/record`. Call only when the record component is enabled and its secret is present. */
export async function openRecordComponent(
  dataDir: string,
  secrets: ResolvedSecrets,
): Promise<OpenedRecord> {
  const masterKey = masterKeyOf(secrets);
  const record = await openAutobaseRecord<unknown>({
    local: nodeDid(masterKey),
    dataDir: join(dataDir, RECORD_DIR),
    masterKey,
  });
  const component: NodeComponent = {
    name: "record",
    async check() {
      return { status: "ok", mode: "autobase" };
    },
  };
  return { record, component };
}
