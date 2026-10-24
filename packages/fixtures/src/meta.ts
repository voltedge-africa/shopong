import type { FixtureMeta } from "./types.js";

const SOURCES = ["recorded", "synthetic-from-docs"];
const DIRECTIONS = ["outbound", "inbound"];

/** Returns a list of problems; an empty list means `value` is a valid FixtureMeta. */
export function validateMeta(
  value: unknown,
  expected?: { service: string; scenario: string },
): string[] {
  const problems: string[] = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return ["meta must be a JSON object"];
  }
  const m = value as Record<string, unknown>;
  for (const key of ["service", "scenario", "description", "capturedAt"]) {
    if (typeof m[key] !== "string" || m[key] === "")
      problems.push(`${key} must be a non-empty string`);
  }
  if (!DIRECTIONS.includes(m["direction"] as string)) {
    problems.push(`direction must be one of ${DIRECTIONS.join(", ")}`);
  }
  if (!SOURCES.includes(m["source"] as string)) {
    problems.push(`source must be one of ${SOURCES.join(", ")}`);
  }
  if (!Array.isArray(m["references"]) || m["references"].some((r) => typeof r !== "string")) {
    problems.push("references must be an array of strings");
  }
  if (typeof m["capturedAt"] === "string" && Number.isNaN(Date.parse(m["capturedAt"]))) {
    problems.push("capturedAt must be an ISO date");
  }
  if (
    m["source"] === "synthetic-from-docs" &&
    (typeof m["todo"] !== "string" || m["todo"] === "")
  ) {
    problems.push("synthetic-from-docs fixtures must carry a todo to replace them with recordings");
  }
  if (expected) {
    if (m["service"] !== expected.service)
      problems.push(`service must equal directory name "${expected.service}"`);
    if (m["scenario"] !== expected.scenario)
      problems.push(`scenario must equal directory name "${expected.scenario}"`);
  }
  return problems;
}

export function assertMeta(
  value: unknown,
  expected?: { service: string; scenario: string },
): FixtureMeta {
  const problems = validateMeta(value, expected);
  if (problems.length > 0) throw new Error(`Invalid fixture meta: ${problems.join("; ")}`);
  return value as FixtureMeta;
}
