import type { UiDocument } from "@shopong/ports";

import { LIBRARY, SCREEN_LANGUAGE, validateScreen } from "./genui";
import { sha512Hex } from "./sha512";

/**
 * A screen, pinned. The builder writes the screen once, as OpenUI Lang text. From then on that exact
 * text is what is stored with the build, what the Screens tab shows, what the Publish preview shows and
 * what the published app shows. Drawing a screen reads this text and nothing else: no model is called
 * and nothing is fetched, ever.
 *
 * It is plain data (strings only), so it can be saved or replicated as it is:
 *
 *   { id, title, language: "openui-lang", library: { name, version }, source, hash }
 */
export type PinnedScreen = {
  readonly id: string;
  readonly title: string;
  readonly language: typeof SCREEN_LANGUAGE;
  /** The screen library the text was written for. It is drawn only by that exact version. */
  readonly library: { readonly name: string; readonly version: string };
  /** The OpenUI Lang text, as the builder wrote it. */
  readonly source: string;
  /** SHA-512 of the source, as 128 lowercase hex characters. Any edit to the text changes it. */
  readonly hash: string;
};

/** Pins the text a builder wrote for the current library. */
export function pinScreen(input: { id: string; title: string; source: string }): PinnedScreen {
  return {
    id: input.id,
    title: input.title,
    language: SCREEN_LANGUAGE,
    library: { name: LIBRARY.name, version: LIBRARY.version },
    source: input.source,
    hash: sha512Hex(input.source),
  };
}

export type PinProblem =
  | "language" // not OpenUI Lang
  | "library" // written for another library or version
  | "hash" // the text is not what was pinned
  | "invalid"; // the library does not allow something in it

export type LoadedScreen =
  | { ok: true; value: UiDocument }
  | { ok: false; error: { problem: PinProblem; message: string } };

const failed = (problem: PinProblem, message: string): LoadedScreen => ({
  ok: false,
  error: { problem, message },
});

/**
 * Checks a pinned screen without drawing it: its language, its library version, its hash and then every
 * part, prop and action in it. Pure: no model, no network. A screen that fails any check is not drawn.
 */
export async function loadPinnedScreen(screen: PinnedScreen): Promise<LoadedScreen> {
  if (screen.language !== SCREEN_LANGUAGE) return failed("language", "not OpenUI Lang");
  if (screen.library.name !== LIBRARY.name || screen.library.version !== LIBRARY.version)
    return failed("library", `written for ${screen.library.name} ${screen.library.version}`);
  if (screen.hash !== sha512Hex(screen.source)) return failed("hash", "the text was changed");
  const result = await validateScreen(screen.source);
  return result.ok ? result : failed("invalid", result.error.message);
}
