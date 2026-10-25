import { describe, expect, it } from "vite-plus/test";

import { REFUSAL_TITLE, classifyRequest } from "./classify";

describe("classifyRequest accepts something to build", () => {
  it.each([
    "I need a way to track who owes me and have a way of reminding them",
    "I run a spaza shop and keep running out of stock. I want to know what to reorder and who is cheapest",
    "My driver needs a list of stops for the day and a way to prove each delivery",
    "How can I keep track of which members have not paid?",
    "Show me who still owes this month and let me remind them",
    "Tell me when my shelf stock is low and reorder from the cheapest supplier",
    "A run sheet for my driver with proof of delivery",
    "Plan a delivery route for my driver",
    "Remind members who owe their pledge",
    "Build me a dashboard of daily sales",
    "Make an app to track stokvel contributions",
    "Create a screen that compares supplier quotes",
    "Automate payouts for the stokvel every month",
  ])("accepts: %s", (prompt) => {
    expect(classifyRequest(prompt)).toEqual({ ok: true });
  });
});

describe("classifyRequest in a project that has a build", () => {
  it.each([
    "also text them on Fridays",
    "Add a column for the date paid",
    "Only show members who owe more than R500",
    "Change the reminder message",
  ])("accepts the follow-up: %s", (prompt) => {
    expect(classifyRequest(prompt, { followUp: true })).toEqual({ ok: true });
  });

  it.each([
    ["Tell me a joke about taxis", "off-topic"],
    ["What is the weather in Durban today?", "question"],
    ["ok thanks", "too-short"],
    ["Write a poem about the sea", "off-topic"],
  ])("still refuses %j as %s", (prompt, reason) => {
    const verdict = classifyRequest(prompt, { followUp: true });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toBe(reason);
  });

  it("needs more as a first message than as a follow-up", () => {
    expect(classifyRequest("also text them on Fridays").ok).toBe(false);
    expect(classifyRequest("also text them on Fridays", { followUp: true }).ok).toBe(true);
  });
});

describe("classifyRequest refuses what cannot be built", () => {
  it.each([
    ["hi", "too-short"],
    ["hello there", "too-short"],
    ["   ", "too-short"],
    ["ok thanks", "too-short"],
    ["What is the weather in Durban today?", "question"],
    ["Who is the president of South Africa", "question"],
    ["How do I cook pap?", "question"],
    ["What is a stokvel?", "question"],
    ["Is it going to rain tomorrow", "question"],
    ["Tell me a joke about taxis", "off-topic"],
    ["Write a poem about the sea", "off-topic"],
    ["Show me a picture of a cat", "off-topic"],
    ["Translate this sentence into Zulu", "off-topic"],
    ["Something else entirely", "off-topic"],
    ["I need a holiday", "off-topic"],
    ["I want to know who won the soccer", "off-topic"],
    ["I need a way to cook pap", "off-topic"],
  ])("refuses %j as %s", (prompt, reason) => {
    const verdict = classifyRequest(prompt);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toBe(reason);
      expect(verdict.title).toBe(REFUSAL_TITLE);
      expect(verdict.message.length).toBeGreaterThan(20);
    }
  });

  it("gives a way forward in every refusal", () => {
    for (const prompt of ["hi", "What is the weather?", "Tell me a joke about taxis"]) {
      const verdict = classifyRequest(prompt);
      expect(verdict.ok ? "" : verdict.message).toMatch(/tell me what/i);
    }
  });

  it("explains a refusal without technical words", () => {
    for (const prompt of ["hi", "What is the weather?", "Tell me a joke about taxis"]) {
      const verdict = classifyRequest(prompt);
      expect(verdict.ok ? "" : verdict.message).not.toMatch(
        /\b(OCN|capabilit\w*|workflow|automation|API|data)\b/i,
      );
    }
  });

  it("does not mistake a question about OCN data for a request to build", () => {
    expect(classifyRequest("Who owes me money this month?").ok).toBe(false);
  });

  it("still builds when a request is phrased as a question", () => {
    expect(classifyRequest("Can you build a screen that shows who owes this month?").ok).toBe(true);
  });
});
