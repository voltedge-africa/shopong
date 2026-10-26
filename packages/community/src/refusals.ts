// The phone's local log of refusals (story 2.5): the last 20 things this phone refused or was refused,
// newest first, shown on the community card. It is kept on the device only; nothing is written to the
// shared record, so a refused event cannot make the record grow (S-2.3-22).

import type { EpochMs } from "@shopong/ports";

export const REFUSAL_LOG_LIMIT = 20;

export interface Refusal {
  /** The device clock when it was refused. */
  readonly at: EpochMs;
  /** What was being done, in a few words, for example "Check an invitation". */
  readonly action: string;
  /** The plain sentence the person was shown. */
  readonly reason: string;
}

/** The log with `refusal` added first, and only the newest `REFUSAL_LOG_LIMIT` kept. */
export function addRefusal(log: readonly Refusal[], refusal: Refusal): readonly Refusal[] {
  return [refusal, ...log].slice(0, REFUSAL_LOG_LIMIT);
}
