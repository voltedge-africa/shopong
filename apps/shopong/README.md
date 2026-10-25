# @shopong/shopong

The Shopong app: an Expo universal app (iOS, Android, web) and one access point to OCN. It has four
tabs (Home, Discover, Notifications, Settings), a 6-digit PIN gate, and mini apps that open in one
generic activity.

## Run

```sh
pnpm install
pnpm --filter @shopong/shopong web       # http://localhost:8081
pnpm --filter @shopong/shopong android   # Expo Go on a device or emulator
pnpm --filter @shopong/shopong ios
```

`dev`, `android`, `ios`, `web` and `build` build the Delivery mini app first
(`@shopong/miniapp-delivery`), because the app ships it as a built page.

The PIN is kept in the device's secure store (`expo-secure-store`). On web it is kept in memory, so a
full reload asks for a new one.

## Layout

| Path          | What it holds                                                                               |
| ------------- | ------------------------------------------------------------------------------------------- |
| `app/`        | Expo Router routes: `auth` (PIN), `(tabs)`, `miniapp/[id]`, `create` (the builder)          |
| `components/` | UI, and `miniapps.ts`, the registry of mini apps this app ships and which are on by default |
| `lib/`        | Pure logic with tests: PIN, notifications, bundle messages, the web mini app document       |
| `global.css`  | Tailwind 4 and PanelUI theme through Uniwind; scans `miniapps/vendor/*/src`                 |

Mini apps are workspace packages under `miniapps/`; see [`miniapps/README.md`](../../miniapps/README.md)
for the layout and how to add one.

## Checks

```sh
pnpm --filter @shopong/shopong check-types
pnpm --filter @shopong/shopong test
```

`pnpm run ci` at the root runs everything, including the web export (`web-dist/`, git-ignored).

## Create

The **+** button next to the search in Discover opens `app/create.tsx`, a builder in the shape of an AI
chat app:

- **Compose:** "What do you want to create?", an `AIInput`, and recent projects. A `Panelside`
  on the left holds all projects, with search and a New project button.
- **Refusing what it cannot build:** the app checks the request first (`lib/classify.ts`), before any
  agent starts. Greetings, questions and anything unrelated to pledges, stock, orders, payments,
  deliveries or reminders get a "No action can be performed" notice in plain words. No project is
  created and the text stays in the box so it can be edited.
- **Starting the builder:** a request it can build shows PanelUI `Task`s: Classifying request,
  Initializing session, Starting agent, each with a line or two in plain words.
- **Thread:** the answer streams into a PanelUI `Response`, with the `AIInput` pinned at the bottom. It says what gets built, how it works as a UML sequence diagram (drawn by `lib/uml.ts`), what it can do and what you will see. It never shows code.
- **Logic, Screens, Build:** once the answer has finished, a "This build" group appears in the Panelside
  (Thread, Logic, Screens, Build) and the header names the view you are on.
  - **Logic** is a dotted canvas of nodes and edges (our own, see below). It fills the screen, opens
    at a zoom set by the size of a node so the text can be read (a long graph is panned, not shrunk;
    `defaultZoom` in `lib/logicGraph.ts`), pans by dragging anywhere, and **Fit** shows the whole graph.
    The dots move with the graph.
  - **Screens** are the generated screens, drawn for real by the OpenUI renderer. Each one is a pinned
    piece of OpenUI Lang text (see "Pinned screens" below), checked against the screen library
    (`lib/genui.ts`: Heading, Metric, Progress, List, Field, Button and so on) before it is drawn; one
    that fails is left out with a plain notice. `components/ScreenParts.tsx` draws the parts with
    PanelUI, so they look like the rest of the app. Buttons only preview what they would do.
  - **Build** is the run that makes the app file, like a deployment screen but stopping short of
    deploying: Build (put the screens together, connect the buttons, check what it may do), Test (try
    each screen, check money cannot move without your OK) and Package (pack the app, make the app
    file). Every step shows what it did and how long it took, a failure is flagged where it happens
    and stays visible when the next step puts it right, and a failure nothing puts right stops the
    run. When every step has passed you press **Publish**, which opens its own screen
    (`app/publish.tsx`) before anything is added to the app:
    - **Name your app**: the name (24 letters or fewer, and not one another app has) and a line about
      what it does, with a picture and a place in Discover.
    - **Preview**: how it looks on Home, and each screen, live.
    - **What it needs**: what it may do in plain words, and whether money waits for your OK.
    - **How it runs**: version, where it runs, the Shopong version it needs, whether it works without
      internet, screens, size, file, when it was built and who made it.

    Pressing **Publish** there adds it to Home as a mini app. Asking for a change builds and tests it
    again as a new version, and the button becomes **Publish update** (with a box for what is new).
    The model is `lib/ci.ts`; the record the platform keeps for each app is `PublishedApp` in
    `lib/publish.ts`.

**Words for people who are not technical.** Everything a person reads (answers, steps, diagrams,
refusals) is plain language: no tool names, no code and no jargon. `lib/builder.test.ts` fails if a
technical word or a code-style name appears in anything they can see.

## Pinned screens, drawn by OpenUI

A generated screen is **OpenUI Lang text** that is made once and then kept as it is:

```
root = Screen("Pledges", [stack])
stack = Stack([paid, target, members, remind])
paid = Metric("Paid so far", "R 3 360 of R 5 600")
target = Progress("Toward the target", 60)
members = List([nomsa, thabo, lindiwe])
nomsa = ListItem("Nomsa", "R 840", "Paid", "good")
thabo = ListItem("Thabo", "R 840", "Paid", "good")
lindiwe = ListItem("Lindiwe", "R 840", "Owes", "attention")
remind = Button("Remind everyone who owes", "primary", @MessageSend())
```

The text is stored with the build as plain data (`PinnedScreen` in `lib/pinnedScreen.ts`):

```
{ id: "pledges", title: "Pledges", language: "openui-lang",
  library: { name: "Shopong", version: "2" },
  source: "root = Screen(...)\n...",
  hash: "9c8d273b..." }   // SHA-512 of the source, 128 hex characters
```

- **Made once.** `lib/builder.ts` writes the text. Today the builder is a keyword script, so the text for
  each of the four kinds of build is written by hand in that file and stands in for what a model would
  write. A real agent would produce the same data; nothing downstream changes.
- **Reused as it is.** The Screens tab, the Publish preview and the published app all draw
  `build.screens`, the same pinned text. **No model is called, no request is made, ever, to draw a
  screen.** `GeneratedScreen` hands `source` to the OpenUI `Renderer` and nothing else.
- **Checked first.** `loadPinnedScreen` refuses a screen whose language is not OpenUI Lang, whose library
  version is not the one the app has (a screen is drawn only by the library version it was written for),
  whose text no longer matches its hash, or that uses anything the library does not allow. A refused
  screen shows "This screen could not be shown", never an error message or code.
- **The hash** is SHA-512 hex, the project's rule for ids, computed by `lib/sha512.ts` because the app
  has no platform crypto (Hermes has no `crypto.subtle`). It is tested against Web Crypto.
  `lib/pinnedScreen.test.ts` also pins the hash of every screen the builder writes today, so editing one
  is a deliberate change.
- **Changing the library.** The signature of every part is part of the library's contract
  (`lib/genui.test.ts`). Change one and bump `LIBRARY.version`; screens pinned for the old version are
  then refused until they are written again.

### What is OpenUI and what is ours

| OpenUI (`@openuidev/react-lang` 1.0.1, `@openuidev/lang-core` 1.0.1) | Ours                                                                                 |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| The language and its parser                                          | The list of parts and their props (`LIBRARY` in `lib/genui.ts`)                      |
| `defineComponent`, `createLibrary`, `defineAction`                   | `lib/screenLibrary.ts` joins the library's definitions to the React components       |
| The `Renderer`, `onAction`, `useTriggerAction`                       | `components/ScreenParts.tsx`: the parts, drawn with PanelUI                          |
|                                                                      | `@shopong/adapters-openui`: the `GenUi` port's OpenUI adapter (check, print, prompt) |
|                                                                      | The plain notices for buttons (`lib/preview.ts`), the pinning and its hash           |

The port is still the seam (AD-11): `lib/genui.ts` talks to `GenUi`, and the in-memory adapter still
passes the same contract suite as the OpenUI one. Buttons write their action as `@MessageSend()`,
`@OrderPropose()`, `@RoutePlan()`, `@DeliveryConfirm()` or `@LedgerRead()`: the capability tool names
(`message.send` and so on) in OpenUI's PascalCase. `onAction` receives one of those names;
`previewNotice` turns it into a plain sentence, and a button with no action says nothing happened. No
name is ever shown.

### Offline by design: the telemetry finding

`@openuidev/lang-core` 1.0.1 (a dependency of the renderer) reports usage to PostHog. Read in the
published package, there are two paths:

1. **Install telemetry.** Its `postinstall` script sends a salted project id, versions, the operating
   system and the IP address, and writes a state file on the machine. **Blocked:** `pnpm-workspace.yaml`
   lists `"@openuidev/lang-core": false` under `allowBuilds`, so pnpm never runs it, and `pnpm install`
   still succeeds.
2. **Run-time telemetry.** `createParser(...).parse` and `generateSystemPrompt` call `postCapture`,
   which calls `fetch` on a PostHog address. It is opt-in (`OPENUI_RUNTIME_TELEMETRY_ENABLED`), sampled
   one run in ten, and never starts in a browser or in React Native (`detectRuntime` returns nothing when
   `navigator.product` is `ReactNative` or a page has a `document`). The code is still in the bundle
   (`grep cloudfront.net` finds it in the exported Android bundle), so it is closed in four places:
   - the app never calls either function: the renderer and the adapter use `createStreamingParser`,
     which does not report; the app never builds a model prompt (that is for a developer machine);
   - `@shopong/adapters-openui` sets `OPENUI_TELEMETRY_DISABLED=1` as it loads;
   - `patches/@openuidev__lang-core@1.0.1.patch` (a pnpm patch) makes `postCapture` return at once, so
     there is no code path to the network in any runtime. Drop the patch only after re-reading the
     package on an upgrade;
   - tests (`packages/adapters-openui/src/openui.test.ts`, `lib/screenLibrary.test.ts`) stub `fetch`,
     `XMLHttpRequest`, `WebSocket`, `EventSource` and `sendBeacon`, switch OpenUI's opt-in on, and assert
     none is called while screens are checked, drawn and their buttons pressed.

`@openuidev/observability` is a local event bus with no network. `@openuidev/devtools` has no network
code; it only draws an overlay on web in development and is never imported on a phone.

### OpenUI on React Native: verified, with one shim

The OpenUI website lists React Native but documents nothing, so this was tested for real.

- The package has a React Native entry (`dist/index.native.*`, picked by Metro's `react-native`
  condition) without the web-only developer overlay. The "preview" chunk does not import `react-dom`; it
  only touches `document` behind a `typeof document` check. `expo export --platform android` succeeds
  and the bundle has no `react-dom/client`.
- **The renderer itself does not run on a phone as shipped.** It wraps what it draws in a `<div>`. On
  Android that fails on the first screen: "View config getter callback for component `div` must be a
  function" (from `DefaultRendererContent`). So on phones only, Metro swaps in a tiny JSX runtime for
  `@openuidev/react-lang` (`lib/openuiJsxRuntime.ts`, wired in `metro.config.js`) that says a `div` is a
  `View` and drops the CSS `transition` a `View` does not know. The renderer's own code is untouched, and
  the web build is unchanged. This is the one workaround; it is small and covered by the Android run
  below.
- Verified on the Android emulator (Expo Go, Metro): the Screens tab draws all four kinds of build with the
  real `Renderer`, buttons show their plain notice, and the crash log stays empty. Taking the shim out
  brings the "`div`" error back.

### New dependencies

| Package                    | Version | Licence | Where                        | Why                                                   |
| -------------------------- | ------- | ------- | ---------------------------- | ----------------------------------------------------- |
| `@openuidev/react-lang`    | 1.0.1   | MIT     | app                          | The renderer, `defineComponent`, `createLibrary`      |
| `@openuidev/lang-core`     | 1.0.1   | MIT     | adapter (and via react-lang) | The parser, without React; patched (see above)        |
| `@openuidev/observability` | 0.0.4   | MIT     | via react-lang               | A local event bus the renderer publishes to           |
| `@openuidev/devtools`      | 0.3.0   | MIT     | via react-lang               | Web-only developer overlay; never imported on a phone |
| `zod`                      | 4.6.7   | MIT     | app, adapter                 | Props schemas; a peer dependency of OpenUI            |
| `ci-info`                  | 4.4.0   | MIT     | via lang-core                | Used only by the telemetry code that is switched off  |
| `lucide-react`             | 0.575.0 | ISC     | via devtools                 | Icons for the web-only overlay                        |

All are pinned. Licences were read from the installed packages (`pnpm licenses list`); nothing is
copyleft. `ci-info` and `lucide-react` are not used by anything that runs on a phone.

**It is a demo.** No agent is connected yet: `lib/builder.ts` scripts the answer from keywords in the
prompt (the stand-in for the builder agent behind the `Agent` and `GenUi` ports), and conversations
live in memory (`lib/conversationStore.ts`) until the app closes.

**Why Logic is not PanelUI's `Flow`.** `Flow` sizes its SVG layers at four times the container. On
Android `react-native-svg` backs each with a bitmap and Android refuses bitmaps over 100 MB, so on a
phone (412 x 660 dp at 2.6x) the Logic tab crashed the app with "Canvas: trying to draw too large
bitmap". `components/create/LogicView.tsx` draws the nodes as positioned views and the edges as one SVG
sized to the graph (`lib/logicGraph.ts`, with a test that keeps it far under the limit). You pan by
scrolling and zoom with the buttons; there is no pinch or node dragging yet.
