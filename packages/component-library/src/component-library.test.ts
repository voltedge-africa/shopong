import { describe, expect, it, vi } from "vite-plus/test";

import {
  CAPABILITY_KINDS,
  LibraryDefinitionError,
  OCN_COMPONENT_LIBRARY,
  capabilityKindOf,
  createLibrary,
  type BoundComponentSpec,
  type LibraryDefinition,
} from "./index.js";

const part = (overrides: Partial<BoundComponentSpec> & { name: string }): BoundComponentSpec => ({
  description: "A part.",
  props: {},
  reads: [],
  actions: [],
  ...overrides,
});

const definition = (components: BoundComponentSpec[], root = "Stack"): LibraryDefinition => ({
  name: "Test",
  version: "1",
  root,
  components: [part({ name: "Stack", children: ["*"] }), ...components],
});

/** The problems `createLibrary` reports for a definition, or [] if it is valid. */
const problemsOf = (input: LibraryDefinition): string[] => {
  try {
    createLibrary(input);
    return [];
  } catch (error) {
    if (error instanceof LibraryDefinitionError) return [...error.problems];
    throw error;
  }
};

const ALL_COMPONENTS = [
  "Stack",
  "Metric",
  "PledgeProgress",
  "Table",
  "Form",
  "Timeline",
  "Map",
  "Chart",
  "ActionButton",
  "MemberList",
  "QuoteCompare",
];

describe("the approved OCN component library", () => {
  it("lists the architecture's components, rooted at Stack", () => {
    expect(OCN_COMPONENT_LIBRARY.root).toBe("Stack");
    expect(OCN_COMPONENT_LIBRARY.components.map((component) => component.name)).toEqual(
      ALL_COMPONENTS,
    );
  });

  it("declares, for every component, the capability reads and actions it may bind to", () => {
    for (const component of OCN_COMPONENT_LIBRARY.components) {
      expect(Array.isArray(component.reads), component.name).toBe(true);
      expect(Array.isArray(component.actions), component.name).toBe(true);
    }
    const byName = new Map(OCN_COMPONENT_LIBRARY.components.map((c) => [c.name, c]));
    expect(byName.get("Metric")?.reads).toEqual(["ledger.read"]);
    expect(byName.get("ActionButton")?.actions).toContain("payment.request");
    expect(byName.get("Form")?.actions).toEqual(["order.propose", "message.send"]);
    expect(byName.get("Stack")).toMatchObject({ reads: [], actions: [] });
  });

  it("binds reads only to read tools and actions only to write or money tools", () => {
    for (const component of OCN_COMPONENT_LIBRARY.components) {
      for (const tool of component.reads ?? []) expect(capabilityKindOf(tool), tool).toBe("read");
      for (const tool of component.actions ?? []) {
        expect(["write", "money"], tool).toContain(capabilityKindOf(tool));
      }
    }
  });

  it("gives its parts no children or props that the slots of OpenUI reserve", () => {
    for (const component of OCN_COMPONENT_LIBRARY.components) {
      expect(Object.keys(component.props)).not.toContain("children");
      expect(Object.keys(component.props)).not.toContain("action");
    }
  });
});

describe("capability catalogue", () => {
  it("knows the three tools the Node lists today, with the kinds it lists them with", () => {
    expect(capabilityKindOf("ledger.read")).toBe("read");
    expect(capabilityKindOf("order.propose")).toBe("write");
    expect(capabilityKindOf("payment.request")).toBe("money");
  });

  it("knows no tool it was not given, including inherited object names", () => {
    expect(capabilityKindOf("payment.approve")).toBeUndefined();
    expect(capabilityKindOf("constructor")).toBeUndefined();
    expect(Object.keys(CAPABILITY_KINDS)).toContain("members.list");
  });
});

describe("createLibrary", () => {
  it("returns the port's library shape, unchanged", () => {
    const library = createLibrary(
      definition([
        part({
          name: "Metric",
          props: { label: { type: "string", required: true } },
          reads: ["ledger.read"],
        }),
      ]),
    );
    expect(library).toEqual({
      name: "Test",
      version: "1",
      root: "Stack",
      components: [
        expect.objectContaining({ name: "Stack" }),
        expect.objectContaining({ name: "Metric", reads: ["ledger.read"], actions: [] }),
      ],
    });
  });

  it("refuses a read bound to a tool that writes or moves money", () => {
    const problems = problemsOf(
      definition([part({ name: "Metric", reads: ["order.propose", "payment.request"] })]),
    );
    expect(problems).toEqual([
      'Metric reads "order.propose", a write capability, not a read',
      'Metric reads "payment.request", a money capability, not a read',
    ]);
  });

  it("refuses an action bound to a read tool", () => {
    expect(
      problemsOf(definition([part({ name: "ActionButton", actions: ["ledger.read"] })])),
    ).toEqual(['ActionButton acts through "ledger.read", a read, not an action']);
  });

  it("refuses a tool the catalogue does not know, in reads or actions", () => {
    const problems = problemsOf(
      definition([
        part({ name: "Metric", reads: ["payment.approve"] }),
        part({ name: "ActionButton", actions: ["shell.run"] }),
      ]),
    );
    expect(problems).toEqual([
      'Metric reads "payment.approve", which is not a known capability',
      'ActionButton acts through "shell.run", which is not a known capability',
    ]);
  });

  it('refuses children that are not components, and "*" beside other children', () => {
    const problems = problemsOf({
      ...definition([part({ name: "List", children: ["Row"] })]),
      components: [
        part({ name: "Stack", children: ["*", "List"] }),
        part({ name: "List", children: ["Row"] }),
      ],
    });
    expect(problems).toEqual([
      'Stack lists "*" with other children',
      "List allows an unknown child Row",
    ]);
  });

  it("refuses bad component names, duplicate names and a root that is not a component", () => {
    const problems = problemsOf({
      name: "Test",
      version: "1",
      root: "Screen",
      components: [part({ name: "Stack" }), part({ name: "stack" }), part({ name: "Stack" })],
    });
    expect(problems).toContain(
      '"stack" is not a component name (letters and digits, starting with a capital)',
    );
    expect(problems).toContain("Stack is declared twice");
    expect(problems).toContain('the root "Screen" is not a component');
  });

  it("refuses prop names the OpenUI slots reserve, and enums on anything but a string", () => {
    const problems = problemsOf(
      definition([
        part({
          name: "Metric",
          props: {
            action: { type: "string" },
            Label: { type: "string" },
            size: { type: "number", enum: ["1"] },
            tone: { type: "string", enum: [] },
          },
        }),
      ]),
    );
    expect(problems).toEqual([
      "Metric.action is not a usable prop name",
      "Metric.Label is not a usable prop name",
      "Metric.size has an enum, which needs a non-empty string prop",
      "Metric.tone has an enum, which needs a non-empty string prop",
    ]);
  });

  it("reports every problem at once, not only the first", () => {
    expect(
      problemsOf(
        definition([
          part({ name: "A", reads: ["nope"], actions: ["ledger.read"] }),
          part({ name: "B", children: ["C"] }),
        ]),
      ),
    ).toHaveLength(3);
  });

  it("needs a name and a version", () => {
    expect(problemsOf({ ...definition([]), name: " ", version: "" })).toEqual([
      "the library needs a name",
      "the library needs a version",
    ]);
  });

  it("makes no network call when it runs", () => {
    const fetchSpy = vi.fn(() => Promise.reject(new Error("no network in tests")));
    vi.stubGlobal("fetch", fetchSpy);
    try {
      createLibrary(definition([part({ name: "Metric", reads: ["ledger.read"] })]));
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
