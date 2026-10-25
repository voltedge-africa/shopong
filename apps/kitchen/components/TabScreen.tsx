import type { ReactNode } from "react";
import { Platform, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

// On web, the tabs are a floating bar fixed 24px from the top and 40px tall, drawn over the page.
const WEB_TAB_BAR_CLEARANCE = Platform.OS === "web" ? 88 : 0;

/** The frame the three tab screens share: themed background, and room for the top bar or the notch. */
export function TabScreen({ children }: { children: ReactNode }) {
  return (
    <View className="flex-1 bg-background" style={{ paddingTop: WEB_TAB_BAR_CLEARANCE }}>
      <SafeAreaView edges={["top"]} style={{ flex: 1 }}>
        {children}
      </SafeAreaView>
    </View>
  );
}
