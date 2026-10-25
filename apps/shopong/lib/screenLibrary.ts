import {
  createLibrary,
  defineComponent,
  type ActionPlan,
  type ComponentRenderer,
} from "@openuidev/react-lang";

import { DEFINITIONS } from "./genui";

type Part<Props> = ComponentRenderer<Props>;

/** An optional prop is missing, or `null` where a later argument was given and this one skipped. */
type Optional<T> = T | null | undefined;

/**
 * How each part of the screen library is drawn: one React component for each part, in `LIBRARY`
 * (`lib/genui.ts`). The props are what OpenUI hands over after it has read the screen. The app draws
 * them with PanelUI (`components/ScreenParts.tsx`); the tests draw them as plain HTML.
 */
export type ScreenParts = {
  Screen: Part<{ title: string; children: unknown[] }>;
  Stack: Part<{ children: unknown[] }>;
  Heading: Part<{ text: string }>;
  Text: Part<{ text: string; muted?: Optional<boolean> }>;
  Metric: Part<{ label: string; value: string }>;
  Progress: Part<{ label: string; value: number }>;
  Pair: Part<{ label: string; value: string }>;
  List: Part<{ children: unknown[] }>;
  ListItem: Part<{
    title: string;
    detail?: Optional<string>;
    tag?: Optional<string>;
    tone?: Optional<"good" | "attention" | "neutral">;
  }>;
  Field: Part<{ placeholder: string; label?: Optional<string> }>;
  Photo: Part<{ label: string }>;
  Button: Part<{
    label: string;
    kind?: Optional<"primary" | "secondary">;
    /** The action OpenUI worked out from `@Name(...)`, ready for `useTriggerAction`. */
    action?: Optional<ActionPlan>;
  }>;
};

/**
 * The OpenUI library the renderer draws screens with: the library's definitions (the same ones the
 * `GenUi` adapter checks against) joined to the React components that draw them.
 */
export function createScreenLibrary(parts: ScreenParts) {
  const drawn = parts as unknown as Record<
    string,
    ComponentRenderer<Record<string, unknown>> | undefined
  >;
  return createLibrary({
    components: DEFINITIONS.components.map((definition) => {
      const component = drawn[definition.name];
      if (component === undefined) throw new Error(`no component draws ${definition.name}`);
      return defineComponent({
        ...definition,
        component: component as ComponentRenderer<Record<string, unknown>>,
      });
    }),
    actions: [...DEFINITIONS.actions],
    root: DEFINITIONS.root,
  });
}
