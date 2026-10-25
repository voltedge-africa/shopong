import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, ScrollView, View } from "react-native";
import { Text } from "panelui-native";

import { runUcanCheck, type CheckReport } from "../lib/ucanCheck";

// A development screen: it runs the UCAN adapter on this device and shows the result. It logs one
// `UCAN_CHECK {...}` line too, so a run can be read from `adb logcat` or the browser console. It shows
// nothing in a release build.
export default function UcanCheck() {
  const [report, setReport] = useState<CheckReport | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    if (!__DEV__) return;
    runUcanCheck()
      .then((r) => {
        console.log(`UCAN_CHECK ${JSON.stringify({ platform: Platform.OS, ...r })}`);
        setReport(r);
      })
      .catch((e: unknown) => {
        console.log(`UCAN_CHECK ${JSON.stringify({ platform: Platform.OS, error: String(e) })}`);
        setError(String(e));
      });
  }, []);

  if (!__DEV__) return null;
  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-3 p-4">
      <Stack.Screen options={{ title: "UCAN check" }} />
      {error !== undefined ? (
        <Text testID="status">{`Crashed: ${error}`}</Text>
      ) : report === undefined ? (
        <Text testID="status">Running…</Text>
      ) : (
        <>
          <Text testID="status">
            {`${report.passed} passed, ${report.failed} failed on ${Platform.OS} (${report.engine})`}
          </Text>
          <Text>{`Polyfills installed: ${report.polyfills.join(", ") || "none"}`}</Text>
          {report.cases.map((c) => (
            <View key={c.name}>
              <Text>{`${c.pass ? "PASS" : "FAIL"}  ${c.name} (${c.ms} ms)`}</Text>
              {c.error === undefined ? null : <Text>{c.error}</Text>}
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}
