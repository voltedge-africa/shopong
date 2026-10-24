import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { assertMeta } from "./meta.js";
import type { Fixture, FixtureRequest, FixtureResponse } from "./types.js";

/** `packages/fixtures/recorded`. Layout: `<service>/<scenario>/{request,response,meta}.json`. */
export const RECORDED_DIR = fileURLToPath(new URL("../recorded", import.meta.url));

const SEGMENT = /^[a-z0-9][a-z0-9-]*$/;

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, "utf8"));
}

function subdirs(dir: string): string[] {
  return readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .sort();
}

function checkSegment(kind: string, value: string): void {
  if (!SEGMENT.test(value))
    throw new Error(`Invalid fixture ${kind} "${value}": use lowercase letters, digits and dashes`);
}

export function loadFixture(
  service: string,
  scenario: string,
  root: string = RECORDED_DIR,
): Fixture {
  checkSegment("service", service);
  checkSegment("scenario", scenario);
  const dir = join(root, service, scenario);
  const meta = assertMeta(readJson(join(dir, "meta.json")), { service, scenario });
  return {
    service,
    scenario,
    meta,
    request: readJson(join(dir, "request.json")) as FixtureRequest,
    response: readJson(join(dir, "response.json")) as FixtureResponse,
  };
}

/** Every `[service, scenario]` pair on disk, optionally for one service. */
export function listFixtures(
  service?: string,
  root: string = RECORDED_DIR,
): Array<[string, string]> {
  const services = service ? [service] : subdirs(root);
  return services.flatMap((s) => subdirs(join(root, s)).map((sc): [string, string] => [s, sc]));
}

export function loadAll(service?: string, root: string = RECORDED_DIR): Fixture[] {
  return listFixtures(service, root).map(([s, sc]) => loadFixture(s, sc, root));
}
