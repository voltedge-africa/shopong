// The name and rules note of a community (story 8.1). The event is `community.named` (registry.ts): the creator writes
// it on creation, and a treasurer whose role stands may write a later one, which replaces the name. This file holds the
// plain sentences a person sees for a refused name or rules note, and the one check that decides it before it is sent.

import {
  COMMUNITY_NAME_MAX,
  COMMUNITY_RULES_MAX,
  PAYLOAD_VALIDATORS,
  PERSONAL_DATA_MESSAGE,
  checkPersonalFields,
} from "@shopong/events";

export const NAMING_TYPE = "community.named" as const;

export const EMPTY_NAME_MESSAGE = "Give your community a name.";

/** Each refusal of a name or rules note is one plain sentence (story 8.1). */
export const NAMING_MESSAGES = {
  unreadable: "This name can't be read.",
  not_permitted: "Only the creator or a co-treasurer can name the community.",
  name_too_long: `Give your community a name of ${COMMUNITY_NAME_MAX} characters or fewer.`,
  name_plain: "The name must be plain words on one line, not an address.",
  rules_too_long: `Keep the rules to ${COMMUNITY_RULES_MAX} characters or fewer.`,
  rules_plain: "The rules must be plain text on one line.",
} as const;

/**
 * Why this name and rules note cannot be written, or `undefined` when they can. Checked on the phone before anything is
 * registered, so a refused name leaves nothing half made. `apply` checks the same event again.
 */
export function namingProblem(name: string, rules: string): string | undefined {
  if (name.trim() === "") return EMPTY_NAME_MESSAGE;
  const payload = { name: name.trim(), rules: rules.trim() };
  if (checkPersonalFields(payload).length > 0) return PERSONAL_DATA_MESSAGE;
  const issue = PAYLOAD_VALIDATORS[NAMING_TYPE](payload)[0];
  if (issue === undefined) return undefined;
  if (issue.path === "$.payload.name") {
    return payload.name.length > COMMUNITY_NAME_MAX
      ? NAMING_MESSAGES.name_too_long
      : NAMING_MESSAGES.name_plain;
  }
  if (issue.path === "$.payload.rules") {
    return payload.rules.length > COMMUNITY_RULES_MAX
      ? NAMING_MESSAGES.rules_too_long
      : NAMING_MESSAGES.rules_plain;
  }
  return NAMING_MESSAGES.unreadable;
}
