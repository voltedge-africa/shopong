/**
 * Decides whether a request is something the builder can act on, before any agent is started. The
 * app does this, not the agent: a request that cannot become a workflow, screen or automation over
 * the OCN capabilities is refused here, without a session, a token or a model call.
 *
 * This is a plain keyword check, a stand-in for a real intent classifier. It leans towards
 * refusing: a refused request costs the person one rephrase, an accepted one starts a sandboxed
 * agent session.
 */

export type RefusalReason = "too-short" | "question" | "off-topic";

export type Verdict =
  | { ok: true }
  | { ok: false; reason: RefusalReason; title: string; message: string };

export const REFUSAL_TITLE = "No action can be performed";

const EXAMPLE = "I need a way to track who owes me and a way of reminding them";

const MESSAGES: Record<RefusalReason, string> = {
  "too-short": `That is too short for me to build from. Tell me what you want, for example “${EXAMPLE}”.`,
  question:
    "I build things for you, like trackers, lists and reminders. I can't answer questions. Tell me what you would like me to build.",
  "off-topic":
    "I can't build that. I can help with your group, shop or deliveries, such as pledges, stock, orders, payments and reminders. Tell me what you would like.",
};

/** What a request asks the builder to do. */
const ACTION = new RegExp(
  `\\b(${[
    "build",
    "create",
    "make",
    "design",
    "generate",
    "automate",
    "track",
    "monitor",
    "list",
    "show",
    "display",
    "remind",
    "notify",
    "alert",
    "send",
    "plan",
    "schedule",
    "reorder",
    "approve",
    "confirm",
    "compare",
    "split",
    "summari[sz]e",
    "tell me when",
    "let me",
    // How people say what they need.
    "i need",
    "i want",
    "i would like",
    "i'd like",
    "help me",
    "a way to",
    "a way of",
    // Changes to a build that already exists.
    "add",
    "remove",
    "change",
    "update",
    "include",
    "rename",
    "text",
    "email",
    "sms",
    "whatsapp",
  ].join("|")})(s|es|ed|ing)?\\b`,
  "i",
);

/** The kinds of thing a person asks for: an artefact rather than an answer. */
const ARTEFACT = new RegExp(
  `\\b(${[
    "workflow",
    "screen",
    "dashboard",
    "app",
    "form",
    "report",
    "tracker",
    "reminder",
    "automation",
    "sheet",
    "checklist",
    "page",
  ].join("|")})s?\\b`,
  "i",
);

/** What OCN has data about, so what a build can read or act on. */
const DOMAIN = new RegExp(
  `\\b(${[
    "stokvel",
    "members?",
    "pledges?",
    "contributions?",
    "payouts?",
    "owes?",
    "owed",
    "owing",
    "stock",
    "inventory",
    "shelf",
    "shelves",
    "suppliers?",
    "quotes?",
    "orders?",
    "invoices?",
    "prices?",
    "payments?",
    "wallet",
    "balance",
    "ledger",
    "sales",
    "customers?",
    "delivery",
    "deliveries",
    "drivers?",
    "routes?",
    "collection",
    "spaza",
    "shop",
    "funding",
    "funders?",
  ].join("|")})\\b`,
  "i",
);

const QUESTION_START =
  /^\s*(what|who|whom|whose|why|when|where|which|how|is|are|was|were|can|could|does|do|did|will|would|should)\b/i;

/** Words in a request, ignoring punctuation. */
const words = (text: string): string[] => text.toLowerCase().match(/[a-z0-9']+/g) ?? [];

function refuse(reason: RefusalReason): Verdict {
  return { ok: false, reason, title: REFUSAL_TITLE, message: MESSAGES[reason] };
}

export type ClassifyOptions = {
  /** A message in a project that already has a build: a change to it needs less to go on. */
  followUp?: boolean;
};

export function classifyRequest(
  prompt: string,
  { followUp = false }: ClassifyOptions = {},
): Verdict {
  const text = prompt.trim();
  if (words(text).length < 3) return refuse("too-short");

  const asksForAction = ACTION.test(text) || ARTEFACT.test(text);
  const domainHits = text.match(new RegExp(DOMAIN.source, "gi"))?.length ?? 0;

  // A question with nothing to do is a request for an answer, which the builder does not give.
  if ((QUESTION_START.test(text) || text.endsWith("?")) && !asksForAction)
    return refuse("question");

  // Inside a build, a change to it is enough: a verb, an artefact or something OCN knows about.
  if (followUp && (asksForAction || domainHits >= 1 || ARTEFACT.test(text))) return { ok: true };

  // Something to build, over something OCN knows about: or an artefact (a screen, an app) to start from.
  if (asksForAction && (domainHits >= 1 || ARTEFACT.test(text))) return { ok: true };
  if (domainHits >= 2) return { ok: true };
  return refuse("off-topic");
}
