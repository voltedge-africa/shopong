export type ColorScheme = "light" | "dark";

export type Theme = {
  background: string;
  text: string;
  mutedText: string;
  primary: string;
  primaryText: string;
  disabledBackground: string;
  disabledText: string;
};

const themes: Record<ColorScheme, Theme> = {
  light: {
    background: "#ffffff",
    text: "#111827",
    mutedText: "#4b5563",
    primary: "#0f766e",
    primaryText: "#ffffff",
    disabledBackground: "#e5e7eb",
    disabledText: "#4b5563",
  },
  dark: {
    background: "#0b1220",
    text: "#f9fafb",
    mutedText: "#9ca3af",
    primary: "#2dd4bf",
    primaryText: "#042f2e",
    disabledBackground: "#1f2937",
    disabledText: "#9ca3af",
  },
};

/** Unknown or unset system schemes fall back to light. */
export function themeFor(scheme: string | null | undefined): Theme {
  return scheme === "dark" ? themes.dark : themes.light;
}
