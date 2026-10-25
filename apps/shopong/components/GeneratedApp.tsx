import { ScrollView } from "react-native";

import type { Build } from "../lib/builder";
import { ScreenSwitcher } from "./ScreenSwitcher";

/** A published app: its screens, one at a time. */
export function GeneratedApp({ build }: { build: Build }) {
  return (
    <ScrollView contentContainerClassName="p-6" keyboardShouldPersistTaps="handled">
      <ScreenSwitcher screens={build.screens} />
    </ScrollView>
  );
}
