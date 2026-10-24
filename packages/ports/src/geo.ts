import type { PortError, Result } from "./common.js";

/** A cell value. Locations are stored as coarsened `lat`/`lng` number columns (never exact addresses). */
export type GeoValue = string | number | boolean | null;

export type GeoRow = { readonly [column: string]: GeoValue };

export type FilterOp = "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "in";

export interface Filter {
  readonly column: string;
  readonly op: FilterOp;
  /** An array only for `in`. */
  readonly value: GeoValue | readonly GeoValue[];
}

/** Rows whose point lies inside a box (inclusive). */
export interface WithinBox {
  readonly kind: "box";
  readonly latColumn: string;
  readonly lngColumn: string;
  readonly minLat: number;
  readonly minLng: number;
  readonly maxLat: number;
  readonly maxLng: number;
}

/** Rows whose point lies within a great-circle radius (inclusive). */
export interface WithinRadius {
  readonly kind: "radius";
  readonly latColumn: string;
  readonly lngColumn: string;
  readonly lat: number;
  readonly lng: number;
  readonly radiusMeters: number;
}

export interface Aggregate {
  readonly fn: "count" | "sum" | "avg" | "min" | "max";
  /** Omit for `count` of rows. */
  readonly column?: string;
  /** Output column name. */
  readonly as: string;
}

/**
 * A structured query. Structured rather than SQL so that agents and generated UIs can
 * use it without SQL injection; the DuckDB adapter compiles it to parameterised SQL.
 */
export interface GeoQuery {
  readonly from: string;
  /** All must hold. */
  readonly where?: readonly Filter[];
  readonly within?: WithinBox | WithinRadius;
  /** With `aggregates`, one output row per group: the group columns then the aggregates. */
  readonly groupBy?: readonly string[];
  readonly aggregates?: readonly Aggregate[];
  /** Projected columns when not aggregating. Default: all. */
  readonly select?: readonly string[];
  /** Without it, row order is unspecified. */
  readonly orderBy?: readonly { column: string; direction: "asc" | "desc" }[];
  readonly limit?: number;
}

export interface GeoResult {
  readonly columns: readonly string[];
  readonly rows: readonly GeoRow[];
}

export type GeoErrorCode = "invalid_request" | "unknown_table" | "unknown_column";

/**
 * Analytical and spatial queries over a community's data (DuckDB-WASM in the web console;
 * Kepler.gl draws the results). Never bundled in the mobile app (AGENTS.md rule 7).
 * Owning epic: 7.
 */
export interface Geo {
  /** Create or replace a table. Every row must have the same columns. */
  load(
    table: string,
    rows: readonly GeoRow[],
  ): Promise<Result<{ table: string; rowCount: number }, PortError<"invalid_request">>>;
  query(query: GeoQuery): Promise<Result<GeoResult, PortError<GeoErrorCode>>>;
}
