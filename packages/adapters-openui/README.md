# @shopong/adapters-openui

The OpenUI adapter for the `GenUi` port (AD-11). A screen is written in **OpenUI Lang**, a few lines of
`name = Part(...)` with positional arguments, and checked against a component library before anything
draws it:

```
root = Screen("Pledges", [stack])
stack = Stack([paid, remind])
paid = Metric("Paid so far", "R 3 360 of R 5 600")
remind = Button("Remind everyone who owes", "primary", @MessageSend())
```

- **`OpenUiGenUi`** implements `GenUi`: `validate` parses the text and applies the library's rules,
  `print` writes a document back as canonical text, `systemPrompt` builds the model prompt from the
  library, locally, with no gateway. It passes the port's contract suite (`src/contracts.test.ts`), the
  same one the in-memory adapter passes.
- **`openUiDefinitions(library)`** turns the port's `ComponentLibrary` into what OpenUI needs: one zod
  props object for each part (positional order = the order the port lists the props, then `children`,
  then `action`) and one OpenUI action for each capability tool (`message.send` is `@MessageSend()`). The
  checking library here and the drawing library in the app are both built from it, so they cannot
  disagree.
- **`inspectScreen(library, source)`** is the same check without the promise.

## What the check adds to OpenUI's parser

OpenUI's parser is forgiving on purpose (it drops what it cannot place and keeps going), which is right
while a model is still streaming and wrong for a pinned screen. So `inspectScreen` also refuses:
text that stops half way, names used but never written (or written and never used), values that have to be
worked out (`"a" + "b"`, `$variables`), `Query`, `Mutation`, state, actions the part may not trigger
(including OpenUI's own `@OpenUrl`, `@Run` and `@Set`), parts in the wrong place and a root that is not the
library's root. The parser drops an argument a part has no slot for; the adapter reads the call again to
say whether it was a part or an action.

## No telemetry

`@openuidev/lang-core` can send usage events to PostHog. This package closes every path to it:

1. The checks use `createStreamingParser`, the parser the renderer uses, which never reports anything. The
   batch `createParser` and `generateSystemPrompt` are the two calls that can.
2. `src/telemetry.ts` sets `OPENUI_TELEMETRY_DISABLED=1` when the package loads.
3. The workspace patch `patches/@openuidev__lang-core@1.0.1.patch` makes the one function that calls
   `fetch` (`postCapture`) return at once, in both the ESM and CommonJS builds.
4. `@openuidev/lang-core` is in `allowBuilds` as `false` in `pnpm-workspace.yaml`, so its install script
   (which sends install telemetry) never runs.

`src/openui.test.ts` stubs `fetch`, switches OpenUI's own opt-in on and asserts nothing is sent. See the
app's README for the full finding.

## Dependencies

| Package                | Version | Licence | Why                                                       |
| ---------------------- | ------- | ------- | --------------------------------------------------------- |
| `@openuidev/lang-core` | 1.0.1   | MIT     | The OpenUI Lang parser and library types, no React        |
| `zod`                  | 4.6.7   | MIT     | The props schemas OpenUI reads (already used by the node) |

Both are pinned exactly.
