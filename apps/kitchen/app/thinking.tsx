import { Effect, Fiber } from "effect";
import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { Shimmer, ThinkingOrb } from "panelui-native";

import { cycleSteps, STEPS } from "../lib/thinkingSteps";

export default function Thinking() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const fiber = Effect.runFork(cycleSteps(setIndex));
    return () => {
      Effect.runFork(Fiber.interrupt(fiber));
    };
  }, []);

  const step = STEPS[index]!;

  return (
    <View className="flex-1 items-center justify-center gap-8 bg-background p-6">
      <Stack.Screen options={{ title: "New add-on" }} />
      <ThinkingOrb state={step.state} size={140} />
      <Shimmer textClassName="text-xl font-semibold">{step.label}</Shimmer>
    </View>
  );
}
