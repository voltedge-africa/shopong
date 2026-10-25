# Mini apps

Each mini app is its own workspace package. The host app (`apps/kitchen`) decides which ones it
ships and which are installed by default; a package only describes itself with a `manifest`
(`@shopong/miniapp` has the types: id, title, icon, category and the content).

| Folder         | Whose code                            | How it runs                                                                        | Packages                       |
| -------------- | ------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------ |
| `vendor/`      | Ours, vendored and shipped in the app | In the app's process (`native`), or as a built page shipped as an asset (`bundle`) | `chat`, `insights`, `delivery` |
| `third-party/` | Anyone's html, css and js             | In a sandboxed WebView with no network and no access to the app (`web`)            | `shop`, `wallet`               |

Third-party packages hold only strings (`html`, `css`, `js`) built on the host's CSS kit, so they have
no React Native dependency and cannot import app code. Vendored native packages are React Native
components and carry the same pinned peers as the app, so there is one copy of each library.

## Adding one

1. Make `miniapps/<vendor|third-party>/<name>` with a `package.json` named `@shopong/miniapp-<name>`
   (copy a sibling) that exports a `manifest`.
2. Add it to `apps/kitchen/components/miniapps.ts`, with whether it is installed by default.
3. A vendored native package needs its source folder covered by `@source` in
   `apps/kitchen/global.css` (already matches `vendor/*/src`).
