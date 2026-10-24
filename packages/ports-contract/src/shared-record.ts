import { expect } from "vite-plus/test";
import type {
  Did,
  JsonValue,
  SharedRecord,
  Space,
  SpaceDefinition,
  ViewChange,
} from "@shopong/ports";
import {
  expectErr,
  expectOk,
  registerContract,
  testEventId,
  unique,
  type ContractCase,
  type ContractOptions,
  type Factory,
} from "./support.js";

/** The events the contract appends. `tag` keeps ids unique across runs against a persistent backend. */
export type ContractEvent =
  | { readonly kind: "put"; readonly tag: string; readonly key: string; readonly value: JsonValue }
  | { readonly kind: "admit"; readonly tag: string; readonly writer: Did }
  | { readonly kind: "remove"; readonly tag: string; readonly writer: Did };

export interface SharedRecordHarness {
  /** A new peer with its own storage and a fresh local identity. */
  readonly peer: () => Promise<SharedRecord<ContractEvent>>;
  /** Exchange everything both peers hold for the space and update both views. */
  readonly replicate: (a: Space<ContractEvent>, b: Space<ContractEvent>) => Promise<void>;
}

const pad = (n: number): string => String(n).padStart(6, "0");

/**
 * A view that records the full applied order, so any divergence in order shows up as a
 * different view. Writers are admitted only by an `admit` event from an existing writer:
 * the stand-in for a capability check on the admitting event.
 */
export const contractDefinition: SpaceDefinition<ContractEvent> = {
  eventId: (event) => testEventId(event),
  apply: async (entries, view, host) => {
    for (const { id, writer, event } of entries) {
      const count = Number((await view.get("meta/count")) ?? 0);
      await view.put(`order/${pad(count)}`, id);
      await view.put("meta/count", count + 1);
      await view.put("meta/last", id);
      if (event.kind === "put")
        await view.put(`kv/${event.key}`, { value: event.value, by: writer });
      if (event.kind === "admit") {
        await host.addWriter(event.writer);
        await view.put(`writers/${event.writer}`, true);
      }
      if (event.kind === "remove") {
        await host.removeWriter(event.writer);
        await view.del(`writers/${event.writer}`);
      }
    }
  },
};

interface Peers {
  a: Space<ContractEvent>;
  b: Space<ContractEvent>;
  c: Space<ContractEvent>;
  tag: string;
}

/** Peer A creates a space and admits B and C; everyone is synced. */
async function threeWriters(h: SharedRecordHarness): Promise<Peers> {
  const tag = unique("r");
  const a = await (await h.peer()).create(contractDefinition);
  const b = await (await h.peer()).open(a.key, contractDefinition);
  const c = await (await h.peer()).open(a.key, contractDefinition);
  expectOk(await a.append({ kind: "admit", tag, writer: b.local }));
  expectOk(await a.append({ kind: "admit", tag, writer: c.local }));
  await h.replicate(a, b);
  await h.replicate(a, c);
  return { a, b, c, tag };
}

async function snapshot(space: Space<ContractEvent>): Promise<readonly unknown[]> {
  await space.update();
  return space.view.list("");
}

export const sharedRecordContract: readonly ContractCase<SharedRecordHarness>[] = [
  {
    name: "the creator is the first writer and its appends reach the view",
    run: async (h) => {
      const tag = unique("r");
      const a = await (await h.peer()).create(contractDefinition);
      expect(a.local).toMatch(/^did:/);
      expect(await a.writable()).toBe(true);
      expect(await a.writers()).toEqual([a.local]);
      const receipt = expectOk(
        await a.append({ kind: "put", tag, key: "greeting", value: "sawubona" }),
      );
      expect(receipt.duplicate).toBe(false);
      expect(receipt.id).toBe(
        testEventId({ kind: "put", tag, key: "greeting", value: "sawubona" }),
      );
      await a.update();
      expect(await a.view.get("kv/greeting")).toEqual({ value: "sawubona", by: a.local });
      expect(await a.view.get("meta/last")).toBe(receipt.id);
      expect(await a.view.get("kv/missing")).toBeUndefined();
    },
  },
  {
    name: "appending an event already in the log is a no-op",
    run: async (h) => {
      const tag = unique("r");
      const a = await (await h.peer()).create(contractDefinition);
      const event: ContractEvent = { kind: "put", tag, key: "k", value: 1 };
      const first = expectOk(await a.append(event));
      const second = expectOk(await a.append(event));
      expect(second).toEqual({ id: first.id, duplicate: true });
      await a.update();
      expect(await a.view.get("meta/count")).toBe(1);
    },
  },
  {
    name: "list returns only the prefix, in ascending key order",
    run: async (h) => {
      const tag = unique("r");
      const a = await (await h.peer()).create(contractDefinition);
      for (const key of ["b", "a/2", "c", "a/10", "a/1"])
        expectOk(await a.append({ kind: "put", tag, key, value: key }));
      await a.update();
      const keys = (await a.view.list("kv/a/")).map((entry) => entry.key);
      expect(keys).toEqual(["kv/a/1", "kv/a/10", "kv/a/2"]);
    },
  },
  {
    name: "a peer that was not admitted cannot write",
    run: async (h) => {
      const tag = unique("r");
      const a = await (await h.peer()).create(contractDefinition);
      const outsider = await (await h.peer()).open(a.key, contractDefinition);
      expectOk(await a.append({ kind: "put", tag, key: "k", value: 1 }));
      await h.replicate(a, outsider);
      expect(await outsider.writable()).toBe(false);
      expectErr(await outsider.append({ kind: "put", tag, key: "k", value: 2 }), "not_writable");
      expect(await outsider.view.get("kv/k")).toEqual({ value: 1, by: a.local });
    },
  },
  {
    name: "a writer admitted in apply can write, and its entries replicate",
    run: async (h) => {
      const { a, b, c, tag } = await threeWriters(h);
      expect(await b.writable()).toBe(true);
      expect(await a.writers()).toEqual([a.local, b.local, c.local].sort());
      expectOk(await b.append({ kind: "put", tag, key: "from-b", value: true }));
      await h.replicate(a, b);
      expect(await a.view.get("kv/from-b")).toEqual({ value: true, by: b.local });
    },
  },
  {
    name: "a removed writer can no longer write",
    run: async (h) => {
      const { a, b, tag } = await threeWriters(h);
      expectOk(await a.append({ kind: "remove", tag, writer: b.local }));
      await h.replicate(a, b);
      expect(await b.writable()).toBe(false);
      expect(await a.writers()).not.toContain(b.local);
      expectErr(await b.append({ kind: "put", tag, key: "late", value: true }), "not_writable");
    },
  },
  {
    name: "concurrent offline writes converge to one view whatever the arrival order",
    run: async (h) => {
      const { a, b, c, tag } = await threeWriters(h);
      // Disconnected: each writer appends, including conflicting writes to the same key.
      for (const [space, name] of [
        [a, "a"],
        [b, "b"],
        [c, "c"],
      ] as const) {
        expectOk(await space.append({ kind: "put", tag, key: "shared", value: name }));
        expectOk(await space.append({ kind: "put", tag, key: `own/${name}`, value: name }));
      }
      // Readers receive the same entries in different orders.
      const readerOne = await (await h.peer()).open(a.key, contractDefinition);
      const readerTwo = await (await h.peer()).open(a.key, contractDefinition);
      await h.replicate(readerOne, c);
      await h.replicate(readerOne, b);
      await h.replicate(readerOne, a);
      await h.replicate(readerTwo, a);
      await h.replicate(readerTwo, b);
      await h.replicate(readerTwo, c);
      // Writers sync among themselves in yet another order.
      await h.replicate(b, c);
      await h.replicate(c, a);
      await h.replicate(a, b);

      const expected = await snapshot(readerOne);
      expect(await a.view.get("meta/count")).toBe(8);
      for (const space of [readerTwo, a, b, c]) expect(await snapshot(space)).toEqual(expected);
    },
  },
  {
    name: "subscribers hear about view changes until they unsubscribe",
    run: async (h) => {
      const tag = unique("r");
      const a = await (await h.peer()).create(contractDefinition);
      const changes: ViewChange[] = [];
      const unsubscribe = a.subscribe((change) => changes.push(change));
      expectOk(await a.append({ kind: "put", tag, key: "k", value: 1 }));
      await a.update();
      expect(changes.length).toBeGreaterThan(0);
      expect(changes.at(-1)?.space).toBe(a.key);
      unsubscribe();
      unsubscribe();
      const heard = changes.length;
      expectOk(await a.append({ kind: "put", tag, key: "k", value: 2 }));
      await a.update();
      expect(changes.length).toBe(heard);
    },
  },
  {
    name: "a closed space refuses appends",
    run: async (h) => {
      const a = await (await h.peer()).create(contractDefinition);
      await a.close();
      expectErr(await a.append({ kind: "put", tag: unique("r"), key: "k", value: 1 }), "closed");
    },
  },
];

/** Register the `SharedRecord` contract against an adapter. */
export function runSharedRecordContract(
  factory: Factory<SharedRecordHarness>,
  options?: ContractOptions,
): void {
  registerContract("SharedRecord contract", sharedRecordContract, factory, options);
}
