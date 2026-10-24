import { useEffect, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, useColorScheme } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { expoSha512 } from "../src/sha512";
import { themeFor } from "../src/theme";
import { runGoldenVectors, type VectorReport } from "../src/vectorCheck";

/**
 * A platform check, not part of the product: runs the golden vectors of @shopong/events
 * through the expo-crypto SHA-512 adapter in whatever JavaScript runtime the app is running
 * in (a browser, or Hermes in Expo Go or a dev build). Not linked from the home screen.
 */
export default function Vectors() {
  const theme = themeFor(useColorScheme());
  const [report, setReport] = useState<VectorReport | undefined>();
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    runGoldenVectors(expoSha512).then(setReport, (e: unknown) =>
      setError(e instanceof Error ? e.message : String(e)),
    );
  }, []);

  const verdict =
    report === undefined
      ? error === undefined
        ? "Running…"
        : `ERROR: ${error}`
      : report.failures.length === 0
        ? `PASS: ${String(report.passed)} of ${String(report.total)} golden vectors match`
        : `FAIL: ${String(report.passed)} of ${String(report.total)} golden vectors match`;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          Event id platform check
        </Text>
        <Text style={[styles.body, { color: theme.mutedText }]}>
          SHA-512 through expo-crypto on {Platform.OS}
        </Text>
        <Text
          testID="verdict"
          accessibilityLiveRegion="polite"
          style={[styles.verdict, { color: theme.text }]}
        >
          {verdict}
        </Text>
        {report?.failures.map((f) => (
          <Text key={`${f.group}/${f.name}`} style={[styles.body, { color: theme.danger }]}>
            {f.group} / {f.name}: {f.detail}
          </Text>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { padding: 24, gap: 12, maxWidth: 640, width: "100%", alignSelf: "center" },
  title: { fontSize: 24, fontWeight: "700" },
  body: { fontSize: 15 },
  verdict: { fontSize: 18, fontWeight: "700" },
});
