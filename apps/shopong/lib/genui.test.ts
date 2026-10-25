import { describe, expect, it } from "vite-plus/test";
import { signaturesOf } from "@shopong/adapters-openui";

import { DEFINITIONS, LIBRARY, SCREEN_LANGUAGE, validateScreen } from "./genui";

const screen = (body: string) => `root = Screen("x", [stack])\nstack = Stack([${body}])`;

describe("the screen library", () => {
  it("starts every screen with a Screen and has unique parts", () => {
    expect(LIBRARY.root).toBe("Screen");
    const names = LIBRARY.components.map((component) => component.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("Screen");
  });

  it("lets only buttons do anything", () => {
    for (const component of LIBRARY.components)
      expect(component.actions === undefined || component.name === "Button").toBe(true);
  });

  it("is written in OpenUI Lang", () => {
    expect(SCREEN_LANGUAGE).toBe("openui-lang");
  });

  // Pinned screens are written against these signatures. If this fails you changed what a part
  // takes: bump LIBRARY.version, because every pinned screen written for the old one means something else.
  it("has the signatures that version 2 of the library promises", () => {
    expect(LIBRARY.version).toBe("2");
    expect(signaturesOf(LIBRARY)).toEqual([
      "Screen(title, children)",
      "Stack(children)",
      "Heading(text)",
      "Text(text, muted?)",
      "Metric(label, value)",
      "Progress(label, value)",
      "Pair(label, value)",
      "List(children)",
      "ListItem(title, detail?, tag?, tone?)",
      "Field(placeholder, label?)",
      "Photo(label)",
      "Button(label, kind?, action?)",
    ]);
  });

  it("names the five actions a button may use, and nothing else", () => {
    expect([...DEFINITIONS.toolOfAction]).toEqual([
      ["MessageSend", "message.send"],
      ["OrderPropose", "order.propose"],
      ["RoutePlan", "route.plan"],
      ["DeliveryConfirm", "delivery.confirm"],
      ["LedgerRead", "ledger.read"],
    ]);
  });
});

describe("validateScreen", () => {
  it("accepts a screen made of the library's parts", async () => {
    const result = await validateScreen(
      `root = Screen("Pledges", [stack])
stack = Stack([paid, bar, rows, remind])
paid = Metric("Paid so far", "R 3 360")
bar = Progress("Toward the target", 60)
rows = List([ListItem("Nomsa", "R 840", "Paid", "good")])
remind = Button("Remind", "primary", @MessageSend())`,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.root.component).toBe("Screen");
      expect(result.value.library).toEqual({ name: "Shopong", version: "2" });
    }
  });

  it("drops a screen that uses a part the library does not have", async () => {
    const result = await validateScreen(screen(`Iframe("https://example.com")`));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.issues[0]?.code).toBe("unknown_component");
  });

  it("drops a button that tries to do something it may not", async () => {
    for (const action of ["@WalletDrain()", `@OpenUrl("https://example.com")`, "@Run(data)"]) {
      const result = await validateScreen(screen(`Button("Go", "primary", ${action})`));
      expect(result.ok, action).toBe(false);
    }
    const result = await validateScreen(screen(`Button("Go", "primary", @WalletDrain())`));
    if (!result.ok) expect(result.error.issues[0]?.code).toBe("forbidden_action");
  });

  it("drops a part with a wrong or missing property, and anything that is not a screen", async () => {
    expect((await validateScreen(screen(`Progress("a", "high")`))).ok).toBe(false);
    expect((await validateScreen(screen(`Progress("a")`))).ok).toBe(false);
    expect((await validateScreen(screen(`Button("Go", "huge")`))).ok).toBe(false);
    expect((await validateScreen(`root = Heading("x")`)).ok).toBe(false);
    expect((await validateScreen("not a screen")).ok).toBe(false);
    expect((await validateScreen("")).ok).toBe(false);
  });

  it("does not take the old JSON screens", async () => {
    const json = JSON.stringify({ component: "Screen", props: { title: "x" } });
    expect((await validateScreen(json)).ok).toBe(false);
  });
});
