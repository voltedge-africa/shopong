import { useState } from "react";
import { View } from "react-native";
import { Chip } from "panelui-native";

import type { Build } from "../lib/builder";
import { GeneratedScreen } from "./GeneratedScreen";

/** One screen of a build at a time, with a chip for each screen when there is more than one. */
export function ScreenSwitcher({ screens }: { screens: Build["screens"] }) {
  const [selected, setSelected] = useState(screens[0]?.id);
  const screen = screens.find((item) => item.id === selected) ?? screens[0];

  return (
    <View className="gap-5">
      {screens.length > 1 ? (
        <View className="flex-row flex-wrap gap-2">
          {screens.map((item) => (
            <Chip
              key={item.id}
              selected={item.id === screen?.id}
              onPress={() => setSelected(item.id)}
            >
              {item.title}
            </Chip>
          ))}
        </View>
      ) : null}
      {screen ? <GeneratedScreen screen={screen} /> : null}
    </View>
  );
}
