import { Effect, Schema } from "effect";

/** Where the PIN lives. Native: the platform keystore. See `pinStore.ts`. */
export type PinStore = {
  read: () => Promise<string | null>;
  write: (pin: string) => Promise<void>;
};

export const PIN_LENGTH = 6;

export const Pin = Schema.String.check(
  Schema.isPattern(new RegExp(`^\\d{${PIN_LENGTH}}$`), {
    message: `Enter ${PIN_LENGTH} digits.`,
  }),
);

export class InvalidPin extends Schema.TaggedError<InvalidPin>()("InvalidPin", {
  message: Schema.String,
}) {}

export class PinMismatch extends Schema.TaggedError<PinMismatch>()("PinMismatch", {}) {}

export class WrongPin extends Schema.TaggedError<WrongPin>()("WrongPin", {}) {}

export class NoPinSet extends Schema.TaggedError<NoPinSet>()("NoPinSet", {}) {}

export class PinStoreFailure extends Schema.TaggedError<PinStoreFailure>()("PinStoreFailure", {
  message: Schema.String,
}) {}

const decodePin = Schema.decodeUnknownEffect(Pin);

const validate = (value: string) =>
  decodePin(value).pipe(Effect.mapError((error) => new InvalidPin({ message: error.message })));

const storeFailure = (cause: unknown) =>
  new PinStoreFailure({ message: cause instanceof Error ? cause.message : String(cause) });

export const hasPin = (store: PinStore) =>
  Effect.tryPromise({ try: store.read, catch: storeFailure }).pipe(
    Effect.map((stored) => stored !== null),
  );

/** Saves a new PIN once it has been typed twice the same. */
export const createPin = Effect.fn("createPin")(function* (
  store: PinStore,
  pin: string,
  confirmation: string,
) {
  yield* validate(pin);
  if (pin !== confirmation) return yield* new PinMismatch();
  yield* Effect.tryPromise({ try: () => store.write(pin), catch: storeFailure });
});

export const verifyPin = Effect.fn("verifyPin")(function* (store: PinStore, pin: string) {
  yield* validate(pin);
  const stored = yield* Effect.tryPromise({ try: store.read, catch: storeFailure });
  if (stored === null) return yield* new NoPinSet();
  if (stored !== pin) return yield* new WrongPin();
});
