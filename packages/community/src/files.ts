// Who may attach a file (story 3.7). A file is kept by the Node before its event is sent, and the event that names it
// is checked again by `apply`, so both use the same rule here. The role is the one the file's carrying event needs:
// a price list rides with the treasurer's quote (`quote.added`, the creator or a co-treasurer); a delivery photo rides
// with a delivery confirmation (`delivery/confirm`, a driver). Judged at log time, as every role check is (story 3.6).

import {
  fileAttachedIssues,
  type AttachmentPurpose,
  type FileAttachedPayload,
} from "@shopong/events";
import type { EpochMs, ViewReader } from "@shopong/ports";
import { isTreasurer } from "./quotes.js";
import { checkAction, type StandingContext } from "./roles.js";

/** The plain sentences a person sees when a file is refused for who sent it or what it is. */
export const FILE_ROLE_MESSAGES = {
  price_list: "Only the treasurer can attach a price list.",
  delivery_photo: "Only a driver can attach a delivery photo.",
  unreadable: "This file can't be recorded: its details are not in the form the record expects.",
} as const;

/** Whether `who` may attach a file of `purpose` at log time `at`. Undefined when they may; else the plain reason. */
export async function fileUploadProblem(
  standing: StandingContext,
  view: ViewReader,
  who: string,
  purpose: AttachmentPurpose,
  at: EpochMs,
): Promise<string | undefined> {
  if (purpose === "price-list") {
    return (await isTreasurer(standing, view, who, at)) ? undefined : FILE_ROLE_MESSAGES.price_list;
  }
  const checked = await checkAction(
    { auth: standing.auth, view, creator: standing.creator, spaceKey: standing.spaceKey },
    who,
    { ability: "delivery/confirm" },
    at,
  );
  return checked.ok ? undefined : FILE_ROLE_MESSAGES.delivery_photo;
}

/** The view key of a file's record, under its order (both parts encoded, so no name can clash). */
export const fileOfOrderKey = (order: string, hash: string) =>
  `files-of/${encodeURIComponent(order.trim().replace(/\s+/g, " "))}/${hash}`;

/** The files recorded for one order, as the view holds them. */
export async function filesOf(
  view: ViewReader,
  order: string,
): Promise<readonly FileAttachedPayload[]> {
  const prefix = `files-of/${encodeURIComponent(order.trim().replace(/\s+/g, " "))}/`;
  const out: FileAttachedPayload[] = [];
  for (const entry of await view.list(prefix)) {
    const value = entry.value as unknown;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      out.push(value as unknown as FileAttachedPayload);
    }
  }
  return out;
}

/** The shape check `apply` and the Node use for a `file.attached` payload. Undefined when it is in the right form. */
export function fileShapeProblem(payload: Record<string, unknown>): string | undefined {
  return fileAttachedIssues(payload).length === 0 ? undefined : FILE_ROLE_MESSAGES.unreadable;
}
