// The SharedRecord port's contract suite, run against the Autobase adapter. Each peer is a Node-side
// record with its own data folder; all peers of one test share the Node's master key.
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vite-plus/test";
import { runSharedRecordContract, type ContractEvent } from "@shopong/ports-contract";
import { openAutobaseRecord, type AutobaseSharedRecord } from "./index.js";
import { replicatePair } from "./test-support.js";

const records: AutobaseSharedRecord<ContractEvent>[] = [];
const dirs: string[] = [];

afterAll(async () => {
  for (const record of records) await record.close();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

runSharedRecordContract(
  () => {
    const masterKey = randomBytes(32);
    let peers = 0;
    return {
      peer: async () => {
        const dataDir = mkdtempSync(join(tmpdir(), "record-contract-"));
        dirs.push(dataDir);
        const record = await openAutobaseRecord<ContractEvent>({
          local: `did:test:peer-${randomBytes(4).toString("hex")}-${String(++peers)}`,
          dataDir,
          masterKey,
        });
        records.push(record);
        return record;
      },
      replicate: replicatePair,
    };
  },
  { timeoutMs: 120_000 },
);
