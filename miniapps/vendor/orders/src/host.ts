// What the Orders screen needs from the app's community: whether this person is the treasurer, the
// quotes recorded for an order, and a way to record one. The app provides it (apps/shopong), so this
// package never reaches into the app.

import { createContext } from "react";
import type { Quote } from "@shopong/community";
import type { PaymentView } from "./pay";
import type { FileCheck, FilePurpose, FileRowView } from "./files";

/**
 * The member's own pledge and its bank payment for one order (story 4.3). The app does the network and the browser;
 * the screen shows only what these answer. Amounts are whole rand cents.
 */
export interface PaymentHost {
  /** What the Node's record and payments hold for this member and order, and what this phone has queued. */
  paymentOf(order: string): Promise<PaymentView>;
  /** Pledge `minor` cents to the order. Resolves with the plain reason it was refused, or `undefined` when queued. */
  pledge(order: string, minor: number): Promise<string | undefined>;
  /**
   * Asks the Node for this member's bank payment of their pledge, then opens the simulated bank page in an in-app
   * browser tab. Resolves with the plain reason it could not, or `undefined` once the tab has been closed.
   */
  pay(order: string): Promise<string | undefined>;
}

/**
 * Files on an order (story 3.7): a price list or a delivery photo. The app picks the file, strips its metadata, keeps
 * the bytes on the Node before the record names them, and checks them when they are shown. The screen only shows.
 */
export interface AttachmentHost {
  /** Whether this person may attach a price list (the treasurer) and a delivery photo (a driver). */
  readonly canAttachPriceList: boolean;
  readonly canAttachPhoto: boolean;
  /** The files for one order: this phone's own, and those the record holds. */
  filesFor(order: string): readonly FileRowView[];
  /** Picks a file and attaches it. Resolves with the plain reason it was refused, or `undefined` when it was started. */
  attach(order: string, purpose: FilePurpose, supplier: string): Promise<string | undefined>;
  /** Checks a recorded file's bytes against its hash. */
  check(hash: string): Promise<FileCheck>;
  /** Sends the files still waiting, for example after the phone is back online. */
  retry(): Promise<void>;
}

/** One member's share of an order, as the record holds it. */
export interface ShareView {
  readonly member: string;
  readonly collected: boolean;
}

/**
 * What the record holds for an order's delivery (story 7.6): whether it arrived, the planned driver, the arrival, each
 * share, and the disputes. Read from the phone's copy of the record, so it can be behind the Node.
 */
export interface ProofView {
  readonly arrived: boolean;
  readonly plannedDriver?: string;
  readonly delivered?: {
    readonly event: string;
    readonly driver: string;
    readonly photoSha512: string;
    readonly claimedAt: number;
  };
  readonly shares: readonly ShareView[];
  readonly disputes: readonly { readonly by: string; readonly note?: string }[];
}

/**
 * Proof of delivery and of collection (story 7.6). The app does the photo, the queue and the record; the screen only
 * shows what the record says and asks for the three things a person may do.
 */
export interface ProofHost {
  /** This phone's person, so the screen can tell its own share and its own driving from the others'. */
  readonly me: string;
  progressOf(order: string): Promise<ProofView>;
  /** The driver's arrival: picks a delivery photo, keeps it, and queues the confirmation. Resolves with a plain reason or undefined. */
  confirmArrival(order: string): Promise<string | undefined>;
  /** This member's own share of the delivery. Resolves with a plain reason or undefined when it is queued. */
  collect(order: string): Promise<string | undefined>;
  /** A dispute of the delivery, with the person's own short note. Resolves with a plain reason or undefined. */
  dispute(order: string, note: string): Promise<string | undefined>;
}

export interface OrdersHost {
  /** Whether this person is the treasurer, so may add a quote. */
  readonly canAdd: boolean;
  /** The quotes recorded for one order, as this phone's record holds them now. */
  quotesFor(order: string): Promise<readonly Quote[]>;
  /** Record a quote. Resolves with the plain reasons it was refused, or `undefined` when it was recorded. */
  addQuote(input: unknown): Promise<string | undefined>;
  /** The pay card's host. Absent in a build without a payments host. */
  readonly payments?: PaymentHost;
  /** The files host (story 3.7). Absent in a build without a file store. */
  readonly attachments?: AttachmentHost;
  /** The delivery proof host (story 7.6). Absent in a build without a Node session. */
  readonly proof?: ProofHost;
}

export const OrdersHostContext = createContext<OrdersHost | null>(null);
