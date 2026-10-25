// Which spatial functions work WITHOUT `LOAD spatial` (autoload off, third parties blocked)?
// DuckDB 1.5 made GEOMETRY a core type; this checks how much of ST_* it ships.
import { startServer } from "./server.mjs";
import { launch, save } from "./lib.mjs";
const out = {};
for (const alias of ["duckdb-1.32.0", "duckdb-dev65"]) {
  const srv = await startServer({ dir: `.tmp/dist-${alias}`, csp: "none" });
  const b = await launch();
  const page = await b.newPage();
  await page.route("**/*", (r) =>
    r.request().url().startsWith(srv.url) ? r.continue() : r.abort(),
  );
  await page.goto(srv.url);
  await page.waitForFunction(() => window.spikeReady);
  const init = await page.evaluate(() => window.spike.init());
  const sql = [
    "SET autoload_known_extensions=false",
    "SET autoinstall_known_extensions=false",
    "select ST_AsText(ST_Point(27.91, -26.24)) x",
    "select ST_AsGeoJSON(ST_Point(27.91, -26.24)) x",
    "select ST_Distance(ST_Point(27.91, -26.24), ST_Point(27.94, -26.25)) x",
    "select ST_Distance_Sphere(ST_Point(27.91, -26.24), ST_Point(27.94, -26.25)) x",
    "select ST_Within(ST_Point(1,1), ST_GeomFromText('POLYGON((0 0,2 0,2 2,0 2,0 0))')) x",
    "select ST_Contains(ST_GeomFromText('POLYGON((0 0,2 0,2 2,0 2,0 0))'), ST_Point(1,1)) x",
    "select ST_AsText(ST_Buffer(ST_Point(1,1), 1)) x",
    "select ST_Area(ST_GeomFromText('POLYGON((0 0,2 0,2 2,0 2,0 0))')) x",
    "select ST_Hilbert(27.91, -26.24) x",
    "select typeof(ST_Point(1,2)) x",
    'select ST_AsText(ST_GeomFromGeoJSON(\'{"type":"Point","coordinates":[1,2]}\')) x',
    "select ST_AsText(ST_Transform(ST_Point(27.91, -26.24), 'EPSG:4326', 'EPSG:3857')) x",
  ];
  const r = await page.evaluate((s) => window.spike.script(s), sql);
  out[alias] = {
    duckdb: init.version.v,
    results: r.map((c) => ({
      sql: c.sql,
      ok: !c.error,
      value: c.rows?.[0]?.x,
      error: c.error?.split("\n")[0].slice(0, 160),
    })),
  };
  await b.close();
  await srv.close();
}
save("core-geometry-without-load-spatial.json", out);
for (const [a, v] of Object.entries(out)) {
  console.log(a, v.duckdb);
  for (const c of v.results)
    console.log(
      "  ",
      c.ok ? "OK " : "ERR",
      c.sql.slice(0, 80),
      c.ok ? JSON.stringify(c.value) : c.error,
    );
}
