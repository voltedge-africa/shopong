import {
  err,
  ok,
  type Aggregate,
  type Filter,
  type Geo,
  type GeoErrorCode,
  type GeoQuery,
  type GeoResult,
  type GeoRow,
  type GeoValue,
  type PortError,
  type Result,
} from "@shopong/ports";
import { haversineMeters } from "./routing.js";
import { stableStringify } from "./support.js";

const TABLE_NAME = /^[a-z_][a-z0-9_]*$/;

interface Table {
  columns: readonly string[];
  rows: readonly GeoRow[];
}

/** In-memory `Geo` that evaluates the structured query directly over arrays. */
export class MemoryGeo implements Geo {
  readonly #tables = new Map<string, Table>();

  async load(
    table: string,
    rows: readonly GeoRow[],
  ): Promise<Result<{ table: string; rowCount: number }, PortError<"invalid_request">>> {
    if (!TABLE_NAME.test(table)) return err("invalid_request", `bad table name ${table}`);
    const columns = rows[0] === undefined ? [] : Object.keys(rows[0]).sort();
    for (const row of rows) {
      const keys = Object.keys(row).sort();
      if (keys.join("\u0000") !== columns.join("\u0000"))
        return err("invalid_request", "rows must share columns");
      for (const value of Object.values(row)) {
        if (!isGeoValue(value))
          return err("invalid_request", "values must be string, finite number, boolean or null");
      }
    }
    this.#tables.set(table, { columns, rows: rows.map((row) => ({ ...row })) });
    return ok({ table, rowCount: rows.length });
  }

  async query(query: GeoQuery): Promise<Result<GeoResult, PortError<GeoErrorCode>>> {
    const table = this.#tables.get(query.from);
    if (table === undefined) return err("unknown_table", `no table ${query.from}`);
    const known = new Set(table.columns);
    const referenced = [
      ...(query.where ?? []).map((filter) => filter.column),
      ...(query.within === undefined ? [] : [query.within.latColumn, query.within.lngColumn]),
      ...(query.groupBy ?? []),
      ...(query.aggregates ?? []).flatMap((aggregate) =>
        aggregate.column === undefined ? [] : [aggregate.column],
      ),
      ...(query.select ?? []),
    ];
    const missing = referenced.find((column) => !known.has(column));
    if (missing !== undefined)
      return err("unknown_column", `no column ${missing} in ${query.from}`);
    if (query.limit !== undefined && !(Number.isInteger(query.limit) && query.limit >= 0)) {
      return err("invalid_request", "limit must be a non-negative integer");
    }
    for (const filter of query.where ?? []) {
      if ((filter.op === "in") !== Array.isArray(filter.value)) {
        return err("invalid_request", "`in` takes an array and only `in` does");
      }
    }
    if (
      (query.aggregates ?? []).some(
        (aggregate) => aggregate.fn !== "count" && aggregate.column === undefined,
      )
    ) {
      return err("invalid_request", "only count may omit its column");
    }

    let rows = table.rows.filter((row) =>
      (query.where ?? []).every((filter) => matches(row, filter)),
    );
    const within = query.within;
    if (within !== undefined) {
      rows = rows.filter((row) => {
        const lat = row[within.latColumn];
        const lng = row[within.lngColumn];
        if (typeof lat !== "number" || typeof lng !== "number") return false;
        return within.kind === "box"
          ? lat >= within.minLat &&
              lat <= within.maxLat &&
              lng >= within.minLng &&
              lng <= within.maxLng
          : haversineMeters({ lat, lng }, within) <= within.radiusMeters;
      });
    }

    let columns: string[];
    let output: GeoRow[];
    const groupBy = query.groupBy ?? [];
    const aggregates = query.aggregates ?? [];
    if (groupBy.length > 0 || aggregates.length > 0) {
      const groups = new Map<string, GeoRow[]>();
      for (const row of rows) {
        const key = stableStringify(groupBy.map((column) => row[column] ?? null));
        groups.set(key, [...(groups.get(key) ?? []), row]);
      }
      if (groupBy.length === 0 && groups.size === 0) groups.set("[]", []);
      columns = [...groupBy, ...aggregates.map((aggregate) => aggregate.as)];
      output = [...groups.values()].map((members) => {
        const out: Record<string, GeoValue> = {};
        for (const column of groupBy) out[column] = members[0]?.[column] ?? null;
        for (const aggregate of aggregates) out[aggregate.as] = aggregateOf(members, aggregate);
        return out;
      });
    } else {
      columns = [...(query.select ?? table.columns)];
      output = rows.map((row) =>
        Object.fromEntries(columns.map((column) => [column, row[column] ?? null])),
      );
    }

    for (const order of query.orderBy ?? []) {
      if (!columns.includes(order.column))
        return err("unknown_column", `cannot order by ${order.column}`);
    }
    const orderBy = query.orderBy ?? [];
    if (orderBy.length > 0) {
      output.sort((a, b) => {
        for (const order of orderBy) {
          const diff = compareValues(a[order.column] ?? null, b[order.column] ?? null);
          if (diff !== 0) return order.direction === "desc" ? -diff : diff;
        }
        return 0;
      });
    }
    if (query.limit !== undefined) output = output.slice(0, query.limit);
    return ok({ columns, rows: output });
  }
}

function isGeoValue(value: unknown): value is GeoValue {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    Number.isFinite(value)
  );
}

function matches(row: GeoRow, filter: Filter): boolean {
  const value = row[filter.column] ?? null;
  const target = filter.value;
  switch (filter.op) {
    case "eq":
      return value === target;
    case "neq":
      return value !== target;
    case "in":
      return (target as readonly GeoValue[]).includes(value);
    default: {
      if (
        value === null ||
        target === null ||
        typeof value !== typeof target ||
        typeof value === "boolean"
      )
        return false;
      const diff = compareValues(value, target as GeoValue);
      return filter.op === "lt"
        ? diff < 0
        : filter.op === "lte"
          ? diff <= 0
          : filter.op === "gt"
            ? diff > 0
            : diff >= 0;
    }
  }
}

/** Nulls sort last, as DuckDB does by default for ascending order. */
function compareValues(a: GeoValue, b: GeoValue): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : 1;
}

function aggregateOf(rows: readonly GeoRow[], aggregate: Aggregate): GeoValue {
  if (aggregate.fn === "count") {
    return aggregate.column === undefined
      ? rows.length
      : rows.filter((row) => row[aggregate.column ?? ""] !== null).length;
  }
  const values = rows
    .map((row) => row[aggregate.column ?? ""])
    .filter((value): value is number => typeof value === "number");
  if (values.length === 0) return null;
  switch (aggregate.fn) {
    case "sum":
      return values.reduce((sum, value) => sum + value, 0);
    case "avg":
      return values.reduce((sum, value) => sum + value, 0) / values.length;
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
  }
}
