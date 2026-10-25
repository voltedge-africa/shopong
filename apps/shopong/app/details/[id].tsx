import Ionicons from "@expo/vector-icons/Ionicons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, View } from "react-native";
import { Button, Text } from "panelui-native";
import { useCSSVariable } from "uniwind";

import { Screenshots } from "../../components/Screenshots";
import { useAllMiniApps } from "../../components/publishedMiniApps";
import { appDetails } from "../../lib/appDetails";
import { installStore } from "../../lib/installedApps";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-3">
      <Text accessibilityRole="header" weight="semibold" size="lg">
        {title}
      </Text>
      {children}
    </View>
  );
}

// An app's page in Discover, like the page an app store shows before you open an app.
export default function AppDetails() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const apps = useAllMiniApps();
  const app = apps.find((candidate) => candidate.id === id);
  const [iconColor, muted] = useCSSVariable(["--color-foreground", "--color-muted-foreground"]);

  if (!app) {
    return (
      <View className="flex-1 items-center justify-center bg-background p-6">
        <Stack.Screen options={{ title: "" }} />
        <Text muted>App not found.</Text>
      </View>
    );
  }

  const details = appDetails(app);

  return (
    <ScrollView className="flex-1 bg-background" contentContainerClassName="gap-6 p-6">
      <Stack.Screen options={{ title: "" }} />
      <View className="flex-row items-center gap-4">
        <View className="h-24 w-24 items-center justify-center rounded-3xl border border-border bg-card">
          <Ionicons name={app.icon} size={44} color={iconColor as string} />
        </View>
        <View className="flex-1 gap-1">
          <Text accessibilityRole="header" size="2xl" weight="bold" numberOfLines={2}>
            {app.title}
          </Text>
          <Text muted>{app.publisher}</Text>
          <Text size="sm" muted>
            {app.category}
          </Text>
        </View>
      </View>

      <View className="gap-2">
        {app.installed ? (
          <>
            <Button
              accessibilityLabel={`Open ${app.title}`}
              onPress={() => router.push({ pathname: "/miniapp/[id]", params: { id: app.id } })}
            >
              Open
            </Button>
            <Button
              variant="outline"
              accessibilityLabel={`Uninstall ${app.title}`}
              onPress={() => installStore.uninstall(app.id)}
            >
              Uninstall
            </Button>
          </>
        ) : (
          <Button
            accessibilityLabel={`Install ${app.title}`}
            onPress={() => installStore.install(app.id)}
          >
            Install
          </Button>
        )}
      </View>

      {details.shots.length > 0 ? (
        <Section title="Screenshots">
          <Screenshots shots={details.shots} />
        </Section>
      ) : null}

      <Section title="About">
        <Text>{details.description}</Text>
      </Section>

      {details.whatsNew ? (
        <Section title="What is new">
          <Text>{details.whatsNew}</Text>
        </Section>
      ) : null}

      {details.mayDo.length > 0 ? (
        <Section title="What it may do">
          <View className="gap-2 rounded-xl border border-border bg-card p-4">
            {details.mayDo.map((line) => (
              <View key={line} className="flex-row items-center gap-3">
                <Ionicons name="checkmark-circle-outline" size={20} color={muted as string} />
                <Text className="flex-1">{line}</Text>
              </View>
            ))}
          </View>
        </Section>
      ) : null}

      <Section title="Information">
        <View className="rounded-xl border border-border bg-card">
          {details.rows.map((row) => (
            <View
              key={row.label}
              className="flex-row items-start justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0"
            >
              <Text muted>{row.label}</Text>
              <Text weight="medium" className="flex-1 text-right">
                {row.value}
              </Text>
            </View>
          ))}
        </View>
      </Section>
    </ScrollView>
  );
}
