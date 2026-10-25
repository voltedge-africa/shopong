// Import the polyfills before the adapter: iso-web reads `globalThis.crypto` when it loads.
import "./cryptoPolyfills";
import { IsoUcanCapabilityAuth } from "@shopong/adapter-ucan-iso";
import type { CapabilityAuth, Did } from "@shopong/ports";
import { Effect, Exit, Schema } from "effect";

import { RECOVERY_SEED_BYTES, fromHex, identitySeed, toHex } from "./identitySeed";

/**
 * Where the recovery seed lives, as 64 lowercase hex characters. Native: the platform keystore. See
 * `identityStore.ts`. Only the seed is stored, never the derived key: story 2.6 restores the same
 * identity from the same seed.
 */
export type IdentityStore = {
  read: () => Promise<string | null>;
  write: (seed: string) => Promise<void>;
};

export type Identity = { did: Did; auth: CapabilityAuth };

export class IdentityStoreFailure extends Schema.TaggedError<IdentityStoreFailure>()(
  "IdentityStoreFailure",
  { message: Schema.String },
) {}

/** A value is stored but it is not a seed. It is left alone, never overwritten. */
export class UnreadableIdentity extends Schema.TaggedError<UnreadableIdentity>()(
  "UnreadableIdentity",
  {},
) {}

const storeFailure = (cause: unknown) =>
  new IdentityStoreFailure({ message: cause instanceof Error ? cause.message : String(cause) });

const buildIdentity = async (recoverySeed: Uint8Array): Promise<Identity> => {
  const auth = new IsoUcanCapabilityAuth({ identitySeed: identitySeed(recoverySeed) });
  return { did: await auth.createIdentity(), auth };
};

const readStored = (store: IdentityStore) =>
  Effect.tryPromise({ try: store.read, catch: storeFailure });

const identityFrom = Effect.fn("identityFrom")(function* (stored: string) {
  const seed = fromHex(stored, RECOVERY_SEED_BYTES);
  if (seed === null) return yield* new UnreadableIdentity();
  return yield* Effect.tryPromise({
    try: () => buildIdentity(seed),
    catch: () => new UnreadableIdentity(),
  });
});

/** The identity already on this device, or `null` when none has been made. Never creates one. */
export const loadIdentity = Effect.fn("loadIdentity")(function* (store: IdentityStore) {
  const stored = yield* readStored(store);
  if (stored === null) return null;
  return yield* identityFrom(stored);
});

/**
 * Makes the identity once. The seed is saved before the DID is returned, so a DID is never shown for a
 * key that was not kept. If something is already stored, that is used (or reported unreadable): a
 * stored seed is never replaced.
 */
export const createIdentity = Effect.fn("createIdentity")(function* (
  store: IdentityStore,
  randomBytes: (length: number) => Uint8Array,
) {
  const stored = yield* readStored(store);
  if (stored !== null) return yield* identityFrom(stored);
  const seed = randomBytes(RECOVERY_SEED_BYTES);
  const identity = yield* Effect.tryPromise({
    try: () => buildIdentity(seed),
    catch: storeFailure,
  });
  yield* Effect.tryPromise({ try: () => store.write(toHex(seed)), catch: storeFailure });
  return identity;
});

const inFlight = new WeakMap<
  IdentityStore,
  Promise<Exit.Exit<Identity, IdentityStoreFailure | UnreadableIdentity>>
>();

/**
 * `createIdentity`, but a second call while the first is still saving joins it instead of racing it, so
 * two quick taps make one identity only.
 */
export const createIdentityOnce = (
  store: IdentityStore,
  randomBytes: (length: number) => Uint8Array,
) =>
  Effect.suspend(() => {
    let attempt = inFlight.get(store);
    if (attempt === undefined) {
      attempt = Effect.runPromiseExit(createIdentity(store, randomBytes)).finally(() =>
        inFlight.delete(store),
      );
      inFlight.set(store, attempt);
    }
    const joined = attempt;
    return Effect.flatMap(
      Effect.promise(() => joined),
      (exit) => exit,
    );
  });

/** A store that forgets everything when the page does. For the web, which has no keystore. */
export const memoryIdentityStore = (): IdentityStore => {
  let stored: string | null = null;
  return {
    read: async () => stored,
    write: async (seed) => {
      stored = seed;
    },
  };
};
