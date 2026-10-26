// The coarsening rule for a member's area (story 7.3, AGENTS rule 6): a suburb or a town, never a street, a number or an
// erf. The phone applies it before anything leaves the device, and the `member.area` shape applies it again, so the
// record can never hold a finer area than this.

/** The one plain sentence a refused member's area is shown with. */
export const COARSE_AREA_MESSAGE = "Give the suburb or town only, with no street, number or erf.";

/** A street word, as a whole word. Suburb names that happen to contain one are refused too: the rule is simple on purpose. */
const STREET_WORD =
  /\b(?:street|st|road|rd|avenue|ave|drive|dr|lane|ln|crescent|cres|close|way|court|ct|boulevard|blvd|highway|erf|stand|unit|flat|house|plot)\b/i;

/** Any digit, in any script: a number in an area makes it finer than a suburb. */
const ANY_DIGIT = /\p{Nd}/u;

/**
 * The member's area as the record may hold it: trimmed, single-spaced, at most 60 characters, with no digit, no control
 * character and no street word. Returns the tidied name, or the plain reason it is refused.
 */
export function coarseArea(
  text: string,
): { readonly ok: true; readonly area: string } | { readonly ok: false; readonly reason: string } {
  const area = text.replace(/\s+/g, " ").trim();
  let control = false;
  for (let i = 0; i < area.length; i++) if (area.charCodeAt(i) < 0x20) control = true;
  if (area === "" || area.length > 60 || control) {
    return { ok: false, reason: "Give the name of your suburb or town, up to 60 characters." };
  }
  if (ANY_DIGIT.test(area) || STREET_WORD.test(area)) {
    return { ok: false, reason: COARSE_AREA_MESSAGE };
  }
  return { ok: true, area };
}
