import type { BuildScreen } from "./builder";

/** The most pictures an app can show. */
export const MAX_SCREENSHOTS = 6;

/** One thing in an app's row of screenshots: a picture someone added, or one of the app's own screens. */
export type Shot = { kind: "image"; uri: string } | { kind: "screen"; screen: BuildScreen };

/**
 * What an app's row of screenshots shows: the pictures its author added, or, when there are none, the
 * app's own screens. An app with neither has no row.
 */
export function shotsFor(
  images: readonly string[] = [],
  screens: readonly BuildScreen[] = [],
): readonly Shot[] {
  if (images.length > 0) return images.map((uri) => ({ kind: "image", uri }));
  return screens.map((screen) => ({ kind: "screen", screen }));
}

/** The pictures after adding `picked`: new ones go last, repeats are left out and only `max` are kept. */
export function addImages(
  current: readonly string[],
  picked: readonly string[],
  max = MAX_SCREENSHOTS,
): readonly string[] {
  const added = picked.filter(
    (uri, index) => !current.includes(uri) && picked.indexOf(uri) === index,
  );
  return [...current, ...added].slice(0, max);
}

export const removeImage = (current: readonly string[], uri: string): readonly string[] =>
  current.filter((item) => item !== uri);
