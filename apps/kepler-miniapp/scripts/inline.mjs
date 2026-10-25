// Folds the built scripts and styles into dist/index.html so the page is a single file with no
// requests to make. A WebView can then open it from disk with nothing else beside it.
import { readFileSync, writeFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const dist = new URL("../dist/", import.meta.url).pathname;
let html = readFileSync(join(dist, "index.html"), "utf8");

const read = (href) => readFileSync(join(dist, href.replace(/^\//, "")), "utf8");

// A closing tag inside the code would end the element early.
const inertScript = (code) => code.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
const inertStyle = (css) => css.replace(/<\/style/gi, "<\\/style");

// One pass over the original html: the inlined code is never searched again, which matters
// because it contains html of its own (Kepler builds a <link> to a font stylesheet in a string).
html = html.replace(
  /<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>|<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g,
  (_, src, href) =>
    // Replacement functions, not strings: the code is full of `$&` and `$1`.
    src === undefined
      ? `<style>${inertStyle(read(href))}</style>`
      : `<script type="module">${inertScript(read(src))}</script>`,
);

if (
  /<(script|link)\b[^>]*\b(src|href)="\/assets\//.test(
    html.replaceAll(/<script type="module">[\s\S]*?<\/script>|<style>[\s\S]*?<\/style>/g, ""),
  )
) {
  throw new Error("dist/index.html still refers to a separate asset");
}

writeFileSync(join(dist, "index.html"), html);
for (const entry of readdirSync(dist)) {
  if (entry !== "index.html") rmSync(join(dist, entry), { recursive: true, force: true });
}
console.log(`dist/index.html: ${(html.length / 1024 / 1024).toFixed(1)} MB`);
