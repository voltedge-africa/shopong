// The Pay card's words (story 4.3): a pure mapping from what the Node says about a member's pledge to what the person
// reads and which buttons they may press. Nothing here reads a redirect parameter or a bank page address: the status
// comes only from the Node's record and payments answer, so "Paid" is never shown from a return link. Every answer the
// phone cannot read has a card of its own, so a state is never a dead end or a spinner (review items 5, 6 and 9).
import { randText } from "./form";

/** The Node's status of the request for a pledge, or `none` when the Node has made no request yet. */
export type NodePayment = "none" | "pending" | "completed" | "cancelled" | "expired" | "failed";

/**
 * What the phone can say about the Node's status: a Node status, or why the status could not be had. `unreachable` is a
 * network failure; `clock` a clock that is too far off; `not_reached` a pledge the Node does not hold yet; `busy` a Node
 * that asks to be tried later; `unreadable` any other refusal.
 */
export type PaymentStatus =
  | NodePayment
  | "unreachable"
  | "clock"
  | "not_reached"
  | "busy"
  | "unreadable";

/** What the phone knows about one order for this member. */
export interface PaymentView {
  /** Whether this phone is in a community on the OCN Node, so a pledge can reach it. */
  readonly onNode: boolean;
  /** The member's pledge for this order as the Node's record holds it, in cents. */
  readonly pledgedMinor?: number;
  /** A pledge this phone made that the Node has not yet confirmed. */
  readonly queued: boolean;
  /** The Node's status of the request for the pledge, when there is a pledge on the Node. */
  readonly status?: PaymentStatus;
  /**
   * Whether this pledge can still be paid, on the Node's clock: its request is pending, or none exists and its window is
   * open. `false` with no pending request means the member must make a new pledge to pay (review item 5).
   */
  readonly windowOpen?: boolean;
}

export type PayAction = "pledge" | "pay" | "check" | "pay_again" | "try_again";

export interface PayCard {
  readonly heading: string;
  readonly body: readonly string[];
  /** The amount on the pledge, as words, when there is one. */
  readonly amountText?: string;
  readonly actions: readonly PayAction[];
}

/** Said on every card that talks about a payment. */
export const SIMULATED_NOTE = "Test payment (simulated): no money moves.";

/** The label of each button. `pay` and `pay_again` name the amount. */
export function actionLabel(action: PayAction, amountText: string | undefined): string {
  switch (action) {
    case "pledge":
      return "Make pledge";
    case "pay":
      return amountText === undefined ? "Pay" : `Pay ${amountText}`;
    case "check":
      return "Check again";
    case "pay_again":
      return "Pay again";
    case "try_again":
      return "Try again";
    default:
      return "Check again";
  }
}

export function payCardOf(view: PaymentView): PayCard {
  if (!view.onNode) {
    return {
      heading: "Pay is not set up here",
      body: ["Make or join a community on the OCN Node first, in Settings."],
      actions: [],
    };
  }
  const amountText = view.pledgedMinor === undefined ? undefined : randText(view.pledgedMinor);
  if (view.pledgedMinor === undefined) {
    if (view.queued) {
      return {
        heading: "Pledge saved on this phone",
        body: ["It reaches the OCN Node when this phone is online.", SIMULATED_NOTE],
        actions: ["check"],
      };
    }
    return {
      heading: "No pledge yet",
      body: ["Type how much you will pay for this order, then make your pledge.", SIMULATED_NOTE],
      actions: ["pledge"],
    };
  }
  const pledged = `Your pledge of ${amountText} is still open.`;
  const status = view.status ?? "none";
  if (status === "none" && view.windowOpen === false) {
    return {
      heading: "Your pledge's time to pay has run out",
      body: ["Make a new pledge to pay again.", SIMULATED_NOTE],
      amountText,
      actions: ["pay_again"],
    };
  }
  switch (status) {
    case "none":
      // The member's own word for an unpaid share (the pool shows the same member as Waiting; see POOL_STATUS_LABELS).
      return {
        heading: "Not paid yet",
        body: [pledged, "Tap Pay to pay it by bank.", SIMULATED_NOTE],
        amountText,
        actions: ["pay"],
      };
    case "pending":
      return {
        heading: "Waiting for confirmation",
        body: ["We will show it as done when the bank confirms it.", SIMULATED_NOTE],
        amountText,
        actions: ["check"],
      };
    case "completed":
      return {
        heading: "Test payment received (simulated)",
        body: ["No money moved. This was a simulated bank."],
        amountText,
        actions: [],
      };
    case "cancelled":
      return {
        heading: "Not paid yet, pledge still open",
        body: [pledged, SIMULATED_NOTE],
        amountText,
        actions: ["check", "pay_again"],
      };
    case "expired":
      return {
        heading: "Not paid. The request ran out.",
        body: [SIMULATED_NOTE],
        amountText,
        actions: ["pay_again"],
      };
    case "failed":
      return {
        heading: "Not paid. The payment did not go through.",
        body: [SIMULATED_NOTE],
        amountText,
        actions: ["pay_again"],
      };
    case "unreachable":
      return {
        heading: "Could not reach your community's Node",
        body: ["Try Pay again when you are online."],
        amountText,
        actions: ["try_again"],
      };
    case "clock":
      return {
        heading: "Check your phone's clock",
        body: [
          "Its time is too far from the OCN Node's. Set the date and time to automatic, then check again.",
        ],
        amountText,
        actions: ["check"],
      };
    case "not_reached":
      return {
        heading: "Your pledge has not reached the Node yet",
        body: ["It reaches the OCN Node when this phone is online.", SIMULATED_NOTE],
        amountText,
        actions: ["check"],
      };
    case "busy":
      return {
        heading: "The Node is busy",
        body: ["Try again in a moment."],
        amountText,
        actions: ["check"],
      };
    default:
      // Any other answer, including one this phone does not know yet: say so, and let the person ask again.
      return {
        heading: "We could not read this payment's status. Try again.",
        body: [SIMULATED_NOTE],
        amountText,
        actions: ["check"],
      };
  }
}

/**
 * Runs one task at a time: a call made while one is still running is ignored, and the guard is set the moment the
 * call starts, so two taps before the first reply open one bank tab (review item 12). Create one per screen.
 */
export function createSingleFlight() {
  let running = false;
  return {
    /** Runs `task` unless one is already running. Resolves `undefined` when it was ignored. */
    async run<T>(task: () => Promise<T>): Promise<T | undefined> {
      if (running) return undefined;
      running = true;
      try {
        return await task();
      } finally {
        running = false;
      }
    },
    /** Whether a task is running right now. */
    busy(): boolean {
      return running;
    },
  };
}
