// An invitation is a `member/join` capability the creator signs for one named person. It is checked
// with `CapabilityAuth.verify` against the creator's DID and an explicit time: no network.

import {
  err,
  isDid,
  ok,
  type CapabilityAuth,
  type CapabilityToken,
  type Did,
  type EpochMs,
  type PortError,
  type Result,
  type VerifyErrorCode,
} from "@shopong/ports";
import { invitePassOnAllowed } from "./chain.js";
import { isCommunityKey, spaceUri } from "./space.js";

export const DAY_MS = 24 * 60 * 60 * 1000;
/** Every invitation lasts 7 days (decision 4; shortcut S-2.3-5). */
export const INVITATION_DAYS = 7;
export const JOIN_ABILITY = "member/join";

/** Why an invitation was refused. Each has one plain sentence in `INVITATION_MESSAGES`. */
export type InvitationProblem =
  | "no_identity"
  | "expired"
  | "already_used"
  | "someone_else"
  | "unreadable"
  | "bad_invitee";

export const INVITATION_MESSAGES: { readonly [P in InvitationProblem]: string } = {
  no_identity: "Make your identity first.",
  expired: "This invitation has expired.",
  already_used: "This invitation was already used.",
  someone_else: "This invitation is for someone else.",
  unreadable: "This invitation can't be checked.",
  bad_invitee: "That doesn't look like an identity.",
};

export type InvitationError = PortError<InvitationProblem>;

const fail = (problem: InvitationProblem) => err(problem, INVITATION_MESSAGES[problem]);

/** The problem a failed `verify` means to a person. */
export function problemOf(code: VerifyErrorCode): InvitationProblem {
  if (code === "expired") return "expired";
  if (code === "wrong_audience") return "someone_else";
  return "unreadable";
}

export interface Invitation {
  /** Token id (the UCAN CID): what `member.joined` carries so a second use is seen. */
  readonly id: string;
  readonly token: CapabilityToken;
  readonly invitee: Did;
  readonly expiresAt: EpochMs;
  /** `shopong://join?...` */
  readonly link: string;
  /** The same text as the link, to paste into the Join box (decision 2). */
  readonly code: string;
}

export interface IssueInvitationRequest {
  readonly auth: CapabilityAuth;
  /** The community's creator: the root of every invitation chain. */
  readonly creator: Did;
  readonly spaceKey: string;
  readonly invitee: string;
  /** The time the invitation starts, from the caller's clock. */
  readonly now: EpochMs;
  /**
   * A co-treasurer passing an invitation on: their own recorded `member/join` grant. The invitation
   * then lasts no longer than that grant, and starts when it did (story 2.4). Omit for the creator.
   */
  readonly via?: { readonly issuer: Did; readonly token: CapabilityToken };
}

export async function issueInvitation(
  request: IssueInvitationRequest,
): Promise<Result<Invitation, InvitationError>> {
  const { auth, creator, spaceKey, invitee, now, via } = request;
  if (!isDid(invitee) || !/^did:key:z[1-9A-HJ-NP-Za-km-z]+$/.test(invitee)) {
    return fail("bad_invitee");
  }
  if (!isCommunityKey(spaceKey)) return fail("unreadable");
  // UCAN times are whole seconds, so the end time is rounded down to one.
  let expiresAt = Math.floor((now + INVITATION_DAYS * DAY_MS) / 1000) * 1000;
  let notBefore: EpochMs | undefined;
  if (via !== undefined) {
    const parent = await auth.decode(via.token);
    if (!parent.ok || parent.value.audience !== via.issuer) return fail("unreadable");
    notBefore = parent.value.notBefore;
    expiresAt = Math.min(expiresAt, parent.value.expiresAt);
  }
  const issued = await auth.issue({
    issuer: via?.issuer ?? creator,
    audience: invitee,
    capabilities: [{ with: spaceUri(spaceKey), can: JOIN_ABILITY }],
    expiresAt,
    ...(via === undefined ? {} : { notBefore, proofs: [via.token] }),
  });
  if (!issued.ok) return fail("unreadable");
  const link = invitationLink({ spaceKey, creator, token: issued.value });
  return ok({
    id: await auth.tokenId(issued.value),
    token: issued.value,
    invitee,
    expiresAt,
    link,
    code: link,
  });
}

interface LinkParts {
  readonly spaceKey: string;
  readonly creator: string;
  readonly token: string;
}

export function invitationLink(parts: LinkParts): string {
  return (
    `shopong://join?space=${parts.spaceKey}` +
    `&creator=${encodeURIComponent(parts.creator)}` +
    `&invitation=${encodeURIComponent(parts.token)}`
  );
}

/** Reads the three parts out of pasted text. `undefined` when any is missing. */
export function parseInvitationText(text: string): LinkParts | undefined {
  const trimmed = text.trim();
  const query = trimmed.slice(trimmed.indexOf("?") + 1);
  if (!trimmed.includes("?") || query === "") return undefined;
  const fields = new Map<string, string>();
  for (const pair of query.split("&")) {
    const at = pair.indexOf("=");
    if (at < 0) continue;
    try {
      fields.set(pair.slice(0, at), decodeURIComponent(pair.slice(at + 1)));
    } catch {
      return undefined;
    }
  }
  const spaceKey = fields.get("space");
  const creator = fields.get("creator");
  const token = fields.get("invitation");
  if (spaceKey === undefined || creator === undefined || token === undefined) return undefined;
  return { spaceKey, creator, token };
}

export interface CheckedInvitation {
  readonly id: string;
  readonly token: CapabilityToken;
  readonly spaceKey: string;
  readonly creator: Did;
  readonly expiresAt: EpochMs;
}

export interface CheckInvitationRequest {
  readonly auth: CapabilityAuth;
  /** The pasted link or code. */
  readonly text: string;
  /** My DID, or `undefined` before I made an identity. */
  readonly me: Did | undefined;
  /** The device clock, passed in so the check is explicit and testable. */
  readonly now: EpochMs;
  /** Whether this invitation id is already in a `member.joined` in the record I hold. */
  readonly isUsed?: (invitationId: string) => boolean | Promise<boolean>;
  /**
   * Whether `inviter` may pass on an invitation whose parent is the grant `parentId` (a co-treasurer's
   * `member/join`). Absent means nobody may pass one on.
   */
  readonly mayPassOn?: (inviter: Did, parentId: string) => boolean | Promise<boolean>;
}

/** Checks an invitation on this phone with no network, and names the problem in plain words. */
export async function checkInvitation(
  request: CheckInvitationRequest,
): Promise<Result<CheckedInvitation, InvitationError>> {
  const { auth, text, me, now } = request;
  if (me === undefined) return fail("no_identity");
  const parts = parseInvitationText(text);
  if (parts === undefined || !isCommunityKey(parts.spaceKey) || !isDid(parts.creator)) {
    return fail("unreadable");
  }
  const token = parts.token as CapabilityToken;
  const verified = await auth.verify(token, {
    required: { with: spaceUri(parts.spaceKey), can: JOIN_ABILITY },
    rootIssuer: parts.creator,
    logTime: now,
    audience: me,
  });
  if (!verified.ok) return fail(problemOf(verified.error.code));
  const passOn = await invitePassOnAllowed(
    auth,
    verified.value.chain,
    request.mayPassOn ?? (() => false),
  );
  if (!passOn) return fail("unreadable");
  const decoded = await auth.decode(token);
  if (!decoded.ok) return fail("unreadable");
  const id = await auth.tokenId(token);
  if ((await request.isUsed?.(id)) === true) return fail("already_used");
  return ok({
    id,
    token,
    spaceKey: parts.spaceKey,
    creator: parts.creator,
    expiresAt: decoded.value.expiresAt,
  });
}
