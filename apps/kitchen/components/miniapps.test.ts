import { describe, expect, it } from "vite-plus/test";

import { contentOf, miniApps } from "./miniapps";

describe("miniApps", () => {
  it("has unique ids that are safe to put in a route", () => {
    const ids = miniApps.map((app) => app.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it("gives an app without content a placeholder page that names it", () => {
    const stokvel = miniApps.find((app) => app.id === "stokvel")!;
    const content = contentOf(stokvel);
    expect(content.kind).toBe("web");
    expect(content.kind === "web" && content.source.html).toContain("Stokvel");
  });

  it("serves web and native content as declared", () => {
    const kind = (id: string) => contentOf(miniApps.find((app) => app.id === id)!).kind;
    expect(kind("shop")).toBe("web");
    expect(kind("insights")).toBe("native");
    expect(kind("chat")).toBe("native");
    expect(kind("delivery")).toBe("bundle");
  });
});
