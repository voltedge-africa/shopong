import { getRandomBytes } from "expo-crypto";
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  CheckedInvitation,
  CommunityError,
  Invitation,
  InvitationError,
  Member,
} from "@shopong/community";
import type { Did, Result } from "@shopong/ports";

import { createCommunityService, type CommunityService } from "./community";
import { useIdentity } from "./IdentityProvider";

type CommunityContextValue = {
  /** The community I created in this run of the app, or `null`. */
  community: { key: string; name: string } | null;
  members: readonly Member[];
  /** Invitations made in this run, newest first. */
  invitations: readonly Invitation[];
  create: (name: string) => Promise<string | undefined>;
  invite: (invitee: string) => Promise<string | undefined>;
  check: (text: string) => Promise<Result<CheckedInvitation, InvitationError>>;
};

const CommunityContext = createContext<CommunityContextValue | null>(null);

const messageOf = (result: Result<unknown, InvitationError | CommunityError>) =>
  result.ok ? undefined : result.error.message;

export function CommunityProvider({ children }: { children: ReactNode }) {
  const { did, auth } = useIdentity();
  const [community, setCommunity] = useState<{ key: string; name: string } | null>(null);
  const [members, setMembers] = useState<readonly Member[]>([]);
  const [invitations, setInvitations] = useState<readonly Invitation[]>([]);

  // One service per identity, so one in-memory record for as long as the identity is the same.
  const service = useRef<{ did: string | null; value: CommunityService } | null>(null);
  const serviceFor = useCallback((): CommunityService => {
    if (service.current === null || service.current.did !== did) {
      service.current = {
        did,
        value: createCommunityService(
          did === null || auth === null ? null : { did: did as Did, auth },
          { randomBytes: getRandomBytes },
        ),
      };
      setCommunity(null);
      setMembers([]);
      setInvitations([]);
    }
    return service.current.value;
  }, [did, auth]);

  const create = useCallback(
    async (name: string) => {
      const made = await serviceFor().create(name);
      if (made.ok) {
        setCommunity({ key: made.value.key, name: made.value.name });
        setMembers(await serviceFor().members());
      }
      return messageOf(made);
    },
    [serviceFor],
  );

  const invite = useCallback(
    async (invitee: string) => {
      const made = await serviceFor().invite(invitee.trim());
      if (made.ok) setInvitations((old) => [made.value, ...old]);
      return messageOf(made);
    },
    [serviceFor],
  );

  const check = useCallback((text: string) => serviceFor().check(text), [serviceFor]);

  const value = useMemo(
    () => ({ community, members, invitations, create, invite, check }),
    [community, members, invitations, create, invite, check],
  );
  return <CommunityContext.Provider value={value}>{children}</CommunityContext.Provider>;
}

export function useCommunity(): CommunityContextValue {
  const value = useContext(CommunityContext);
  if (value === null) throw new Error("useCommunity must be used inside CommunityProvider");
  return value;
}
