import type { EpochMs, EventId, PortError, Result } from "./common.js";

export interface StableAsset {
  /** For example `ZARP` or `ZARsc`. */
  readonly code: string;
  /** For example `solana-devnet`, `base-sepolia`. */
  readonly network: string;
  /** Base units per token as a power of ten (ZARsc 6; ZARP on EVM 18). */
  readonly decimals: number;
}

/**
 * Token amount in base units as a decimal integer string. A string, not a number,
 * because 18-decimal tokens overflow `Number.MAX_SAFE_INTEGER` at about 9,000 tokens.
 */
export type BaseUnits = string;

/** On-chain address in the network's own format. */
export type WalletAddress = string;

/** A wallet whose keys the custody arrangement behind the adapter controls. */
export interface CustodyWallet {
  readonly id: string;
  readonly label: string;
  readonly address: WalletAddress;
}

/** `submitted` until the network finalises it; then `confirmed` or `failed`. */
export type TransferStatus = "submitted" | "confirmed" | "failed";

export interface TransferRequest {
  readonly fromWalletId: string;
  readonly to: WalletAddress;
  /** Strictly positive. */
  readonly amount: BaseUnits;
  /** The event id; the idempotency key and the memo that reconciles the chain with the record. */
  readonly idempotencyKey: EventId;
}

export interface StableTransfer {
  readonly id: string;
  readonly idempotencyKey: EventId;
  readonly from: WalletAddress;
  readonly to: WalletAddress;
  readonly amount: BaseUnits;
  readonly status: TransferStatus;
  /** Chain transaction signature or hash, once broadcast. */
  readonly signature?: string;
  readonly submittedAt: EpochMs;
}

export type TransferErrorCode =
  | "invalid_request"
  | "unknown_wallet"
  | "insufficient_funds"
  | "idempotency_conflict";

/**
 * Optional stablecoin rail (ZARP or ZARsc, decision D-1). Runs on the OCN Node only.
 * Owning epic: 5.
 *
 * Confirmation is asynchronous on a real chain: callers poll `getTransfer` and must not
 * assume a transfer is confirmed when `transfer` resolves. The same idempotency key with
 * the same request returns the existing transfer; with a different request it is a conflict.
 */
export interface StableRail {
  readonly asset: StableAsset;
  /** Open the custody wallet with this label, creating it on first use. */
  openWallet(label: string): Promise<CustodyWallet>;
  /** Confirmed balance of any address. */
  balance(address: WalletAddress): Promise<BaseUnits>;
  transfer(request: TransferRequest): Promise<Result<StableTransfer, PortError<TransferErrorCode>>>;
  /** By transfer id. Undefined if unknown. */
  getTransfer(id: string): Promise<StableTransfer | undefined>;
}
