// In-memory `Commitments` (story 2.7): holds each community's secret in memory and commits with an injected
// HMAC-SHA512. Pure TypeScript, so it runs in tests and in the app. The secret never leaves this object:
// `commit` returns only the commitment.
import { commitPersonal, type HmacSha512 } from "@shopong/events";
import {
  err,
  ok,
  type CommitmentErrorCode,
  type CommitmentHex,
  type Commitments,
  type PersonalKind,
  type PortError,
  type Result,
} from "@shopong/ports";

export interface MemoryCommitmentsOptions {
  /** HMAC-SHA512(key, message) with 64 bytes out. Injected, so this adapter stays dependency-free. */
  readonly hmac: HmacSha512;
}

export class MemoryCommitments implements Commitments {
  readonly #hmac: HmacSha512;
  readonly #secrets = new Map<string, Uint8Array>();

  constructor(options: MemoryCommitmentsOptions) {
    this.#hmac = options.hmac;
  }

  /** Test control: give a community its secret. */
  addCommunity(community: string, secret: Uint8Array): void {
    this.#secrets.set(community, new Uint8Array(secret));
  }

  async commit(
    community: string,
    kind: PersonalKind,
    value: string,
  ): Promise<Result<CommitmentHex, PortError<CommitmentErrorCode>>> {
    const secret = this.#secrets.get(community);
    if (secret === undefined) {
      return err("unknown_community", "This Node has no secret for this community yet.");
    }
    const result = await commitPersonal(secret, kind, value, this.#hmac);
    if (!result.ok) return err(result.problem, result.message);
    return ok(result.commitment as CommitmentHex);
  }
}
