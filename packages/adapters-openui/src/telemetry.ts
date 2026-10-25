// OpenUI's core package can send usage telemetry to PostHog. That is opt-in at run time
// (OPENUI_RUNTIME_TELEMETRY_ENABLED) and it also honours OPENUI_TELEMETRY_DISABLED and DO_NOT_TRACK.
// Shopong promises that nothing phones home (AGENTS.md rules 4 and 6), so this adapter switches it
// off for good the moment it is loaded, whatever the environment says. The code that checks the flag
// lives in `@openuidev/lang-core` (`createParser`, `generateSystemPrompt`); the adapter checks screens
// with `createStreamingParser`, which never reports anything, and the app never builds a prompt.

type EnvHolder = { process?: { env?: Record<string, string | undefined> } };

/** Set the OpenUI opt-out flag in this process. Safe to call anywhere; a no-op without `process.env`. */
export function disableOpenUiTelemetry(): void {
  const env = (globalThis as EnvHolder).process?.env;
  if (env === undefined || env === null) return;
  try {
    env["OPENUI_TELEMETRY_DISABLED"] = "1";
  } catch {
    // A frozen environment cannot be written to; there is nothing to opt out of there either.
  }
}

disableOpenUiTelemetry();
