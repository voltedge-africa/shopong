// The state machine behind the /demo screen. The screen only renders `getState()` and calls
// `next`, `runAll` and `reset`; this file holds everything that can go wrong, so it is tested
// without a renderer.

import type { Snapshot, StokvelScenario } from "@shopong/scenario-stokvel";

export interface DemoState {
  readonly status: "loading" | "ready" | "failed";
  readonly snapshot?: Snapshot;
  /** True while a step is running: the buttons are off, so a double tap cannot run two steps. */
  readonly busy: boolean;
  /** A sentence for screen readers (live region) after each action. */
  readonly announcement: string;
  readonly error?: string;
}

export interface DemoController {
  getState: () => DemoState;
  subscribe: (listener: () => void) => () => void;
  load: () => Promise<void>;
  next: () => Promise<void>;
  runAll: () => Promise<void>;
  reset: () => Promise<void>;
}

const message = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export function createDemoController(scenario: StokvelScenario): DemoController {
  let state: DemoState = { status: "loading", busy: true, announcement: "" };
  const listeners = new Set<() => void>();
  const set = (patch: Partial<DemoState>): void => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };

  async function act(work: () => Promise<string>): Promise<void> {
    if (state.busy) return;
    set({ busy: true });
    try {
      const announcement = await work();
      set({ status: "ready", busy: false, announcement, snapshot: await scenario.snapshot() });
    } catch (error) {
      set({ status: "failed", busy: false, error: message(error) });
    }
  }

  return {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load: async () => {
      set({ busy: false });
      await act(async () => "");
    },
    next: () =>
      act(async () => {
        const outcome = await scenario.step();
        if (outcome === undefined) return "All steps are done.";
        return `Step ${String(outcome.step)} done: ${outcome.title}. ${String(outcome.entries.length)} new ${outcome.entries.length === 1 ? "entry" : "entries"} in the timeline.`;
      }),
    runAll: () =>
      act(async () => {
        await scenario.runAll();
        return `All ${String(scenario.stepCount)} steps done.`;
      }),
    reset: () =>
      act(async () => {
        await scenario.reset();
        return "Started again from the beginning.";
      }),
  };
}
