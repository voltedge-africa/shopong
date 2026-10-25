import { Effect, Schedule, Stream } from "effect";
import type { ThinkingOrbState } from "panelui-native";

export const STEPS = [
  { state: "working", label: "Working…" },
  { state: "searching", label: "Searching…" },
  { state: "solving", label: "Solving…" },
  { state: "listening", label: "Listening…" },
  { state: "shaping", label: "Shaping…" },
] as const satisfies readonly { state: ThinkingOrbState; label: string }[];

export const STEP_MS = 2500;

/**
 * Reports step 0 immediately, then the next step every STEP_MS, wrapping around forever.
 * Interrupt the fiber to stop it.
 */
export const cycleSteps = (onStep: (index: number) => void) =>
  Effect.sync(() => onStep(0)).pipe(
    // The first tick arrives after one interval and counts from 0, so it reports step 1.
    Effect.andThen(
      Stream.fromSchedule(Schedule.spaced(STEP_MS)).pipe(
        Stream.runForEach((tick) => Effect.sync(() => onStep((tick + 1) % STEPS.length))),
      ),
    ),
  );
