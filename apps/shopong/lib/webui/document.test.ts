import { describe, expect, it } from "vite-plus/test";

import type { MiniAppSource } from "@shopong/miniapp";

import { buildMiniAppDocument } from "./document";
import { KIT_CSS } from "./kit";

const build = (
  source: MiniAppSource = { html: "<p>hi</p>" },
  tokens: Record<string, string | undefined> = {},
) => buildMiniAppDocument(tokens, source);

describe("buildMiniAppDocument", () => {
  it("includes the mini app's html, css and js", () => {
    const doc = build({ html: "<p id=x>hello</p>", css: ".mine{color:red}", js: "window.ran=1" });
    expect(doc).toContain("<p id=x>hello</p>");
    expect(doc).toContain(".mine{color:red}");
    expect(doc).toContain("window.ran=1");
  });

  it("puts the kit before the mini app's css so the mini app can override it", () => {
    const doc = build({ html: "", css: ".mine{}" });
    expect(doc.indexOf(KIT_CSS.trim().slice(0, 20))).toBeLessThan(doc.indexOf(".mine{}"));
  });

  it("writes the PanelUI theme into :root", () => {
    const doc = build(undefined, {
      "--color-background": "#141414",
      "--color-border": "rgba(255, 255, 255, 0.06)",
    });
    expect(doc).toContain(
      ":root{--color-background:#141414;--color-border:rgba(255, 255, 255, 0.06)}",
    );
  });

  it("drops theme values that could escape the declaration", () => {
    const doc = build(undefined, {
      "--color-background": "red;} body{display:none",
      "--color-foreground": "#fafafa",
      "not-a-variable": "#000",
      "--color-card": undefined,
    });
    expect(doc).toContain(":root{--color-foreground:#fafafa}");
  });

  it("forbids network, forms and frames with a content security policy", () => {
    const doc = build();
    expect(doc).toContain("default-src 'none'");
    expect(doc).not.toMatch(/connect-src|frame-src|https?:\/\//);
    expect(doc).toContain("form-action 'none'");
  });

  it("cannot be broken out of by a closing script or style tag in the mini app's code", () => {
    const doc = build({ html: "", js: "var a='</script><img src=x>'", css: "a{}</style><b>" });
    expect(doc.match(/<\/script>/g)).toHaveLength(1);
    expect(doc.match(/<\/style>/g)).toHaveLength(3);
  });
});

describe("kit", () => {
  it("keeps the hidden attribute working on classes that set display", () => {
    expect(build().replace(/\s/g, "")).toContain("[hidden]{display:none!important}");
  });
});
