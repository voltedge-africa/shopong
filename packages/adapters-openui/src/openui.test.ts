import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { createParser } from "@openuidev/lang-core";
import type { ComponentLibrary, GenUiErrorCode, JsonValue } from "@shopong/ports";

import {
  OpenUiGenUi,
  actionNameOf,
  inspectScreen,
  openUiLibraryOf,
  signaturesOf,
} from "./index.js";

const library: ComponentLibrary = {
  name: "Test",
  version: "1",
  root: "Screen",
  components: [
    {
      name: "Screen",
      description: "One screen.",
      props: { title: { type: "string", required: true } },
      children: ["*"],
    },
    {
      name: "List",
      description: "Rows.",
      props: {},
      children: ["Row"],
    },
    {
      name: "Row",
      description: "One row.",
      props: {
        title: { type: "string", required: true },
        tag: { type: "string" },
        tone: { type: "string", enum: ["good", "bad"] },
      },
    },
    {
      name: "Button",
      description: "A button.",
      props: { label: { type: "string", required: true } },
      actions: ["message.send", "order.propose"],
    },
  ],
};

const codes = (source: string): GenUiErrorCode[] => {
  const result = inspectScreen(library, source);
  return result.ok ? [] : result.error.issues.map((issue) => issue.code);
};

describe("OpenUI adapter", () => {
  it("reads a screen written as OpenUI Lang", () => {
    const result = inspectScreen(
      library,
      `root = Screen("Pledges", [list, send])
list = List([Row("Nomsa", "Paid", "good"), Row("Thabo")])
send = Button("Remind", @MessageSend({to: ["m1"], note: "hi"}))`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.root.children.map((node) => node.component)).toEqual(["List", "Button"]);
    expect(result.value.root.children[0]?.children[1]?.props).toEqual({ title: "Thabo" });
    expect(result.value.root.children[1]?.action).toEqual({
      tool: "message.send",
      input: { to: ["m1"], note: "hi" },
    });
  });

  it("gives an action with nothing in it a null input", () => {
    const result = inspectScreen(library, `root = Screen("x", [Button("Go", @OrderPropose())])`);
    expect(result.ok && result.value.root.children[0]?.action).toEqual({
      tool: "order.propose",
      input: null,
    });
  });

  it("writes strings with quotes, line breaks and accents so they read back the same", async () => {
    const genUi = new OpenUiGenUi([library]);
    const title = 'He said "hi"\nCafé 😀 \\ // # = (';
    const document = { library: { name: "Test", version: "1" }, root: node("Screen", { title }) };
    const source = await genUi.print(document);
    const back = await genUi.validate(library, source);
    expect(back.ok && back.value.root.props["title"]).toBe(title);
  });

  it("refuses source that is not a screen, or stops half way", () => {
    expect(codes("")).toEqual(["parse_error"]);
    expect(codes("hello there")).toEqual(["parse_error"]);
    expect(codes(`root = Screen("x", [`)).toContain("parse_error");
  });

  it("refuses a part that is never used, or used and never written", () => {
    expect(codes(`root = Screen("x", [])\nlonely = Row("a")`)).toEqual(["parse_error"]);
    expect(codes(`root = Screen("x", [missing])`)).toEqual(["parse_error"]);
  });

  it("refuses values that have to be worked out, state and data fetching", () => {
    expect(codes(`root = Screen("a" + "b", [])`)).toEqual(["invalid_props"]);
    expect(codes(`$count = 1\nroot = Screen("x", [])`)).toContain("forbidden_action");
    expect(codes(`data = Query("members", {})\nroot = Screen("x", [])`)).toContain(
      "forbidden_action",
    );
    expect(codes(`root = Screen("x", [Button("Go", @MessageSend($input))])`)).toContain(
      "invalid_props",
    );
  });

  it("refuses actions that are not the library's, and OpenUI's own steps", () => {
    expect(codes(`root = Screen("x", [Button("Go", @PaymentApprove())])`)).toContain(
      "forbidden_action",
    );
    expect(codes(`root = Screen("x", [Button("Go", @OpenUrl("https://example.com"))])`)).toContain(
      "forbidden_action",
    );
    expect(codes(`root = Screen("x", [Button("Go", "message.send")])`)).toContain(
      "forbidden_action",
    );
    // An action where the part has no slot for one is also refused.
    expect(codes(`root = Screen("x", [List([Row("a", null, null, @MessageSend())])])`)).toContain(
      "forbidden_action",
    );
  });

  it("refuses parts in the wrong place, wrong values and unknown parts", () => {
    expect(codes(`root = Screen("x", [List([Button("Go")])])`)).toContain("invalid_children");
    expect(codes(`root = Screen("x", [Button("Go", null, [Row("a")])])`)).toContain(
      "invalid_children",
    );
    expect(codes(`root = Screen("x", [Row("a", null, "weird")])`)).toEqual(["invalid_props"]);
    expect(codes(`root = Screen("x", [Row(5)])`)).toEqual(["invalid_props"]);
    expect(codes(`root = Screen("x", [Iframe("https://example.com")])`)).toEqual([
      "unknown_component",
    ]);
    expect(codes(`root = Row("a")`)).toEqual(["invalid_root"]);
  });

  it("prints a document that reads back unchanged", async () => {
    const genUi = new OpenUiGenUi([library]);
    const document = {
      library: { name: "Test", version: "1" },
      root: node("Screen", { title: "Hi" }, [
        node("List", {}, [node("Row", { title: "A", tone: "bad" })]),
        { ...node("Button", { label: "Go" }), action: { tool: "message.send", input: { n: -1 } } },
      ]),
    };
    const source = await genUi.print(document);
    expect(source.split("\n")[0]).toBe('root = Screen("Hi", [list1, button1])');
    expect(await genUi.validate(library, source)).toEqual({ ok: true, value: document });
  });

  it("names actions after their tools, and keeps OpenUI's own words for itself", () => {
    expect(actionNameOf("message.send")).toBe("MessageSend");
    expect(actionNameOf("delivery.confirm")).toBe("DeliveryConfirm");
    expect(() => actionNameOf("open.url")).toThrow(); // OpenUrl is a step of OpenUI's own
    expect(() => actionNameOf("run")).toThrow();
    expect(() => actionNameOf("1.x")).toThrow();
  });

  it("lists the signature of every part", () => {
    expect(signaturesOf(library)).toEqual([
      "Screen(title, children)",
      "List(children)",
      "Row(title, tag?, tone?)",
      "Button(label, action?)",
    ]);
  });

  it("builds the system prompt without a gateway and names the actions a button may use", async () => {
    const prompt = await new OpenUiGenUi([library]).systemPrompt(library);
    for (const component of library.components) expect(prompt).toContain(component.name);
    expect(prompt).toContain("@MessageSend");
    expect(prompt).toContain("@OrderPropose");
  });
});

describe("OpenUI never phones home from here", () => {
  const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } })
    .process.env;

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    delete env["OPENUI_RUNTIME_TELEMETRY_ENABLED"];
  });

  const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

  it("is switched off the moment the adapter is loaded", () => {
    expect(env["OPENUI_TELEMETRY_DISABLED"]).toBe("1");
  });

  it("makes no network call even if OpenUI's own opt-in is switched on", async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("no network in tests")));
    vi.stubGlobal("fetch", fetchSpy);
    env["OPENUI_RUNTIME_TELEMETRY_ENABLED"] = "1";
    vi.spyOn(Math, "random").mockReturnValue(0); // OpenUI samples one run in ten: make every run count
    const genUi = new OpenUiGenUi([library]);
    expect(inspectScreen(library, `root = Screen("x", [])`).ok).toBe(true);
    await genUi.systemPrompt(library);
    await settle();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("makes none even with the flag removed: the patch to OpenUI's core closes the one place it sends", async () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("no network in tests")));
    vi.stubGlobal("fetch", fetchSpy);
    env["OPENUI_RUNTIME_TELEMETRY_ENABLED"] = "1";
    const disabled = env["OPENUI_TELEMETRY_DISABLED"];
    delete env["OPENUI_TELEMETRY_DISABLED"];
    vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      // OpenUI's own batch parser and prompt builder, which the adapter does not use for checking.
      const openui = openUiLibraryOf(library);
      createParser(openui.toJSONSchema(), "Screen").parse(`root = Screen("x", [])`);
      openui.prompt();
      await settle();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      env["OPENUI_TELEMETRY_DISABLED"] = disabled;
    }
  });
});

type TestNode = {
  component: string;
  props: Record<string, string>;
  children: TestNode[];
  action?: { tool: string; input: JsonValue };
};

function node(
  component: string,
  props: Record<string, string>,
  children: TestNode[] = [],
): TestNode {
  return { component, props, children };
}
