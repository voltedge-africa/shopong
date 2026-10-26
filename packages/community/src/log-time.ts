// Log time (story 3.6): the time `apply` judges every role and invitation at, instead of the time an
// event claims. It is the highest `claimedAt` of the events already accepted, held in the view under
// `log/time`. It only ever rises, and one accepted event may raise it by at most `LOG_RISE_LIMIT_MS`: a claim
// further ahead than that moves log time by the cap, not to the claim (the clamp, review item 1).
// Nothing here reads a clock: every function is a pure function of the view or its arguments (AGENTS rule 3).

import type { EpochMs, ViewReader } from "@shopong/ports";

/** The view key that holds log time. */
export const LOG_TIME_KEY = "log/time";

/**
 * The most log time may rise for one accepted event: a day. Chosen, not measured (shortcut S-3.6-1). A claim
 * further ahead than this does not refuse the event: it is judged at the current log time and moves log time
 * by this much at most (the clamp, shortcut S-3.6-14). A refusal would freeze the record after a quiet gap.
 */
export const LOG_RISE_LIMIT_MS = 24 * 60 * 60 * 1000;

/** The plain sentence an event gets when its claimed time is not a safe, non-negative whole number of milliseconds. */
export const CLAIM_MESSAGE = "This event has no valid time.";

/** Whether a claimed time is a safe, non-negative whole number of milliseconds (the only kind `apply` accepts). */
export function isValidClaim(value: unknown): value is EpochMs {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Log time as the view holds it, or `undefined` before the first accepted event. */
export async function logTimeOf(view: ViewReader): Promise<EpochMs | undefined> {
  const value = await view.get(LOG_TIME_KEY);
  return typeof value === "number" ? value : undefined;
}

/**
 * Log time after an accepted event claiming `claimedAt`. The first accepted event sets it, uncapped (the
 * creator's founder join). After that it rises to the claim, but by at most the cap, and never moves back.
 */
export function advanceLogTime(logTime: EpochMs | undefined, claimedAt: EpochMs): EpochMs {
  if (logTime === undefined) return claimedAt;
  return Math.max(logTime, Math.min(claimedAt, logTime + LOG_RISE_LIMIT_MS));
}
