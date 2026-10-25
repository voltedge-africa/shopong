import Ionicons from "@expo/vector-icons/Ionicons";
import { Image, Pressable, ScrollView, View } from "react-native";
import { ScrollFade } from "panelui-native";
import { useCSSVariable } from "uniwind";

import type { Shot } from "../lib/screenshots";
import { GeneratedScreen } from "./GeneratedScreen";

type Props = {
  shots: readonly Shot[];
  /** Given when the pictures can be taken out (while publishing): shows a remove button on each one. */
  onRemove?: (uri: string) => void;
};

/**
 * A row of screenshots you swipe sideways, fading at the edge that has more behind it. Each one is a
 * picture the author added or, for an app with none, one of its own screens. It bleeds to the edges of
 * the page, so the page it sits in needs 24px (`p-6`) of padding.
 */
export function Screenshots({ shots, onRemove }: Props) {
  const foreground = useCSSVariable("--color-foreground") as string;
  if (shots.length === 0) return null;

  return (
    <ScrollFade size={32} className="-mx-6">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerClassName="gap-3 px-6"
      >
        {shots.map((shot, index) => (
          <View
            key={shot.kind === "image" ? shot.uri : shot.screen.id}
            className="h-96 w-52 overflow-hidden rounded-2xl border border-border bg-card"
          >
            {shot.kind === "image" ? (
              <Image
                source={{ uri: shot.uri }}
                accessibilityLabel={`Screenshot ${index + 1}`}
                resizeMode="cover"
                className="h-full w-full"
              />
            ) : (
              // A picture of the screen, not the screen: its buttons can be neither pressed nor reached.
              <View aria-hidden pointerEvents="none" className="p-4">
                <GeneratedScreen screen={shot.screen} />
              </View>
            )}
            {onRemove && shot.kind === "image" ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove screenshot ${index + 1}`}
                onPress={() => onRemove(shot.uri)}
                hitSlop={8}
                className="absolute right-2 top-2 h-8 w-8 items-center justify-center rounded-full border border-border bg-background"
              >
                <Ionicons name="close" size={18} color={foreground} />
              </Pressable>
            ) : null}
          </View>
        ))}
      </ScrollView>
    </ScrollFade>
  );
}
