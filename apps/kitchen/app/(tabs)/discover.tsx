import { useRouter } from "expo-router";
import { useState } from "react";
import { ScrollView, View } from "react-native";
import { Chip, SearchBar, Text } from "panelui-native";

import { MiniAppTile } from "../../components/MiniAppTile";
import { TabScreen } from "../../components/TabScreen";
import {
  CATEGORIES,
  filterMiniApps,
  miniApps,
  type MiniAppCategory,
} from "../../components/miniapps";

export default function Discover() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<MiniAppCategory | undefined>();

  const results = filterMiniApps(miniApps, { query, category });

  return (
    <TabScreen>
      <ScrollView contentContainerClassName="gap-4 p-6" keyboardShouldPersistTaps="handled">
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
        {results.length === 0 ? (
          <Text muted className="py-8 text-center">
            No mini apps match.
          </Text>
        ) : (
          <View className="flex-row flex-wrap">
            {results.map((app) => (
              <MiniAppTile
                key={app.id}
                app={app}
                showInstalled
                onPress={() => router.push({ pathname: "/miniapp/[id]", params: { id: app.id } })}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </TabScreen>
  );
}
