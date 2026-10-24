import { expect } from "vite-plus/test";
import type { ComponentLibrary, GenUi, GenUiErrorCode, UiDocument, UiNode } from "@shopong/ports";
import {
  expectErr,
  expectOk,
  registerContract,
  type ContractCase,
  type ContractOptions,
  type Factory,
} from "./support.js";

/** A small slice of the OCN component library (architecture 4.5). */
export const contractLibrary: ComponentLibrary = {
  name: "ocn-contract",
  version: "1.0.0",
  root: "Stack",
  components: [
    {
      name: "Stack",
      description: "Vertical layout.",
      props: { gap: { type: "number" } },
      children: ["Metric", "PledgeProgress", "ActionButton", "MemberList"],
    },
    {
      name: "Metric",
      description: "A labelled number.",
      props: {
        label: { type: "string", required: true },
        value: { type: "money", required: true },
      },
    },
    {
      name: "PledgeProgress",
      description: "Progress towards an order's target.",
      props: {
        pledged: { type: "money", required: true },
        target: { type: "money", required: true },
      },
    },
    {
      name: "MemberList",
      description: "Members of a space.",
      props: {
        members: { type: "string[]", required: true },
        status: { type: "string", enum: ["paid", "owing"] },
      },
    },
    {
      name: "ActionButton",
      description: "Triggers a capability through the member's UCAN.",
      props: { label: { type: "string", required: true } },
      actions: ["message.send"],
    },
  ],
};

const zar = (minor: number) => ({ currency: "ZAR", minor });

const valid: UiNode = {
  component: "Stack",
  props: { gap: 8 },
  children: [
    { component: "Metric", props: { label: "Pooled", value: zar(4500_00) }, children: [] },
    {
      component: "PledgeProgress",
      props: { pledged: zar(4500_00), target: zar(6000_00) },
      children: [],
    },
    { component: "MemberList", props: { members: ["m1", "m2"], status: "owing" }, children: [] },
    {
      component: "ActionButton",
      props: { label: "Remind" },
      children: [],
      action: { tool: "message.send", input: { to: ["m1", "m2"], template: "reminder" } },
    },
  ],
};

const doc = (root: UiNode): UiDocument => ({
  library: { name: contractLibrary.name, version: contractLibrary.version },
  root,
});

/** Replace the first child of the valid tree. */
const withChild = (child: UiNode): UiNode => ({
  ...valid,
  children: [child, ...valid.children.slice(1)],
});

/** Rejected with an issue of this code. A node may break several rules; which is reported first is not specified. */
async function rejects(genUi: GenUi, root: UiNode, code: GenUiErrorCode): Promise<void> {
  const result = await genUi.validate(contractLibrary, await genUi.print(doc(root)));
  if (result.ok) throw new Error(`expected ${code}, got a valid document`);
  const codes = result.error.issues.map((issue) => issue.code);
  expect(codes).toContain(code);
  expect(codes).toContain(result.error.code);
}

export const genUiContract: readonly ContractCase<GenUi>[] = [
  {
    name: "the system prompt names every component in the library",
    run: async (genUi) => {
      const prompt = await genUi.systemPrompt(contractLibrary);
      for (const component of contractLibrary.components) expect(prompt).toContain(component.name);
    },
  },
  {
    name: "a valid document survives print then validate unchanged",
    run: async (genUi) => {
      const document = doc(valid);
      expect(expectOk(await genUi.validate(contractLibrary, await genUi.print(document)))).toEqual(
        document,
      );
    },
  },
  {
    name: "refuses source that does not parse",
    run: async (genUi) => {
      expectErr(await genUi.validate(contractLibrary, ")))((( not a document"), "parse_error");
    },
  },
  {
    name: "refuses the wrong root",
    run: async (genUi) => {
      await rejects(
        genUi,
        { component: "Metric", props: { label: "x", value: zar(1) }, children: [] },
        "invalid_root",
      );
    },
  },
  {
    name: "refuses components outside the library",
    run: async (genUi) => {
      await rejects(
        genUi,
        withChild({ component: "Script", props: { src: "https://evil.example" }, children: [] }),
        "unknown_component",
      );
    },
  },
  {
    name: "refuses missing, unknown, mistyped and out-of-enum props",
    run: async (genUi) => {
      await rejects(
        genUi,
        withChild({ component: "Metric", props: { label: "Pooled" }, children: [] }),
        "invalid_props",
      );
      await rejects(
        genUi,
        withChild({
          component: "Metric",
          props: { label: "P", value: zar(1), onClick: "x" },
          children: [],
        }),
        "invalid_props",
      );
      await rejects(
        genUi,
        withChild({ component: "Metric", props: { label: "P", value: 4500.5 }, children: [] }),
        "invalid_props",
      );
      await rejects(
        genUi,
        withChild({
          component: "MemberList",
          props: { members: ["m1"], status: "rich" },
          children: [],
        }),
        "invalid_props",
      );
    },
  },
  {
    name: "refuses children a component does not allow",
    run: async (genUi) => {
      const metric: UiNode = {
        component: "Metric",
        props: { label: "P", value: zar(1) },
        children: [],
      };
      await rejects(genUi, withChild({ ...metric, children: [metric] }), "invalid_children");
    },
  },
  {
    name: "refuses actions a component may not trigger",
    run: async (genUi) => {
      await rejects(
        genUi,
        withChild({
          component: "ActionButton",
          props: { label: "Pay" },
          children: [],
          action: { tool: "payment.approve", input: {} },
        }),
        "forbidden_action",
      );
      await rejects(
        genUi,
        withChild({
          component: "Metric",
          props: { label: "P", value: zar(1) },
          children: [],
          action: { tool: "message.send", input: {} },
        }),
        "forbidden_action",
      );
    },
  },
];

/** Register the `GenUi` contract against an adapter. */
export function runGenUiContract(factory: Factory<GenUi>, options?: ContractOptions): void {
  registerContract("GenUi contract", genUiContract, factory, options);
}
