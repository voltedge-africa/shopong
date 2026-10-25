import { OpenUiGenUi, openUiDefinitions } from "@shopong/adapters-openui";
import type { ComponentLibrary, GenUiError, Result, UiDocument } from "@shopong/ports";

/**
 * The parts a generated screen may be made of. This is the allow-list (AD-11): a screen that uses
 * anything else, or gives a part something it does not take, is not drawn. The parts are drawn by
 * `components/ScreenParts.tsx` with PanelUI, so a generated screen looks like any other screen in the app.
 *
 * Screens are written in OpenUI Lang. A part takes its props as positional arguments in the order they
 * are listed here, then its parts as one list, then its action:
 *
 *   Screen(title, children)            ListItem(title, detail?, tag?, tone?)
 *   Stack(children)                    Field(placeholder, label?)
 *   Heading(text)                      Photo(label)
 *   Text(text, muted?)                 Button(label, kind?, action?)
 *   Metric(label, value)               List(children)
 *   Progress(label, value)             Pair(label, value)
 *
 * Changing a part, its props or their order changes what every pinned screen means, so it needs a new
 * `version`. A screen pinned to another version is not drawn (see `lib/pinnedScreen.ts`).
 */
export const LIBRARY: ComponentLibrary = {
  name: "Shopong",
  version: "2",
  root: "Screen",
  components: [
    {
      name: "Screen",
      description: "One screen of the app. Every screen starts with this.",
      props: { title: { type: "string", required: true } },
      children: ["*"],
    },
    {
      name: "Stack",
      description: "Parts one under the other.",
      props: {},
      children: ["*"],
    },
    {
      name: "Heading",
      description: "A large line of text.",
      props: { text: { type: "string", required: true } },
    },
    {
      name: "Text",
      description: "A line of text. Muted text is quieter.",
      props: { text: { type: "string", required: true }, muted: { type: "boolean" } },
    },
    {
      name: "Metric",
      description: "A figure with a label above it.",
      props: {
        label: { type: "string", required: true },
        value: { type: "string", required: true },
      },
    },
    {
      name: "Progress",
      description: "A bar showing how far along something is, from 0 to 100.",
      props: {
        label: { type: "string", required: true },
        value: { type: "number", required: true },
      },
    },
    {
      name: "Pair",
      description: "A label with its value on the same line.",
      props: {
        label: { type: "string", required: true },
        value: { type: "string", required: true },
      },
    },
    {
      name: "List",
      description: "A list of rows.",
      props: {},
      children: ["ListItem"],
    },
    {
      name: "ListItem",
      description: "One row: a title, a line under it and an optional tag.",
      props: {
        title: { type: "string", required: true },
        detail: { type: "string" },
        tag: { type: "string" },
        tone: { type: "string", enum: ["good", "attention", "neutral"] },
      },
    },
    {
      name: "Field",
      description: "A box to type in.",
      props: { placeholder: { type: "string", required: true }, label: { type: "string" } },
    },
    {
      name: "Photo",
      description: "A place for a photo.",
      props: { label: { type: "string", required: true } },
    },
    {
      name: "Button",
      description: "A button. The main one is primary.",
      props: {
        label: { type: "string", required: true },
        kind: { type: "string", enum: ["primary", "secondary"] },
      },
      actions: ["message.send", "order.propose", "route.plan", "delivery.confirm", "ledger.read"],
    },
  ],
};

/** The language screens are written in. */
export const SCREEN_LANGUAGE = "openui-lang" as const;

/** What OpenUI needs to draw and check the library: the parts' props and the actions' names. */
export const DEFINITIONS = openUiDefinitions(LIBRARY);

const genUi = new OpenUiGenUi([LIBRARY]);

/** Checks a screen against the library. A screen that fails is not drawn. */
export const validateScreen = (source: string): Promise<Result<UiDocument, GenUiError>> =>
  genUi.validate(LIBRARY, source);
