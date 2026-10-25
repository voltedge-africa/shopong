import type { MiniAppCategory } from "@shopong/miniapp";

import { pinScreen, type PinnedScreen } from "./pinnedScreen";
import type { SequenceDiagram, SequenceMessage } from "./uml";

export type TaskStatus = "pending" | "running" | "complete" | "error";

export type LogicKind = "trigger" | "step" | "decision" | "action";

export type LogicNode = {
  id: string;
  kind: LogicKind;
  label: string;
  /** Grid cell, not pixels: see `LOGIC_CELL`. */
  col: number;
  row: number;
};

export type LogicEdge = { from: string; to: string; label?: string; dashed?: boolean };

/**
 * A screen as the builder hands it over: OpenUI Lang text, pinned (see `lib/pinnedScreen.ts`). The
 * builder writes it once; the Screens tab, the Publish preview and the published app all draw that same
 * text.
 */
export type BuildScreen = PinnedScreen;

/** A check that fails the first time and is fixed, so the build screen shows how a failure looks. */
export type KnownIssue = { screen: string; problem: string; fix: string };

export type Build = {
  title: string;
  /** What the build may do, in a phrase: "look at your records and send messages for you". */
  permission: string;
  /** The same, one thing per entry: "look at your records", "send messages for you". */
  permissions: readonly string[];
  /** True when something it does moves money, so it waits for the person's OK first. */
  needsApproval: boolean;
  /** One line about the app, to start from when it is published. */
  blurb: string;
  /** How the app looks on Home to start with. */
  icon: AppIcon;
  category: MiniAppCategory;
  /** How the build works as a UML sequence diagram; the reply embeds it as `SEQUENCE_SRC`. */
  sequence: SequenceDiagram;
  /** Markdown, the builder's answer. It never contains code. */
  reply: string;
  nodes: readonly LogicNode[];
  edges: readonly LogicEdge[];
  screens: readonly BuildScreen[];
  /** What the person asked to change after the first answer, in order. Each one is built and tested. */
  changes: readonly string[];
  knownIssue?: KnownIssue;
};

/** The pictures an app can have on Home. */
export const APP_ICONS = [
  "sparkles-outline",
  "people-outline",
  "cart-outline",
  "bicycle-outline",
  "stats-chart-outline",
  "wallet-outline",
  "cube-outline",
  "chatbubbles-outline",
] as const;
export type AppIcon = (typeof APP_ICONS)[number];

/** Pixels per grid cell on the logic canvas. */
export const LOGIC_CELL = { x: 210, y: 130 } as const;

/** The image address the reply uses for the build's sequence diagram. */
export const SEQUENCE_SRC = "uml:sequence";

const PREVIEW_NOTE =
  "_Preview only: the builder is not connected yet, so this is an example of what it will produce._";

/* -------------------------------------------------------------------------- */
/* The answer, written for people who are not technical                        */
/* -------------------------------------------------------------------------- */

type Access = "read" | "message" | "propose" | "confirm";

type ReplySpec = {
  title: string;
  /** What the person needs, in their terms: the answer starts here. */
  need: string;
  /** What gets built, in a sentence. */
  plan: string;
  /** One line about the app, as it would sit under its name. */
  blurb: string;
  icon: AppIcon;
  category: MiniAppCategory;
  /** What they could ask to change, as an offer: the answer ends with it. */
  offer: string;
  /** What the build does, in order. */
  steps: readonly {
    access: Access;
    /** What the builder asks your records to do, as it appears on the diagram. */
    ask: string;
    /** What comes back. */
    gets: string;
    /** What it means for you, as a sentence that starts with a verb: "Looks at who has paid". */
    does: string;
  }[];
  /** What each screen shows, in plain words. */
  screens: readonly { name: string; shows: string }[];
};

const PERMISSION: Record<Access, string> = {
  read: "look at your records",
  message: "send messages for you",
  propose: "prepare orders for you to approve",
  confirm: "save proof once you approve",
};

const needsApproval = (access: Access): boolean => access === "propose" || access === "confirm";

/** How the build works: you ask, the builder checks your records, and money waits for your OK. */
function sequenceOf(steps: ReplySpec["steps"]): SequenceDiagram {
  const messages: SequenceMessage[] = [{ from: 0, to: 1, label: "You ask", kind: "call" }];
  for (const step of steps) {
    messages.push(
      { from: 1, to: 2, label: step.ask, kind: "call" },
      { from: 2, to: 1, label: step.gets, kind: "return" },
    );
    if (needsApproval(step.access)) {
      messages.push(
        { from: 2, to: 0, label: "Waits for your OK", kind: "return" },
        { from: 0, to: 2, label: "You approve", kind: "call" },
      );
    }
  }
  messages.push({ from: 1, to: 0, label: "Done", kind: "return" });
  return { participants: ["You", "Builder", "Your records"], messages };
}

/**
 * The answer: what gets built, how it works as a diagram, what it can do and what you will see. No
 * code and no technical words. The diagram is a UML sequence diagram the app draws (`uml:sequence`).
 */
function replyOf(spec: ReplySpec): string {
  const does = spec.steps.map((step) => `- ${step.does}`);
  const screens = spec.screens.map((screen) => `- **${screen.name}**: ${screen.shows}`);
  const money = spec.steps.some((step) => needsApproval(step.access));
  return [
    `## ${spec.title}`,
    spec.need,
    spec.plan,
    "### How it works",
    `![How this build works, step by step](${SEQUENCE_SRC})`,
    "### What it can do",
    ...does,
    money
      ? "Anything that moves money waits for your OK."
      : "It never moves money, so nothing needs your OK.",
    "### What you will see",
    ...screens,
    "Tap **Logic** to see the steps, **Screens** to preview them and **Build and Publish** to follow the progress and publish.",
    spec.offer,
    PREVIEW_NOTE,
  ].join("\n\n");
}

/** What the session may do, in a phrase: "look at your records and send messages for you". */
function permissionOf(steps: ReplySpec["steps"]): string {
  const kinds = [...new Set(steps.map((step) => step.access))];
  const phrases = kinds.map((kind) => PERMISSION[kind]);
  return phrases.length < 2
    ? (phrases[0] ?? "")
    : `${phrases.slice(0, -1).join(", ")} and ${phrases.at(-1)}`;
}

/** The parts of a build that come from its spec. */
function spec(input: ReplySpec) {
  return {
    permission: permissionOf(input.steps),
    permissions: [...new Set(input.steps.map((step) => PERMISSION[step.access]))],
    needsApproval: input.steps.some((step) => needsApproval(step.access)),
    blurb: input.blurb,
    icon: input.icon,
    category: input.category,
    sequence: sequenceOf(input.steps),
    reply: replyOf(input),
  };
}

/* -------------------------------------------------------------------------- */
/* What can be built                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Pins a screen the builder wrote. Today the builder is a script, so the text below is written by hand
 * and stands in for what a model would write; it is stored and drawn exactly as a model's would be.
 */
const screenOf = (id: string, title: string, source: string): BuildScreen =>
  pinScreen({ id, title, source });

/** A piece of text as an OpenUI Lang string, with its quotes and line breaks escaped. */
const quoted = (text: string): string => JSON.stringify(text);

type Archetype = { match: RegExp; build: (prompt: string) => Build };

const pledges: Archetype = {
  match: /stokvel|saving|pledge|owe|contribut|remind|member|payout/i,
  build: () => ({
    title: "Pledge tracker",
    ...spec({
      title: "Pledge tracker",
      blurb: "Checks every pledge each month and reminds the members who still owe.",
      icon: "people-outline",
      category: "Money",
      need: "You want to keep track of who owes you, and have a way of reminding them.",
      plan: "I will build a tracker that checks every pledge each month, counts what has been paid and reminds the members who still owe.",
      offer:
        "Would you like it to remind them on a day you choose, or at a different time each month?",
      steps: [
        {
          access: "read",
          ask: "Who is in the stokvel?",
          gets: "The members",
          does: "Looks at who is in the stokvel",
        },
        {
          access: "read",
          ask: "Who has paid?",
          gets: "Each pledge",
          does: "Looks at each pledge and whether it is paid",
        },
        {
          access: "message",
          ask: "Send a reminder",
          gets: "Sent",
          does: "Sends reminders for you to members who owe",
        },
      ],
      screens: [
        {
          name: "Pledges",
          shows:
            "A progress bar toward the target, each member and whether they have paid, and a Remind button.",
        },
        { name: "Remind", shows: "A message box and a Send button." },
      ],
    }),
    nodes: [
      { id: "due", kind: "trigger", label: "Pledge month starts", col: 0, row: 1 },
      { id: "check", kind: "step", label: "Check pledges", col: 1, row: 1 },
      { id: "paid", kind: "decision", label: "Paid?", col: 2, row: 1 },
      { id: "mark", kind: "action", label: "Count toward the pool", col: 3, row: 0 },
      { id: "remind", kind: "action", label: "Send a reminder", col: 3, row: 2 },
      { id: "wait", kind: "step", label: "Wait 3 days", col: 2, row: 3 },
    ],
    edges: [
      { from: "due", to: "check" },
      { from: "check", to: "paid" },
      { from: "paid", to: "mark", label: "yes" },
      { from: "paid", to: "remind", label: "no" },
      { from: "remind", to: "wait" },
      { from: "wait", to: "check", dashed: true },
    ],
    screens: [
      screenOf(
        "pledges",
        "Pledges",
        `root = Screen("Pledges", [stack])
stack = Stack([paid, target, members, remind])
paid = Metric("Paid so far", "R 3 360 of R 5 600")
target = Progress("Toward the target", 60)
members = List([nomsa, thabo, lindiwe])
nomsa = ListItem("Nomsa", "R 840", "Paid", "good")
thabo = ListItem("Thabo", "R 840", "Paid", "good")
lindiwe = ListItem("Lindiwe", "R 840", "Owes", "attention")
remind = Button("Remind everyone who owes", "primary", @MessageSend())
`,
      ),
      screenOf(
        "remind",
        "Remind",
        `root = Screen("Remind", [stack])
stack = Stack([to, message, send, cancel])
to = Text("To: Lindiwe and 1 other member who owes", true)
message = Field("Write your message", "Message")
send = Button("Send reminder", "primary", @MessageSend())
cancel = Button("Cancel", "secondary")
`,
      ),
    ],
    changes: [],
  }),
};

const reorder: Archetype = {
  match: /stock|reorder|inventory|supplier|spaza|shelf|shop|order/i,
  build: () => ({
    title: "Reorder list",
    ...spec({
      title: "Reorder list",
      blurb: "Watches your stock and prepares an order from the cheapest supplier.",
      icon: "cart-outline",
      category: "Commerce",
      need: "You want to stop running out of stock, and to buy from whoever charges least.",
      plan: "I will build a list that watches your stock, compares what your suppliers charge and prepares an order from the cheapest one.",
      offer: "Would you like it to warn you earlier for the items that sell fastest?",
      steps: [
        {
          access: "read",
          ask: "What is running low?",
          gets: "Low items",
          does: "Looks at what is on your shelves",
        },
        {
          access: "read",
          ask: "Who charges least?",
          gets: "Cheapest supplier",
          does: "Compares what your suppliers charge",
        },
        {
          access: "propose",
          ask: "Prepare an order",
          gets: "A draft order",
          does: "Prepares an order. Nothing is bought until you approve it",
        },
      ],
      screens: [
        {
          name: "Reorder",
          shows: "The items running low and the cheapest supplier for each, with a Compare button.",
        },
        {
          name: "Draft order",
          shows:
            "The supplier, the items and the total, with Approve and Keep on the list buttons.",
        },
      ],
    }),
    nodes: [
      { id: "low", kind: "trigger", label: "Stock runs low", col: 0, row: 1 },
      { id: "list", kind: "step", label: "Add to the reorder list", col: 1, row: 1 },
      { id: "quotes", kind: "step", label: "Compare supplier prices", col: 2, row: 1 },
      { id: "draft", kind: "action", label: "Prepare an order", col: 3, row: 1 },
      { id: "approve", kind: "decision", label: "You approve?", col: 4, row: 1 },
      { id: "send", kind: "action", label: "Place the order", col: 5, row: 0 },
      { id: "keep", kind: "step", label: "Keep on the list", col: 5, row: 2 },
    ],
    edges: [
      { from: "low", to: "list" },
      { from: "list", to: "quotes" },
      { from: "quotes", to: "draft" },
      { from: "draft", to: "approve" },
      { from: "approve", to: "send", label: "yes" },
      { from: "approve", to: "keep", label: "no", dashed: true },
    ],
    screens: [
      screenOf(
        "list",
        "Reorder",
        `root = Screen("Reorder", [stack])
stack = Stack([low, compare])
low = List([maize, oil, bread])
maize = ListItem("Maize meal 5 kg", "2 left, you like to keep 6", "Low", "attention")
oil = ListItem("Cooking oil 750 ml", "1 left, you like to keep 4", "Low", "attention")
bread = ListItem("Bread", "3 left, you like to keep 10", "Low", "attention")
compare = Button("Compare suppliers", "primary", @LedgerRead())
`,
      ),
      screenOf(
        "order",
        "Draft order",
        `root = Screen("Draft order", [stack])
stack = Stack([supplier, items, total, approve, keep])
supplier = Pair("Supplier", "Ubuntu Wholesale")
items = Pair("Items", "3")
total = Pair("Total", "R 1 840.00")
approve = Button("Approve and place order", "primary", @OrderPropose())
keep = Button("Keep on the list", "secondary")
`,
      ),
    ],
    changes: [],
  }),
};

const run: Archetype = {
  match: /deliver|driver|route|collect|pickup|run sheet|truck|bakkie/i,
  build: () => ({
    title: "Run sheet",
    ...spec({
      title: "Run sheet",
      blurb: "The day's stops in order, with proof of each delivery.",
      icon: "bicycle-outline",
      category: "Logistics",
      need: "You want your driver to have the day's stops in order, and to prove each delivery was made.",
      plan: "I will build a run sheet for your driver: the stops in a good order, and proof of each delivery.",
      offer: "Would you like each member to get a message when the driver is on the way?",
      steps: [
        {
          access: "read",
          ask: "Plan the stops",
          gets: "Stops in order",
          does: "Puts the stops in a good order",
        },
        {
          access: "confirm",
          ask: "Record a delivery",
          gets: "Proof saved",
          does: "Saves a photo and the place as proof, once you approve",
        },
        {
          access: "message",
          ask: "Tell the member",
          gets: "Sent",
          does: "Tells each member their order is close",
        },
      ],
      screens: [
        { name: "Stops", shows: "Today's stops in order, with a Start button." },
        { name: "Confirm", shows: "A photo, the name of the stop and a Confirm button." },
      ],
    }),
    nodes: [
      { id: "paid", kind: "trigger", label: "Orders are paid", col: 0, row: 1 },
      { id: "plan", kind: "step", label: "Plan the stops", col: 1, row: 1 },
      { id: "stop", kind: "step", label: "Go to the next stop", col: 2, row: 1 },
      { id: "near", kind: "action", label: "Tell the member", col: 3, row: 0 },
      { id: "confirm", kind: "action", label: "Confirm the delivery", col: 3, row: 2 },
      { id: "more", kind: "decision", label: "More stops?", col: 4, row: 2 },
    ],
    edges: [
      { from: "paid", to: "plan" },
      { from: "plan", to: "stop" },
      { from: "stop", to: "near" },
      { from: "stop", to: "confirm" },
      { from: "confirm", to: "more" },
      { from: "more", to: "stop", label: "yes", dashed: true },
    ],
    screens: [
      screenOf(
        "stops",
        "Stops",
        `root = Screen("Today's run", [stack])
stack = Stack([stops, start])
stops = List([first, second, third])
first = ListItem("1. Clermont, Nomsa", "Maize meal, oil")
second = ListItem("2. Clermont, Thabo", "Bread")
third = ListItem("3. Hillary, Lindiwe", "Airtime")
start = Button("Start the run", "primary", @RoutePlan())
`,
      ),
      screenOf(
        "confirm",
        "Confirm",
        `root = Screen("Confirm delivery", [stack])
stack = Stack([stop, photo, take, confirm])
stop = Heading("Clermont, Nomsa")
photo = Photo("Photo of the delivery")
take = Button("Take a photo", "secondary", @DeliveryConfirm())
confirm = Button("Confirm delivered", "primary", @DeliveryConfirm())
`,
      ),
    ],
    changes: [],
    knownIssue: {
      screen: "Confirm",
      problem: "The Confirm button let a delivery through without a photo.",
      fix: "Confirming now asks for the photo first.",
    },
  }),
};

const custom: Archetype = {
  match: /./,
  build: (prompt) => {
    const title = titleFor(prompt);
    return {
      title,
      ...spec({
        title,
        blurb: "A first version of what you described.",
        icon: "sparkles-outline",
        category: "Community",
        need: "Here is a first version of what you described.",
        plan: "It looks at the information it needs, shows it to you and checks with you before anything involves money.",
        offer: "Tell me what it should show first, and I will change it.",
        steps: [
          {
            access: "read",
            ask: "Who is in the group?",
            gets: "The members",
            does: "Looks at who is in your group",
          },
          {
            access: "read",
            ask: "What has been paid?",
            gets: "The payments",
            does: "Looks at your payments",
          },
          {
            access: "message",
            ask: "Send a message",
            gets: "Sent",
            does: "Sends messages for you",
          },
        ],
        screens: [{ name: title, shows: "A page with the information and a Refresh button." }],
      }),
      nodes: [
        { id: "start", kind: "trigger", label: "Something happens", col: 0, row: 0 },
        { id: "read", kind: "step", label: "Look at the information", col: 1, row: 0 },
        { id: "show", kind: "action", label: "Show you the result", col: 2, row: 0 },
      ],
      edges: [
        { from: "start", to: "read" },
        { from: "read", to: "show" },
      ],
      screens: [
        screenOf(
          "main",
          title,
          `root = Screen(${quoted(title)}, [stack])
stack = Stack([note, refresh])
note = Text("Your information will appear here", true)
refresh = Button("Refresh", "primary", @LedgerRead())
`,
        ),
      ],
      changes: [],
    };
  },
};

const ARCHETYPES: readonly Archetype[] = [pledges, reorder, run, custom];

/** How people begin a request. It says what they feel, not what they want built. */
const OPENING =
  /^(please\s+)?((can|could)\s+you\s+(please\s+)?(help\s+me\s+)?(to\s+)?|i\s+(need|want|would\s+like|'d\s+like)\s+(a\s+way\s+(to|of)\s+|to\s+)?|help\s+me\s+(to\s+)?)/i;

/** The first seven words of a request, without how it began, capitalised: a project's title. */
export function titleFor(prompt: string): string {
  const text = prompt
    .trim()
    .replace(/[.!?]+$/, "")
    .replace(OPENING, "");
  const words = text.split(/\s+/).filter(Boolean).slice(0, 7);
  if (words.length === 0) return "Untitled";
  const title = words.join(" ");
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/** The scripted stand-in for the builder agent. Same request, same build. */
export function designBuild(prompt: string): Build {
  const archetype = ARCHETYPES.find((entry) => entry.match.test(prompt)) ?? custom;
  return archetype.build(prompt);
}

/** A follow-up adds one change to the build. It is built and tested again. */
export function refineBuild(build: Build, prompt: string): { build: Build; reply: string } {
  const change = titleFor(prompt);
  return {
    build: { ...build, changes: [...build.changes, change] },
    reply: [
      `### Added: ${change}`,
      `I added this to your build, so it will be built and tested again. It can do the same things as before, so nothing new needs your OK.`,
      "Check **Logic** and **Screens** to see if they need the change too, and **Build and Publish** to follow the new run.",
      PREVIEW_NOTE,
    ].join("\n\n"),
  };
}

/** Pixel position of a logic node on the canvas. */
export const nodePosition = (node: Pick<LogicNode, "col" | "row">) => ({
  x: 24 + node.col * LOGIC_CELL.x,
  y: 24 + node.row * LOGIC_CELL.y,
});

/** The first `count` words of `text`, for revealing a reply as if it were streaming. */
export function revealWords(text: string, count: number): string {
  if (count <= 0) return "";
  const pieces = text.split(/(\s+)/);
  let words = 0;
  let end = 0;
  for (let index = 0; index < pieces.length; index++) {
    const piece = pieces[index]!;
    if (!/^\s*$/.test(piece)) words++;
    end = index + 1;
    if (words >= count) break;
  }
  return pieces.slice(0, end).join("");
}

export const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length;

/**
 * Status of every task `tick` steps after the build started: the task at index `tick` is running,
 * the ones before it are complete and the ones after it are pending. Past the end, all complete.
 */
export function taskStatuses(count: number, tick: number): TaskStatus[] {
  return Array.from({ length: count }, (_, index) =>
    index < tick ? "complete" : index === tick ? "running" : "pending",
  );
}
