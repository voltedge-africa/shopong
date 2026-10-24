import { DEFAULT_EPOCH } from "@shopong/adapters-memory";
import type { Sha512 } from "@shopong/events";
import type { EpochMs } from "@shopong/ports";
import { formatZar } from "./format.js";
import { ACCOUNT_POOL, memberAccount } from "./node.js";
import { CURRENCY, HOUR_MS, MEMBERS } from "./plan.js";
import { STEPS } from "./steps.js";
import type { TimelineEntry } from "./timeline.js";
import { createWorld, roleLabel, type World } from "./world.js";

export interface ScenarioOptions {
  /** SHA-512 for event ids: `webCryptoSha512` in Node and browsers, the expo-crypto adapter in the app. */
  readonly sha512: Sha512;
  /** Seeds nonces and the space key. The same seed always gives the same event ids. */
  readonly seed?: string;
  /** Time of the first step. The scenario never reads the wall clock. */
  readonly startAt?: EpochMs;
}

export const DEFAULT_SEED = "ubuntu-savers-1";

export interface StepOutcome {
  /** 1-based. */
  readonly step: number;
  readonly id: string;
  readonly title: string;
  /** Timeline entries this step added. */
  readonly entries: readonly TimelineEntry[];
}

export interface MemberStatus {
  readonly key: string;
  readonly name: string;
  readonly role: string;
  /** One phrase, for example `Pledged R840.00, payment requested`. */
  readonly status: string;
  readonly paid: boolean;
}

export interface FundingSummary {
  /** The selected quote's price, once chosen. */
  readonly targetMinor?: number;
  readonly paidMinor: number;
  /** Pledged or requested but not paid yet. */
  readonly pendingMinor: number;
  /** Whole percent of the target that is paid, 0 to 100. */
  readonly percent: number;
  readonly funded: boolean;
  /** For example `R3 360.00 of R4 180.00 paid (80%)`. */
  readonly text: string;
}

export interface MemberSummary {
  readonly name: string;
  readonly paidText: string;
  readonly shareText: string;
  /** What the member is owed back from the pool. */
  readonly creditText: string;
}

export interface OrderSummary {
  readonly totalCostText: string;
  readonly creditedBackText: string;
  readonly members: readonly MemberSummary[];
}

export interface Snapshot {
  readonly stepsDone: number;
  readonly stepsTotal: number;
  readonly done: boolean;
  /** The step "Next step" would run. */
  readonly next?: { readonly step: number; readonly title: string };
  readonly timeline: readonly TimelineEntry[];
  readonly members: readonly MemberStatus[];
  readonly funding: FundingSummary;
  /** Present once the order is closed. */
  readonly summary?: OrderSummary;
}

export interface Reconciliation {
  readonly ok: boolean;
  readonly problems: readonly string[];
  /** What members paid in, from the record. */
  readonly contributionsMinor: number;
  /** What the supplier was paid, from the record. */
  readonly supplierPaidMinor: number;
  /** The pool's balance in the books. */
  readonly poolMinor: number;
  readonly members: ReadonlyArray<{
    readonly key: string;
    readonly paidMinor: number;
    readonly shareMinor: number;
    /** From the books. */
    readonly creditMinor: number;
  }>;
}

export interface StokvelScenario {
  readonly stepCount: number;
  /** Run the next step. Resolves to `undefined` when every step has run. */
  step(): Promise<StepOutcome | undefined>;
  /** Run every remaining step. */
  runAll(): Promise<Snapshot>;
  /** Throw everything away and start again from step 1. */
  reset(): Promise<void>;
  /**
   * Run a step that already ran, a second time. Every event it writes is identical, so the
   * record, the books and the payment ports must end up exactly as they were.
   */
  rerun(step: number): Promise<void>;
  snapshot(): Promise<Snapshot>;
  /** Compare the books with the record. */
  reconcile(): Promise<Reconciliation>;
  /** The adapters, record and cast, for tests and tooling. */
  world(): Promise<World>;
}

type Obj = { [key: string]: unknown };

async function viewObj(world: World, key: string): Promise<Obj | undefined> {
  await world.hub.update();
  const value = await world.hub.view.get(key);
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Obj)
    : undefined;
}

function fundingText(paid: number, target: number | undefined, percent: number): string {
  return target === undefined
    ? "No supplier chosen yet, so there is no target"
    : `${formatZar(paid)} of ${formatZar(target)} paid (${String(percent)}%)`;
}

async function buildSnapshot(world: World, stepsDone: number): Promise<Snapshot> {
  const selected = await viewObj(world, "selected");
  const target = typeof selected?.totalMinor === "number" ? selected.totalMinor : undefined;
  let paid = 0;
  let pending = 0;
  const members: MemberStatus[] = [];
  for (const m of MEMBERS) {
    const person = world.person(m.key);
    const actor = await viewObj(world, `actors/${person.actor}`);
    const pledge = await viewObj(world, `pledges/${m.key}`);
    const collected = await viewObj(world, `collections/${m.key}`);
    const amount = typeof pledge?.amountMinor === "number" ? pledge.amountMinor : 0;
    let status = "Not invited yet";
    if (actor?.state === "invited") status = "Invited";
    if (actor?.state === "joined") status = "Joined";
    if (pledge?.state === "pledged" || pledge?.state === "requested") {
      pending += amount;
      status =
        pledge.state === "pledged"
          ? `Pledged ${formatZar(amount)}`
          : `Pledged ${formatZar(amount)}, payment requested`;
    }
    if (pledge?.state === "failed") status = "Payment failed, needs another try";
    if (pledge?.state === "paid") {
      paid += amount;
      status = `Paid ${formatZar(amount)}`;
    }
    if (collected !== undefined) status = "Collected their share";
    members.push({
      key: m.key,
      name: m.name,
      role: roleLabel(m),
      status,
      paid: pledge?.state === "paid",
    });
  }
  const percent =
    target === undefined || target === 0 ? 0 : Math.min(100, Math.floor((paid * 100) / target));
  const order = await viewObj(world, "order");
  const funded = target !== undefined && paid >= target && order?.status !== undefined;

  const closed = await viewObj(world, "closed");
  let summary: OrderSummary | undefined;
  if (closed !== undefined) {
    const rows = Array.isArray(closed.members) ? (closed.members as Obj[]) : [];
    summary = {
      totalCostText: formatZar(Number(closed.totalCostMinor)),
      creditedBackText: formatZar(Number(closed.creditedBackMinor)),
      members: rows.map((r) => ({
        name: world.person(String(r.member)).name,
        paidText: formatZar(Number(r.paidMinor)),
        shareText: formatZar(Number(r.shareMinor)),
        creditText: formatZar(Number(r.creditMinor)),
      })),
    };
  }
  const nextStep = STEPS[stepsDone];
  return {
    stepsDone,
    stepsTotal: STEPS.length,
    done: stepsDone >= STEPS.length,
    ...(nextStep === undefined ? {} : { next: { step: stepsDone + 1, title: nextStep.title } }),
    timeline: [...world.timeline],
    members,
    funding: {
      ...(target === undefined ? {} : { targetMinor: target }),
      paidMinor: paid,
      pendingMinor: pending,
      percent,
      funded,
      text: fundingText(paid, target, percent),
    },
    ...(summary === undefined ? {} : { summary }),
  };
}

async function buildReconciliation(world: World): Promise<Reconciliation> {
  const problems: string[] = [];
  let contributions = 0;
  const rows: { key: string; paidMinor: number; shareMinor: number; creditMinor: number }[] = [];
  const supplier = await viewObj(world, "supplier");
  const supplierPaid = supplier?.state === "paid" ? Number(supplier.amountMinor) : 0;
  const closed = await viewObj(world, "closed");
  const closedRows = Array.isArray(closed?.members) ? (closed.members as Obj[]) : [];

  for (const m of MEMBERS) {
    const pledge = await viewObj(world, `pledges/${m.key}`);
    const paid = pledge?.state === "paid" ? Number(pledge.amountMinor) : 0;
    contributions += paid;
    const credit = (await world.ledger.balance(memberAccount(m.key), CURRENCY)).balance.minor;
    const share = Number(closedRows.find((r) => r.member === m.key)?.shareMinor ?? 0);
    rows.push({ key: m.key, paidMinor: paid, shareMinor: share, creditMinor: credit });
    if (supplierPaid > 0 && credit !== paid - share) {
      problems.push(
        `${m.name}: books say ${formatZar(credit)} credit, record says ${formatZar(paid - share)}`,
      );
    }
  }
  const pool = (await world.ledger.balance(ACCOUNT_POOL, CURRENCY)).balance.minor;
  if (pool !== contributions - supplierPaid) {
    problems.push(
      `pool holds ${formatZar(pool)} but contributions ${formatZar(contributions)} minus supplier ${formatZar(supplierPaid)} is ${formatZar(contributions - supplierPaid)}`,
    );
  }
  // Every money event in the record has its books entry, found by the event id.
  for (const entry of world.timeline) {
    if (entry.money?.state === "paid" && entry.eventId !== undefined) {
      if ((await world.ledger.findByIdempotencyKey(entry.eventId)) === undefined) {
        problems.push(`no ledger entry for event ${entry.eventIdShort ?? ""}: ${entry.title}`);
      }
    }
  }
  const trial = await world.ledger.trialBalance();
  for (const t of trial.totals) {
    if (t.debits !== t.credits)
      problems.push(`trial balance is out by ${String(t.debits - t.credits)} ${t.currency}`);
  }
  return {
    ok: problems.length === 0,
    problems,
    contributionsMinor: contributions,
    supplierPaidMinor: supplierPaid,
    poolMinor: pool,
    members: rows,
  };
}

export function createStokvelScenario(options: ScenarioOptions): StokvelScenario {
  const seed = options.seed ?? DEFAULT_SEED;
  const startAt = options.startAt ?? DEFAULT_EPOCH;
  let current: Promise<World> | undefined;
  let stepsDone = 0;
  // One thing at a time: presses of "Next step" must never interleave.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const result = queue.then(work, work);
    queue = result.catch(() => undefined);
    return result;
  };
  const world = (): Promise<World> => {
    current ??= createWorld({ seed, sha512: options.sha512, startAt });
    return current;
  };
  const startOf = (index: number): number => startAt + index * HOUR_MS;

  async function runStep(index: number): Promise<StepOutcome> {
    const w = await world();
    const def = STEPS[index];
    if (def === undefined) throw new Error(`no step ${String(index + 1)}`);
    const before = w.timeline.length;
    w.stepNumber = index + 1;
    await def.run(w, startOf(index));
    return { step: index + 1, id: def.id, title: def.title, entries: w.timeline.slice(before) };
  }

  return {
    stepCount: STEPS.length,
    step: () =>
      serial(async () => {
        if (stepsDone >= STEPS.length) return undefined;
        const outcome = await runStep(stepsDone);
        stepsDone++;
        return outcome;
      }),
    runAll: () =>
      serial(async () => {
        while (stepsDone < STEPS.length) {
          await runStep(stepsDone);
          stepsDone++;
        }
        return buildSnapshot(await world(), stepsDone);
      }),
    reset: () =>
      serial(async () => {
        current = undefined;
        stepsDone = 0;
      }),
    rerun: (step) =>
      serial(async () => {
        if (step < 1 || step > stepsDone) throw new Error(`step ${String(step)} has not run yet`);
        const w = await world();
        const before = w.timeline.length;
        await runStep(step - 1);
        if (w.timeline.length !== before)
          throw new Error("re-running a step added timeline entries");
      }),
    snapshot: () => serial(async () => buildSnapshot(await world(), stepsDone)),
    reconcile: () => serial(async () => buildReconciliation(await world())),
    world,
  };
}
