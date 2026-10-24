// The world the scenario runs in: in-memory adapters, a cast of identities with their
// capability tokens, and `emit`, which turns "this person did this" into a real envelope
// appended to the shared record.

import {
  createEvent,
  encodeUtf8,
  eventIdOf,
  sha512Hex,
  type EventEnvelope,
  type EventType,
  type JsonObject,
  type Sha512,
} from "@shopong/events";
import {
  MemoryCapabilityAuth,
  MemoryLedger,
  MemoryPayIn,
  MemoryPayOut,
  MemoryRouting,
  createCounterIds,
  createManualClock,
  createMemoryRecordNetwork,
  type ManualClock,
  type MemoryRecordNetwork,
} from "@shopong/adapters-memory";
import {
  money,
  type Capability,
  type CapabilityToken,
  type Did,
  type EpochMs,
  type EventId,
  type Space,
  type SpaceDefinition,
} from "@shopong/ports";
import { createApply, encodeProof } from "./apply.js";
import { base58btc } from "./base58.js";
import { formatZar } from "./format.js";
import { CEILING_MINOR, CURRENCY, DAY_MS, DRIVER, MEMBERS, NODE, type PersonSpec } from "./plan.js";
import { seededHex } from "./prng.js";
import { MONEY_STATE_WORDS, type EntryDescription, type TimelineEntry } from "./timeline.js";

export interface Person extends PersonSpec {
  /** The `CapabilityAuth` identity that signs this person's tokens. */
  readonly did: Did;
  /** The envelope `actor`: a `did:key`-shaped alias of `did`. See `aliasDidKey`. */
  readonly actor: string;
  /** The capability token this person presents as `proof`. */
  token: CapabilityToken;
}

/** A record of one external effect, so re-running a step can be shown to post nothing twice. */
export interface EffectRecord {
  readonly kind: "payin.request" | "payout.create" | "ledger.post";
  /** The idempotency key: the event id the effect belongs to. */
  readonly key: string;
  /** True when the port recognised the key and created nothing new. */
  readonly replayed: boolean;
}

export interface Emitted {
  readonly id: EventId;
  readonly event: EventEnvelope;
  /** True when the record already held this event (a re-run). */
  readonly duplicate: boolean;
  /** False when the space's `apply` refused it (see `rejected/<id>` in the view). */
  readonly accepted: boolean;
}

export interface EmitOptions {
  /** The writer's claimed time. */
  readonly at: EpochMs;
  /** Names the nonce, so the same label always builds the same event. Unique per event. */
  readonly label: string;
  /** Show the event on the timeline. Omit to keep it out of the timeline. */
  readonly show?: EntryDescription;
}

export interface World {
  readonly seed: string;
  readonly sha512: Sha512;
  readonly clock: ManualClock;
  readonly auth: MemoryCapabilityAuth;
  readonly ledger: MemoryLedger;
  readonly payIn: MemoryPayIn;
  readonly payOut: MemoryPayOut;
  readonly routing: MemoryRouting;
  readonly network: MemoryRecordNetwork;
  /** Everyone, in creation order: five members, the OCN Node, the driver. */
  readonly people: readonly Person[];
  /** The treasurer's replica of the space: the one the app reads. */
  readonly hub: Space<EventEnvelope>;
  /** The envelope `space`: 64 lowercase hex characters. */
  readonly spaceKey: string;
  readonly timeline: TimelineEntry[];
  /** Every event this world appended, by event id. */
  readonly events: Map<string, EventEnvelope>;
  readonly effects: EffectRecord[];
  /** The step being run, stamped on new timeline entries. */
  stepNumber: number;
  person(key: string): Person;
  personByActor(actor: string): Person | undefined;
  emit(
    person: Person,
    type: EventType,
    payload: JsonObject,
    options: EmitOptions,
  ): Promise<Emitted>;
  /** Add an entry that comes from the record's state rather than from one event. Once per `key`. */
  addDerivedEntry(
    key: string,
    entry: Omit<TimelineEntry, "index" | "step" | "eventId" | "eventIdShort">,
  ): void;
  /** Whether `apply` accepted the event with this id. */
  isAccepted(id: string): Promise<boolean>;
}

export interface WorldOptions {
  readonly seed: string;
  readonly sha512: Sha512;
  readonly startAt: EpochMs;
}

/**
 * A `did:key`-shaped alias for an in-memory identity: `did:key:z` + base58btc of the Ed25519
 * multicodec prefix (0xed01) and 32 bytes of SHA-512 of the in-memory DID. It satisfies the
 * envelope's `actor` pattern but is NOT a real key: nothing can be signed with it. The memory
 * `CapabilityAuth` only mints `did:mem:*` identities (a finding in the PR).
 */
export async function aliasDidKey(did: Did, sha512: Sha512): Promise<string> {
  const digest = await sha512(encodeUtf8(`alias:${did}`));
  const bytes = new Uint8Array(34);
  bytes[0] = 0xed;
  bytes[1] = 0x01;
  bytes.set(digest.slice(0, 32), 2);
  return `did:key:z${base58btc(bytes)}`;
}

const GRANT_UNTIL_DAYS = 90;

export async function createWorld(options: WorldOptions): Promise<World> {
  const { seed, sha512, startAt } = options;
  const clock = createManualClock(startAt);
  const auth = new MemoryCapabilityAuth({ ids: createCounterIds("auth") });
  const ledger = new MemoryLedger({ clock, ids: createCounterIds("txn") });
  const payIn = new MemoryPayIn({ clock, ids: createCounterIds("pay") });
  const payOut = new MemoryPayOut({ clock, ids: createCounterIds("payout") });
  const routing = new MemoryRouting();
  const network = createMemoryRecordNetwork({ ids: createCounterIds("rec") });

  // Identities, in a fixed order so their ids are the same on every run.
  const specs: readonly PersonSpec[] = [...MEMBERS, NODE, DRIVER];
  const people: Person[] = [];
  for (const spec of specs) {
    const did = await auth.createIdentity();
    people.push({
      ...spec,
      did,
      actor: await aliasDidKey(did, sha512),
      token: "" as CapabilityToken,
    });
  }
  const byKey = new Map(people.map((p) => [p.key, p]));
  const byActor = new Map(people.map((p) => [p.actor, p]));
  const authorityOfActor = (actor: string): Did | undefined => byActor.get(actor)?.did;
  const treasurer = people.find((p) => p.role === "treasurer");
  if (treasurer === undefined) throw new Error("the cast needs a treasurer");

  // The space key an Autobase would have: 32 bytes as 64 lowercase hex characters.
  const spaceKey = (await sha512Hex(encodeUtf8(`space:${seed}`), sha512)).slice(0, 64);
  const resource = `ocn:space/${spaceKey}`;
  const expiresAt = startAt + GRANT_UNTIL_DAYS * DAY_MS;

  // Capabilities. The treasurer holds a root grant (with a ceiling on approving payouts) and
  // delegates narrower tokens, which a real invitation would carry to each person.
  const rootCapabilities: Capability[] = [
    { with: resource, can: "member/*" },
    { with: resource, can: "role/*" },
    { with: resource, can: "order/*" },
    { with: resource, can: "quote/*" },
    { with: resource, can: "pledge/*" },
    { with: resource, can: "collection/*" },
    { with: resource, can: "delivery/*" },
    { with: resource, can: "payment/approve", ceiling: money(CURRENCY, CEILING_MINOR) },
    { with: resource, can: "payment/record" },
  ];
  const issue = async (
    to: Person,
    label: string,
    capabilities: Capability[],
    proofs?: CapabilityToken[],
  ): Promise<CapabilityToken> => {
    const result = await auth.issue({
      issuer: treasurer.did,
      audience: to.did,
      capabilities,
      notBefore: startAt,
      expiresAt,
      nonce: seededHex(seed, `cap:${label}`, 8),
      ...(proofs === undefined ? {} : { proofs }),
    });
    if (!result.ok) throw new Error(`could not issue ${label}: ${result.error.message}`);
    return result.value;
  };
  treasurer.token = await issue(treasurer, "root", rootCapabilities);
  const memberAbilities = ["member/join", "order/propose", "pledge/create", "collection/confirm"];
  for (const person of people) {
    if (person === treasurer) continue;
    const abilities =
      person.role === "node"
        ? ["payment/record"]
        : person.role === "driver"
          ? ["delivery/confirm"]
          : memberAbilities;
    person.token = await issue(
      person,
      person.key,
      abilities.map((can) => ({ with: resource, can })),
      [treasurer.token],
    );
  }

  const definition: SpaceDefinition<EventEnvelope> = {
    apply: createApply({ auth, rootIssuer: treasurer.did, authorityOf: authorityOfActor }),
    eventId: (event) => eventIdOf(event, sha512),
  };
  const hub = await network.peer<EventEnvelope>(treasurer.actor as Did).create(definition);
  const replicas = new Map<string, Space<EventEnvelope>>([[treasurer.key, hub]]);

  async function replicaOf(person: Person): Promise<Space<EventEnvelope>> {
    const existing = replicas.get(person.key);
    if (existing !== undefined) return existing;
    const space = await network.peer<EventEnvelope>(person.actor as Did).open(hub.key, definition);
    replicas.set(person.key, space);
    return space;
  }

  const shownDerived = new Set<string>();
  const shownEvents = new Set<string>();
  const world: World = {
    seed,
    sha512,
    clock,
    auth,
    ledger,
    payIn,
    payOut,
    routing,
    network,
    people,
    hub,
    spaceKey,
    timeline: [],
    events: new Map(),
    effects: [],
    stepNumber: 0,
    person(key) {
      const person = byKey.get(key);
      if (person === undefined) throw new Error(`no such person: ${key}`);
      return person;
    },
    personByActor: (actor) => byActor.get(actor),
    async isAccepted(id) {
      await hub.update();
      return (await hub.view.get(`rejected/${id}`)) === undefined;
    },
    async emit(person, type, payload, opts) {
      const replica = await replicaOf(person);
      // Catch up first: an invitation or an earlier event may exist only on another device.
      if (replica !== hub) await network.replicate(hub, replica);
      const event = createEvent({
        type,
        space: spaceKey,
        actor: person.actor,
        proof: [encodeProof(person.token)],
        claimedAt: opts.at,
        nonce: seededHex(seed, `event:${opts.label}`, 16),
        payload,
      });
      const appended = await replica.append(event);
      if (!appended.ok)
        throw new Error(`${person.name} could not append ${type}: ${appended.error.message}`);
      if (replica !== hub) await network.replicate(replica, hub);
      const { id, duplicate } = appended.value;
      world.events.set(id, event);
      const accepted = await world.isAccepted(id);
      if (accepted && !duplicate && opts.show !== undefined && !shownEvents.has(id)) {
        shownEvents.add(id);
        const { milestone, title, money: m } = opts.show;
        world.timeline.push({
          index: world.timeline.length + 1,
          step: world.stepNumber,
          milestone,
          eventType: type,
          title,
          actorName: person.name,
          actorRole: roleLabel(person),
          ...(m === undefined
            ? {}
            : {
                money: {
                  state: m.state,
                  amountMinor: m.amountMinor,
                  amountText: formatZar(m.amountMinor),
                  words: MONEY_STATE_WORDS[m.state],
                },
              }),
          eventId: id,
          eventIdShort: id.slice(0, 8),
          at: opts.at,
        });
      }
      return { id, event, duplicate, accepted };
    },
    addDerivedEntry(key, entry) {
      if (shownDerived.has(key)) return;
      shownDerived.add(key);
      world.timeline.push({ ...entry, index: world.timeline.length + 1, step: world.stepNumber });
    },
  };
  return world;
}

export function roleLabel(person: PersonSpec): string {
  switch (person.role) {
    case "treasurer":
      return "Treasurer";
    case "node":
      return "OCN Node";
    case "driver":
      return "Driver";
    default:
      return "Member";
  }
}
