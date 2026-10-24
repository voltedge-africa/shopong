import type * as arrow from "apache-arrow";

/** Kepler.gl field types (see kepler.gl `ALL_FIELD_TYPES`). */
type KeplerType = "boolean" | "date" | "geojson" | "integer" | "real" | "string" | "timestamp" | "point";

function keplerType(f: arrow.Field): KeplerType {
  const s = String(f.type);
  if (/^Bool/.test(s)) return "boolean";
  if (/^(Int|Uint)/.test(s)) return "integer";
  if (/^(Float|Decimal)/.test(s)) return "real";
  if (/^Timestamp/.test(s)) return "timestamp";
  if (/^Date/.test(s)) return "date";
  return "string";
}

/**
 * Arrow table -> the `{fields, rows}` shape Kepler.gl `addDataToMap` accepts as `datasets.data`.
 * `fields`: [{name, format, type}]; `rows`: array of arrays in field order.
 * Timestamps are emitted as ISO strings and 64-bit ints as numbers (Kepler rows are plain JS values).
 */
export function tableToKepler(tbl: arrow.Table) {
  const fields = tbl.schema.fields.map((f) => ({ name: f.name, format: "", type: keplerType(f) }));
  const cols = tbl.schema.fields.map((_, i) => tbl.getChildAt(i)!);
  const rows: unknown[][] = [];
  for (let r = 0; r < tbl.numRows; r++) {
    rows.push(
      cols.map((col, i) => {
        const v = col.get(r);
        const ty = fields[i].type;
        if (v === null || v === undefined) return null;
        if (typeof v === "bigint") return Number(v);
        if (ty === "timestamp" || ty === "date") return new Date(Number(v)).toISOString();
        return v;
      }),
    );
  }
  return { fields, rows };
}
