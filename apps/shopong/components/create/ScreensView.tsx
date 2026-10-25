import { ScrollView, View } from "react-native";
import { Text } from "panelui-native";

import type { Build } from "../../lib/builder";
import { GeneratedScreen } from "../GeneratedScreen";

/** The screens the build would have, drawn for real. Buttons only preview; nothing is sent. */
export function ScreensView({ screens }: { screens: Build["screens"] }) {
  return (
    <ScrollView contentContainerClassName="gap-6 p-4" keyboardShouldPersistTaps="handled">
      <Text size="sm" muted>
        These are the screens it made. Try the buttons: nothing is sent.
      </Text>
      {screens.map((screen) => (
        <View key={screen.id} className="gap-2">
          <Text weight="semibold">{screen.title}</Text>
          <View className="rounded-3xl border border-border bg-background p-5">
            <GeneratedScreen screen={screen} />
          </View>
        </View>
      ))}
    </ScrollView>
  );
}
