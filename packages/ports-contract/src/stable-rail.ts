import { expect } from "vite-plus/test";
import type { BaseUnits, StableRail, StableTransfer, WalletAddress } from "@shopong/ports";
import {
  eventually,
  expectErr,
  expectOk,
  randomEventId,
  registerContract,
  unique,
  type ContractCase,
  type ContractOptions,
  type Factory,
} from "./support.js";

export interface StableRailHarness {
  readonly rail: StableRail;
  /** Credit an address with test tokens (devnet faucet or test mint). */
  readonly fund: (address: WalletAddress, amount: BaseUnits) => Promise<void>;
  /** How long to wait for confirmations; default 10 s. */
  readonly confirmTimeoutMs?: number;
}

async function settled(h: StableRailHarness, id: string): Promise<StableTransfer> {
  return eventually(
    async () => {
      const transfer = await h.rail.getTransfer(id);
      return transfer !== undefined && transfer.status !== "submitted" ? transfer : undefined;
    },
    { timeoutMs: h.confirmTimeoutMs ?? 10_000 },
  );
}

export const stableRailContract: readonly ContractCase<StableRailHarness>[] = [
  {
    name: "describes its asset",
    run: async ({ rail }) => {
      expect(rail.asset.code).toEqual(expect.any(String));
      expect(rail.asset.network).toEqual(expect.any(String));
      expect(Number.isInteger(rail.asset.decimals) && rail.asset.decimals >= 0).toBe(true);
    },
  },
  {
    name: "opening a wallet by label is idempotent and a new wallet is empty",
    run: async ({ rail }) => {
      const label = unique("w");
      const wallet = await rail.openWallet(label);
      expect(await rail.openWallet(label)).toEqual(wallet);
      const other = await rail.openWallet(unique("w"));
      expect(other.address).not.toBe(wallet.address);
      expect(await rail.balance(other.address)).toBe("0");
    },
  },
  {
    name: "a transfer confirms asynchronously and moves the balance",
    run: async (h) => {
      const from = await h.rail.openWallet(unique("w"));
      const to = await h.rail.openWallet(unique("w"));
      await h.fund(from.address, "1000000");
      await eventually(async () =>
        (await h.rail.balance(from.address)) === "1000000" ? true : undefined,
      );
      const key = randomEventId();
      const submitted = expectOk(
        await h.rail.transfer({
          fromWalletId: from.id,
          to: to.address,
          amount: "400000",
          idempotencyKey: key,
        }),
      );
      expect(["submitted", "confirmed"]).toContain(submitted.status);
      expect(submitted).toMatchObject({
        idempotencyKey: key,
        from: from.address,
        to: to.address,
        amount: "400000",
      });
      const final = await settled(h, submitted.id);
      expect(final.status).toBe("confirmed");
      expect(final.signature).toEqual(expect.any(String));
      expect(await h.rail.balance(to.address)).toBe("400000");
      expect(await h.rail.balance(from.address)).toBe("600000");
    },
  },
  {
    name: "the same idempotency key and request returns the same transfer; a different request conflicts",
    run: async (h) => {
      const from = await h.rail.openWallet(unique("w"));
      const to = await h.rail.openWallet(unique("w"));
      await h.fund(from.address, "1000");
      await eventually(async () =>
        (await h.rail.balance(from.address)) === "1000" ? true : undefined,
      );
      const request = {
        fromWalletId: from.id,
        to: to.address,
        amount: "100",
        idempotencyKey: randomEventId(),
      };
      const first = expectOk(await h.rail.transfer(request));
      expect(expectOk(await h.rail.transfer({ ...request })).id).toBe(first.id);
      expectErr(await h.rail.transfer({ ...request, amount: "200" }), "idempotency_conflict");
      await settled(h, first.id);
      expect(await h.rail.balance(to.address)).toBe("100");
    },
  },
  {
    name: "refuses a transfer larger than the balance",
    run: async ({ rail }) => {
      const from = await rail.openWallet(unique("w"));
      const to = await rail.openWallet(unique("w"));
      expectErr(
        await rail.transfer({
          fromWalletId: from.id,
          to: to.address,
          amount: "1",
          idempotencyKey: randomEventId(),
        }),
        "insufficient_funds",
      );
    },
  },
  {
    name: "refuses malformed amounts and unknown wallets",
    run: async ({ rail }) => {
      const from = await rail.openWallet(unique("w"));
      for (const amount of ["0", "-1", "1.5", "abc", ""]) {
        expectErr(
          await rail.transfer({
            fromWalletId: from.id,
            to: from.address,
            amount,
            idempotencyKey: randomEventId(),
          }),
          "invalid_request",
        );
      }
      expectErr(
        await rail.transfer({
          fromWalletId: "no-such-wallet",
          to: from.address,
          amount: "1",
          idempotencyKey: randomEventId(),
        }),
        "unknown_wallet",
      );
      expect(await rail.getTransfer("no-such-transfer")).toBeUndefined();
    },
  },
];

/** Register the `StableRail` contract against an adapter. */
export function runStableRailContract(
  factory: Factory<StableRailHarness>,
  options?: ContractOptions,
): void {
  registerContract("StableRail contract", stableRailContract, factory, options);
}
