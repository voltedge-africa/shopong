import { NativeTabs } from "expo-router/native-tabs";
import { Platform } from "react-native";
import { useCSSVariable } from "uniwind";

// Native controls ignore className, so the PanelUI theme tokens are read as values.
export default function TabsLayout() {
  const [tint, icon, background, pill] = useCSSVariable([
    "--color-primary",
    "--color-muted-foreground",
    "--color-card",
    "--color-secondary",
  ]);

  return (
    <NativeTabs
      tintColor={tint as string}
      iconColor={icon as string}
      backgroundColor={background as string}
      // Android's default ("auto") hides the labels of unselected tabs once there are more than three.
      labelVisibilityMode="labeled"
      // On web the selected tab is a pill that defaults to a fixed dark grey, which the tint colour
      // does not read on in dark mode. Android draws its own pill.
      indicatorColor={Platform.OS === "web" ? (pill as string) : undefined}
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf={{ default: "house", selected: "house.fill" }} md="home" />
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="discover">
        <NativeTabs.Trigger.Icon sf={{ default: "safari", selected: "safari.fill" }} md="explore" />
        <NativeTabs.Trigger.Label>Discover</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="notifications">
        <NativeTabs.Trigger.Icon
          sf={{ default: "bell", selected: "bell.fill" }}
          md="notifications"
        />
        <NativeTabs.Trigger.Label>Notifications</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon
          sf={{ default: "gearshape", selected: "gearshape.fill" }}
          md="settings"
        />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
