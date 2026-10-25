import { Effect } from "effect";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { createPin, hasPin, verifyPin } from "./pin";
import { pinStore } from "./pinStore";

/** `unavailable`: the PIN store could not be read, so the app stays locked. */
export type AuthStatus = "loading" | "setup" | "locked" | "unlocked" | "unavailable";

export type PinOutcome = "ok" | "invalid" | "mismatch" | "wrong" | "error";

type Auth = {
  status: AuthStatus;
  create: (pin: string, confirmation: string) => Promise<PinOutcome>;
  unlock: (pin: string) => Promise<PinOutcome>;
};

const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");

  useEffect(() => {
    return runCancellable(
      hasPin(pinStore).pipe(
        Effect.match({
          onSuccess: (stored): AuthStatus => (stored ? "locked" : "setup"),
          onFailure: (): AuthStatus => "unavailable",
        }),
        Effect.flatMap((next) => Effect.sync(() => setStatus(next))),
      ),
    );
  }, []);

  const create = useCallback(
    (pin: string, confirmation: string) =>
      Effect.runPromise(
        createPin(pinStore, pin, confirmation).pipe(
          Effect.map((): PinOutcome => "ok"),
          Effect.catchTags({
            InvalidPin: () => Effect.succeed<PinOutcome>("invalid"),
            PinMismatch: () => Effect.succeed<PinOutcome>("mismatch"),
            PinStoreFailure: () => Effect.succeed<PinOutcome>("error"),
          }),
          Effect.tap((outcome) =>
            outcome === "ok" ? Effect.sync(() => setStatus("unlocked")) : Effect.void,
          ),
        ),
      ),
    [],
  );

  const unlock = useCallback(
    (pin: string) =>
      Effect.runPromise(
        verifyPin(pinStore, pin).pipe(
          Effect.map((): PinOutcome => "ok"),
          Effect.catchTags({
            InvalidPin: () => Effect.succeed<PinOutcome>("invalid"),
            WrongPin: () => Effect.succeed<PinOutcome>("wrong"),
            NoPinSet: () => Effect.succeed<PinOutcome>("error"),
            PinStoreFailure: () => Effect.succeed<PinOutcome>("error"),
          }),
          Effect.tap((outcome) =>
            outcome === "ok" ? Effect.sync(() => setStatus("unlocked")) : Effect.void,
          ),
        ),
      ),
    [],
  );

  const value = useMemo(() => ({ status, create, unlock }), [status, create, unlock]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (auth === null) throw new Error("useAuth must be used inside AuthProvider");
  return auth;
}

function runCancellable(effect: Effect.Effect<void>): () => void {
  const fiber = Effect.runFork(effect);
  return () => fiber.interruptUnsafe();
}
