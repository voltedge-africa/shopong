import Ionicons from "@expo/vector-icons/Ionicons";
import { useTriggerAction } from "@openuidev/react-lang";
import { View } from "react-native";
import { Badge, Button, Input, Progress, Text } from "panelui-native";
import { useCSSVariable } from "uniwind";

import { createScreenLibrary, type ScreenParts } from "../lib/screenLibrary";

const TAG_VARIANT = { good: "success", attention: "warning", neutral: "secondary" } as const;

/** The parts of a generated screen, drawn with PanelUI so they look like the rest of the app. */
export const NATIVE_PARTS: ScreenParts = {
  Screen: ({ props, renderNode }) => (
    <View className="gap-4">
      <Text accessibilityRole="header" size="2xl" weight="bold">
        {props.title}
      </Text>
      {renderNode(props.children)}
    </View>
  ),
  Stack: ({ props, renderNode }) => <View className="gap-4">{renderNode(props.children)}</View>,
  Heading: ({ props }) => (
    <Text accessibilityRole="header" size="xl" weight="semibold">
      {props.text}
    </Text>
  ),
  Text: ({ props }) => <Text muted={props.muted === true}>{props.text}</Text>,
  Metric: ({ props }) => (
    <View className="gap-0.5">
      <Text size="sm" muted>
        {props.label}
      </Text>
      <Text size="2xl" weight="bold">
        {props.value}
      </Text>
    </View>
  ),
  Progress: ({ props }) => (
    <Progress label={props.label} value={Number(props.value)} showValueLabel />
  ),
  Pair: ({ props }) => (
    <View className="flex-row items-center justify-between gap-4">
      <Text muted>{props.label}</Text>
      <Text weight="medium">{props.value}</Text>
    </View>
  ),
  List: ({ props, renderNode }) => (
    <View className="overflow-hidden rounded-xl border border-border bg-card">
      {renderNode(props.children)}
    </View>
  ),
  ListItem: ({ props }) => (
    <View className="flex-row items-center justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <View className="flex-1 gap-0.5">
        <Text weight="medium">{props.title}</Text>
        {props.detail ? (
          <Text size="sm" muted>
            {props.detail}
          </Text>
        ) : null}
      </View>
      {props.tag ? <Badge variant={TAG_VARIANT[props.tone ?? "neutral"]}>{props.tag}</Badge> : null}
    </View>
  ),
  Field: ({ props }) => <Input label={props.label || undefined} placeholder={props.placeholder} />,
  Photo: function Photo({ props }) {
    const muted = useCSSVariable("--color-muted-foreground") as string;
    return (
      <View className="h-40 items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-muted">
        <Ionicons name="camera-outline" size={32} color={muted} />
        <Text size="sm" muted>
          {props.label}
        </Text>
      </View>
    );
  },
  Button: function ScreenButton({ props }) {
    const trigger = useTriggerAction();
    return (
      <Button
        fullWidth
        variant={props.kind === "secondary" ? "outline" : "primary"}
        onPress={() => void trigger(props.label, undefined, props.action ?? undefined)}
      >
        {props.label}
      </Button>
    );
  },
};

/** The library the renderer draws generated screens with. */
export const SCREEN_LIBRARY = createScreenLibrary(NATIVE_PARTS);
