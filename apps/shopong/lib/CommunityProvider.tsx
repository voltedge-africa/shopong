import NetInfo from "@react-native-community/netinfo";
import { getRandomBytes } from "expo-crypto";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Platform } from "react-native";
import {
  EMPTY_NAME_MESSAGE,
  newCommunityKey,
  type ActionRequest,
  type CheckedInvitation,
  type Refusal,
  type GrantOptions,
  type Invitation,
  type InvitationError,
  type Member,
  type Quote,
  type RoleCheck,
  type RoleError,
  type RoleRecord,
} from "@shopong/community";
import type { Did, JsonValue, PortError, Result } from "@shopong/ports";

import { createCommunityService, type CommunityService } from "./community";
import { founderEvent, inviteEvent, joinEvent } from "./communityEvents";
import { nodeFailureMessage, unqueuedMessage } from "./nodeMessages";
import { NODE_ADDRESS } from "./nodeAddress";
import { createNodeClient, type NodeClient } from "./nodeClient";
import { cameBackOnline } from "./connectivity";
import { createQueueStore } from "./queueStore";
import { poolScreenOf, type PoolScreen } from "./pool";
import { createSyncService, type Mark, type SyncService, type SyncState } from "./sync";
import { useIdentity } from "./IdentityProvider";

/** How often the phone tries to send and pull while the app is open, in milliseconds. Backoff can make it wait longer. */
const TICK_MS = 5_000;

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
  /** Whether I may add a quote: the creator, or a co-treasurer whose role has not ended. */
  canAddQuotes: boolean;
  /** Record a quote. Resolves with the plain reasons it was refused, or `undefined` when recorded. */
  addQuote: (input: unknown) => Promise<string | undefined>;
  quotesFor: (order: string) => Promise<readonly Quote[]>;
  /** The last refusals on this phone, newest first (story 2.5). */
  refusals: readonly Refusal[];
  /** The Node sync: what was last tried, and what is waiting (story 3.4). */
  sync: SyncState;
  /** netinfo says the phone has no connection. A hint only: the last sync result is the truth. */
  offlineHint: boolean;
  /** Why the Node is not used in this build or session, when it is not. */
  noNodeReason: string | undefined;
  /** Whether this session talks to a Node. */
  nodeConnected: boolean;
  /** Whether the phone is running on the web, where the queue is memory only. */
  onWeb: boolean;
  /** Tries to send the queue and pull now. */
  retry: () => Promise<void>;
  /** Drops the parked item the Node refused, so the rest of the queue can go. */
  discardParked: () => Promise<void>;
  /** The mark of an invitation's event: on your phone, saved on the Node, or confirmed. */
  markOfInvitation: (invitationId: string) => Mark | undefined;
  /** The mark of the community's own founding or joining event. */
  markOfCommunity: () => Mark | undefined;
  /** Joins a community through the Node: admits this person, then queues the join. Resolves a plain reason on failure. */
  joinOnNode: (text: string) => Promise<string | undefined>;
  /** The pool as the Node reads it (story 4.6), or `null` when this is not a community on the Node. */
  pool: PoolScreen | null;
  /** Reads the pool from the Node again now. */
  refreshPool: () => Promise<void>;
};

/** What the session needs to talk to the Node: the client (absent without an address) and the sync service. */
type NodeBundle = { did: string; client: NodeClient | undefined; sync: SyncService };

/** A community the Node knows: its key and creator, which `apply` needs to check invitations. */
type NodeCommunity = { key: string; creator: Did };

const CommunityContext = createContext<CommunityContextValue | null>(null);

const messageOf = (result: Result<unknown, PortError>) =>
  result.ok ? undefined : result.error.message;

export function CommunityProvider({ children }: { children: ReactNode }) {
  const { did, auth } = useIdentity();
  const [sync, setSync] = useState<SyncState>({ result: "none", pending: 0 });
  const [offlineHint, setOfflineHint] = useState(false);
  const [nodeCommunity, setNodeCommunity] = useState<NodeCommunity | null>(null);
  const [nodeMembers, setNodeMembers] = useState<readonly Member[]>([]);
  /** The event that makes this phone's own community: its founding or joining event, with the community it is in. */
  const [communityEvent, setCommunityEvent] = useState<
    { community: string; id: string } | undefined
  >();
  const invitationEvents = useRef(new Map<string, { community: string; id: string }>());
  const wasOffline = useRef(false);
  const node = useRef<NodeBundle | null>(null);
  const nextTryAt = useRef(0);
  const [community, setCommunity] = useState<{ key: string; name: string } | null>(null);
  const [isCreator, setIsCreator] = useState(false);
  const [members, setMembers] = useState<readonly Member[]>([]);
  const [invitations, setInvitations] = useState<readonly Invitation[]>([]);
  const [roles, setRoles] = useState<readonly RoleRecord[]>([]);
  const [refusals, setRefusals] = useState<readonly Refusal[]>([]);
  const [pool, setPool] = useState<PoolScreen | null>(null);

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
      setRefusals([]);
      setNodeCommunity(null);
      setNodeMembers([]);
      setPool(null);
      setCommunityEvent(undefined);
      invitationEvents.current = new Map();
    }
    return service.current.value;
  }, [did, auth]);

  /** The Node session for this identity: a client when the build has an address, and the queue's sync service. */
  const nodeFor = useCallback((): NodeBundle | null => {
    if (did === null || auth === null) return null;
    if (node.current === null || node.current.did !== did) {
      const client = NODE_ADDRESS.ok
        ? createNodeClient({
            baseUrl: NODE_ADDRESS.url,
            auth,
            did: did as Did,
            randomBytes: getRandomBytes,
          })
        : undefined;
      let service: SyncService;
      service = createSyncService({
        node: client,
        queue: createQueueStore(did),
        auth,
        onChange: () => setSync(service.state()),
      });
      node.current = { did, client, sync: service };
      nextTryAt.current = 0;
      void service.start().then(setSync);
    }
    return node.current;
  }, [did, auth]);

  /** Reads the pool from the Node. Shows the Node's answer; a failure shows its state and no figures as current. */
  const refreshPool = useCallback(async () => {
    const bundle = nodeFor();
    if (bundle === null || bundle.client === undefined || nodeCommunity === null) return;
    setPool((old) => old ?? { state: "loading" });
    const reply = await bundle.client.pool(nodeCommunity.key);
    setPool(poolScreenOf(reply, Date.now()));
  }, [nodeFor, nodeCommunity]);

  /**
   * Sends the queue, then pulls the community. Waits out the backoff the last try asked for, unless `force` (Try
   * again: a parked item is sent) or `once` (a change from offline to online: one immediate try).
   */
  const tick = useCallback(
    async ({ force = false, once = false }: { force?: boolean; once?: boolean } = {}) => {
      const bundle = nodeFor();
      if (bundle === null || bundle.client === undefined) return;
      if (!force && !once && Date.now() < nextTryAt.current) return;
      const sent = await bundle.sync.flush(force);
      let wait = sent.retryInMs;
      if (nodeCommunity !== null) {
        const pulled = await bundle.sync.pull(
          { key: nodeCommunity.key, creator: nodeCommunity.creator },
          force,
        );
        wait = wait ?? pulled.retryInMs;
        const view = bundle.sync.viewOf(nodeCommunity.key);
        if (view !== undefined) {
          setNodeMembers(
            [...view.entries()]
              .filter(([key]) => key.startsWith("members/"))
              .map(([key, value]) => ({
                did: key.slice("members/".length) as Did,
                joinedAt:
                  typeof (value as JsonValue & { joinedAt?: unknown })?.joinedAt === "number"
                    ? (value as { joinedAt: number }).joinedAt
                    : 0,
              })),
          );
        }
      }
      await refreshPool();
      nextTryAt.current = wait === undefined ? 0 : Date.now() + wait;
      setSync(bundle.sync.state());
    },
    [nodeFor, nodeCommunity, refreshPool],
  );

  // Start the queue, send and pull on a timer while the app is open, and again when netinfo sees a connection.
  useEffect(() => {
    nodeFor();
    const timer = setInterval(() => void tick(), TICK_MS);
    // netinfo may repeat "connected" while the phone stays online: only the change counts, and the backoff holds after one try.
    const unsubscribe = NetInfo.addEventListener((state) => {
      const offline = state.isConnected === false;
      const back = cameBackOnline(wasOffline.current, offline);
      wasOffline.current = offline;
      setOfflineHint(offline);
      if (back) void tick({ once: true });
    });
    return () => {
      clearInterval(timer);
      unsubscribe();
    };
  }, [nodeFor, tick]);

  const create = useCallback(
    async (name: string) => {
      if (name.trim() === "") return EMPTY_NAME_MESSAGE;
      const bundle = nodeFor();
      // With a Node, the community is registered there first, under the key the phone keeps for it.
      let key: string | undefined;
      if (bundle?.client !== undefined) {
        key = newCommunityKey(getRandomBytes);
        const registered = await bundle.client.createCommunity(key);
        if (!registered.ok) return nodeFailureMessage(registered.failure, "make the community");
      }
      const made = await serviceFor().create(name, key);
      if (made.ok) {
        setCommunity({ key: made.value.key, name: made.value.name });
        setIsCreator(made.value.creator === made.value.me);
        setMembers(await serviceFor().members());
        setRoles(await serviceFor().roles());
        if (bundle !== null && bundle.client !== undefined && key !== undefined && did !== null) {
          const creator = did as Did;
          const event = founderEvent({
            community: key,
            me: creator,
            now: Date.now(),
            randomBytes: getRandomBytes,
          });
          setNodeCommunity({ key, creator });
          const queued = await bundle.sync.enqueue(key, event);
          setRefusals(serviceFor().refusals());
          if (!queued.ok) return unqueuedMessage("The community was made", queued.reason);
          setCommunityEvent({ community: key, id: queued.id });
          void tick({ once: true });
          return undefined;
        }
      }
      setRefusals(serviceFor().refusals());
      return messageOf(made);
    },
    [serviceFor, nodeFor, tick, did],
  );

  const invite = useCallback(
    async (invitee: string) => {
      const made = await serviceFor().invite(invitee.trim());
      if (made.ok) {
        setInvitations((old) => [made.value, ...old]);
        const bundle = nodeFor();
        if (bundle !== null && nodeCommunity !== null && did !== null && isCreator) {
          const event = inviteEvent({
            community: nodeCommunity.key,
            me: did as Did,
            now: Date.now(),
            randomBytes: getRandomBytes,
            invitation: made.value,
          });
          const queued = await bundle.sync.enqueue(nodeCommunity.key, event);
          if (!queued.ok) {
            setRefusals(serviceFor().refusals());
            return unqueuedMessage("The invitation was made", queued.reason);
          }
          invitationEvents.current.set(made.value.id, {
            community: nodeCommunity.key,
            id: queued.id,
          });
          void tick({ once: true });
        }
      }
      setRefusals(serviceFor().refusals());
      return messageOf(made);
    },
    [serviceFor, nodeFor, nodeCommunity, did, isCreator, tick],
  );

  const check = useCallback(
    async (text: string) => {
      const checked = await serviceFor().check(text);
      setRefusals(serviceFor().refusals());
      return checked;
    },
    [serviceFor],
  );

  const joinOnNode = useCallback(
    async (text: string) => {
      const bundle = nodeFor();
      if (bundle === null || bundle.client === undefined || did === null) {
        return "This build has no OCN Node set, so the invitation can only be checked here.";
      }
      const checked = await serviceFor().check(text);
      if (!checked.ok) return checked.error.message;
      const admitted = await bundle.client.admitMember(checked.value.spaceKey, text.trim());
      if (!admitted.ok) return nodeFailureMessage(admitted.failure, "let you in");
      const key = checked.value.spaceKey;
      const event = joinEvent({
        community: key,
        me: did as Did,
        now: Date.now(),
        randomBytes: getRandomBytes,
        checked: checked.value,
      });
      const queued = await bundle.sync.enqueue(key, event);
      setRefusals(serviceFor().refusals());
      // Without the join event on the phone, this person cannot write: say so and do not show the community as joined.
      if (!queued.ok) return unqueuedMessage("You were let in", queued.reason);
      setCommunityEvent({ community: key, id: queued.id });
      setCommunity({ key, name: "A community you joined" });
      setIsCreator(false);
      setNodeCommunity({ key, creator: checked.value.creator });
      void tick({ once: true });
      return undefined;
    },
    [nodeFor, serviceFor, did, tick],
  );

  /** Try again: sends a parked item and pulls now, whatever backoff was set. */
  const retry = useCallback(async () => {
    await tick({ force: true });
  }, [tick]);

  const discardParked = useCallback(async () => {
    const bundle = nodeFor();
    if (bundle === null) return;
    await bundle.sync.discardParked();
    setSync(bundle.sync.state());
  }, [nodeFor]);

  const markOfInvitation = useCallback(
    (invitationId: string) => {
      const entry = invitationEvents.current.get(invitationId);
      return entry === undefined ? undefined : node.current?.sync.markOf(entry.community, entry.id);
    },
    // The sync state changes with every send and pull, so marks are read again then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sync],
  );

  const markOfCommunity = useCallback(
    () =>
      communityEvent === undefined
        ? undefined
        : node.current?.sync.markOf(communityEvent.community, communityEvent.id),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sync, communityEvent],
  );

  const grant = useCallback(
    async (grantee: string, role: string, options: GrantOptions) => {
      const made = await serviceFor().grant(grantee.trim(), role, options);
      setRoles(await serviceFor().roles());
      setRefusals(serviceFor().refusals());
      return messageOf(made);
    },
    [serviceFor],
  );

  const checkAction = useCallback(
    async (request: ActionRequest) => {
      const checked = await serviceFor().checkAction(request);
      setRefusals(serviceFor().refusals());
      return checked;
    },
    [serviceFor],
  );

  const addQuote = useCallback(
    async (input: unknown) => {
      const made = await serviceFor().addQuote(input);
      setRefusals(serviceFor().refusals());
      return messageOf(made);
    },
    [serviceFor],
  );

  const quotesFor = useCallback((order: string) => serviceFor().quotesFor(order), [serviceFor]);

  const canAddQuotes =
    community !== null &&
    (isCreator ||
      roles.some((role) => role.role === "co-treasurer" && role.expiresAt > Date.now()));

  const shownMembers = nodeCommunity === null ? members : nodeMembers;
  const noNodeReason =
    did === null || auth === null || NODE_ADDRESS.ok ? undefined : NODE_ADDRESS.reason;
  const nodeConnected = node.current?.client !== undefined;

  const value = useMemo(
    () => ({
      community,
      isCreator,
      members: shownMembers,
      invitations,
      roles,
      create,
      invite,
      check,
      grant,
      checkAction,
      canAddQuotes,
      addQuote,
      quotesFor,
      refusals,
      sync,
      offlineHint,
      noNodeReason,
      nodeConnected,
      onWeb: Platform.OS === "web",
      retry,
      discardParked,
      markOfInvitation,
      markOfCommunity,
      joinOnNode,
      pool: nodeCommunity === null ? null : pool,
      refreshPool,
    }),
    [
      community,
      isCreator,
      shownMembers,
      invitations,
      roles,
      create,
      invite,
      check,
      grant,
      checkAction,
      canAddQuotes,
      addQuote,
      quotesFor,
      refusals,
      sync,
      offlineHint,
      noNodeReason,
      nodeConnected,
      retry,
      discardParked,
      markOfInvitation,
      markOfCommunity,
      joinOnNode,
      nodeCommunity,
      pool,
      refreshPool,
    ],
  );
  return <CommunityContext.Provider value={value}>{children}</CommunityContext.Provider>;
}

export function useCommunity(): CommunityContextValue {
  const value = useContext(CommunityContext);
  if (value === null) throw new Error("useCommunity must be used inside CommunityProvider");
  return value;
}
