import { expect } from "vite-plus/test";
import type { Geo, GeoRow } from "@shopong/ports";
import {
  expectErr,
  expectOk,
  registerContract,
  unique,
  type ContractCase,
  type ContractOptions,
  type Factory,
} from "./support.js";

// Coarsened member locations (suburb centroids), never exact addresses.
const members: GeoRow[] = [
  { member: "m1", suburb: "Soweto", lat: -26.2485, lng: 27.854, pledgeZar: 150 },
  { member: "m2", suburb: "Soweto", lat: -26.2485, lng: 27.854, pledgeZar: 200 },
  { member: "m3", suburb: "Alexandra", lat: -26.1035, lng: 28.0972, pledgeZar: 100 },
  { member: "m4", suburb: "Tembisa", lat: -25.9964, lng: 28.2268, pledgeZar: null },
  { member: "m5", suburb: "Soweto", lat: -26.2485, lng: 27.854, pledgeZar: 50 },
];

async function loaded(geo: Geo): Promise<string> {
  const table = unique("members_");
  expect(expectOk(await geo.load(table, members))).toEqual({ table, rowCount: 5 });
  return table;
}

const byMember = (a: GeoRow, b: GeoRow): number => String(a.member).localeCompare(String(b.member));

export const geoContract: readonly ContractCase<Geo>[] = [
  {
    name: "loads rows and returns them all",
    run: async (geo) => {
      const table = await loaded(geo);
      const result = expectOk(await geo.query({ from: table }));
      expect([...result.columns].sort()).toEqual(["lat", "lng", "member", "pledgeZar", "suburb"]);
      // Without orderBy the order is unspecified: compare sorted.
      expect([...result.rows].sort(byMember)).toEqual(members);
    },
  },
  {
    name: "loading the same table again replaces it",
    run: async (geo) => {
      const table = await loaded(geo);
      expectOk(await geo.load(table, members.slice(0, 2)));
      expect(expectOk(await geo.query({ from: table })).rows).toHaveLength(2);
    },
  },
  {
    name: "filters, projects, orders and limits",
    run: async (geo) => {
      const table = await loaded(geo);
      const result = expectOk(
        await geo.query({
          from: table,
          where: [
            { column: "suburb", op: "eq", value: "Soweto" },
            { column: "pledgeZar", op: "gte", value: 100 },
          ],
          select: ["member", "pledgeZar"],
          orderBy: [{ column: "pledgeZar", direction: "desc" }],
        }),
      );
      expect(result.columns).toEqual(["member", "pledgeZar"]);
      expect(result.rows).toEqual([
        { member: "m2", pledgeZar: 200 },
        { member: "m1", pledgeZar: 150 },
      ]);
      const limited = expectOk(
        await geo.query({
          from: table,
          select: ["member"],
          orderBy: [{ column: "member", direction: "asc" }],
          limit: 2,
        }),
      );
      expect(limited.rows).toEqual([{ member: "m1" }, { member: "m2" }]);
      const within = expectOk(
        await geo.query({
          from: table,
          where: [{ column: "member", op: "in", value: ["m3", "m4"] }],
        }),
      );
      expect(within.rows.map((row) => String(row.member)).sort()).toEqual(["m3", "m4"]);
    },
  },
  {
    name: "groups and aggregates, ignoring nulls",
    run: async (geo) => {
      const table = await loaded(geo);
      const result = expectOk(
        await geo.query({
          from: table,
          groupBy: ["suburb"],
          aggregates: [
            { fn: "count", as: "members" },
            { fn: "sum", column: "pledgeZar", as: "total" },
            { fn: "avg", column: "pledgeZar", as: "average" },
            { fn: "max", column: "pledgeZar", as: "largest" },
          ],
          orderBy: [{ column: "suburb", direction: "asc" }],
        }),
      );
      expect(result.columns).toEqual(["suburb", "members", "total", "average", "largest"]);
      expect(result.rows).toEqual([
        { suburb: "Alexandra", members: 1, total: 100, average: 100, largest: 100 },
        { suburb: "Soweto", members: 3, total: 400, average: 400 / 3, largest: 200 },
        { suburb: "Tembisa", members: 1, total: null, average: null, largest: null },
      ]);
    },
  },
  {
    name: "selects points in a box and within a radius",
    run: async (geo) => {
      const table = await loaded(geo);
      const box = expectOk(
        await geo.query({
          from: table,
          within: {
            kind: "box",
            latColumn: "lat",
            lngColumn: "lng",
            minLat: -26.2,
            maxLat: -25.9,
            minLng: 28,
            maxLng: 28.3,
          },
        }),
      );
      expect(box.rows.map((row) => String(row.member)).sort()).toEqual(["m3", "m4"]);
      // About 26 km from Soweto to Alexandra; 5 km around Soweto holds only Soweto.
      const near = expectOk(
        await geo.query({
          from: table,
          within: {
            kind: "radius",
            latColumn: "lat",
            lngColumn: "lng",
            lat: -26.25,
            lng: 27.85,
            radiusMeters: 5000,
          },
          aggregates: [{ fn: "count", as: "n" }],
        }),
      );
      expect(near.rows).toEqual([{ n: 3 }]);
    },
  },
  {
    name: "refuses bad tables, rows and columns",
    run: async (geo) => {
      const table = await loaded(geo);
      expectErr(await geo.load("Bad Name; DROP TABLE x", members), "invalid_request");
      expectErr(await geo.load(unique("t_"), [{ a: 1 }, { b: 2 }]), "invalid_request");
      expectErr(await geo.query({ from: unique("missing_") }), "unknown_table");
      expectErr(
        await geo.query({ from: table, where: [{ column: "phone", op: "eq", value: "x" }] }),
        "unknown_column",
      );
      expectErr(await geo.query({ from: table, select: ["phone"] }), "unknown_column");
    },
  },
];

/** Register the `Geo` contract against an adapter. */
export function runGeoContract(factory: Factory<Geo>, options?: ContractOptions): void {
  registerContract("Geo contract", geoContract, factory, options);
}
