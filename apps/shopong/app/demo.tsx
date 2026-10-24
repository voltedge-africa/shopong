import { Stack } from "expo-router";
import { useEffect, useRef, useSyncExternalStore, type ComponentRef } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useColorScheme } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { createStokvelScenario } from "@shopong/scenario-stokvel";

import { createDemoController, type DemoController } from "../src/demo/demoController";
import { demoScreenModel, type TimelineRowModel } from "../src/demo/demoModel";
import { expoSha512 } from "../src/sha512";
import { themeFor, type Theme } from "../src/theme";

function useController(): DemoController {
  const ref = useRef<DemoController | null>(null);
  ref.current ??= createDemoController(createStokvelScenario({ sha512: expoSha512 }));
  return ref.current;
}

export default function Demo() {
  const theme = themeFor(useColorScheme());
  const controller = useController();
  const state = useSyncExternalStore(controller.subscribe, controller.getState);
  const scroller = useRef<ComponentRef<typeof ScrollView>>(null);

  useEffect(() => {
    void controller.load();
  }, [controller]);

  const snapshot = state.snapshot;
  const model = snapshot === undefined ? undefined : demoScreenModel(snapshot);
  const finished = snapshot?.done === true;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
      <Stack.Screen options={{ title: "Stokvel order", headerShown: true }} />
      <ScrollView
        ref={scroller}
        contentContainerStyle={styles.content}
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
      >
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          {model?.heading ?? "A stokvel order, step by step"}
        </Text>
        <Text style={[styles.body, { color: theme.mutedText }]}>
          {model?.intro ??
            "Five stokvel members buy groceries together. Nothing here is real money."}
        </Text>

        {state.status === "loading" && (
          <Text style={[styles.body, { color: theme.text }]}>Setting up the stokvel…</Text>
        )}
        {state.status === "failed" && (
          <Text role="alert" style={[styles.body, { color: theme.danger }]}>
            Something went wrong: {state.error}
          </Text>
        )}

        {model !== undefined && (
          <>
            <View
              style={[styles.card, { borderColor: theme.border, backgroundColor: theme.surface }]}
            >
              <Text accessibilityRole="header" style={[styles.cardTitle, { color: theme.text }]}>
                {model.funding.heading}
              </Text>
              <View
                accessibilityRole="progressbar"
                accessibilityLabel={model.funding.heading}
                accessibilityValue={{
                  min: 0,
                  max: 100,
                  now: model.funding.percent,
                  text: model.funding.text,
                }}
                style={[styles.track, { backgroundColor: theme.track }]}
              >
                <View
                  style={[
                    styles.fill,
                    {
                      width: `${String(model.funding.percent)}%`,
                      backgroundColor: model.funding.funded ? theme.success : theme.primary,
                    },
                  ]}
                />
              </View>
              <Text style={[styles.body, { color: theme.text }]}>{model.funding.text}</Text>
              {model.members.map((m) => (
                <View key={m.key} style={styles.memberRow}>
                  <Text style={[styles.memberName, { color: theme.text }]}>{m.name}</Text>
                  <Text style={[styles.memberStatus, { color: theme.mutedText }]}>{m.status}</Text>
                </View>
              ))}
            </View>

            {model.summary !== undefined && (
              <View
                style={[
                  styles.card,
                  { borderColor: theme.success, backgroundColor: theme.surface },
                ]}
              >
                <Text accessibilityRole="header" style={[styles.cardTitle, { color: theme.text }]}>
                  {model.summary.heading}
                </Text>
                {model.summary.lines.map((line) => (
                  <Text key={line} style={[styles.body, { color: theme.text }]}>
                    {line}
                  </Text>
                ))}
              </View>
            )}

            <Text accessibilityRole="header" style={[styles.cardTitle, { color: theme.text }]}>
              {model.timelineHeading}
            </Text>
            {model.groups.length === 0 && (
              <Text style={[styles.body, { color: theme.mutedText }]}>{model.emptyTimeline}</Text>
            )}
            {model.groups.map((group) => (
              <View
                key={group.key}
                role="list"
                accessibilityLabel={group.heading}
                style={styles.group}
              >
                <Text
                  accessibilityRole="header"
                  style={[styles.groupHeading, { color: theme.primary }]}
                >
                  {group.heading}
                </Text>
                {group.rows.map((row) => (
                  <TimelineRow key={row.key} row={row} theme={theme} />
                ))}
              </View>
            ))}
          </>
        )}
      </ScrollView>

      <View style={[styles.bar, { borderColor: theme.border, backgroundColor: theme.background }]}>
        <Text
          accessibilityLiveRegion="polite"
          aria-live="polite"
          style={[styles.status, { color: theme.mutedText }]}
        >
          {state.announcement || model?.progressLabel || " "}
        </Text>
        <View style={styles.buttons}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Next step: ${model?.next.detail ?? ""}`}
            accessibilityState={{ disabled: state.busy || finished || model === undefined }}
            disabled={state.busy || finished || model === undefined}
            onPress={() => void controller.next()}
            style={[
              styles.button,
              styles.primaryButton,
              {
                backgroundColor:
                  state.busy || finished || model === undefined
                    ? theme.disabledBackground
                    : theme.primary,
              },
            ]}
          >
            <Text
              style={[
                styles.buttonLabel,
                { color: state.busy || finished ? theme.disabledText : theme.primaryText },
              ]}
            >
              Next step
            </Text>
            <Text
              style={[
                styles.buttonDetail,
                { color: state.busy || finished ? theme.disabledText : theme.primaryText },
              ]}
            >
              {model?.next.detail ?? ""}
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Start again from the beginning"
            disabled={state.busy || model === undefined}
            onPress={() => void controller.reset()}
            style={[styles.button, styles.secondaryButton, { borderColor: theme.border }]}
          >
            <Text style={[styles.buttonLabel, { color: theme.text }]}>Start again</Text>
          </Pressable>
        </View>
        {!finished && model !== undefined && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Run all the remaining steps at once"
            disabled={state.busy}
            onPress={() => void controller.runAll()}
            style={styles.link}
          >
            <Text style={[styles.linkLabel, { color: theme.primary }]}>
              Run all remaining steps
            </Text>
          </Pressable>
        )}
      </View>
    </SafeAreaView>
  );
}

function TimelineRow({ row, theme }: { row: TimelineRowModel; theme: Theme }) {
  const moneyColor =
    row.money?.state === "failed"
      ? theme.danger
      : row.money?.state === "paid"
        ? theme.success
        : theme.mutedText;
  return (
    <View
      role="listitem"
      accessible
      accessibilityLabel={row.accessibilityLabel}
      style={[styles.row, { borderColor: theme.border }]}
    >
      <Text style={[styles.rowTitle, { color: theme.text }]}>{row.title}</Text>
      <Text style={[styles.rowMeta, { color: theme.mutedText }]}>{row.who}</Text>
      {row.money !== undefined && (
        <Text style={[styles.rowMoney, { color: moneyColor }]}>{row.money.text}</Text>
      )}
      <Text style={[styles.rowMeta, { color: theme.mutedText }]}>{row.idText}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    padding: 20,
    gap: 12,
    maxWidth: 640,
    width: "100%",
    alignSelf: "center",
    paddingBottom: 32,
  },
  title: { fontSize: 28, fontWeight: "700" },
  body: { fontSize: 16, lineHeight: 22 },
  card: { borderWidth: 1, borderRadius: 12, padding: 16, gap: 8 },
  cardTitle: { fontSize: 18, fontWeight: "700", marginTop: 4 },
  track: { height: 14, borderRadius: 7, overflow: "hidden" },
  fill: { height: 14 },
  memberRow: { flexDirection: "row", justifyContent: "space-between", gap: 12 },
  memberName: { fontSize: 15, fontWeight: "600", flexShrink: 0 },
  memberStatus: { fontSize: 15, flexShrink: 1, textAlign: "right" },
  group: { gap: 8, marginTop: 8 },
  groupHeading: { fontSize: 15, fontWeight: "700" },
  row: { borderLeftWidth: 3, paddingLeft: 12, paddingVertical: 4, gap: 2 },
  rowTitle: { fontSize: 16, lineHeight: 22 },
  rowMeta: { fontSize: 13 },
  rowMoney: { fontSize: 14, fontWeight: "600" },
  bar: { borderTopWidth: 1, padding: 12, gap: 8, alignItems: "center" },
  status: { fontSize: 14, textAlign: "center", maxWidth: 640 },
  buttons: { flexDirection: "row", gap: 12, width: "100%", maxWidth: 640 },
  button: {
    minHeight: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  primaryButton: { flex: 1 },
  secondaryButton: { borderWidth: 1 },
  buttonLabel: { fontSize: 17, fontWeight: "600" },
  buttonDetail: { fontSize: 13, textAlign: "center" },
  link: { minHeight: 44, justifyContent: "center" },
  linkLabel: { fontSize: 15, fontWeight: "600" },
});
