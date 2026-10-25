import Ionicons from "@expo/vector-icons/Ionicons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { Alert, Button, Chip, Input, Text } from "panelui-native";
import { CATEGORIES } from "@shopong/miniapp";
import { useCSSVariable } from "uniwind";

import { MiniAppTile } from "../components/MiniAppTile";
import { ScreenSwitcher } from "../components/ScreenSwitcher";
import { Screenshots } from "../components/Screenshots";
import { toMiniApp, useAllMiniApps } from "../components/publishedMiniApps";
import { APP_ICONS } from "../lib/builder";
import { artifactOf } from "../lib/ci";
import { useConversations } from "../lib/conversationStore";
import {
  DESCRIPTION_MAX,
  NAME_MAX,
  appRecord,
  defaultForm,
  detailRows,
  sentence,
  validatePublish,
  type PublishForm,
} from "../lib/publish";
import { publishIdFor, publishedStore, usePublishedApps } from "../lib/publishedApps";
import { MAX_SCREENSHOTS, addImages, removeImage, shotsFor } from "../lib/screenshots";

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-3">
      <View className="gap-0.5">
        <Text accessibilityRole="header" weight="semibold" size="lg">
          {title}
        </Text>
        {hint ? (
          <Text size="sm" muted>
            {hint}
          </Text>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/**
 * Where a finished build becomes an app: name it, see how it will look, check what it needs and how it
 * runs, then publish. Publishing adds it to the apps on Home. Nothing is deployed.
 */
export default function Publish() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [primary, foreground, muted] = useCSSVariable([
    "--color-primary",
    "--color-foreground",
    "--color-muted-foreground",
  ]) as [string, string, string];
  const conversations = useConversations();
  const published = usePublishedApps();
  const apps = useAllMiniApps();
  const [now] = useState(() => Date.now());

  const conversation = conversations.find((item) => item.id === id);
  const build = conversation?.build;
  const appId = publishIdFor(id ?? "");
  const existing = published.find((item) => item.id === appId);

  const [form, setForm] = useState<PublishForm | undefined>();
  const [submitted, setSubmitted] = useState(false);
  const [done, setDone] = useState(false);
  const current = form ?? (build ? defaultForm(build, existing) : undefined);

  const artifact = useMemo(() => (build ? artifactOf(build) : undefined), [build]);
  const taken = useMemo(
    () => apps.filter((app) => app.id !== appId).map((app) => app.title),
    [apps, appId],
  );

  if (!build || !artifact || !current) {
    return (
      <View className="flex-1 items-center justify-center gap-4 bg-background p-6">
        <Text muted>There is nothing to publish here.</Text>
        <Button variant="outline" onPress={() => router.back()}>
          Go back
        </Button>
      </View>
    );
  }

  const check = validatePublish(current, taken);
  const draft = appRecord({ id: appId, build, artifact, form: current, now });
  const preview = toMiniApp({ ...draft, name: draft.name || "Your app" });
  const update = (patch: Partial<PublishForm>) => setForm({ ...current, ...patch });
  const showErrors = submitted || current.name !== defaultForm(build, existing).name;

  const addScreenshots = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: MAX_SCREENSHOTS - current.screenshots.length,
      quality: 0.8,
    });
    if (result.canceled) return;
    update({
      screenshots: addImages(
        current.screenshots,
        result.assets.map((asset) => asset.uri),
      ),
    });
  };

  const publish = () => {
    setSubmitted(true);
    if (!check.ok) return;
    publishedStore.publish(draft);
    setDone(true);
  };

  if (done)
    return (
      <View className="flex-1 gap-6 bg-background p-6">
        <Stack.Screen options={{ title: "Published", headerBackVisible: false }} />
        <Alert variant="success">
          <Alert.Indicator />
          <Alert.Content>
            <Alert.Title>{`${draft.name} is published`}</Alert.Title>
            <Alert.Description>
              It is on your Home screen now, with the other apps.
            </Alert.Description>
          </Alert.Content>
        </Alert>
        <View className="flex-row">
          <MiniAppTile app={toMiniApp(draft)} onPress={() => undefined} />
        </View>
        <View className="gap-3">
          <Button
            fullWidth
            onPress={() => router.replace({ pathname: "/miniapp/[id]", params: { id: draft.id } })}
          >
            Open
          </Button>
          <Button fullWidth variant="outline" onPress={() => router.back()}>
            Done
          </Button>
        </View>
      </View>
    );

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="gap-8 p-6 pb-12"
      keyboardShouldPersistTaps="handled"
    >
      <Stack.Screen options={{ title: existing ? "Publish update" : "Publish" }} />

      <Section title="Name your app" hint="This is the name people will see on Home.">
        <Input
          label="Name"
          value={current.name}
          onChangeText={(name) => update({ name })}
          maxLength={NAME_MAX + 10}
          errorMessage={showErrors ? check.errors.name : undefined}
          description={`${current.name.trim().length} of ${NAME_MAX} letters`}
        />
        <Input
          label="What it does"
          value={current.description}
          onChangeText={(description) => update({ description })}
          errorMessage={showErrors ? check.errors.description : undefined}
          description={`${current.description.trim().length} of ${DESCRIPTION_MAX} letters`}
          multiline
        />
        {existing ? (
          <Input
            label="What is new in this version"
            placeholder="It now texts members on Fridays"
            value={current.notes}
            onChangeText={(notes) => update({ notes })}
            multiline
          />
        ) : null}
      </Section>

      <Section
        title="Picture and place"
        hint="The picture shows on Home. The place is where people find it in Discover."
      >
        <View className="flex-row flex-wrap gap-2">
          {APP_ICONS.map((icon) => (
            <Pressable
              key={icon}
              accessibilityRole="button"
              accessibilityLabel={`Picture: ${icon.replace("-outline", "").replace(/-/g, " ")}`}
              accessibilityState={{ selected: current.icon === icon }}
              onPress={() => update({ icon })}
              className={
                current.icon === icon
                  ? "h-14 w-14 items-center justify-center rounded-2xl border-2 border-primary bg-card"
                  : "h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card"
              }
            >
              <Ionicons
                name={icon}
                size={26}
                color={current.icon === icon ? primary : foreground}
              />
            </Pressable>
          ))}
        </View>
        <View className="flex-row flex-wrap gap-2">
          {CATEGORIES.map((category) => (
            <Chip
              key={category}
              selected={current.category === category}
              onPress={() => update({ category })}
            >
              {category}
            </Chip>
          ))}
        </View>
      </Section>

      <Section
        title="Screenshots"
        hint={
          current.screenshots.length === 0
            ? `Show people what your app looks like. Add up to ${MAX_SCREENSHOTS} pictures. Until you do, people see your app's own screens.`
            : `${current.screenshots.length} of ${MAX_SCREENSHOTS} pictures. Tap the cross on a picture to take it out.`
        }
      >
        <Screenshots
          shots={shotsFor(current.screenshots, build.screens)}
          onRemove={(uri) => update({ screenshots: removeImage(current.screenshots, uri) })}
        />
        <Button
          variant="outline"
          disabled={current.screenshots.length >= MAX_SCREENSHOTS}
          accessibilityLabel="Add screenshots"
          onPress={() => void addScreenshots()}
        >
          Add screenshots
        </Button>
      </Section>

      <Section
        title="Preview"
        hint="This is how it will look. The buttons only preview what they do."
      >
        <View className="flex-row items-center gap-4">
          <MiniAppTile app={preview} onPress={() => undefined} />
          <Text size="sm" muted className="flex-1">
            On your Home screen
          </Text>
        </View>
        <View className="rounded-3xl border border-border bg-background p-5">
          <ScreenSwitcher screens={build.screens} />
        </View>
      </Section>

      <Section
        title="What it needs"
        hint="It can only do these things. It can never do more than you can."
      >
        <View className="gap-2 rounded-xl border border-border bg-card p-4">
          {draft.permissions.map((permission) => (
            <View key={permission} className="flex-row items-center gap-3">
              <Ionicons name="checkmark-circle-outline" size={20} color={muted} />
              <Text className="flex-1">{sentence(permission)}</Text>
            </View>
          ))}
          <View className="flex-row items-center gap-3">
            <Ionicons name="shield-checkmark-outline" size={20} color={muted} />
            <Text className="flex-1">
              {draft.needsApproval ? "Asks for your OK before money moves" : "Never moves money"}
            </Text>
          </View>
        </View>
      </Section>

      <Section title="How it runs">
        <View className="rounded-xl border border-border bg-card">
          {detailRows(draft).map((row) => (
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

      <View className="gap-3">
        {submitted && !check.ok ? (
          <Alert variant="warning">
            <Alert.Indicator />
            <Alert.Content>
              <Alert.Title>It cannot be published yet</Alert.Title>
              <Alert.Description>{check.errors.name ?? check.errors.description}</Alert.Description>
            </Alert.Content>
          </Alert>
        ) : null}
        <Button fullWidth onPress={publish}>
          {existing ? `Publish version ${artifact.version}` : "Publish"}
        </Button>
        <Button fullWidth variant="outline" onPress={() => router.back()}>
          Not yet
        </Button>
      </View>
    </ScrollView>
  );
}
