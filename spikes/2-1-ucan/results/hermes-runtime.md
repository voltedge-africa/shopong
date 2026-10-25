# Hermes / React Native probe

## What this machine actually established

**Bundled/compiled only. Nothing ran on a device or emulator here.** There is no Android
emulator, iOS simulator or physical phone attached to this workspace, so this spike cannot
claim Hermes runtime success. What was established is that Metro can resolve the three
prototypes through the alias/polyfill setup and emit Android, iOS and web bundles.

`expo-probe` is an Expo 58 / React Native 0.88 app with `jsEngine: "hermes"`. Its `App.tsx`
calls `runAll()` from `src/probe/all.ts`, which runs the `CapabilityAuth` contract cases plus
the AD-18 seed check for ts-ucan, iso-ucan and the in-house adapter, and logs one line:
`UCAN_PROBE {...}`.

| Platform | Build result | Output | Notes |
|----------|--------------|--------|-------|
| Android | **bundle compiled only** | `_expo/static/js/android/index-*.hbc` (about 3 MB) | Metro reported about 896 modules. Hermes bytecode produced; no APK installed, no device run. |
| iOS | **bundle compiled only** | `_expo/static/js/ios/index-*.hbc` (about 3 MB) | Metro reported about 898 modules. No simulator/device run. |
| Web | **bundle compiled only** | `_expo/static/js/web/index-*.js` (about 1.3 MB) | Metro reported about 464 modules. Not opened in a browser here. |

Commands used for the build evidence:

```sh
cd spikes/2-1-ucan/expo-probe
npm install
npx expo export --platform android --platform ios --output-dir dist-native --no-minify
npx expo export --platform web --output-dir dist-web
```

## Polyfills and shims the bundle needs

- `globalThis.crypto.getRandomValues` via `expo-crypto`.
- `crypto.subtle.digest` via `@noble/hashes` (pure JS), because `@noble/ed25519` v3 async
  sign/verify and parts of the iso-ucan stack ask for it.
- `Buffer` and `stream` via Metro `extraNodeModules` (`buffer`, `readable-stream`).
- `.js`-to-`.ts` resolution for the spike's NodeNext-style imports, and `node:` prefix
  stripping.
- `TextEncoder`, `TextDecoder`, `structuredClone`, `atob`, `btoa` are checked at startup and
  reported as `MISSING ...` if the runtime lacks them; they are not silently shimmed.
- `index.tsx` contains JSX, hence the `.tsx` extension.

## Exact human steps: low-end Android phone

Use a physical Android phone (ideally 2 GB RAM or less, e.g. an entry-level 2020-2022
device), not an emulator.

1. On the phone: enable **Developer options** and **USB debugging**; connect it by USB and
   accept the "Allow USB debugging" prompt. Install **Expo Go** (SDK 58) from the Play Store.
2. On the computer:
   ```sh
   cd spikes/2-1-ucan/expo-probe
   npm install
   npx expo start --tunnel
   ```
3. Scan the QR code with Expo Go (or open the `exp://` URL). Keep the phone on the same
   network (or use `--tunnel` if it is not).
4. Wait for the screen to change from `running…` to three lines:
   `ts-ucan 0.12.0: N passed`, `iso-ucan 2.0.0: N passed`, `in-house minimal chain: N passed`.
   The JSON below it must contain `"engine": "hermes"`. A failed adapter shows `M failed` and
   the JSON has `error`.
5. Capture the machine-readable line:
   ```sh
   adb logcat -s ReactNativeJS | grep UCAN_PROBE
   ```
   Save that JSON with the device model and Android version in the PR or decision record.

If Expo Go cannot load the custom Metro config, build a development client instead:
`npx expo run:android --device` (requires Android SDK + USB device) and read the same
`UCAN_PROBE` line from `adb logcat`.

## Exact human steps: iPhone

Requires a Mac with Xcode and an Apple ID/team for signing, plus a physical iPhone.

1. On the iPhone: install **Expo Go** (SDK 58) from the App Store.
2. On the Mac:
   ```sh
   cd spikes/2-1-ucan/expo-probe
   npm install
   npx expo start --tunnel
   ```
3. Scan the QR code with the iPhone Camera or Expo Go. Wait for the same three result lines
   and `"engine": "hermes"` in the JSON.
4. Capture the line from the Expo/Metro terminal, or from the Xcode console if using a
   development build. Save it with the iPhone model and iOS version.

If Expo Go cannot load the custom Metro config, build a development client:
`npx expo run:ios --device` (Xcode + signing team required), then read `UCAN_PROBE` from the
Xcode console.

## What a device run must show before this spike can claim runtime fit

- All three adapters report 17/17 passed plus the AD-18 golden DID check, on Hermes.
- No `MISSING TextEncoder/TextDecoder/structuredClone/atob/btoa` in the `polyfills` array.
- No crash or redbox during the run; note cold-start time from `totalMs`.
- Repeat on a low-end Android phone specifically; bundle size and parse time are only
  proxies for that device.
