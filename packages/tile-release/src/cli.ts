// Command line for the tile release scripts (scripts/tiles). Prints plain words; never prints file contents.
//   node packages/tile-release/dist/cli.js pin-check <pin.json>
//   node packages/tile-release/dist/cli.js pin-get <pin.json> <dotted.key>
//   node packages/tile-release/dist/cli.js publish --releases-dir D --staging S --pin P --build-report R --release N
//   node packages/tile-release/dist/cli.js verify --releases-dir D --release N
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { join } from "node:path";
import { createManifest, ManifestError, type Attribution, type Bbox } from "./manifest.js";
import { publishRelease, ReleaseExistsError } from "./publish.js";
import { scanFiles, verifyRelease } from "./verify.js";
import { isSafeReleaseName } from "./paths.js";

/** The pin file for one region (scripts/tiles/pins). */
interface Pin {
  region: string;
  pinned: boolean;
  note?: string;
  source: { file: string; url: string; snapshotDate: string; sha256: string; md5Url?: string };
  coverage: Bbox | null;
  attribution: Attribution;
  /** The pinned native builder (the same for every region). */
  builder: { valhallaVersion: string; valhallaRevision: string; wrapper: string };
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8")) as unknown;
}

function getPath(value: unknown, dotted: string): unknown {
  return dotted.split(".").reduce<unknown>((node, key) => {
    if (typeof node !== "object" || node === null) return undefined;
    return (node as Record<string, unknown>)[key];
  }, value);
}

/** The pin's rules: it names a real extract, its checksum is a SHA-256, and the attribution is complete. */
function checkPin(raw: unknown): Pin {
  const pin = raw as Pin;
  if (typeof pin !== "object" || pin === null) throw new Error("The pin file is not an object.");
  if (pin.pinned !== true) {
    throw new Error(
      `No pinned extract for region ${pin.region ?? "(unknown)"} yet${pin.note ? `: ${pin.note}` : "."}`,
    );
  }
  if (!/^[0-9a-f]{64}$/u.test(pin.source?.sha256 ?? ""))
    throw new Error("The pin has no SHA-256 for the extract.");
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(pin.source?.snapshotDate ?? ""))
    throw new Error("The pin has no snapshot date.");
  if (!pin.source.url.startsWith("https://"))
    throw new Error("The pin's source URL must be https.");
  if (!Array.isArray(pin.coverage) || pin.coverage.length !== 4) {
    throw new Error("The pin has no coverage box (west, south, east, north).");
  }
  const attribution = pin.attribution;
  if (!attribution?.text || !attribution.linkText || !attribution.url) {
    throw new Error("Add the OpenStreetMap attribution.");
  }
  return pin;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  switch (command) {
    case "pin-check": {
      checkPin(readJson(rest[0] ?? ""));
      console.log("pin ok");
      return 0;
    }
    case "pin-get": {
      const value = getPath(readJson(rest[0] ?? ""), rest[1] ?? "");
      if (value === undefined) return 1;
      console.log(typeof value === "string" ? value : JSON.stringify(value));
      return 0;
    }
    case "publish": {
      const { values } = parseArgs({
        args: rest,
        options: {
          "releases-dir": { type: "string" },
          staging: { type: "string" },
          pin: { type: "string" },
          "build-report": { type: "string" },
          release: { type: "string" },
        },
        strict: true,
      });
      const pin = checkPin(readJson(values.pin ?? ""));
      const report = readJson(values["build-report"] ?? "") as {
        valhallaRevision: string;
        nativeBuilderSha256: string;
        source?: { timezone?: { release: string; url: string; sha256: string; license: string } };
      };
      if (report.valhallaRevision !== pin.builder.valhallaRevision) {
        throw new Error(
          "The build used a different Valhalla revision from the pin; nothing was published.",
        );
      }
      const release = values.release ?? "";
      if (!isSafeReleaseName(release)) throw new ManifestError("Release name is not allowed.");
      const staging = values.staging ?? "";
      const manifest = createManifest({
        release,
        region: pin.region,
        source: {
          file: pin.source.file,
          url: pin.source.url,
          snapshotDate: pin.source.snapshotDate,
          sha256: pin.source.sha256,
          ...(report.source?.timezone === undefined
            ? {}
            : {
                timezoneInput: {
                  release: report.source.timezone.release,
                  url: report.source.timezone.url,
                  sha256: report.source.timezone.sha256,
                  licence: report.source.timezone.license,
                },
              }),
        },
        coverage: pin.coverage as Bbox,
        builder: {
          valhallaVersion: pin.builder.valhallaVersion,
          valhallaRevision: pin.builder.valhallaRevision,
          wrapper: pin.builder.wrapper,
          nativeBuilderSha256: report.nativeBuilderSha256,
        },
        attribution: pin.attribution,
        files: scanFiles(staging),
      });
      try {
        const result = await publishRelease({
          releasesDir: values["releases-dir"] ?? "",
          stagingDir: staging,
          manifest,
        });
        const bytes = manifest.files.reduce((sum, f) => sum + f.size, 0);
        console.log(
          JSON.stringify({
            status: result.status,
            release: release,
            dir: result.dir,
            files: manifest.files.length,
            bytes,
          }),
        );
        return 0;
      } catch (error) {
        if (error instanceof ReleaseExistsError) {
          console.error(error.message);
          return 3;
        }
        throw error;
      }
    }
    case "verify": {
      const { values } = parseArgs({
        args: rest,
        options: { "releases-dir": { type: "string" }, release: { type: "string" } },
        strict: true,
      });
      const release = values.release ?? "";
      if (!isSafeReleaseName(release)) {
        console.error("Release name is not allowed.");
        return 2;
      }
      const result = await verifyRelease(join(values["releases-dir"] ?? "", release), release);
      if (result.ok) {
        console.log(
          `verified ${release}: ${result.manifest?.files.length ?? 0} files match the manifest`,
        );
        return 0;
      }
      for (const problem of result.problems) console.error(`problem: ${problem}`);
      console.error("Map data can't be checked.");
      return 1;
    }
    default:
      console.error("usage: cli.js pin-check|pin-get|publish|verify ...");
      return 2;
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "The command failed.");
  process.exitCode = 1;
}
