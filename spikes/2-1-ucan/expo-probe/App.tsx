// Runs both prototype adapters through the CapabilityAuth contract cases on whatever runtime
// loads the bundle, shows the result and logs it as one JSON line (`UCAN_PROBE {...}`), so a
// device run can be read from `adb logcat` / the Xcode console and a web run from the DOM.
import { useEffect, useState } from "react";
import { Platform, ScrollView, Text } from "react-native";
import { runAll } from "../src/probe/all";
import type { Report } from "../src/probe/run";

interface Result {
  platform: string;
  engine: string;
  polyfills: readonly string[];
  totalMs: number;
  reports?: Report[];
  error?: string;
}

export function App({ polyfills }: { polyfills: readonly string[] }) {
  const [result, setResult] = useState<Result | undefined>();
  useEffect(() => {
    const engine = (globalThis as { HermesInternal?: unknown }).HermesInternal ? "hermes" : "other";
    const start = Date.now();
    const base = { platform: Platform.OS, engine, polyfills };
    runAll()
      .then((reports) => ({ ...base, totalMs: Date.now() - start, reports }))
      .catch((e: unknown) => ({ ...base, totalMs: Date.now() - start, error: String(e) }))
      .then((r) => {
        console.log(`UCAN_PROBE ${JSON.stringify(r)}`);
        (globalThis as { __UCAN_PROBE__?: Result }).__UCAN_PROBE__ = r;
        setResult(r);
      });
  }, []);
  if (result === undefined) return <Text testID="status">running…</Text>;
  return (
    <ScrollView>
      <Text testID="status">
        {result.error ??
          result.reports?.map((r) => `${r.adapter}: ${r.passed} passed, ${r.failed} failed`).join("\n")}
      </Text>
      <Text testID="json">{JSON.stringify(result, null, 1)}</Text>
    </ScrollView>
  );
}
