// Metro swaps this in for `react/jsx-runtime` inside `@openuidev/react-lang` on phones (see
// metro.config.js), and nowhere else.
//
// The OpenUI renderer wraps what it draws in `<div>`s (an opacity wrapper and a loading spinner for
// data queries). A phone has no `div`: React Native throws "View config not found for component div".
// This keeps the renderer itself, unchanged, and says what its `div` is on a phone: a `View`. The only
// style it sets on that wrapper that a `View` does not know is a CSS `transition`, which is dropped.
import { Fragment, jsx as baseJsx, jsxs as baseJsxs } from "react/jsx-runtime";
import { View } from "react-native";

type Props = Record<string, unknown> | null;

function onPhone(type: unknown, props: Props): [unknown, Props] {
  if (type !== "div") return [type, props];
  const { style, hidden, ...rest } = props ?? {};
  const { transition: _transition, ...viewStyle } = (style ?? {}) as Record<string, unknown>;
  return [View, { ...rest, style: hidden === true ? [viewStyle, { display: "none" }] : viewStyle }];
}

export { Fragment };

export function jsx(type: unknown, props: Props, key?: string) {
  const [swapped, swappedProps] = onPhone(type, props);
  return baseJsx(swapped as never, swappedProps as never, key);
}

export function jsxs(type: unknown, props: Props, key?: string) {
  const [swapped, swappedProps] = onPhone(type, props);
  return baseJsxs(swapped as never, swappedProps as never, key);
}
