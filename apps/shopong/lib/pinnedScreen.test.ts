import { describe, expect, it } from "vite-plus/test";

import { designBuild } from "./builder";
import { loadPinnedScreen, pinScreen, type PinnedScreen } from "./pinnedScreen";
import { sha512Hex } from "./sha512";

const SOURCE = `root = Screen("Hello", [stack])\nstack = Stack([hi])\nhi = Text("Hi there")\n`;

describe("pinScreen", () => {
  it("makes plain data: text, the library it was written for and its SHA-512", () => {
    const screen = pinScreen({ id: "hello", title: "Hello", source: SOURCE });
    expect(screen).toEqual({
      id: "hello",
      title: "Hello",
      language: "openui-lang",
      library: { name: "Shopong", version: "2" },
      source: SOURCE,
      hash: sha512Hex(SOURCE),
    });
    expect(screen.hash).toMatch(/^[0-9a-f]{128}$/);
    // Stored or replicated as JSON and read back, nothing is lost.
    expect(JSON.parse(JSON.stringify(screen))).toEqual(screen);
  });
});

describe("loadPinnedScreen", () => {
  const good = pinScreen({ id: "hello", title: "Hello", source: SOURCE });

  it("loads a screen that is what was pinned", async () => {
    const result = await loadPinnedScreen(good);
    expect(result.ok && result.value.root.component).toBe("Screen");
  });

  it("is the same every time: pinned text in, the same screen out", async () => {
    expect(await loadPinnedScreen(good)).toEqual(await loadPinnedScreen(good));
  });

  it("refuses text that was changed after it was pinned", async () => {
    const result = await loadPinnedScreen({ ...good, source: SOURCE.replace("Hi there", "Hello") });
    expect(!result.ok && result.error.problem).toBe("hash");
  });

  it("refuses text written for another version of the library, or in another language", async () => {
    const other = await loadPinnedScreen({ ...good, library: { name: "Shopong", version: "1" } });
    expect(!other.ok && other.error.problem).toBe("library");
    const json = await loadPinnedScreen({ ...good, language: "json" } as unknown as PinnedScreen);
    expect(!json.ok && json.error.problem).toBe("language");
  });

  it.each([
    ["a part the library does not have", `root = Screen("x", [Iframe("https://example.com")])`],
    ["a value of the wrong kind", `root = Screen("x", [Progress("Done", "high")])`],
    ["a value that is missing", `root = Screen("x", [Metric("Paid")])`],
    ["an action it may not take", `root = Screen("x", [Button("Go", "primary", @WalletDrain())])`],
    [
      "a link to open",
      `root = Screen("x", [Button("Go", "primary", @OpenUrl("https://example.com"))])`,
    ],
    [
      "a part where it does not belong",
      `root = Screen("x", [ListItem("a")])\nlist = List([Text("b")])`,
    ],
    ["a screen that does not start with Screen", `root = Stack([])`],
  ])("refuses text the library does not allow, even when it was pinned: %s", async (_, source) => {
    const result = await loadPinnedScreen(pinScreen({ id: "bad", title: "Bad", source }));
    expect(!result.ok && result.error.problem).toBe("invalid");
  });
});

// Each screen the builder writes today, pinned. Editing any of them changes its hash, so it shows up
// here on purpose: update the hash with the text, and the screen is pinned again.
const PINNED: Record<string, string> = {
  pledges:
    "9c8d273bbe67ab9fd9fd85a742d81dabe8b3d065d6d8cab5091eca759a0d4632f1df38f25bb3bebf6e62ab307dbc514e981057da45c0b6cd593c537242e69c0b",
  remind:
    "05a924869f4fd7105de64c9ab1c5ec859974ac9662d02971cd33ef58bff8502a5df11dfe2418988009b0c0ff71dd1b1be477bb9f470b32b913632750cfa79956",
  list: "7e5b4c99919504974cbf4e02e7e2eb68c1d525720d4304292f7cf6c88da0a72e8cbc1898c3666e7c0407ad2718d38d86e7210a3a27c9b9871363fdb28be2da4c",
  order:
    "6ab74fd47be8994ed853f69ea848f91daa6a5dcec7dab432fbb90f3d369e01d2285ddfafcf56872427bc5d3341841413a326e01ce7232fb0f4c1590d926e7eae",
  stops:
    "ad07e0ed3ec6d7b7f948217c2c36b6e1db26898e9a7fbf15cdcb3b486e96bcdc64a4b85615acac6a15a3254763941b4199d887ddcee378bb36c736bcd983268f",
  confirm:
    "6c6ee4710c795ccbbb8b520ac4a4e2760aa3bf9a2af036a4690d184095f4aaddaf8669e6ef734dabc3a20ee9728f238f35fe1e13a4369e9d8b8f17f2d5e8e11b",
};

describe("the screens the builder writes", () => {
  const prompts = [
    "I need a way to track who owes me and have a way of reminding them",
    "I run a spaza shop and keep running out of stock. I want to know what to reorder and who is cheapest",
    "My driver needs a list of stops for the day and a way to prove each delivery",
  ];

  it.each(prompts)("pins every screen, and every one loads: %s", async (prompt) => {
    for (const screen of designBuild(prompt).screens) {
      expect(screen.language).toBe("openui-lang");
      expect(screen.source.startsWith("root = Screen(")).toBe(true);
      const result = await loadPinnedScreen(screen);
      expect(result.ok, `${screen.title}: ${result.ok ? "" : result.error.message}`).toBe(true);
    }
  });

  it("pins the fixed screens to these hashes", () => {
    const hashes = Object.fromEntries(
      prompts.flatMap((prompt) => designBuild(prompt).screens.map((s) => [s.id, s.hash])),
    );
    expect(hashes).toEqual(PINNED);
  });

  it("shows the same text to the Screens tab, the preview and the published app", () => {
    // They all read `build.screens`, so one build gives one text.
    const first = designBuild(prompts[0]!).screens;
    const second = designBuild(prompts[0]!).screens;
    expect(second.map((screen) => screen.source)).toEqual(first.map((screen) => screen.source));
    expect(second.map((screen) => screen.hash)).toEqual(first.map((screen) => screen.hash));
  });

  it("writes a custom screen's title safely, even with quotes in it", async () => {
    const build = designBuild('Build a "special" dashboard');
    const result = await loadPinnedScreen(build.screens[0]!);
    expect(result.ok && result.value.root.props["title"]).toBe('Build a "special" dashboard');
  });
});
