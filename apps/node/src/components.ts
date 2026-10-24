// The four components the OCN Node can run. They are configurable on or off;
// until their real adapters exist (stories 1.2 onward) each is an in-memory or
// no-op stub that only answers "am I healthy?".

export const COMPONENT_NAMES = ["record", "ledger", "payments", "queue"] as const;
export type ComponentName = (typeof COMPONENT_NAMES)[number];

/** `ok` runs; `disabled` is switched off; `not-configured` is on but lacks a required secret; `error` failed its check. */
export type ComponentStatus = "ok" | "disabled" | "not-configured" | "error";

export interface ComponentHealth {
  status: ComponentStatus;
  /** Which implementation answers, for example `in-memory`. Never holds configuration values. */
  mode?: string;
}

export interface NodeComponent {
  readonly name: ComponentName;
  check(): Promise<ComponentHealth>;
}

export interface ComponentState {
  enabled: boolean;
  /** Whether every required secret of this component was resolved at start. */
  secretsPresent: boolean;
}

/** An in-memory/no-op stub standing in for a component's real adapter. */
export function createStubComponent(name: ComponentName, state: ComponentState): NodeComponent {
  return {
    name,
    async check() {
      if (!state.enabled) return { status: "disabled" };
      if (!state.secretsPresent) return { status: "not-configured" };
      return { status: "ok", mode: "in-memory" };
    },
  };
}
