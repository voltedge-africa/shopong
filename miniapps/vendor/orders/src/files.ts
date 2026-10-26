// The words a person sees for a file on an order (story 3.7). Pure, so the screen and the tests use one set. The host
// (apps/shopong) gives the state of each file and the check; this package never reads bytes or the network.

export type FilePurpose = "price-list" | "delivery-photo";
/** `sending`: the bytes are on their way to the Node. `saved`: the Node has them and the record names them. */
export type FileListState = "sending" | "saved" | "waiting" | "refused";
/** `verified`: the bytes hash to the recorded SHA-512. `unavailable`: the check could not be made now. */
export type FileCheck = "verified" | "does_not_match" | "cannot_check" | "unavailable";

export interface FileRowView {
  readonly hash: string;
  readonly name: string;
  readonly type: string;
  readonly size: number;
  readonly purpose: FilePurpose;
  readonly supplier?: string;
  readonly state: FileListState;
  /** The plain reason the Node gave, when `state` is `refused`. */
  readonly reason?: string;
}

const kindOf = (purpose: FilePurpose) => (purpose === "price-list" ? "Price list" : "Photo");

/** "Sending photo", "Photo saved", "Waiting to send", or the Node's plain reason for a refusal. */
export function stateWords(file: FileRowView): string {
  switch (file.state) {
    case "sending":
      return `Sending ${kindOf(file.purpose).toLowerCase()}`;
    case "saved":
      return `${kindOf(file.purpose)} saved`;
    case "waiting":
      return "Waiting to send";
    case "refused":
      return file.reason ?? "The OCN Node did not accept it.";
  }
}

/** "verified", "Photo does not match, kept and flagged", or the words for a check that could not be made. */
export function checkWords(purpose: FilePurpose, check: FileCheck | undefined): string {
  switch (check) {
    case undefined:
      return "Checking…";
    case "verified":
      return "verified";
    case "does_not_match":
      return `${kindOf(purpose)} does not match, kept and flagged`;
    case "cannot_check":
      return "can't be checked";
    case "unavailable":
      return "Couldn't check it now. Try again.";
  }
}

/** A short line for a person choosing a file: the purpose and its limit. */
export const PURPOSE_HELP: { readonly [P in FilePurpose]: string } = {
  "price-list": "A PDF, JPEG or PNG up to 10 MB.",
  "delivery-photo": "A JPEG, PNG or WebP photo up to 5 MB.",
};

/** The plain sentence when an attach fails for any reason the app could not name. Never a raw error message. */
export const READ_FAILED = "We could not read that file. Try another photo.";

/**
 * Runs an attach and turns any rejection into the plain sentence, so the panel always shows something (review patch 2:
 * on web an attach rejected silently). A refusal or a start is passed through unchanged.
 */
export async function attachOrReason(
  attach: (order: string, purpose: FilePurpose, supplier: string) => Promise<string | undefined>,
  order: string,
  purpose: FilePurpose,
  supplier: string,
): Promise<string | undefined> {
  try {
    return await attach(order, purpose, supplier);
  } catch {
    return READ_FAILED;
  }
}
