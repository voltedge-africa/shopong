import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Chip, Fab, SearchBar, Text } from "panelui-native";
import { useCSSVariable } from "uniwind";

import { MiniAppTile } from "../../components/MiniAppTile";
import { TabScreen } from "../../components/TabScreen";
import { useAllMiniApps } from "../../components/publishedMiniApps";
import {
  CATEGORIES,
  filterMiniApps,
  groupMiniApps,
  type MiniAppCategory,
} from "../../components/miniapps";

export default function Discover() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<MiniAppCategory | undefined>();

  const iconColor = useCSSVariable("--color-primary-foreground") as string;

  const apps = useAllMiniApps();
  const groups = groupMiniApps(filterMiniApps(apps, { query, category }));

  return (
    <TabScreen>
      {/* pb-28: room at the bottom so the last row can scroll clear of the button. */}
      <ScrollView contentContainerClassName="gap-4 p-6 pb-28" keyboardShouldPersistTaps="handled">
        <Text accessibilityRole="header" size="3xl" weight="bold">
          Discover
        </Text>
        <SearchBar placeholder="Search mini apps" value={query} onChangeText={setQuery} />
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="-mx-6"
          contentContainerClassName="gap-2 px-6"
          keyboardShouldPersistTaps="handled"
        >
          <Chip selected={category === undefined} onPress={() => setCategory(undefined)}>
            All
          </Chip>
          {CATEGORIES.map((name) => (
            <Chip key={name} selected={category === name} onPress={() => setCategory(name)}>
              {name}
            </Chip>
          ))}
        </ScrollView>
        {groups.length === 0 ? (
          <Text muted className="py-8 text-center">
            No mini apps match.
          </Text>
        ) : (
          groups.map((group) => (
            <View key={group.title} className="gap-1">
              <Text accessibilityRole="header" weight="semibold" size="lg">
                {group.title}
              </Text>
              <View className="flex-row flex-wrap">
                {group.apps.map((app) => (
                  <MiniAppTile
                    key={app.id}
                    app={app}
                    showInstalled
                    onPress={() =>
                      router.push({ pathname: "/details/[id]", params: { id: app.id } })
                    }
                  />
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
      <Fab
        placement="bottom-right"
        accessibilityLabel="Create a mini app"
        icon={<Ionicons name="add" size={26} color={iconColor} />}
        onPress={() => router.push("/create")}
      />
    </TabScreen>
  );
}
