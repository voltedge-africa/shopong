import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";

const dir = fileURLToPath(new URL(".", import.meta.url));
const truth = JSON.parse(readFileSync(join(dir, "ground-truth.json"), "utf8")) as Record<
  string,
  { kind: string; rows: Array<Record<string, unknown>> }
>;
const documents = readdirSync(dir).filter((f) => /\.(pdf|png)$/.test(f));

describe("sample documents", () => {
  it("has every required kind: 3 price lists, 2 invoices, 2 delivery notes", () => {
    const count = (kind: string) => Object.values(truth).filter((t) => t.kind === kind).length;
    expect(count("price list")).toBeGreaterThanOrEqual(3);
    expect(count("invoice")).toBeGreaterThanOrEqual(2);
    expect(count("delivery note")).toBeGreaterThanOrEqual(2);
  });

  it("has a ground-truth entry for every document and a document for every entry", () => {
    expect(Object.keys(truth).sort()).toEqual([...documents].sort());
  });

  it("keeps each file under 500 KB and the set under 3 MB", () => {
    const sizes = documents.map((f) => statSync(join(dir, f)).size);
    for (const size of sizes) expect(size).toBeLessThan(500 * 1024);
    expect(sizes.reduce((a, b) => a + b, 0)).toBeLessThan(3 * 1024 * 1024);
  });

  it("is watermarked in every PDF", () => {
    for (const f of documents.filter((d) => d.endsWith(".pdf"))) {
      expect(readFileSync(join(dir, f), "latin1")).toContain("(SAMPLE - NOT REAL)");
    }
  });

  it("has well-formed price rows (integer cents, ZAR)", () => {
    for (const { kind, rows } of Object.values(truth)) {
      if (kind === "delivery note") continue;
      for (const row of rows) {
        expect(typeof row["item"]).toBe("string");
        expect(Number.isInteger(row["priceMinorUnits"])).toBe(true);
        expect(row["currency"]).toBe("ZAR");
      }
    }
  });

  it("invoice totals equal quantity times unit price", () => {
    for (const { kind, rows } of Object.values(truth)) {
      if (kind !== "invoice") continue;
      for (const r of rows)
        expect(r["lineTotalMinorUnits"]).toBe(
          (r["priceMinorUnits"] as number) * (r["quantity"] as number),
        );
    }
  });
});
