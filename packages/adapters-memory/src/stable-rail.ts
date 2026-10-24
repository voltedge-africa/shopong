import {
  err,
  isEventId,
  ok,
  type BaseUnits,
  type Clock,
  type CustodyWallet,
  type IdGenerator,
  type PortError,
  type Result,
  type StableAsset,
  type StableRail,
  type StableTransfer,
  type TransferErrorCode,
  type TransferRequest,
  type WalletAddress,
} from "@shopong/ports";
import { createCounterIds, createManualClock, fakeDigest, stableStringify } from "./support.js";

export interface MemoryStableRailOptions {
  asset?: StableAsset;
  clock?: Clock;
  ids?: IdGenerator;
  /**
   * How many `getTransfer` reads a transfer stays `submitted` before it confirms. Default 1,
   * so callers are forced to poll as they must on a real chain.
   */
  confirmAfterReads?: number;
}

interface PendingTransfer {
  transfer: StableTransfer;
  body: string;
  readsLeft: number;
}

const BASE_UNITS = /^[1-9]\d*$/;

/** In-memory `StableRail`: a toy chain with custody wallets, a faucet and delayed confirmation. */
export class MemoryStableRail implements StableRail {
  readonly asset: StableAsset;
  readonly #clock: Clock;
  readonly #ids: IdGenerator;
  readonly #confirmAfterReads: number;
  readonly #balances = new Map<WalletAddress, bigint>();
  readonly #wallets = new Map<string, CustodyWallet>();
  readonly #transfers = new Map<string, PendingTransfer>();
  readonly #byKey = new Map<string, string>();

  constructor(options: MemoryStableRailOptions = {}) {
    this.asset = options.asset ?? { code: "ZARsc", network: "memory", decimals: 6 };
    this.#clock = options.clock ?? createManualClock();
    this.#ids = options.ids ?? createCounterIds();
    this.#confirmAfterReads = options.confirmAfterReads ?? 1;
  }

  async openWallet(label: string): Promise<CustodyWallet> {
    const existing = [...this.#wallets.values()].find((wallet) => wallet.label === label);
    if (existing !== undefined) return existing;
    const id = this.#ids.next("wallet");
    const wallet = { id, label, address: `mem1${fakeDigest(id).slice(0, 32)}` };
    this.#wallets.set(id, wallet);
    return wallet;
  }

  async balance(address: WalletAddress): Promise<BaseUnits> {
    return (this.#balances.get(address) ?? 0n).toString();
  }

  /** Test control: credit an address, like a devnet faucet or a mint. */
  async mint(address: WalletAddress, amount: BaseUnits): Promise<void> {
    if (!BASE_UNITS.test(amount)) throw new TypeError("amount must be a positive integer string");
    this.#balances.set(address, (this.#balances.get(address) ?? 0n) + BigInt(amount));
  }

  async transfer(
    request: TransferRequest,
  ): Promise<Result<StableTransfer, PortError<TransferErrorCode>>> {
    if (!BASE_UNITS.test(request.amount))
      return err("invalid_request", "amount must be a positive integer string");
    if (!isEventId(request.idempotencyKey))
      return err("invalid_request", "idempotencyKey must be an event id");
    if (request.to.length === 0) return err("invalid_request", "destination address required");
    const body = stableStringify(request);
    const previousId = this.#byKey.get(request.idempotencyKey);
    if (previousId !== undefined) {
      const previous = this.#transfers.get(previousId);
      if (previous !== undefined && previous.body === body) return ok(previous.transfer);
      return err("idempotency_conflict", "idempotency key reused with a different transfer");
    }
    const from = this.#wallets.get(request.fromWalletId);
    if (from === undefined) return err("unknown_wallet", `unknown wallet ${request.fromWalletId}`);
    if (this.#spendable(from.address) < BigInt(request.amount)) {
      return err("insufficient_funds", "wallet balance is too low");
    }
    const id = this.#ids.next("tx");
    const transfer: StableTransfer = {
      id,
      idempotencyKey: request.idempotencyKey,
      from: from.address,
      to: request.to,
      amount: request.amount,
      status: "submitted",
      signature: `memsig${fakeDigest(`${id}|${body}`)}`,
      submittedAt: this.#clock.now(),
    };
    this.#transfers.set(id, { transfer, body, readsLeft: this.#confirmAfterReads });
    this.#byKey.set(request.idempotencyKey, id);
    if (this.#confirmAfterReads === 0) this.#confirm(id);
    return ok(transfer);
  }

  async getTransfer(id: string): Promise<StableTransfer | undefined> {
    const pending = this.#transfers.get(id);
    if (pending === undefined) return undefined;
    if (pending.transfer.status === "submitted") {
      pending.readsLeft--;
      if (pending.readsLeft < 0) this.#confirm(id);
    }
    return this.#transfers.get(id)?.transfer;
  }

  #spendable(address: WalletAddress): bigint {
    let outgoing = 0n;
    for (const { transfer } of this.#transfers.values()) {
      if (transfer.from === address && transfer.status === "submitted")
        outgoing += BigInt(transfer.amount);
    }
    return (this.#balances.get(address) ?? 0n) - outgoing;
  }

  #confirm(id: string): void {
    const pending = this.#transfers.get(id);
    if (pending === undefined || pending.transfer.status !== "submitted") return;
    const { from, to, amount } = pending.transfer;
    const value = BigInt(amount);
    const available = this.#balances.get(from) ?? 0n;
    if (available < value) {
      pending.transfer = { ...pending.transfer, status: "failed" };
      return;
    }
    this.#balances.set(from, available - value);
    this.#balances.set(to, (this.#balances.get(to) ?? 0n) + value);
    pending.transfer = { ...pending.transfer, status: "confirmed" };
  }
}
