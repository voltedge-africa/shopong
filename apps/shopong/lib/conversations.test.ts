import { describe, expect, it } from "vite-plus/test";

import {
  addUserTurn,
  answer,
  awaitingAnswer,
  byRecent,
  filterConversations,
  seedConversations,
  startConversation,
} from "./conversations";
import { createConversationStore } from "./conversationStore";

const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);

describe("seedConversations", () => {
  it("names each demo project for what it is", () => {
    expect(seedConversations(NOW).map((item) => item.title)).toEqual([
      "Pledge tracker",
      "Reorder list",
      "Run sheet",
    ]);
  });

  it("has unique ids, a finished build each and recents newest first", () => {
    const list = seedConversations(NOW);
    expect(new Set(list.map((item) => item.id)).size).toBe(list.length);
    expect(list.every((item) => item.build !== undefined && !awaitingAnswer(item))).toBe(true);
    expect(byRecent(list).map((item) => item.id)).toEqual(list.map((item) => item.id));
  });
});

describe("filterConversations", () => {
  const list = seedConversations(NOW);

  it("matches the title ignoring case and spaces", () => {
    expect(filterConversations(list, "  RUN sheet ").map((item) => item.id)).toEqual(["c3"]);
  });

  it("returns everything for a blank query and nothing for no match", () => {
    expect(filterConversations(list, " ")).toHaveLength(list.length);
    expect(filterConversations(list, "zzz")).toEqual([]);
  });
});

describe("a conversation", () => {
  it("starts with the user's message and waits for an answer", () => {
    const started = startConversation("n1", "  Who owes me?  ", NOW);
    expect(started.title).toBe("Who owes me");
    expect(started.turns).toEqual([{ id: "n1-u1", role: "user", text: "Who owes me?" }]);
    expect(awaitingAnswer(started)).toBe(true);
  });

  it("is answered with a build the first time and a refinement after that", () => {
    const first = answer(
      startConversation("n1", "I need a way to track who owes me and remind them", NOW),
      NOW + 1,
    );
    expect(first.turns.map((turn) => turn.role)).toEqual(["user", "assistant"]);
    expect(first.build?.title).toBe("Pledge tracker");
    expect(awaitingAnswer(first)).toBe(false);

    const second = answer(addUserTurn(first, "also text them on Fridays", NOW + 2), NOW + 3);
    expect(second.turns).toHaveLength(4);
    expect(second.build?.changes).toHaveLength(1);
    expect(first.build?.changes).toEqual([]);
    expect(second.updatedAt).toBe(NOW + 3);
  });

  it("names the project for what it is once the builder has answered, and keeps the name", () => {
    const started = startConversation("n1", "I need a way to track who owes me", NOW);
    expect(started.title).toBe("Track who owes me");
    const first = answer(started, NOW + 1);
    expect(first.title).toBe("Pledge tracker");
    const second = answer(addUserTurn(first, "also text them on Fridays", NOW + 2), NOW + 3);
    expect(second.title).toBe("Pledge tracker");
  });

  it("ignores a blank follow-up and does not change what it was given", () => {
    const started = startConversation("n1", "Who owes me?", NOW);
    expect(addUserTurn(started, "   ", NOW + 1)).toBe(started);
    answer(started, NOW + 1);
    expect(started.turns).toHaveLength(1);
  });

  it("makes unique turn ids", () => {
    const done = answer(
      addUserTurn(answer(startConversation("n1", "Who owes me?", NOW), NOW), "more", NOW),
      NOW,
    );
    expect(new Set(done.turns.map((turn) => turn.id)).size).toBe(done.turns.length);
  });
});

describe("conversation store", () => {
  it("adds, replaces and tells subscribers", () => {
    const store = createConversationStore([]);
    let calls = 0;
    const stop = store.subscribe(() => calls++);

    const started = startConversation("n1", "Who owes me?", NOW);
    store.put(started);
    store.put(answer(started, NOW + 1));
    expect(store.get()).toHaveLength(1);
    expect(store.get()[0]?.turns).toHaveLength(2);
    expect(calls).toBe(2);

    stop();
    store.put(started);
    expect(calls).toBe(2);
  });
});
