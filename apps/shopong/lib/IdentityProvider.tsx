import { getRandomBytes } from "expo-crypto";
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

import { useAuth } from "./auth";
import { createIdentityOnce, loadIdentity, type Identity } from "./identity";
import { identityStore } from "./identityStore";

/**
 * `none`: nothing made yet. `unreadable`: something is stored but is not a seed, and is left alone.
 * `unavailable`: the keystore could not be read.
 */
export type IdentityStatus = "loading" | "none" | "ready" | "unreadable" | "unavailable";

export type CreateOutcome = "ok" | "unreadable" | "error";

type IdentityContextValue = {
  status: IdentityStatus;
  /** The DID, once its seed is saved. */
  did: string | null;
  create: () => Promise<CreateOutcome>;
};

const IdentityContext = createContext<IdentityContextValue | null>(null);

export function IdentityProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<IdentityStatus>("loading");
  const [identity, setIdentity] = useState<Identity | null>(null);
  const { status: authStatus } = useAuth();

  useEffect(() => {
    if (authStatus !== "unlocked") return;
    const fiber = Effect.runFork(
      loadIdentity(identityStore).pipe(
        Effect.match({
          onSuccess: (found) => {
            setIdentity(found);
            setStatus(found === null ? "none" : "ready");
          },
          onFailure: (error) =>
            setStatus(error._tag === "UnreadableIdentity" ? "unreadable" : "unavailable"),
        }),
      ),
    );
    return () => fiber.interruptUnsafe();
  }, [authStatus]);

  const create = useCallback((): Promise<CreateOutcome> => {
    // A second tap while the first is still saving joins it (`createIdentityOnce`): one identity only.
    return Effect.runPromise(
      createIdentityOnce(identityStore, getRandomBytes).pipe(
        Effect.map((made): CreateOutcome => {
          setIdentity(made);
          setStatus("ready");
          return "ok";
        }),
        Effect.catchTags({
          UnreadableIdentity: () =>
            Effect.sync((): CreateOutcome => {
              setStatus("unreadable");
              return "unreadable";
            }),
          IdentityStoreFailure: () => Effect.succeed<CreateOutcome>("error"),
        }),
      ),
    );
  }, []);

  const value = useMemo(
    () => ({ status, did: identity?.did ?? null, create }),
    [status, identity, create],
  );
  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function useIdentity(): IdentityContextValue {
  const value = useContext(IdentityContext);
  if (value === null) throw new Error("useIdentity must be used inside IdentityProvider");
  return value;
}
