// SHA-512 of a file, as lowercase hex. Streams the file so a large graph.tar is never read whole into memory.
import { createHash } from "node:crypto";
import { openSync, readSync, closeSync } from "node:fs";
import { open } from "node:fs/promises";

const CHUNK = 1024 * 1024;

export function sha512Bytes(bytes: Uint8Array | string): string {
  return createHash("sha512").update(bytes).digest("hex");
}

export function sha512FileSync(path: string): string {
  const hash = createHash("sha512");
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(CHUNK);
    for (;;) {
      const read = readSync(fd, buffer, 0, CHUNK, null);
      if (read === 0) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

export async function sha512FileAsync(path: string): Promise<string> {
  const hash = createHash("sha512");
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(CHUNK);
    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, CHUNK, null);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}
