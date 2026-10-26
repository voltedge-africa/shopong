// What the Timeline screen needs from the app's community: this phone's own payments, and the timeline of one of them.
// The app provides it (apps/shopong), so this package never reaches into the app. The Node answers for the timeline and
// only the member who pledged may read it; the screen only shows what it is given.

import { createContext } from "react";
import type { Timeline } from "@shopong/community";

/** One of this member's payments, as this phone's copy of the record names it. */
export interface TimelinePayment {
  /** The pledge's event id: the payment's join key. */
  readonly pledgeId: string;
  readonly order: string;
  /** The pledge's amount in whole rand cents. */
  readonly minor: number;
}

/** The Node's answer for one payment's timeline, or the plain reason it could not give one. */
export type TimelineAnswer =
  | { readonly ok: true; readonly timeline: Timeline; readonly note?: string }
  | { readonly ok: false; readonly message: string };

export interface TimelineHost {
  /** This member's own payments, as this phone's copy of the record holds them. */
  payments(): Promise<readonly TimelinePayment[]>;
  /** The timeline of one of this member's payments, read from the Node. */
  timelineOf(pledgeId: string): Promise<TimelineAnswer>;
}

/** Absent (null) outside a community: the screen then says so. */
export const TimelineHostContext = createContext<TimelineHost | null>(null);
