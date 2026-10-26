// Test helpers only: replicate two in-process spaces over a pipe, the way two Nodes would once connected.
import type { Space } from "@shopong/ports";
import { baseOf } from "./record.js";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Exchange what both replicas hold for the space, then wait until the transfer settles (the
 * lengths of both logs stop moving), and update both views.
 */
export async function replicatePair(a: Space<unknown>, b: Space<unknown>): Promise<void> {
  const left = baseOf(a);
  const right = baseOf(b);
  const s1 = left.replicate(true);
  const s2 = right.replicate(false);
  s1.on("error", () => {});
  s2.on("error", () => {});
  s1.pipe(s2).pipe(s1);
  try {
    let last = "";
    let stable = 0;
    const deadline = Date.now() + 30_000;
    while (stable < 4) {
      await sleep(10);
      await left.update();
      await right.update();
      const signature = `${left.length}/${right.length}/${left.view.version}/${right.view.version}`;
      stable = signature === last ? stable + 1 : 0;
      last = signature;
      if (Date.now() > deadline) throw new Error("replication did not settle within 30 s");
    }
  } finally {
    s1.destroy();
    s2.destroy();
  }
  await a.update();
  await b.update();
}

/** The whole view as the port shows it, for comparing replicas. */
export async function viewSnapshot(space: Space<unknown>): Promise<string> {
  await space.update();
  return JSON.stringify(await space.view.list(""));
}
