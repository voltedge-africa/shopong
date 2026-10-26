// A member's area (story 7.3): the suburb or town a member is in, recorded as `member.area` and kept at
// `areas/<did>` { area }. The phone coarsens the name first (`coarseArea` in @shopong/events), and `apply` refuses
// a member who is not a member now. Nothing finer than a suburb or town is kept (AGENTS rule 6).

/** Why a member's area is refused by `apply`. Each is one plain sentence, as the record shows it. */
export const MEMBER_AREA_MESSAGES = {
  unreadable: "This area can't be read.",
  not_a_member: "Only a member of this community can give an area.",
} as const;

/** The view key of a member's area. */
export const memberAreaKey = (member: string) => `areas/${member}`;
