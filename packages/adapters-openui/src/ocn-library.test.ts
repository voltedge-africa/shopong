import { describe, expect, it, vi } from "vite-plus/test";
import { OCN_COMPONENT_LIBRARY } from "@shopong/component-library";

import { generateSpec, generateSystemPrompt, inspectScreen, OpenUiGenUi } from "./index.js";

const names = OCN_COMPONENT_LIBRARY.components.map((component) => component.name);

const codes = (source: string) => {
  const result = inspectScreen(OCN_COMPONENT_LIBRARY, source);
  return result.ok ? [] : result.error.issues.map((issue) => issue.code);
};

describe("OCN component library in OpenUI (story 11.4)", () => {
  it("builds the spec locally, with every approved part and nothing else", () => {
    const spec = generateSpec(OCN_COMPONENT_LIBRARY);
    const json = JSON.stringify(spec);
    for (const name of names) expect(json, name).toContain(`"${name}"`);
    expect(json).not.toContain('"Script"');
  });

  it("builds the system prompt locally, naming every part and the actions a button may use", async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("no network in tests")));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      const prompt = await generateSystemPrompt(OCN_COMPONENT_LIBRARY);
      for (const name of names) expect(prompt, name).toContain(name);
      expect(prompt).toContain("root = Stack(");
      expect(prompt).toContain("@PaymentRequest");
      expect(prompt).toContain("@OrderPropose");
      expect(
        await new OpenUiGenUi([OCN_COMPONENT_LIBRARY]).systemPrompt(OCN_COMPONENT_LIBRARY),
      ).toBe(prompt);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("accepts a screen built from approved parts", () => {
    const result = inspectScreen(
      OCN_COMPONENT_LIBRARY,
      `root = Stack([total, members, send])
total = Metric("Pooled so far", {currency: "ZAR", minor: 450000})
members = MemberList(["m1", "m2"], "owing")
send = ActionButton("Remind", "primary", @MessageSend())`,
    );
    expect(result.ok).toBe(true);
  });

  it("refuses a part that is not in the approved library", () => {
    expect(codes(`root = Stack([s])\ns = Script("https://example.invalid")`)).toContain(
      "unknown_component",
    );
  });

  it("refuses a form that triggers an action only another part may", () => {
    expect(
      inspectScreen(
        OCN_COMPONENT_LIBRARY,
        `root = Stack([f])\nf = Form("Pay out", ["Amount"], @DeliveryConfirm())`,
      ).ok,
    ).toBe(false);
    expect(codes(`root = Stack([f])\nf = Form("Pay out", ["Amount"], @OrderPropose())`)).toEqual(
      [],
    );
  });
});
