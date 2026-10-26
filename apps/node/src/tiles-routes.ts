// The map tile route (story 7.2). Read-only: GET only, and only the files a checked release's manifest lists (plus the
// manifest itself). Files are streamed with byte ranges, so a client can fetch part of graph.tar. The first request to
// a release checks every file against the manifest; a failed check is refused with "Map data can't be checked.".
// The Node speaks plain HTTP; TLS is terminated by a reverse proxy in front of it (story 7.2, hosting option A).
import type { FastifyInstance, FastifyReply } from "fastify";
import {
  ACTIVE_ALIAS,
  parseByteRange,
  ReleaseStore,
  type LookupFailure,
  type StoreOptions,
} from "@shopong/tile-release";

export interface TileRouteOptions {
  /** The releases folder, outside the data folder. */
  readonly releasesDir: string;
  /** The release served at `/map/active/...`. Read at each request, so the alias can move. */
  readonly activeRelease?: string | undefined;
  /** Test seams for the store's clock and retry interval. */
  readonly store?: StoreOptions;
}

export const MAP_CANT_BE_CHECKED = "Map data can't be checked.";
export const NO_MAP_DATA = "No map data yet.";

/** Files in an immutable named release never change, so a browser or proxy may keep them for a year. */
const IMMUTABLE = "public, max-age=31536000, immutable";
/** The manifest and the alias can point at a different release over time, so they are never cached. */
const REVALIDATE = "no-cache";

/** Registers `GET /map/:release/*`. `release` is a release name or `active`. Returns the store for tests and status. */
export function registerTileRoutes(app: FastifyInstance, options: TileRouteOptions): ReleaseStore {
  const store = new ReleaseStore(options.releasesDir, options.store);

  app.get("/map/:release/*", async (request, reply) => {
    const { release: requested, "*": path = "" } = request.params as {
      release: string;
      "*": string | undefined;
    };
    const alias = requested === ACTIVE_ALIAS;
    const release = alias ? options.activeRelease : requested;
    if (release === undefined) return notFound(reply, NO_MAP_DATA);

    const found = await store.lookup(release, path);
    if (typeof found === "string") return failure(reply, found, alias);

    const etag = `"${found.sha512}"`;
    // If-Range: a range is honoured only while the client's validator is the file's current ETag. Otherwise the client
    // gets the whole file, so a moved alias never mixes two releases in one answer.
    const ifRange = request.headers["if-range"];
    const rangeAllowed = ifRange === undefined || ifRange === etag;
    const range = rangeAllowed
      ? parseByteRange(request.headers.range, found.size)
      : { kind: "full" as const };

    reply.header("accept-ranges", "bytes");
    reply.header("content-type", found.contentType);
    reply.header("cache-control", alias ? REVALIDATE : IMMUTABLE);
    reply.header("etag", etag);
    reply.header("x-content-type-options", "nosniff");

    if (request.headers["if-none-match"] === etag) {
      found.discard();
      return reply.code(304).send();
    }
    if (range.kind === "unsatisfiable") {
      found.discard();
      reply.header("content-range", `bytes */${found.size}`);
      return reply.code(416).send();
    }
    if (range.kind === "full") {
      reply.header("content-length", String(found.size));
      return reply.code(200).send(found.stream(0, found.size - 1));
    }
    reply.header("content-range", `bytes ${range.start}-${range.end}/${found.size}`);
    reply.header("content-length", String(range.end - range.start + 1));
    return reply.code(206).send(found.stream(range.start, range.end));
  });

  return store;
}

function notFound(reply: FastifyReply, message: string) {
  return reply.code(404).send({ error: "no-map-data", message });
}

function failure(reply: FastifyReply, reason: LookupFailure, alias: boolean) {
  if (reason === "unchecked") {
    return reply.code(503).send({ error: "map-data-unchecked", message: MAP_CANT_BE_CHECKED });
  }
  if (alias && reason === "no-release") return notFound(reply, NO_MAP_DATA);
  return reply.code(404).send({ error: "not-found" });
}
