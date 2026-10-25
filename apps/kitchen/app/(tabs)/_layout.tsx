import { NativeTabs } from "expo-router/native-tabs";
import { useCSSVariable } from "uniwind";

// Native controls ignore className, so the PanelUI theme tokens are read as values.
export default function TabsLayout() {
  const [tint, icon, background] = useCSSVariable([
    "--color-primary",
    "--color-muted-foreground",
    "--color-card",
  ]);

  return (
    <NativeTabs
      tintColor={tint as string}
      iconColor={icon as string}
      backgroundColor={background as string}
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf={{ default: "house", selected: "house.fill" }} md="home" />
        <NativeTabs.Trigger.Label>Home</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="addons">
        <NativeTabs.Trigger.Icon
          sf={{ default: "puzzlepiece.extension", selected: "puzzlepiece.extension.fill" }}
          md="extension"
        />
        <NativeTabs.Trigger.Label>Addons</NativeTabs.Trigger.Label>
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
