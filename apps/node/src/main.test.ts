// Runs the real entry point in a child process, so exit codes and the exact
// bytes written to stdout and stderr are what an operator would see.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { FAKE_SECRETS } from "./testing/capture.ts";

const MAIN = fileURLToPath(new URL("./main.ts", import.meta.url));
const REGISTER = fileURLToPath(new URL("./register.mjs", import.meta.url));
let dir: string;
let configPath: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "ocn-node-test-"));
  configPath = join(dir, "node.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      server: { host: "127.0.0.1", port: 0 },
      components: { ledger: { enabled: true }, payments: { enabled: true } },
    }),
  );
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function run(env: Record<string, string>) {
  const child = spawn(process.execPath, ["--import", REGISTER, MAIN, "--config", configPath], {
    env: { PATH: process.env["PATH"] ?? "", ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
  child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
  const exit = new Promise<number | null>((resolve) => child.on("close", (code) => resolve(code)));
  return { child, exit, out: () => ({ stdout, stderr }) };
}

describe("ocn node process", () => {
  it("refuses to start when a required secret is missing, naming the key and no values (AC 1.5a)", async () => {
    // STITCH_CLIENT_SECRET is missing; every other secret is present.
    const { STITCH_CLIENT_SECRET: _omitted, ...present } = FAKE_SECRETS;
    const proc = run(present);
    const code = await proc.exit;
    const { stdout, stderr } = proc.out();

    expect(code).not.toBe(0);
    expect(stderr).toContain("STITCH_CLIENT_SECRET");
    expect(stderr).toContain("refused to start");
    for (const value of Object.values(FAKE_SECRETS)) {
      expect(stdout).not.toContain(value);
      expect(stderr).not.toContain(value);
    }
    expect(stdout).not.toContain("listening");
  });

  it("names every missing key when several are missing", async () => {
    const proc = run({});
    expect(await proc.exit).not.toBe(0);
    const { stderr } = proc.out();
    for (const key of ["STITCH_CLIENT_ID", "STITCH_CLIENT_SECRET", "LEDFRA_API_TOKEN"]) {
      expect(stderr).toContain(key);
    }
  });

  it("starts with all secrets, reports healthy, logs no secret value and stops cleanly on SIGTERM", async () => {
    const proc = run({ ...FAKE_SECRETS });
    const port = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("node did not start in time")), 20_000);
      const poll = setInterval(() => {
        const match = /"url":"http:\/\/127\.0\.0\.1:(\d+)"/u.exec(proc.out().stdout);
        if (match) {
          clearTimeout(timer);
          clearInterval(poll);
          resolve(Number(match[1]));
        }
      }, 25);
      void proc.exit.then((code) => {
        clearTimeout(timer);
        clearInterval(poll);
        reject(new Error(`node exited early with ${code}: ${proc.out().stderr}`));
      });
    });

    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "ok" });

    proc.child.kill("SIGTERM");
    expect(await proc.exit).toBe(0);
    const { stdout, stderr } = proc.out();
    for (const value of Object.values(FAKE_SECRETS)) {
      expect(stdout).not.toContain(value);
      expect(stderr).not.toContain(value);
    }
  }, 30_000);
});
