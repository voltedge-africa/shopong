import { designBuild, refineBuild, titleFor, type Build } from "./builder";

export type Turn = { id: string; role: "user" | "assistant"; text: string };

export type Conversation = {
  id: string;
  title: string;
  /** When it last changed, in milliseconds since the epoch. */
  updatedAt: number;
  turns: readonly Turn[];
  /** Set once the assistant has answered the first message. */
  build?: Build;
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Demo conversations dated relative to `now`, so the recents list is not empty. */
export function seedConversations(now: number): Conversation[] {
  const seeded = (id: string, prompt: string, ago: number): Conversation => {
    const build = designBuild(prompt);
    return {
      id,
      title: build.title,
      updatedAt: now - ago,
      turns: [
        { id: `${id}-u1`, role: "user", text: prompt },
        { id: `${id}-a1`, role: "assistant", text: build.reply },
      ],
      build,
    };
  };
  return [
    seeded("c1", "I need a way to track who owes me and have a way of reminding them", 3 * HOUR),
    seeded(
      "c2",
      "I run a spaza shop and keep running out of stock. I want to know what to reorder and who is cheapest",
      DAY + HOUR,
    ),
    seeded(
      "c3",
      "My driver needs a list of stops for the day and a way to prove each delivery",
      4 * DAY,
    ),
  ];
}

/** Newest first. */
export const byRecent = (list: readonly Conversation[]): Conversation[] =>
  [...list].sort((a, b) => b.updatedAt - a.updatedAt);

/** Conversations whose title contains `query`, ignoring case and surrounding spaces. */
export function filterConversations(list: readonly Conversation[], query: string): Conversation[] {
  const needle = query.trim().toLowerCase();
  return needle === ""
    ? [...list]
    : list.filter((item) => item.title.toLowerCase().includes(needle));
}

/** A new conversation holding the first message. The assistant has not answered yet. */
export function startConversation(id: string, prompt: string, now: number): Conversation {
  return {
    id,
    title: titleFor(prompt),
    updatedAt: now,
    turns: [{ id: `${id}-u1`, role: "user", text: prompt.trim() }],
  };
}

/** Adds the user's message. Blank text changes nothing. */
export function addUserTurn(conversation: Conversation, text: string, now: number): Conversation {
  const trimmed = text.trim();
  if (trimmed === "") return conversation;
  return {
    ...conversation,
    updatedAt: now,
    turns: [
      ...conversation.turns,
      { id: `${conversation.id}-u${conversation.turns.length + 1}`, role: "user", text: trimmed },
    ],
  };
}

/**
 * The assistant answers the last user message. The first answer designs the build; later ones
 * refine it.
 */
export function answer(conversation: Conversation, now: number): Conversation {
  const last = [...conversation.turns].reverse().find((turn) => turn.role === "user");
  if (!last) return conversation;
  const first = conversation.build === undefined;
  const result = first
    ? (() => {
        const build = designBuild(last.text);
        return { build, reply: build.reply };
      })()
    : refineBuild(conversation.build!, last.text);
  return {
    ...conversation,
    // Once the builder has answered, the project is named for what it is.
    title: first ? result.build.title : conversation.title,
    updatedAt: now,
    build: result.build,
    turns: [
      ...conversation.turns,
      {
        id: `${conversation.id}-a${conversation.turns.length + 1}`,
        role: "assistant",
        text: result.reply,
      },
    ],
  };
}

/** True while the last turn is the user's: the assistant owes an answer. */
export const awaitingAnswer = (conversation: Conversation): boolean =>
  conversation.turns.at(-1)?.role === "user";
