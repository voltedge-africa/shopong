import { KIT_CSS } from "./kit";

/** What a mini app is made of. It runs inside a WebView with no network and no access to the app. */
export type MiniAppSource = { html: string; css?: string; js?: string };

/** Theme variable name (`--color-background`) to its current value. */
export type ThemeTokens = Readonly<Record<string, string | undefined>>;

// Mini-app code is untrusted. This policy lets it style and script itself and nothing else:
// no network requests, no forms, no frames, no external images, fonts or scripts.
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  "script-src 'unsafe-inline'",
  "img-src data:",
  "font-src data:",
  "form-action 'none'",
  "base-uri 'none'",
].join("; ");

// Theme values are colours such as `#262626` or `rgba(0, 0, 0, 0.08)`. Anything else is dropped
// rather than written into a stylesheet.
const SAFE_TOKEN_VALUE = /^[#\w\s.,()%/-]+$/;

const tokensCss = (tokens: ThemeTokens) => {
  const declarations = Object.entries(tokens)
    .filter(
      (entry): entry is [string, string] =>
        entry[0].startsWith("--") && entry[1] !== undefined && SAFE_TOKEN_VALUE.test(entry[1]),
    )
    .map(([name, value]) => `${name}:${value}`);
  return `:root{${declarations.join(";")}}`;
};

const inertStyle = (css: string) => css.replace(/<\/style/gi, "<\\/style");
const inertScript = (js: string) =>
  js.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");

export function buildMiniAppDocument(tokens: ThemeTokens, source: MiniAppSource): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}">
<style>${tokensCss(tokens)}</style>
<style>${inertStyle(KIT_CSS)}</style>
<style>${inertStyle(source.css ?? "")}</style>
</head>
<body>
${source.html}
<script>${inertScript(source.js ?? "")}</script>
</body>
</html>`;
}

export const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
