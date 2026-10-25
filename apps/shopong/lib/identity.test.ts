import { Effect } from "effect";
import { describe, expect, it, vi } from "vite-plus/test";

// Node already has everything the polyfills would add, and expo-crypto needs the Expo runtime.
vi.mock("./cryptoPolyfills", () => ({ installedPolyfills: [] }));

import {
  createIdentity,
  createIdentityOnce,
  loadIdentity,
  memoryIdentityStore,
  type IdentityStore,
} from "./identity";

const GOLDEN_HEX = Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0")).join("");
const GOLDEN_DID = "did:key:z6MkmtmqQWNzwamfa7QWkNU3Sk2qHpuXK4VrfMXXqVouVZtL";
const golden = () => Uint8Array.from({ length: 32 }, (_, i) => i);

const memoryStore = (
  initial: string | null = null,
): IdentityStore & { current: () => string | null; writes: () => number } => {
  let stored = initial;
  let writes = 0;
  return {
    read: async () => stored,
    write: async (seed) => {
      writes++;
      stored = seed;
    },
    current: () => stored,
    writes: () => writes,
  };
};

const failureOf = (effect: Effect.Effect<unknown, { _tag: string }>) =>
  Effect.runPromise(Effect.flip(effect)).then((error) => error._tag);

describe("createIdentity", () => {
  it("saves 32 random bytes and returns the DID of that seed", async () => {
    const store = memoryStore();
    const identity = await Effect.runPromise(createIdentity(store, golden));
    expect(store.current()).toBe(GOLDEN_HEX);
    expect(identity.did).toBe(GOLDEN_DID);
  });

  it("fails and saves nothing when the keystore write throws", async () => {
    const store: IdentityStore = {
      read: async () => null,
      write: async () => {
        throw new Error("keystore locked");
      },
    };
    expect(await failureOf(createIdentity(store, golden))).toBe("IdentityStoreFailure");
  });

  it("makes one identity when tapped twice at the same moment", async () => {
    const store = memoryStore();
    let calls = 0;
    const random = (n: number) => {
      calls++;
      return Uint8Array.from({ length: n }, () => calls);
    };
    const [first, second] = await Promise.all([
      Effect.runPromise(createIdentityOnce(store, random)),
      Effect.runPromise(createIdentityOnce(store, random)),
    ]);
    expect(second.did).toBe(first.did);
    expect(store.writes()).toBe(1);
    expect(calls).toBe(1);
  });

  it("makes one identity when tapped again after the first finished", async () => {
    const store = memoryStore();
    const first = await Effect.runPromise(createIdentity(store, golden));
    const second = await Effect.runPromise(createIdentity(store, () => new Uint8Array(32).fill(7)));
    expect(second.did).toBe(first.did);
    expect(store.writes()).toBe(1);
  });

  it("leaves an unreadable stored value alone", async () => {
    const store = memoryStore("not a seed");
    expect(await failureOf(createIdentity(store, golden))).toBe("UnreadableIdentity");
    expect(store.current()).toBe("not a seed");
    expect(store.writes()).toBe(0);
  });
});

describe("loadIdentity", () => {
  it("is null when nothing is stored, and creates nothing", async () => {
    const store = memoryStore();
    expect(await Effect.runPromise(loadIdentity(store))).toBeNull();
    expect(store.writes()).toBe(0);
  });

  it("returns the same DID for a stored seed", async () => {
    const store = memoryStore(GOLDEN_HEX);
    const identity = await Effect.runPromise(loadIdentity(store));
    expect(identity?.did).toBe(GOLDEN_DID);
    expect(store.writes()).toBe(0);
  });

  it.each(["", "abc", "zz".repeat(32), "00".repeat(31), "AB".repeat(32)])(
    "reports %j as unreadable and does not touch it",
    async (bad) => {
      const store = memoryStore(bad);
      expect(await failureOf(loadIdentity(store))).toBe("UnreadableIdentity");
      expect(store.current()).toBe(bad);
    },
  );

  it("fails with IdentityStoreFailure when the keystore cannot be read", async () => {
    const store: IdentityStore = {
      read: async () => {
        throw new Error("boom");
      },
      write: async () => {},
    };
    expect(await failureOf(loadIdentity(store))).toBe("IdentityStoreFailure");
  });
});

describe("memoryIdentityStore (the web)", () => {
  it("starts empty, so a reloaded page has no identity and offers Create", async () => {
    const before = memoryIdentityStore();
    await Effect.runPromise(createIdentity(before, golden));
    expect(await Effect.runPromise(loadIdentity(before))).not.toBeNull();
    // A reload makes a new page, and so a new store.
    expect(await Effect.runPromise(loadIdentity(memoryIdentityStore()))).toBeNull();
  });
});
