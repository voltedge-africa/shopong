// Turns a scenario snapshot into exactly what the /demo screen shows. Plain strings and
// numbers, no React Native, so the same model drives the screen and the tests.

import {
  STEPS,
  type Milestone,
  type MoneyState,
  type Snapshot,
  type TimelineEntry,
} from "@shopong/scenario-stokvel";

export interface TimelineRowModel {
  readonly key: string;
  readonly milestone: Milestone;
  readonly title: string;
  /** For example `Nomsa Dlamini, Treasurer`. */
  readonly who: string;
  readonly money?: { readonly state: MoneyState; readonly text: string };
  /** For example `Event 63b69f91`, or `Worked out from the record` when no single event shows it. */
  readonly idText: string;
  /** The whole row as one sentence for screen readers. */
  readonly accessibilityLabel: string;
}

export interface TimelineGroupModel {
  readonly key: string;
  /** For example `Step 8: Every member pledges their share`. */
  readonly heading: string;
  readonly rows: readonly TimelineRowModel[];
}

export interface DemoScreenModel {
  readonly heading: string;
  readonly intro: string;
  /** For example `Step 9 of 16`, or `All 16 steps done`. */
  readonly progressLabel: string;
  readonly next: { readonly label: string; readonly detail: string; readonly enabled: boolean };
  readonly funding: {
    readonly heading: string;
    readonly text: string;
    readonly percent: number;
    readonly funded: boolean;
  };
  readonly members: ReadonlyArray<{
    readonly key: string;
    readonly name: string;
    readonly status: string;
  }>;
  readonly timelineHeading: string;
  readonly emptyTimeline: string;
  readonly groups: readonly TimelineGroupModel[];
  readonly summary?: {
    readonly heading: string;
    readonly lines: readonly string[];
  };
}

export const DEMO_HEADING = "A stokvel order, step by step";
export const DEMO_INTRO =
  "Five stokvel members buy groceries together. Nothing here is real money: it all runs on practice versions of the record, the books and the payment services, inside this app.";

function rowOf(entry: TimelineEntry): TimelineRowModel {
  const who = `${entry.actorName}, ${entry.actorRole}`;
  const idText =
    entry.eventIdShort === undefined ? "Worked out from the record" : `Event ${entry.eventIdShort}`;
  const money =
    entry.money === undefined
      ? undefined
      : { state: entry.money.state, text: `${entry.money.words}: ${entry.money.amountText}` };
  const parts = [entry.title, who, ...(money === undefined ? [] : [money.text]), idText];
  return {
    key: entry.eventId ?? `derived-${String(entry.index)}`,
    milestone: entry.milestone,
    title: entry.title,
    who,
    ...(money === undefined ? {} : { money }),
    idText,
    accessibilityLabel: `${parts.join(". ")}.`,
  };
}

export function demoScreenModel(snapshot: Snapshot): DemoScreenModel {
  const groups: { key: string; heading: string; rows: TimelineRowModel[] }[] = [];
  for (const entry of snapshot.timeline) {
    let group = groups.at(-1);
    if (group === undefined || group.key !== `step-${String(entry.step)}`) {
      group = {
        key: `step-${String(entry.step)}`,
        heading: `Step ${String(entry.step)}: ${STEPS[entry.step - 1]?.title ?? ""}`,
        rows: [],
      };
      groups.push(group);
    }
    group.rows.push(rowOf(entry));
  }

  const { funding, summary } = snapshot;
  return {
    heading: DEMO_HEADING,
    intro: DEMO_INTRO,
    progressLabel: snapshot.done
      ? `All ${String(snapshot.stepsTotal)} steps done`
      : `Step ${String(snapshot.stepsDone + 1)} of ${String(snapshot.stepsTotal)} is next`,
    next: snapshot.next
      ? { label: "Next step", detail: snapshot.next.title, enabled: true }
      : { label: "Next step", detail: "The order is finished", enabled: false },
    funding: {
      heading: "Money collected for the order",
      text: funding.text,
      percent: funding.percent,
      funded: funding.funded,
    },
    members: snapshot.members.map((m) => ({ key: m.key, name: m.name, status: m.status })),
    timelineHeading: "What has happened, in order",
    emptyTimeline: "Nothing yet. Press Next step to begin.",
    groups,
    ...(summary === undefined
      ? {}
      : {
          summary: {
            heading: "The order is closed",
            lines: [
              `The groceries cost ${summary.totalCostText} in total.`,
              ...summary.members.map(
                (m) =>
                  `${m.name}: paid ${m.paidText}, share ${m.shareText}, credit ${m.creditText}`,
              ),
              `${summary.creditedBackText} stays in the pool as credit for the members.`,
            ],
          },
        }),
  };
}

/** Every row of the screen in the order it is shown. */
export function allRows(model: DemoScreenModel): readonly TimelineRowModel[] {
  return model.groups.flatMap((g) => g.rows);
}
