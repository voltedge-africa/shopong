import { useMemo } from "react";
import { useCSSVariable } from "uniwind";

import { buildMiniAppDocument, type MiniAppSource } from "../lib/webui/document";
import { THEME_VARIABLES } from "../lib/webui/kit";

/** The mini app as one HTML document, styled with the current PanelUI theme. */
export function useMiniAppDocument(source: MiniAppSource) {
  const values = useCSSVariable([...THEME_VARIABLES]);
  const tokens = Object.fromEntries(
    THEME_VARIABLES.map((name, index) => {
      const value = values[index];
      return [name, value === undefined ? undefined : String(value)];
    }),
  );
  const key = THEME_VARIABLES.map((name) => tokens[name] ?? "").join("|");

  // `tokens` is rebuilt every render; `key` changes only when the theme does.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const html = useMemo(() => buildMiniAppDocument(tokens, source), [key, source]);
  return { html, background: tokens["--color-background"] };
}
