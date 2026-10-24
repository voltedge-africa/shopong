import { Pressable, StyleSheet, Text, View, useColorScheme } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { appInfo } from "../src/appInfo";
import { themeFor } from "../src/theme";

export default function SignedOutHome() {
  const theme = themeFor(useColorScheme());
  const { createIdentity } = appInfo;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.background }]}>
      <View style={styles.content}>
        <Text accessibilityRole="header" style={[styles.title, { color: theme.text }]}>
          {appInfo.name}
        </Text>
        <Text style={[styles.tagline, { color: theme.mutedText }]}>{appInfo.tagline}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={createIdentity.label}
          accessibilityHint={createIdentity.helper}
          accessibilityState={{ disabled: !createIdentity.enabled }}
          disabled={!createIdentity.enabled}
          style={[
            styles.button,
            { backgroundColor: createIdentity.enabled ? theme.primary : theme.disabledBackground },
          ]}
        >
          <Text
            style={[
              styles.buttonLabel,
              { color: createIdentity.enabled ? theme.primaryText : theme.disabledText },
            ]}
          >
            {createIdentity.label}
          </Text>
        </Pressable>
        <Text style={[styles.helper, { color: theme.mutedText }]}>{createIdentity.helper}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    padding: 24,
    maxWidth: 480,
    width: "100%",
    alignSelf: "center",
  },
  title: { fontSize: 40, fontWeight: "700" },
  tagline: { fontSize: 18, textAlign: "center" },
  button: {
    minHeight: 48,
    minWidth: 220,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 16,
  },
  buttonLabel: { fontSize: 17, fontWeight: "600" },
  helper: { fontSize: 14 },
});
