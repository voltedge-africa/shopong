import { Effect, Fiber } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { cycleSteps, STEP_MS, STEPS } from "./thinkingSteps";

describe("cycleSteps", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("starts at the first step, advances every STEP_MS and wraps around", async () => {
    const seen: number[] = [];
    const fiber = Effect.runFork(cycleSteps((index) => seen.push(index)));

    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([0]);

    await vi.advanceTimersByTimeAsync(STEP_MS * STEPS.length);
    expect(seen).toEqual([0, 1, 2, 3, 4, 0]);

    await Effect.runPromise(Fiber.interrupt(fiber));
  });

  it("stops reporting once the fiber is interrupted", async () => {
    const seen: number[] = [];
    const fiber = Effect.runFork(cycleSteps((index) => seen.push(index)));
    await vi.advanceTimersByTimeAsync(STEP_MS);
    await Effect.runPromise(Fiber.interrupt(fiber));

    const count = seen.length;
    await vi.advanceTimersByTimeAsync(STEP_MS * 3);
    expect(seen).toHaveLength(count);
  });
});
