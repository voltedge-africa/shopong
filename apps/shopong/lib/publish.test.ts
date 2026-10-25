import { describe, expect, it } from "vite-plus/test";

import { designBuild, refineBuild } from "./builder";
import { artifactOf } from "./ci";
import {
  DESCRIPTION_MAX,
  NAME_MAX,
  appRecord,
  builtOn,
  defaultForm,
  detailRows,
  fitName,
  normalise,
  sentence,
  validatePublish,
} from "./publish";

const PROMPTS = [
  "I need a way to track who owes me and have a way of reminding them",
  "I run a spaza shop and keep running out of stock. I want to know what to reorder and who is cheapest",
  "My driver needs a list of stops for the day and a way to prove each delivery",
  "I need a dashboard of my daily sales",
];
const [pledges, reorder] = PROMPTS.map(designBuild) as [
  ReturnType<typeof designBuild>,
  ReturnType<typeof designBuild>,
];
const NOW = new Date(2026, 9, 25, 14, 30).getTime();

const record = (build = pledges, name?: string) => {
  const form = defaultForm(build);
  return appRecord({
    id: "build-c1",
    build,
    artifact: artifactOf(build),
    form: name === undefined ? form : { ...form, name },
    now: NOW,
  });
};

describe("what a build offers to start with", () => {
  it.each(PROMPTS)("has a name, a line about it, a picture and a category: %s", (prompt) => {
    const build = designBuild(prompt);
    expect(build.blurb.length).toBeGreaterThan(10);
    expect(build.permissions.length).toBeGreaterThan(0);
    const form = defaultForm(build);
    expect(form).toMatchObject({ name: fitName(build.title), description: build.blurb, notes: "" });
    expect(validatePublish(form, []).ok).toBe(true);
  });

  it("suits what each one is", () => {
    expect(defaultForm(pledges)).toMatchObject({ icon: "people-outline", category: "Money" });
    expect(defaultForm(reorder)).toMatchObject({ icon: "cart-outline", category: "Commerce" });
    expect(defaultForm(designBuild(PROMPTS[2]!))).toMatchObject({
      icon: "bicycle-outline",
      category: "Logistics",
    });
  });

  it("lists what it may do, and whether money waits for the person's OK", () => {
    expect(pledges.permissions).toEqual(["look at your records", "send messages for you"]);
    expect(pledges.needsApproval).toBe(false);
    expect(reorder.needsApproval).toBe(true);
    expect(reorder.permissions).toContain("prepare orders for you to approve");
  });

  it("starts an update from what was published, not from the build", () => {
    const published = record(pledges, "Who owes me");
    expect(defaultForm(pledges, published)).toMatchObject({ name: "Who owes me", notes: "" });
  });
});

describe("validatePublish", () => {
  const form = defaultForm(pledges);

  it("accepts a name, and an empty description", () => {
    expect(validatePublish({ ...form, description: "" }, ["Shop", "Wallet"])).toEqual({
      ok: true,
      errors: {},
    });
  });

  it.each([
    ["", "Give your app a name."],
    ["   ", "Give your app a name."],
    ["x".repeat(NAME_MAX + 1), `Keep the name to ${NAME_MAX} letters or fewer.`],
  ])("refuses the name %j in plain words", (name, message) => {
    const result = validatePublish({ ...form, name }, []);
    expect(result.ok).toBe(false);
    expect(result.errors.name).toBe(message);
  });

  it("accepts a name of exactly the longest length", () => {
    expect(validatePublish({ ...form, name: "x".repeat(NAME_MAX) }, []).ok).toBe(true);
  });

  it("refuses a name another app already has, however it is written", () => {
    for (const name of ["Wallet", "  wallet ", "WALLET"]) {
      const result = validatePublish({ ...form, name }, ["Shop", "Wallet"]);
      expect(result.ok).toBe(false);
      expect(result.errors.name).toMatch(/already an app called/);
    }
  });

  it("refuses a description that is too long", () => {
    const result = validatePublish({ ...form, description: "x".repeat(DESCRIPTION_MAX + 1) }, []);
    expect(result.ok).toBe(false);
    expect(result.errors.description).toContain(String(DESCRIPTION_MAX));
  });

  it("explains every refusal without technical words", () => {
    const messages = [
      validatePublish({ ...form, name: "" }, []).errors.name,
      validatePublish({ ...form, name: "x".repeat(99) }, []).errors.name,
      validatePublish({ ...form }, [form.name]).errors.name,
      validatePublish({ ...form, description: "x".repeat(999) }, []).errors.description,
    ].join("\n");
    expect(messages).not.toMatch(
      /\b(invalid|null|undefined|validation|string|characters?|input|field|error)\b/i,
    );
  });
});

describe("fitName", () => {
  it.each([
    ["Pledge tracker", "Pledge tracker"],
    ["  Pledge   tracker ", "Pledge tracker"],
    ["A dashboard of my daily sales", "A dashboard of my daily"],
    ["Supercalifragilisticexpialidocious name", "Supercalifragilisticexpi"],
    ["", ""],
  ])("fits %j as %j", (name, fitted) => {
    expect(fitName(name)).toBe(fitted);
    expect(fitted.length).toBeLessThanOrEqual(NAME_MAX);
  });

  it("gives every build a name that passes", () => {
    for (const prompt of PROMPTS)
      expect(validatePublish(defaultForm(designBuild(prompt)), []).ok).toBe(true);
  });
});

describe("normalise", () => {
  it("ignores case and spare spaces", () => {
    expect(normalise("  My   Wallet ")).toBe("my wallet");
  });
});

describe("screenshots", () => {
  it("start empty for a new app and carry over when updating one", () => {
    expect(defaultForm(pledges).screenshots).toEqual([]);
    const published = appRecord({
      id: "build-c1",
      build: pledges,
      artifact: artifactOf(pledges),
      form: { ...defaultForm(pledges), screenshots: ["a.jpg", "b.jpg"] },
      now: NOW,
    });
    expect(published.screenshots).toEqual(["a.jpg", "b.jpg"]);
    expect(defaultForm(pledges, published).screenshots).toEqual(["a.jpg", "b.jpg"]);
  });
});

describe("appRecord", () => {
  it("holds everything the platform needs to install the app", () => {
    const app = record();
    expect(app).toMatchObject({
      id: "build-c1",
      name: "Pledge tracker",
      version: "1.0",
      icon: "people-outline",
      category: "Money",
      runtime: { runsIn: "Shopong", minShopong: "1.0", offline: true },
      permissions: ["look at your records", "send messages for you"],
      needsApproval: false,
      size: "1.4 MB",
      file: "pledge-tracker-1.0.shopong",
      builtAt: NOW,
      publisher: "You",
    });
    expect(app.screens.map((screen) => screen.title)).toEqual(["Pledges", "Remind"]);
    expect(app.build).toBe(pledges);
  });

  it("uses the name the person chose, tidied", () => {
    expect(record(pledges, "   Who   owes  me ").name).toBe("Who owes me");
  });

  it("falls back to the build's own line when the description is left empty", () => {
    const form = { ...defaultForm(pledges), description: "   " };
    const app = appRecord({
      id: "x",
      build: pledges,
      artifact: artifactOf(pledges),
      form,
      now: NOW,
    });
    expect(app.description).toBe(pledges.blurb);
  });

  it("takes its version from the file, so a change makes a new version", () => {
    const changed = refineBuild(pledges, "also text them on Fridays").build;
    const app = appRecord({
      id: "x",
      build: changed,
      artifact: artifactOf(changed),
      form: { ...defaultForm(changed), notes: " Texts on Fridays " },
      now: NOW,
    });
    expect(app.version).toBe("1.1");
    expect(app.file).toBe("pledge-tracker-1.1.shopong");
    expect(app.notes).toBe("Texts on Fridays");
  });
});

describe("detailRows", () => {
  it("lists the details in plain words", () => {
    const rows = detailRows(record());
    expect(rows.map((row) => row.label)).toEqual([
      "Version",
      "Runs inside",
      "Needs",
      "Works without internet",
      "Screens",
      "Size",
      "File",
      "Built",
      "Made by",
      "Money",
    ]);
    const value = (label: string) => rows.find((row) => row.label === label)?.value;
    expect(value("Version")).toBe("1.0");
    expect(value("Runs inside")).toBe("Shopong on your phone");
    expect(value("Needs")).toBe("Shopong 1.0 or later");
    expect(value("Works without internet")).toBe("Yes");
    expect(value("Screens")).toBe("2");
    expect(value("Built")).toBe("25 Oct 2026, 14:30");
    expect(value("Money")).toBe("Never moves money");
    expect(detailRows(record(reorder)).find((row) => row.label === "Money")?.value).toBe(
      "Asks for your OK first",
    );
  });

  it("uses no technical words", () => {
    const text = PROMPTS.flatMap((prompt) =>
      detailRows(record(designBuild(prompt))).flatMap((row) => [row.label, row.value]),
    ).join("\n");
    expect(text).not.toMatch(
      /\b(runtime|manifest|engine|sdk|api|json|bundle|binary|apk|metadata)\b/i,
    );
  });
});

describe("builtOn and sentence", () => {
  it("writes a date and time the way people say it", () => {
    expect(builtOn(new Date(2026, 0, 5, 9, 7).getTime())).toBe("5 Jan 2026, 09:07");
    expect(builtOn(new Date(2026, 11, 31, 23, 59).getTime())).toBe("31 Dec 2026, 23:59");
  });

  it("capitalises the first letter only", () => {
    expect(sentence("look at your records")).toBe("Look at your records");
    expect(sentence("")).toBe("");
  });
});
