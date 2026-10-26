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
  approvalBytes,
  checkApprovalsSetting,
  DEFAULT_APPROVALS,
  checkPledge,
  holdersOf,
  namingProblem,
  newCommunityKey,
  pledgeKey,
  tidy,
  type OrderProgress,
  type ActionRequest,
  type CheckedInvitation,
  type HeldRole,
  type Refusal,
  type GrantOptions,
  type Invitation,
  type InvitationError,
  type Member,
  type Quote,
  type RoleCheck,
  type RoleError,
  type RoleRecord,
  type StoredOrder,
} from "@shopong/community";
import type { EventEnvelope } from "@shopong/events";
import type { Did, JsonValue, PortError, Result } from "@shopong/ports";
import type { BankForm, PaymentRecord, PaymentView, PayoutsReading } from "@shopong/miniapp-orders";

import { createCommunityService, type CommunityService } from "./community";
import { paymentStatusOfFailure } from "./paymentStatus";
import { quoteEventOf, quotesToShow, type SavedQuote } from "./quotes";
import { approveEventOf, gateProblemIn, memberCountIn, orderEventOf, ordersInView } from "./orders";
import {
  approvalEvent,
  collectionConfirmedEvent,
  deliveryConfirmedEvent,
  deliveryDisputedEvent,
  founderEvent,
  inviteEvent,
  joinEvent,
  namingEvent,
  payoutEvent,
  pledgeEvent,
} from "./communityEvents";
import { nodeFailureMessage, unqueuedMessage } from "./nodeMessages";
import { NODE_ADDRESS } from "./nodeAddress";
import { createNodeClient, type NodeClient, type RouteAnswer } from "./nodeClient";
import {
  OFFLINE_PLAN_MESSAGE,
  planFailureMessage,
  routeScreenOf,
  type RoutePlace,
  type RouteScreen,
} from "./route";
import { cameBackOnline } from "./connectivity";
import { createQueueStore } from "./queueStore";
import { poolScreenOf, type PoolScreen } from "./pool";
import { createSyncService, type Mark, type SyncService, type SyncState } from "./sync";
import {
  createAttachmentService,
  type AttachmentService,
  type AttachPurpose,
  type Check,
  type FileRow,
  type PickedFile,
} from "./attachments";
import { createAttachmentStores } from "./attachmentStore";
import { sha512 } from "./sha512";
import { useIdentity } from "./IdentityProvider";

/** How often the phone tries to send and pull while the app is open, in milliseconds. Backoff can make it wait longer. */
const TICK_MS = 5_000;

type CommunityContextValue = {
  /** The community I created in this run of the app, or `null`. `rules` is the rules note, empty when there is none. */
  community: { key: string; name: string; rules?: string; creator?: string } | null;
  /** Whether I am that community's creator (only the creator can give a role). */
  isCreator: boolean;
  members: readonly Member[];
  /** Every role in the community with its holder and end date, as every member sees them (story 8.1). */
  roleHolders: readonly HeldRole[];
  /** Invitations made in this run, newest first. */
  invitations: readonly Invitation[];
  /** The roles recorded for me, ended ones included. */
  roles: readonly RoleRecord[];
  /** Makes the community. `approvals` is how many people must approve a supplier payment (1 to 5; two when left out). `rules` is an optional rules note. */
  create: (name: string, approvals?: number, rules?: string) => Promise<string | undefined>;
  invite: (invitee: string) => Promise<string | undefined>;
  check: (text: string) => Promise<Result<CheckedInvitation, InvitationError>>;
  grant: (grantee: string, role: string, options: GrantOptions) => Promise<string | undefined>;
  checkAction: (request: ActionRequest) => Promise<Result<RoleCheck, RoleError>>;
  /** Whether I may add a quote: the creator, or a co-treasurer whose role has not ended. */
  canAddQuotes: boolean;
  /** Record a quote. Resolves with the plain reasons it was refused, or `undefined` when recorded. */
  addQuote: (input: unknown) => Promise<string | undefined>;
  quotesFor: (order: string) => Promise<readonly Quote[]>;
  /** The orders on the record and how many members there are (story 8.2). */
  ordersOf: () => Promise<{
    readonly orders: readonly StoredOrder[];
    readonly memberCount: number;
  }>;
  /** Propose a bulk order (story 8.2). Resolves with the plain reasons refused, or undefined when queued or recorded. */
  proposeOrder: (input: unknown) => Promise<string | undefined>;
  /** Approve a proposed order by its event id (story 8.2). Resolves with the plain reason refused, or undefined. */
  approveOrder: (id: string) => Promise<string | undefined>;
  /** The files on an order (story 3.7). Null until this phone has a Node session for the community. */
  files: FilesSurface | null;
  /** The delivery of an order (story 7.6). Null until this phone has a Node session for the community. */
  proof: ProofSurface | null;
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
  /** Pledges `minor` cents to an order on the Node, queued like every other event. Resolves a plain reason on refusal. */
  pledgeOrder: (order: string, minor: number) => Promise<string | undefined>;
  /** What the Node's record and payments hold for this member's pledge to an order, and whether one is queued here. */
  paymentOf: (order: string) => Promise<PaymentView>;
  /** Asks the Node for the bank request for this member's pledge. Resolves the bank page's address, or a plain reason. */
  payOrder: (order: string) => Promise<{ ok: true; url: string } | { ok: false; message: string }>;
  /** The payments recorded for an order, with approvals and what the Node has sent (story 4.7). */
  paymentsOf: (order: string) => Promise<PayoutsReading>;
  /** Records the treasurer's payment for a supplier's quote, for approval. Resolves with the reason refused, or `undefined`. */
  proposePayment: (
    order: string,
    supplier: string,
    amountMinor: number,
    recommendation: string,
  ) => Promise<string | undefined>;
  /** Signs this person's approval of a payment after they confirmed it, and sends it to the record. */
  approvePayment: (payout: string) => Promise<string | undefined>;
  /** Asks the Node to pay the supplier now. Resolves with the Node's plain reason when refused. */
  payPayment: (payout: string) => Promise<string | undefined>;
  /** Keeps a supplier's bank details on the Node. The treasurer only. */
  saveSupplierBank: (supplier: string, bank: BankForm) => Promise<string | undefined>;
  /** The places this community registered, by id and label (story 7.4). Never a coordinate or an address. */
  placesOf: () => Promise<readonly RoutePlace[]>;
  /**
   * Plans the route between two registered places on the Node, then records `delivery.planned` for the delivery. The
   * Node refuses a plain member, and a plain sentence says so. Offline, nothing is planned.
   */
  planRoute: (
    origin: string,
    destination: string,
  ) => Promise<{ ok: true; route: RouteAnswer } | { ok: false; message: string }>;
  /** The community's planned route: its line and sentences from the Node, by the fingerprint the record holds. */
  routeScreen: () => Promise<RouteScreen>;
};

/** The one delivery the community plans for now; orders are not yet in the record (see shortcuts S-7.4-8). */
const DELIVERY_ORDER = "current";
const DELIVERY_VIEW_KEY = `delivery/${encodeURIComponent(DELIVERY_ORDER)}`;

/** What the session needs to talk to the Node: the client (absent without an address), the sync service and the files. */
type NodeBundle = {
  did: string;
  client: NodeClient | undefined;
  sync: SyncService;
  files: AttachmentService;
};

/** What the Orders screen may do with the files on an order (story 3.7). */
export interface FilesSurface {
  /** Whether this person holds a driver's role, so may attach a delivery photo. */
  readonly canAttachPhoto: boolean;
  readonly filesFor: (order: string) => readonly FileRow[];
  /** Attaches a picked file. Resolves with the plain reason it was refused, or `undefined` when it was started. */
  readonly attach: (
    order: string,
    purpose: AttachPurpose,
    supplier: string,
    picked: PickedFile,
  ) => Promise<string | undefined>;
  readonly check: (hash: string) => Promise<Check>;
  readonly retry: () => Promise<void>;
}

/** What the Orders screen may do with an order's delivery (story 7.6): the arrival, a member's share, a dispute. */
export interface ProofSurface {
  /** This phone's person. */
  readonly me: string;
  readonly progressOf: (order: string) => Promise<OrderProgress>;
  /** The driver's arrival: attaches the picked photo, then queues the confirmation with its SHA-512. */
  readonly confirmArrival: (order: string, picked: PickedFile) => Promise<string | undefined>;
  readonly collect: (order: string) => Promise<string | undefined>;
  readonly dispute: (order: string, note: string) => Promise<string | undefined>;
}

const NO_PROGRESS: OrderProgress = {
  arrived: false,
  shares: [],
  collected: 0,
  of: 0,
  disputes: [],
};

/** A community the Node knows: its key and creator, which `apply` needs to check invitations. */
type NodeCommunity = { key: string; creator: Did };

const CommunityContext = createContext<CommunityContextValue | null>(null);

const messageOf = (result: Result<unknown, PortError>) =>
  result.ok ? undefined : result.error.message;

export function CommunityProvider({ children }: { children: ReactNode }) {
  const { did, auth } = useIdentity();
  const [sync, setSync] = useState<SyncState>({ result: "none", pending: 0 });
  const [syncVersion, setSyncVersion] = useState(0);
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
  const [community, setCommunity] = useState<{
    key: string;
    name: string;
    rules?: string;
    creator?: string;
  } | null>(null);
  const [isCreator, setIsCreator] = useState(false);
  const [members, setMembers] = useState<readonly Member[]>([]);
  const [roleHolders, setRoleHolders] = useState<readonly HeldRole[]>([]);
  const [nodeRoleHolders, setNodeRoleHolders] = useState<readonly HeldRole[]>([]);
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
      setRoleHolders([]);
      setNodeRoleHolders([]);
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
        onChange: () => {
          setSync(service.state());
          // The Orders list re-reads when the synced view changes (quotes shown after a pull, S-4.7 quote display).
          setSyncVersion((version) => version + 1);
        },
      });
      const stores = createAttachmentStores(did);
      const files = createAttachmentService({
        node: client,
        sync: service,
        pending: stores.pending,
        cache: stores.cache,
        did: did as Did,
        sha512: async (bytes) => sha512(bytes),
        viewOf: (community) => service.viewOf(community),
      });
      node.current = { did, client, sync: service, files };
      nextTryAt.current = 0;
      void files.start();
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
          // The name and rules note are in the record, so a joiner sees the same words as the creator (story 8.1).
          const heldName = view.get("community/name");
          const heldRules = view.get("community/rules");
          if (typeof heldName === "string" && heldName !== "") {
            setCommunity((old) =>
              old !== null && old.key === nodeCommunity.key
                ? {
                    key: old.key,
                    name: heldName,
                    rules: typeof heldRules === "string" ? heldRules : "",
                    creator: old.creator,
                  }
                : old,
            );
          }
          setNodeRoleHolders(
            holdersOf([...view.entries()].map(([key, value]) => ({ key, value }))),
          );
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
      nextTryAt.current = wait === undefined ? 0 : Date.now() + wait;
      setSync(bundle.sync.state());
    },
    [nodeFor, nodeCommunity],
  );

  // Start the queue, send and pull on a timer while the app is open, and again when netinfo sees a connection.
  useEffect(() => {
    nodeFor();
    const timer = setInterval(() => void tick(), TICK_MS);
    // The pool is asked on its own clock, outside the sync backoff, so its figures age honestly (triage 2).
    const poolTimer = setInterval(() => void refreshPool(), TICK_MS);
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
      clearInterval(poolTimer);
      unsubscribe();
    };
  }, [nodeFor, tick, refreshPool]);

  const create = useCallback(
    async (name: string, approvals?: number, rules?: string) => {
      const problem = namingProblem(name, rules ?? "");
      if (problem !== undefined) return problem;
      const bundle = nodeFor();
      // With a Node, the community is registered there first, under the key the phone keeps for it.
      let key: string | undefined;
      if (bundle?.client !== undefined) {
        key = newCommunityKey(getRandomBytes);
        const registered = await bundle.client.createCommunity(key);
        if (!registered.ok) return nodeFailureMessage(registered.failure, "make the community");
      }
      const made = await serviceFor().create(name, key, approvals, rules);
      if (made.ok) {
        setCommunity({
          key: made.value.key,
          name: made.value.name,
          rules: rules?.trim() ?? "",
          creator: made.value.creator,
        });
        setIsCreator(made.value.creator === made.value.me);
        setMembers(await serviceFor().members());
        setRoles(await serviceFor().roles());
        setRoleHolders(await serviceFor().roleHolders());
        if (bundle !== null && bundle.client !== undefined && key !== undefined && did !== null) {
          const creator = did as Did;
          const event = founderEvent({
            community: key,
            me: creator,
            now: Date.now(),
            randomBytes: getRandomBytes,
            ...(approvals === undefined ? {} : { approvals }),
          });
          setNodeCommunity({ key, creator });
          const queued = await bundle.sync.enqueue(key, event);
          setRefusals(serviceFor().refusals());
          if (!queued.ok) return unqueuedMessage("The community was made", queued.reason);
          setCommunityEvent({ community: key, id: queued.id });
          // The name and rules note go to the Node straight after the founding event (story 8.1).
          const naming = namingEvent({
            community: key,
            me: creator,
            now: Date.now(),
            randomBytes: getRandomBytes,
            name: name.trim(),
            rules: rules?.trim() ?? "",
          });
          const named = await bundle.sync.enqueue(key, naming);
          if (!named.ok) return unqueuedMessage("The community was made", named.reason);
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
      setCommunity({ key, name: "A community you joined", creator: checked.value.creator });
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
      setRoleHolders(await serviceFor().roleHolders());
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

  const filesSurface = useMemo<FilesSurface | null>(() => {
    if (nodeCommunity === null) return null;
    const key = nodeCommunity.key;
    return {
      canAttachPhoto: roles.some((role) => role.role === "driver" && role.expiresAt > Date.now()),
      filesFor: (order) => {
        const bundle = nodeFor();
        return bundle === null ? [] : bundle.files.filesFor(key, order);
      },
      attach: async (order, purpose, supplier, picked) => {
        const bundle = nodeFor();
        if (bundle === null) return "Make your identity first.";
        const made = await bundle.files.attach(key, order, purpose, picked, supplier);
        setSync(bundle.sync.state());
        return made.ok ? undefined : made.reason;
      },
      check: async (hash) => {
        const bundle = nodeFor();
        return bundle === null ? "unavailable" : bundle.files.check(key, hash);
      },
      retry: async () => {
        const bundle = nodeFor();
        if (bundle === null) return;
        await bundle.files.retryPending();
        setSync(bundle.sync.state());
      },
    };
  }, [nodeCommunity, roles, nodeFor]);

  const proofSurface = useMemo<ProofSurface | null>(() => {
    if (nodeCommunity === null || did === null) return null;
    const key = nodeCommunity.key;
    const me = did as Did;
    /** Queues one proof event for the Node, as the pledge does. A refusal the Node gives later is not shown here yet. */
    const queue = async (event: EventEnvelope, what: string): Promise<string | undefined> => {
      const bundle = nodeFor();
      if (bundle === null) return "Make or join a community on the OCN Node first, in Settings.";
      const queued = await bundle.sync.enqueue(key, event);
      setSync(bundle.sync.state());
      if (!queued.ok) return unqueuedMessage(what, queued.reason);
      void tick({ once: true });
      return undefined;
    };
    /** The delivery the record holds for an order, or undefined when nothing has arrived yet. */
    const arrivalOf = async (order: string) => {
      const current = serviceFor().community();
      if (current === null) return undefined;
      return (await current.orderProgress(order)).delivered;
    };
    return {
      me: did,
      progressOf: async (order) => {
        const current = serviceFor().community();
        return current === null ? NO_PROGRESS : current.orderProgress(order);
      },
      confirmArrival: async (order, picked) => {
        const bundle = nodeFor();
        if (bundle === null) return "Make or join a community on the OCN Node first, in Settings.";
        const wanted = tidy(order);
        // The photo goes to the Node first (it is kept there, and checked against this hash); then the arrival is queued.
        const made = await bundle.files.attach(key, wanted, "delivery-photo", picked);
        setSync(bundle.sync.state());
        if (!made.ok) return made.reason;
        return queue(
          deliveryConfirmedEvent({
            community: key,
            me,
            now: Date.now(),
            randomBytes: getRandomBytes,
            order: wanted,
            photoSha512: made.hash,
          }),
          "The arrival was recorded",
        );
      },
      collect: async (order) => {
        const wanted = tidy(order);
        const delivered = await arrivalOf(wanted);
        if (delivered === undefined) return "This order has not been delivered yet.";
        return queue(
          collectionConfirmedEvent({
            community: key,
            me,
            now: Date.now(),
            randomBytes: getRandomBytes,
            order: wanted,
            delivery: delivered.event,
          }),
          "Your collection was recorded",
        );
      },
      dispute: async (order, note) => {
        const wanted = tidy(order);
        const delivered = await arrivalOf(wanted);
        if (delivered === undefined) return "This order has not been delivered yet.";
        return queue(
          deliveryDisputedEvent({
            community: key,
            me,
            now: Date.now(),
            randomBytes: getRandomBytes,
            order: wanted,
            delivery: delivered.event,
            ...(note === "" ? {} : { note }),
          }),
          "The dispute was recorded",
        );
      },
    };
  }, [nodeCommunity, did, nodeFor, serviceFor, tick]);

  const canAddQuotes =
    community !== null &&
    (isCreator ||
      roles.some((role) => role.role === "co-treasurer" && role.expiresAt > Date.now()));

  const addQuote = useCallback(
    async (input: unknown) => {
      const bundle = nodeFor();
      // With a Node, the quote is sent to the record as a `quote.added` event (S-4.7 quote sync). Without one, the
      // phone's own copy keeps it, as before.
      if (
        bundle !== null &&
        bundle.client !== undefined &&
        did !== null &&
        nodeCommunity !== null
      ) {
        if (!canAddQuotes) return "Only the treasurer can add a quote.";
        const made = quoteEventOf({
          community: nodeCommunity.key,
          me: did as Did,
          now: Date.now(),
          randomBytes: getRandomBytes,
          input,
        });
        if (!made.ok) return made.problems.join(" ");
        const held = gateProblemIn(
          bundle.sync.viewOf(nodeCommunity.key) ?? new Map<string, JsonValue>(),
          made.value.payload.order,
          "quote",
        );
        if (held !== undefined) return held;
        const queued = await bundle.sync.enqueue(nodeCommunity.key, made.value);
        if (!queued.ok) return unqueuedMessage("The quote was saved", queued.reason);
        // Shown at once from this phone's own copy, before the Node pulls it back (quotesToShow).
        ownQuotes.current.push({ eventId: queued.id, payload: made.value.payload as JsonValue });
        void tick({ once: true });
        return undefined;
      }
      const made = await serviceFor().addQuote(input);
      setRefusals(serviceFor().refusals());
      return messageOf(made);
    },
    [serviceFor, nodeFor, did, nodeCommunity, canAddQuotes, tick],
  );

  const quotesFor = useCallback(
    async (order: string) => {
      const bundle = nodeFor();
      // With a Node: the synced record's quotes, plus this phone's own saved quotes not yet pulled back. A quote the
      // record refuses is left out. The version changes on each sync change, so a list that holds this function re-reads.
      if (bundle !== null && nodeCommunity !== null) {
        const view = bundle.sync.viewOf(nodeCommunity.key) ?? new Map<string, JsonValue>();
        return quotesToShow({ view, own: ownQuotes.current, order }).quotes;
      }
      return serviceFor().quotesFor(order);
    },
    // syncVersion is a dependency on purpose: each sync change makes a new function, so the Orders list re-reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serviceFor, nodeFor, nodeCommunity, syncVersion],
  );

  const ordersOf = useCallback(async () => {
    const bundle = nodeFor();
    if (bundle !== null && nodeCommunity !== null) {
      const view = bundle.sync.viewOf(nodeCommunity.key) ?? new Map<string, JsonValue>();
      return { orders: ordersInView(view), memberCount: memberCountIn(view) };
    }
    const service = serviceFor();
    return { orders: await service.orders(), memberCount: (await service.members()).length };
    // Each sync change makes a new function, so the Orders list re-reads the record (as quotesFor does).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serviceFor, nodeFor, nodeCommunity, syncVersion]);

  const proposeOrder = useCallback(
    async (input: unknown) => {
      const bundle = nodeFor();
      // With a Node, the proposal is sent to the record as an `order.proposed` event; the phone checks it first (story 8.2).
      if (
        bundle !== null &&
        bundle.client !== undefined &&
        did !== null &&
        nodeCommunity !== null
      ) {
        const made = orderEventOf({
          community: nodeCommunity.key,
          me: did as Did,
          now: Date.now(),
          randomBytes: getRandomBytes,
          input,
          view: bundle.sync.viewOf(nodeCommunity.key) ?? new Map<string, JsonValue>(),
        });
        if (!made.ok) return made.problems.join(" ");
        const queued = await bundle.sync.enqueue(nodeCommunity.key, made.value);
        if (!queued.ok) return unqueuedMessage("The order was saved", queued.reason);
        void tick({ once: true });
        return undefined;
      }
      const made = await serviceFor().proposeOrder(input);
      setRefusals(serviceFor().refusals());
      return messageOf(made);
    },
    [serviceFor, nodeFor, did, nodeCommunity, tick],
  );

  const approveOrder = useCallback(
    async (id: string) => {
      if (!canAddQuotes) return "Only the treasurer can approve an order.";
      const bundle = nodeFor();
      if (
        bundle !== null &&
        bundle.client !== undefined &&
        did !== null &&
        nodeCommunity !== null
      ) {
        const event = approveEventOf({
          community: nodeCommunity.key,
          me: did as Did,
          now: Date.now(),
          randomBytes: getRandomBytes,
          order: id,
        });
        const queued = await bundle.sync.enqueue(nodeCommunity.key, event);
        if (!queued.ok) return unqueuedMessage("The approval was saved", queued.reason);
        void tick({ once: true });
        return undefined;
      }
      const made = await serviceFor().approveOrder(id);
      setRefusals(serviceFor().refusals());
      return messageOf(made);
    },
    [serviceFor, nodeFor, did, nodeCommunity, canAddQuotes, tick],
  );

  /** The event id of the newest pledge this phone queued for each order (keyed by the order's tidied name). */
  const queuedPledges = useRef(new Map<string, string>());

  const pledgeOrder = useCallback(
    async (order: string, minor: number) => {
      const bundle = nodeFor();
      if (
        bundle === null ||
        bundle.client === undefined ||
        did === null ||
        nodeCommunity === null
      ) {
        return "Make or join a community on the OCN Node first, in Settings.";
      }
      const checked = checkPledge(
        { order, member: did, amount: { currency: "ZAR", minor } },
        did as Did,
      );
      if (!checked.ok) return checked.problem;
      const held = gateProblemIn(
        bundle.sync.viewOf(nodeCommunity.key) ?? new Map<string, JsonValue>(),
        checked.value.order,
        "pledge",
      );
      if (held !== undefined) return held;
      const event = pledgeEvent({
        community: nodeCommunity.key,
        me: did as Did,
        now: Date.now(),
        randomBytes: getRandomBytes,
        order: checked.value.order,
        minor,
      });
      const queued = await bundle.sync.enqueue(nodeCommunity.key, event);
      if (!queued.ok) return unqueuedMessage("The pledge was made", queued.reason);
      queuedPledges.current.set(checked.value.order, queued.id);
      void tick({ once: true });
      return undefined;
    },
    [nodeFor, did, nodeCommunity, tick],
  );

  const paymentOf = useCallback(
    async (order: string): Promise<PaymentView> => {
      const bundle = nodeFor();
      if (
        bundle === null ||
        bundle.client === undefined ||
        did === null ||
        nodeCommunity === null
      ) {
        return { onNode: false, queued: false };
      }
      const name = tidy(order);
      const stored = bundle.sync.viewOf(nodeCommunity.key)?.get(pledgeKey(name, did)) as
        | { event?: unknown; minor?: unknown }
        | undefined;
      // A newer pledge still on this phone (Pay again) shows as saved here until the Node's record has it.
      const pending = queuedPledges.current.get(name);
      const onRecord = typeof stored?.event === "string" ? stored.event : undefined;
      if (pending !== undefined && pending !== onRecord) {
        return { onNode: true, queued: true };
      }
      if (pending !== undefined) queuedPledges.current.delete(name);
      if (
        stored === undefined ||
        typeof stored.event !== "string" ||
        typeof stored.minor !== "number"
      ) {
        return { onNode: true, queued: false };
      }
      const status = await bundle.client.paymentStatus(nodeCommunity.key, stored.event);
      // A failed read says why, by its kind (review item 6); only the Node's own answer carries a payment status.
      return status.ok
        ? {
            onNode: true,
            pledgedMinor: stored.minor,
            queued: false,
            status: status.value.status,
            windowOpen: status.value.windowOpen,
          }
        : {
            onNode: true,
            pledgedMinor: stored.minor,
            queued: false,
            status: paymentStatusOfFailure(status.failure),
          };
    },
    [nodeFor, did, nodeCommunity],
  );

  const payOrder = useCallback(
    async (order: string) => {
      const bundle = nodeFor();
      if (
        bundle === null ||
        bundle.client === undefined ||
        did === null ||
        nodeCommunity === null
      ) {
        return {
          ok: false as const,
          message: "Make or join a community on the OCN Node first, in Settings.",
        };
      }
      const stored = bundle.sync.viewOf(nodeCommunity.key)?.get(pledgeKey(tidy(order), did)) as
        | { event?: unknown }
        | undefined;
      if (stored === undefined || typeof stored.event !== "string") {
        return {
          ok: false as const,
          message: "Your pledge has not reached the OCN Node yet. Try Pay again in a moment.",
        };
      }
      const reply = await bundle.client.payPledge(nodeCommunity.key, stored.event);
      if (!reply.ok) {
        return {
          ok: false as const,
          message: nodeFailureMessage(reply.failure, "start your payment"),
        };
      }
      if (NODE_ADDRESS.ok === false) {
        return { ok: false as const, message: NODE_ADDRESS.reason };
      }
      return { ok: true as const, url: `${NODE_ADDRESS.url}${reply.value.bankPath}` };
    },
    [nodeFor, did, nodeCommunity],
  );

  /** The Node's answers for payments this phone has sent, by payment id (kept for this run of the app). */
  const sentPayments = useRef(new Map<string, string>());
  /** The event ids of the payments and approvals this phone sent, so the record's refusals of them can be shown (S-4.7 fix 7). */
  const proposalEvents = useRef<string[]>([]);
  /** The quotes this phone saved and queued for the Node, shown until the record holds them (see quotesToShow). */
  const ownQuotes = useRef<SavedQuote[]>([]);
  const approvalEvents = useRef(new Map<string, string>());

  const paymentsOf = useCallback(
    async (order: string): Promise<PayoutsReading> => {
      const view = nodeCommunity === null ? undefined : nodeFor()?.sync.viewOf(nodeCommunity.key);
      const me = did ?? "";
      if (view === undefined) {
        return {
          payments: [],
          required: DEFAULT_APPROVALS,
          sent: sentPayments.current,
          me,
          treasurer: canAddQuotes,
        };
      }
      const approvers = new Map<string, string[]>();
      const found: PaymentRecord[] = [];
      for (const [key, value] of view) {
        if (key.startsWith("approvals/")) {
          const [, payout, approver] = key.split("/");
          if (payout !== undefined && approver !== undefined) {
            approvers.set(payout, [...(approvers.get(payout) ?? []), approver]);
          }
        } else if (key.startsWith("payouts/") && typeof value === "object" && value !== null) {
          const record = value as Record<string, unknown>;
          if (
            typeof record.order === "string" &&
            typeof record.supplier === "string" &&
            typeof record.amountMinor === "number" &&
            typeof record.by === "string"
          ) {
            found.push({
              payout: key.slice("payouts/".length),
              order: record.order,
              supplier: record.supplier,
              amountMinor: record.amountMinor,
              by: record.by,
              approvers: [],
            });
          }
        }
      }
      const payments = found
        .filter((payment) => payment.order === tidy(order))
        .map((payment) => ({ ...payment, approvers: approvers.get(payment.payout) ?? [] }));
      const required = checkApprovalsSetting(view.get("settings/approvals")) ?? DEFAULT_APPROVALS;
      // The record's refusals of this phone's own approvals and payments (S-4.7 fix 7): read from `rejected/<event id>`.
      const approvalNotices = new Map<string, string>();
      for (const [payout, eventId] of approvalEvents.current) {
        const marker = view.get(`rejected/${eventId}`) as { reason?: unknown } | undefined;
        if (typeof marker?.reason === "string") approvalNotices.set(payout, marker.reason);
      }
      const proposalNotices: string[] = [];
      for (const eventId of proposalEvents.current) {
        const marker = view.get(`rejected/${eventId}`) as { reason?: unknown } | undefined;
        if (typeof marker?.reason === "string") proposalNotices.push(marker.reason);
      }
      return {
        payments,
        required,
        sent: sentPayments.current,
        me,
        treasurer: canAddQuotes,
        approvalNotices,
        proposalNotices,
      };
    },
    [nodeFor, nodeCommunity, did, canAddQuotes],
  );

  const proposePayment = useCallback(
    async (order: string, supplier: string, amountMinor: number, recommendation: string) => {
      const bundle = nodeFor();
      if (
        bundle === null ||
        bundle.client === undefined ||
        did === null ||
        nodeCommunity === null
      ) {
        return "Make or join a community on the OCN Node first, in Settings.";
      }
      if (!canAddQuotes) return "Only the treasurer can pay a supplier.";
      // The payment carries the commitment of the bank details now on the Node: the approvers sign it (S-4.7 fix 3).
      const commitment = await bundle.client.supplierBankCommitment(nodeCommunity.key, supplier);
      if (!commitment.ok)
        return nodeFailureMessage(commitment.failure, "send the payment for approval");
      const event = payoutEvent({
        community: nodeCommunity.key,
        me: did as Did,
        now: Date.now(),
        randomBytes: getRandomBytes,
        order: tidy(order),
        supplier,
        amountMinor,
        recommendation,
        bank: commitment.value.commitment,
      });
      const queued = await bundle.sync.enqueue(nodeCommunity.key, event);
      if (!queued.ok) return unqueuedMessage("The payment was sent for approval", queued.reason);
      proposalEvents.current.push(queued.id);
      void tick({ once: true });
      return undefined;
    },
    [nodeFor, did, nodeCommunity, canAddQuotes, tick],
  );

  const approvePayment = useCallback(
    async (payout: string) => {
      const bundle = nodeFor();
      if (
        bundle === null ||
        bundle.client === undefined ||
        did === null ||
        nodeCommunity === null
      ) {
        return "Make or join a community on the OCN Node first, in Settings.";
      }
      const stored = bundle.sync.viewOf(nodeCommunity.key)?.get(`payouts/${payout}`) as
        | { order?: unknown; supplier?: unknown; amountMinor?: unknown; bank?: unknown }
        | undefined;
      if (
        stored === undefined ||
        typeof stored.order !== "string" ||
        typeof stored.supplier !== "string" ||
        typeof stored.amountMinor !== "number" ||
        typeof stored.bank !== "string"
      ) {
        return "This payment has not reached this phone yet. Try again in a moment.";
      }
      // The approval names the bank commitment the payment carries, so the details cannot change under it (S-4.7 fix 3).
      const terms = {
        order: stored.order,
        supplier: stored.supplier,
        amountMinor: stored.amountMinor,
        bank: stored.bank,
      };
      // Each approver signs their own approval: the bytes name this community, this payment and these terms.
      const signed = await auth?.sign(
        did as Did,
        approvalBytes(nodeCommunity.key, payout, did as Did, terms),
      );
      if (signed === undefined || !signed.ok)
        return "Your identity could not sign this approval. Try again.";
      const event = approvalEvent({
        community: nodeCommunity.key,
        me: did as Did,
        now: Date.now(),
        randomBytes: getRandomBytes,
        payout,
        ...terms,
        signature: signed.value,
      });
      const queued = await bundle.sync.enqueue(nodeCommunity.key, event);
      if (!queued.ok) return unqueuedMessage("Your approval was signed", queued.reason);
      approvalEvents.current.set(payout, queued.id);
      void tick({ once: true });
      return undefined;
    },
    [nodeFor, did, auth, nodeCommunity, tick],
  );

  const payPayment = useCallback(
    async (payout: string) => {
      const bundle = nodeFor();
      if (bundle === null || bundle.client === undefined || nodeCommunity === null) {
        return "Make or join a community on the OCN Node first, in Settings.";
      }
      const reply = await bundle.client.payOut(nodeCommunity.key, payout);
      if (!reply.ok) return nodeFailureMessage(reply.failure, "pay the supplier");
      sentPayments.current.set(payout, reply.value.reason);
      return undefined;
    },
    [nodeFor, nodeCommunity],
  );

  const saveSupplierBank = useCallback(
    async (supplier: string, bank: BankForm) => {
      const bundle = nodeFor();
      if (bundle === null || bundle.client === undefined || nodeCommunity === null) {
        return "Make or join a community on the OCN Node first, in Settings.";
      }
      if (supplier === "" || bank.name === "" || bank.bankId === "" || bank.accountNumber === "") {
        return "Fill in the supplier, the account holder, the bank and the account number.";
      }
      const reply = await bundle.client.saveSupplierBank(nodeCommunity.key, supplier, bank);
      if (!reply.ok) return nodeFailureMessage(reply.failure, "save the bank details");
      return undefined;
    },
    [nodeFor, nodeCommunity],
  );
  const placesOf = useCallback(async (): Promise<readonly RoutePlace[]> => {
    const current = serviceFor().community();
    if (current === null) return [];
    await current.space.update();
    const rows = await current.space.view.list("places/");
    return rows.map((row) => {
      const value = (row.value ?? {}) as { label?: unknown; area?: unknown };
      return {
        id: row.key.slice("places/".length),
        label: typeof value.label === "string" ? value.label : "",
        area: typeof value.area === "string" ? value.area : "",
      };
    });
  }, [serviceFor]);

  const planRoute = useCallback(
    async (origin: string, destination: string) => {
      const bundle = nodeFor();
      const current = serviceFor().community();
      if (bundle === null || bundle.client === undefined || nodeCommunity === null) {
        return { ok: false as const, message: OFFLINE_PLAN_MESSAGE };
      }
      if (current === null) return { ok: false as const, message: "Make a community first." };
      await current.space.update();
      const driver = await serviceFor().currentDriver(Date.now());
      if (driver === undefined) {
        return { ok: false as const, message: "Assign a driver before planning a route." };
      }
      const reply = await bundle.client.planRoute(nodeCommunity.key, {
        order: DELIVERY_ORDER,
        origin,
        destination,
      });
      if (!reply.ok) return { ok: false as const, message: planFailureMessage(reply.failure) };
      const route = reply.value;
      const recorded = await serviceFor().planDelivery({
        order: DELIVERY_ORDER,
        driver,
        origin,
        destination,
        route: {
          costing: route.costing,
          distanceMeters: route.distanceMeters,
          durationSeconds: route.durationSeconds,
          tileRelease: route.tileRelease,
          fingerprint: route.fingerprint,
        },
      });
      setRefusals(serviceFor().refusals());
      if (!recorded.ok) return { ok: false as const, message: recorded.error.message };
      return { ok: true as const, route };
    },
    [nodeFor, nodeCommunity, serviceFor],
  );

  const routeScreen = useCallback(async (): Promise<RouteScreen> => {
    const current = serviceFor().community();
    if (current === null) return { state: "none" };
    await current.space.update();
    const stored = (await current.space.view.get(DELIVERY_VIEW_KEY)) as
      | { fingerprint?: unknown }
      | undefined;
    if (typeof stored?.fingerprint !== "string") return { state: "none" };
    const bundle = nodeFor();
    if (bundle === null || bundle.client === undefined || nodeCommunity === null) {
      return { state: "unreachable", message: OFFLINE_PLAN_MESSAGE };
    }
    return routeScreenOf(
      await bundle.client.route(nodeCommunity.key, DELIVERY_ORDER, stored.fingerprint),
    );
  }, [nodeFor, nodeCommunity, serviceFor]);

  const shownMembers = nodeCommunity === null ? members : nodeMembers;
  const shownRoleHolders = nodeCommunity === null ? roleHolders : nodeRoleHolders;
  const noNodeReason =
    did === null || auth === null || NODE_ADDRESS.ok ? undefined : NODE_ADDRESS.reason;
  const nodeConnected = node.current?.client !== undefined;

  const value = useMemo(
    () => ({
      community,
      isCreator,
      members: shownMembers,
      roleHolders: shownRoleHolders,
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
      ordersOf,
      proposeOrder,
      approveOrder,
      files: filesSurface,
      proof: proofSurface,
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
      pledgeOrder,
      placesOf,
      planRoute,
      routeScreen,
      paymentOf,
      payOrder,
      paymentsOf,
      proposePayment,
      approvePayment,
      payPayment,
      saveSupplierBank,
    }),
    [
      community,
      isCreator,
      shownMembers,
      shownRoleHolders,
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
      ordersOf,
      proposeOrder,
      approveOrder,
      filesSurface,
      proofSurface,
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
      pledgeOrder,
      placesOf,
      planRoute,
      routeScreen,
      paymentOf,
      payOrder,
      paymentsOf,
      proposePayment,
      approvePayment,
      payPayment,
      saveSupplierBank,
    ],
  );
  return <CommunityContext.Provider value={value}>{children}</CommunityContext.Provider>;
}

export function useCommunity(): CommunityContextValue {
  const value = useContext(CommunityContext);
  if (value === null) throw new Error("useCommunity must be used inside CommunityProvider");
  return value;
}
