import * as duckdb from "@duckdb/duckdb-wasm";
import * as arrow from "apache-arrow";
import { COLLECTION_POINTS, generate, suburbGeoJSON, type Dataset } from "./data";
import { tableToKepler } from "./kepler";

type BundleInfo = {
  alias: string;
  version: string;
  bundles: Record<string, duckdb.DuckDBBundle & { mainModule: string }>;
};

let db: duckdb.AsyncDuckDB | undefined;
let conn: duckdb.AsyncDuckDBConnection | undefined;
let worker: Worker | undefined;
let info: BundleInfo | undefined;
const out = document.getElementById("out")!;
const log = (m: string) => (out.textContent = m);

const t = async <T>(f: () => Promise<T>): Promise<{ ms: number; value: T }> => {
  const s = performance.now();
  const value = await f();
  return { ms: Math.round((performance.now() - s) * 10) / 10, value };
};

const rows = (tbl: arrow.Table) =>
  tbl
    .toArray()
    .map((r) =>
      JSON.parse(JSON.stringify(r.toJSON(), (_k, v) => (typeof v === "bigint" ? Number(v) : v))),
    );
const q = async (sql: string) => rows(await conn!.query(sql));

const api = {
  /** Instantiate AsyncDuckDB in a worker from self-hosted bundles.
   *  `path: "opfs://…"` opens a persistent OPFS database. Feature-detected at init with a real
   *  `navigator.storage.getDirectory()` call; an `opfs://` path with no OPFS falls back to an
   *  in-memory database (`storage: "memory"`), so data lives for the session only. */
  async init(
    opts: {
      bundle?: string;
      path?: string;
      accessMode?: "read_write";
      config?: Record<string, unknown>;
    } = {},
  ) {
    log("init");
    info = await (await fetch("/duckdb/bundles.json")).json();
    const bundles = info!.bundles;
    const pick = opts.bundle
      ? bundles[opts.bundle]
      : await duckdb.selectBundle(bundles as unknown as duckdb.DuckDBBundles);
    const key = Object.entries(bundles).find(([, b]) => b.mainModule === pick.mainModule)![0];
    const start = performance.now();
    // Same-origin worker script: no blob: URL needed when the bundle is self-hosted.
    worker = new Worker(pick.mainWorker!);
    db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    await db.instantiate(pick.mainModule, pick.pthreadWorker);
    const instantiateMs = performance.now() - start;
    let storage: "opfs" | "file" | "memory" = opts.path?.startsWith("opfs://")
      ? "opfs"
      : opts.path
        ? "file"
        : "memory";
    if (storage === "opfs") {
      let opfs = false;
      try {
        opfs = "storage" in navigator && !!(await navigator.storage.getDirectory());
      } catch {
        opfs = false;
      }
      if (!opfs) {
        log("opfs unavailable — falling back to an in-memory database");
        storage = "memory";
        opts = { ...opts, path: undefined };
      }
    }
    if (opts.path) {
      await db.open({
        path: opts.path,
        accessMode: duckdb.DuckDBAccessMode.READ_WRITE,
        ...opts.config,
      });
    } else if (opts.config) {
      await db.open(opts.config as duckdb.DuckDBConfig);
    }
    conn = await db.connect();
    const v = await q(
      "select version() as v, (select value from duckdb_settings() where name='duckdb_api') api, (select value from duckdb_settings() where name='custom_extension_repository') cer, (select value from duckdb_settings() where name='default_extension_repository') der, (select value from duckdb_settings() where name='threads') threads",
    );
    const platform = await q("pragma platform").catch((e) => String(e));
    const extHash = await q("select source_id from pragma_version()").catch(() => []);
    log("ready");
    return {
      bundle: key,
      alias: info!.alias,
      pkgVersion: info!.version,
      storage,
      instantiateMs: Math.round(instantiateMs),
      version: v[0],
      platform,
      sourceId: extHash[0],
      crossOriginIsolated: self.crossOriginIsolated,
    };
  },

  async query(sql: string) {
    return t(() => q(sql));
  },

  /** Run each statement, return the timing of each; errors are captured, not thrown. */
  async script(stmts: string[]) {
    const res: { sql: string; ms: number; rows?: unknown; error?: string }[] = [];
    for (const sql of stmts) {
      const s = performance.now();
      try {
        const r = await q(sql);
        res.push({ sql, ms: Math.round(performance.now() - s), rows: r.slice(0, 5) });
      } catch (e) {
        res.push({
          sql,
          ms: Math.round(performance.now() - s),
          error: String((e as Error).message ?? e).slice(0, 400),
        });
      }
    }
    return res;
  },

  /** Load a synthetic dataset as JSON or as Arrow. Returns per-table times. */
  async load(total: number, format: "json" | "arrow") {
    const s0 = performance.now();
    const ds: Dataset = generate(total);
    const genMs = performance.now() - s0;
    await conn!.query(
      "drop table if exists members; drop table if exists orders; drop table if exists pledges; drop table if exists deliveries;",
    );
    const times: Record<string, number> = {};
    for (const name of ["members", "orders", "pledges", "deliveries"] as const) {
      const data = ds[name];
      const s = performance.now();
      if (format === "json") {
        const text = JSON.stringify(data);
        await db!.registerFileText(`${name}.json`, text);
        await conn!.insertJSONFromPath(`${name}.json`, { name, schema: "main" });
        await db!.dropFile(`${name}.json`);
      } else {
        const tbl = arrow.tableFromJSON(data as Record<string, unknown>[]);
        await conn!.insertArrowTable(tbl, { name, schema: "main", create: true });
      }
      times[name] = Math.round(performance.now() - s);
    }
    const counts = await q(
      "select (select count(*) from members) members, (select count(*) from orders) orders, (select count(*) from pledges) pledges, (select count(*) from deliveries) deliveries",
    );
    const types = await q(
      "select table_name, column_name, data_type from information_schema.columns where table_schema='main' order by 1, ordinal_position",
    );
    return {
      format,
      total,
      genMs: Math.round(genMs),
      times,
      totalMs: Math.round(Object.values(times).reduce((a, b) => a + b, 0)),
      counts: counts[0],
      types,
    };
  },

  /** Aggregate queries over the loaded tables, each run `reps` times; returns the median ms. */
  async aggregates(reps = 5) {
    const queries: Record<string, string> = {
      spend_per_item:
        "select item, count(*) n, sum(qty*price_cents)/100.0 rand from orders group by 1 order by 3 desc",
      who_has_not_paid:
        "select m.member_id, count(*) unpaid from members m join pledges p using(member_id) where p.cycle = 11 and not p.paid group by 1 order by 2 desc, 1 limit 20",
      delivery_hours_per_point:
        "select collection_point, count(*) n, avg(delivered_ms - dispatched_ms)/3600000.0 avg_hours from deliveries where status='delivered' group by 1 order by 1",
      price_history_by_month:
        // ts_ms is UBIGINT; make_timestamp needs BIGINT and CAST keeps us off the ICU-dependent
        // TIMESTAMPTZ date_trunc path (which autoloads icu from the CDN and breaks under strict CSP).
        "select item, date_trunc('month', make_timestamp(ts_ms::BIGINT * 1000)) as mon, avg(price_cents)/100.0 avg_price from orders group by 1,2 order by 1,2",
      three_way_join:
        "select d.collection_point, count(distinct m.member_id) members, sum(o.qty*o.price_cents)/100.0 total_value from deliveries d join orders o using(order_id) join members m using(member_id) group by 1 order by 1",
      window_rank:
        "select member_id, total, rank() over (order by total desc) r from (select member_id, sum(qty*price_cents) total from orders group by 1) order by r limit 10",
    };
    const result: Record<
      string,
      { medianMs: number; minMs: number; rows: number; sample: unknown }
    > = {};
    for (const [name, sql] of Object.entries(queries)) {
      const ms: number[] = [];
      let last: unknown[] = [];
      for (let i = 0; i < reps; i++) {
        const r = await t(() => q(sql));
        ms.push(r.ms);
        last = r.value;
      }
      ms.sort((a, b) => a - b);
      result[name] = {
        medianMs: ms[Math.floor(ms.length / 2)],
        minMs: ms[0],
        rows: last.length,
        sample: last[0],
      };
    }
    return result;
  },

  /** Spatial: LOAD spatial, then ST_* functions, GeoJSON and Kepler shape. */
  async spatial(opts: { customRepo?: string } = {}) {
    const res: Record<string, unknown> = {};
    if (opts.customRepo) await conn!.query(`SET custom_extension_repository='${opts.customRepo}'`);
    const inst = await t(async () => {
      try {
        await conn!.query("INSTALL spatial");
        return "ok";
      } catch (e) {
        return "ERR " + String((e as Error).message).slice(0, 300);
      }
    });
    res.install = inst;
    const load = await t(async () => {
      try {
        await conn!.query("LOAD spatial");
        return "ok";
      } catch (e) {
        return "ERR " + String((e as Error).message).slice(0, 500);
      }
    });
    res.load = load;
    if (load.value !== "ok") return res;
    await db!.registerFileText("suburbs.geojson", JSON.stringify(suburbGeoJSON()));
    await conn!.query(
      `create or replace table collection_points as select * from (values ${COLLECTION_POINTS.map((p) => `('${p.id}','${p.name}',${p.lon},${p.lat})`).join(",")}) v(cp, name, lon, lat)`,
    );
    const checks: Record<string, string> = {
      st_point: "select ST_AsText(ST_Point(27.91, -26.24)) wkt",
      st_distance:
        "select ST_Distance(ST_Point(27.91, -26.24), ST_Point(27.94, -26.25)) planar_deg",
      st_distance_sphere:
        "select ST_Distance_Sphere(ST_Point(27.91, -26.24), ST_Point(27.94, -26.25)) metres",
      st_read_geojson:
        "select name, cp, ST_AsText(geom) wkt from ST_Read('suburbs.geojson') order by cp",
      st_within_count:
        "select count(*) members_in_catchments from members m, ST_Read('suburbs.geojson') s where ST_Within(ST_Point(m.lon, m.lat), s.geom)",
      st_asgeojson: "select ST_AsGeoJSON(ST_Point(27.91, -26.24)) gj",
      members_per_grid_cell:
        "select ST_AsGeoJSON(ST_Point(lon, lat)) cell, count(*) n from members group by lon, lat order by n desc limit 3",
      nearest_collection_point:
        "select cp, count(*) members from (select m.member_id, arg_min(c.cp, ST_Distance_Sphere(ST_Point(m.lon, m.lat), ST_Point(c.lon, c.lat))) cp from members m cross join collection_points c group by m.member_id) group by 1 order by 1",
    };
    res.checks = await api.script(Object.values(checks));
    res.checkNames = Object.keys(checks);
    const ext = await q(
      "select extension_name, loaded, installed, install_path, extension_version from duckdb_extensions() where loaded or installed order by 1",
    );
    res.extensions = ext;
    return res;
  },

  /** Spatial queries timed on current data (call after spatial()). */
  async spatialTimings(reps = 3) {
    const queries: Record<string, string> = {
      st_point_construct: "select count(ST_Point(lon, lat)) from members",
      within_join:
        "select count(*) from members m, ST_Read('suburbs.geojson') s where ST_Within(ST_Point(m.lon, m.lat), s.geom)",
      nearest_cp:
        "select cp, count(*) from (select m.member_id, arg_min(c.cp, ST_Distance_Sphere(ST_Point(m.lon, m.lat), ST_Point(c.lon, c.lat))) cp from members m cross join collection_points c group by m.member_id) group by 1",
    };
    const result: Record<string, number> = {};
    for (const [n, sql] of Object.entries(queries)) {
      const ms: number[] = [];
      for (let i = 0; i < reps; i++) ms.push((await t(() => q(sql))).ms);
      ms.sort((a, b) => a - b);
      result[n] = ms[Math.floor(ms.length / 2)];
    }
    return result;
  },

  /** Parquet export then re-import, row counts and content hash compared. */
  async parquetRoundTrip() {
    const before = await q("select count(*) n, sum(qty*price_cents) s from orders");
    const exp = await t(async () => {
      await conn!.query("copy orders to 'orders.parquet' (format parquet, compression zstd)");
      return (await db!.copyFileToBuffer("orders.parquet")).byteLength;
    });
    const buf = await db!.copyFileToBuffer("orders.parquet");
    await db!.registerFileBuffer("orders_in.parquet", buf);
    const imp = await t(async () =>
      q("create or replace table orders_rt as select * from 'orders_in.parquet'"),
    );
    const after = await q("select count(*) n, sum(qty*price_cents) s from orders_rt");
    const diff = await q(
      "select count(*) n from (select * from orders except select * from orders_rt)",
    );
    return {
      before: before[0],
      after: after[0],
      diffRows: diff[0],
      parquetBytes: exp.value,
      exportMs: exp.ms,
      importMs: imp.ms,
    };
  },

  /** Arrow result -> Kepler.gl `{fields, rows}` for addDataToMap. */
  async keplerShape() {
    const tbl = await conn!.query(
      "select m.member_id::INTEGER member_id, m.lat, m.lon, count(o.order_id)::INTEGER orders, max(to_timestamp(o.ts_ms/1000)) last_order from members m left join orders o using(member_id) group by all order by 1 limit 5",
    );
    const shaped = tableToKepler(tbl);
    return {
      arrowSchema: tbl.schema.fields.map((f: arrow.Field) => `${f.name}: ${String(f.type)}`),
      kepler: shaped,
    };
  },

  async persistWrite() {
    await q("create table if not exists persisted as select * from range(1000) t(i)");
    await q("insert into persisted select * from range(1000, 2000)");
    await conn!.query("checkpoint");
    return (await q("select count(*) n from persisted"))[0];
  },
  async persistRead() {
    return (await q("select count(*) n from persisted"))[0];
  },

  async close() {
    await conn?.close();
    await db?.terminate();
    worker?.terminate();
    conn = undefined;
    db = undefined;
  },

  async env() {
    return {
      crossOriginIsolated: self.crossOriginIsolated,
      opfs: "storage" in navigator && "getDirectory" in navigator.storage,
      ua: navigator.userAgent,
      hw: navigator.hardwareConcurrency,
      sab: typeof SharedArrayBuffer !== "undefined",
    };
  },
};

(window as unknown as { spike: typeof api }).spike = api;
(window as unknown as { spikeReady: boolean }).spikeReady = true;
log("loaded");
