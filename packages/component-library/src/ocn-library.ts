import { createLibrary, type BoundComponentSpec } from "./create-library.js";

/**
 * The approved OCN component library (AD-11): the only parts a generated interface may be made of.
 * Each part declares the capability reads and actions it may bind to (`reads`, `actions`); a part with
 * neither is layout only. Changing a part, its props or their order needs a new `version`, because a
 * saved solution is pinned to the version it was written against.
 *
 * `json` props are plain data the drawing code checks itself (for example a GeoJSON collection). The
 * library checks only that the value is data, not its shape.
 */
const COMPONENTS: readonly BoundComponentSpec[] = [
  {
    name: "Stack",
    description: "Parts one under the other, in the order written. A screen is a stack.",
    props: {},
    children: ["*"],
    reads: [],
    actions: [],
  },
  {
    name: "Metric",
    description: "One figure with its label above it, for example the pooled total.",
    props: {
      label: { type: "string", required: true },
      value: { type: "money", required: true },
    },
    reads: ["ledger.read"],
    actions: [],
  },
  {
    name: "PledgeProgress",
    description: "How far a group order's pledges have got towards its target.",
    props: {
      pledged: { type: "money", required: true },
      target: { type: "money", required: true },
    },
    reads: ["pledges.query"],
    actions: [],
  },
  {
    name: "Table",
    description: "Rows and columns of text, for example a price list or a member's history.",
    props: {
      columns: { type: "string[]", required: true },
      rows: {
        type: "json",
        required: true,
        description: "Rows of cell texts, one array per row.",
      },
    },
    reads: ["ledger.read", "members.list", "pledges.query", "quote.compare"],
    actions: [],
  },
  {
    name: "Form",
    description: "Fields to fill in and a button to send them to a capability.",
    props: {
      title: { type: "string", required: true },
      fields: { type: "string[]", required: true, description: "The labels of the fields." },
    },
    reads: [],
    actions: ["order.propose", "message.send"],
  },
  {
    name: "Timeline",
    description: "A dated list of what happened, oldest last.",
    props: {
      entries: { type: "string[]", required: true, description: "One line per event." },
    },
    reads: ["ledger.read"],
    actions: [],
  },
  {
    name: "Map",
    description: "A map of precomputed points or routes. Shown as GeoJSON, never raw addresses.",
    props: {
      label: { type: "string", required: true },
      geojson: { type: "json", required: true, description: "A GeoJSON collection." },
    },
    reads: ["route.plan"],
    actions: [],
  },
  {
    name: "Chart",
    description: "Bars or a line over labelled values.",
    props: {
      title: { type: "string", required: true },
      labels: { type: "string[]", required: true },
      values: { type: "json", required: true, description: "One number per label." },
    },
    reads: ["ledger.read", "pledges.query"],
    actions: [],
  },
  {
    name: "ActionButton",
    description:
      "A button that runs a capability with the member's authority. Money needs approval.",
    props: {
      label: { type: "string", required: true },
      kind: { type: "string", enum: ["primary", "secondary"] },
    },
    reads: [],
    actions: ["message.send", "order.propose", "delivery.confirm", "payment.request"],
  },
  {
    name: "MemberList",
    description: "Members of a community, with whether each has paid or still owes.",
    props: {
      members: {
        type: "string[]",
        required: true,
        description: "Member ids, never phone numbers.",
      },
      status: { type: "string", enum: ["paid", "owing"] },
    },
    reads: ["members.list", "pledges.query"],
    actions: [],
  },
  {
    name: "QuoteCompare",
    description: "Supplier quotes side by side.",
    props: {
      quotes: { type: "json", required: true, description: "One entry per quote." },
    },
    reads: ["quote.compare"],
    actions: [],
  },
];

export const OCN_COMPONENT_LIBRARY = createLibrary({
  name: "OCN",
  version: "1",
  root: "Stack",
  components: COMPONENTS,
});
