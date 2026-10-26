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
  ActionRequest,
  CheckedInvitation,
  GrantOptions,
  Invitation,
  InvitationError,
  Member,
  RoleCheck,
  RoleError,
  RoleRecord,
} from "@shopong/community";
import type { Did, PortError, Result } from "@shopong/ports";

import { createCommunityService, type CommunityService } from "./community";
import { useIdentity } from "./IdentityProvider";

type CommunityContextValue = {
  /** The community I created in this run of the app, or `null`. */
  community: { key: string; name: string } | null;
  /** Whether I am that community's creator (only the creator can give a role). */
  isCreator: boolean;
  members: readonly Member[];
  /** Invitations made in this run, newest first. */
  invitations: readonly Invitation[];
  /** The roles recorded for me, ended ones included. */
  roles: readonly RoleRecord[];
  create: (name: string) => Promise<string | undefined>;
  invite: (invitee: string) => Promise<string | undefined>;
  check: (text: string) => Promise<Result<CheckedInvitation, InvitationError>>;
  grant: (grantee: string, role: string, options: GrantOptions) => Promise<string | undefined>;
  checkAction: (request: ActionRequest) => Promise<Result<RoleCheck, RoleError>>;
};

const CommunityContext = createContext<CommunityContextValue | null>(null);

const messageOf = (result: Result<unknown, PortError>) =>
  result.ok ? undefined : result.error.message;

export function CommunityProvider({ children }: { children: ReactNode }) {
  const { did, auth } = useIdentity();
  const [community, setCommunity] = useState<{ key: string; name: string } | null>(null);
  const [isCreator, setIsCreator] = useState(false);
  const [members, setMembers] = useState<readonly Member[]>([]);
  const [invitations, setInvitations] = useState<readonly Invitation[]>([]);
  const [roles, setRoles] = useState<readonly RoleRecord[]>([]);

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
      setIsCreator(false);
      setMembers([]);
      setInvitations([]);
      setRoles([]);
    }
    return service.current.value;
  }, [did, auth]);

  const create = useCallback(
    async (name: string) => {
      const made = await serviceFor().create(name);
      if (made.ok) {
        setCommunity({ key: made.value.key, name: made.value.name });
        setIsCreator(made.value.creator === made.value.me);
        setMembers(await serviceFor().members());
        setRoles(await serviceFor().roles());
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

  const grant = useCallback(
    async (grantee: string, role: string, options: GrantOptions) => {
      const made = await serviceFor().grant(grantee.trim(), role, options);
      setRoles(await serviceFor().roles());
      return messageOf(made);
    },
    [serviceFor],
  );

  const checkAction = useCallback(
    (request: ActionRequest) => serviceFor().checkAction(request),
    [serviceFor],
  );

  const value = useMemo(
    () => ({
      community,
      isCreator,
      members,
      invitations,
      roles,
      create,
      invite,
      check,
      grant,
      checkAction,
    }),
    [community, isCreator, members, invitations, roles, create, invite, check, grant, checkAction],
  );
  return <CommunityContext.Provider value={value}>{children}</CommunityContext.Provider>;
}

export function useCommunity(): CommunityContextValue {
  const value = useContext(CommunityContext);
  if (value === null) throw new Error("useCommunity must be used inside CommunityProvider");
  return value;
}
