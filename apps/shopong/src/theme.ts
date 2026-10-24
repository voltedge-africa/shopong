export type ColorScheme = "light" | "dark";

export type Theme = {
  background: string;
  text: string;
  mutedText: string;
  primary: string;
  primaryText: string;
  disabledBackground: string;
  disabledText: string;
  surface: string;
  border: string;
  success: string;
  danger: string;
  track: string;
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
    surface: "#f3f4f6",
    border: "#d1d5db",
    success: "#047857",
    danger: "#b91c1c",
    track: "#d1d5db",
  },
  dark: {
    background: "#0b1220",
    text: "#f9fafb",
    mutedText: "#9ca3af",
    primary: "#2dd4bf",
    primaryText: "#042f2e",
    disabledBackground: "#1f2937",
    disabledText: "#9ca3af",
    surface: "#111a2e",
    border: "#374151",
    success: "#34d399",
    danger: "#f87171",
    track: "#374151",
  },
};

/** Unknown or unset system schemes fall back to light. */
export function themeFor(scheme: string | null | undefined): Theme {
  return scheme === "dark" ? themes.dark : themes.light;
}
