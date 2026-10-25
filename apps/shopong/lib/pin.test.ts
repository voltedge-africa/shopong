import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import { createPin, hasPin, verifyPin, type PinStore } from "./pin";

const memoryStore = (
  initial: string | null = null,
): PinStore & { current: () => string | null } => {
  let stored = initial;
  return {
    read: async () => stored,
    write: async (pin) => {
      stored = pin;
    },
    current: () => stored,
  };
};

const failureOf = (effect: Effect.Effect<unknown, { _tag: string }>) =>
  Effect.runPromise(Effect.flip(effect)).then((error) => error._tag);

describe("hasPin", () => {
  it("is false until a PIN has been saved", async () => {
    expect(await Effect.runPromise(hasPin(memoryStore()))).toBe(false);
    expect(await Effect.runPromise(hasPin(memoryStore("123456")))).toBe(true);
  });
});

describe("createPin", () => {
  it("saves the PIN when it is typed twice the same", async () => {
    const store = memoryStore();
    await Effect.runPromise(createPin(store, "123456", "123456"));
    expect(store.current()).toBe("123456");
  });

  it("fails with PinMismatch and saves nothing when the confirmation differs", async () => {
    const store = memoryStore();
    expect(await failureOf(createPin(store, "123456", "654321"))).toBe("PinMismatch");
    expect(store.current()).toBeNull();
  });

  it.each(["12345", "1234567", "12345a", "", "      "])(
    "rejects %j as not 6 digits",
    async (bad) => {
      const store = memoryStore();
      expect(await failureOf(createPin(store, bad, bad))).toBe("InvalidPin");
      expect(store.current()).toBeNull();
    },
  );
});

describe("verifyPin", () => {
  it("succeeds for the saved PIN", async () => {
    await Effect.runPromise(verifyPin(memoryStore("123456"), "123456"));
  });

  it("fails with WrongPin for a different PIN", async () => {
    expect(await failureOf(verifyPin(memoryStore("123456"), "000000"))).toBe("WrongPin");
  });

  it("fails with NoPinSet when nothing was saved", async () => {
    expect(await failureOf(verifyPin(memoryStore(), "123456"))).toBe("NoPinSet");
  });

  it("fails with PinStoreFailure when the store throws", async () => {
    const broken: PinStore = {
      read: async () => {
        throw new Error("keystore unavailable");
      },
      write: async () => {},
    };
    expect(await failureOf(verifyPin(broken, "123456"))).toBe("PinStoreFailure");
  });
});
