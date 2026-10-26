// The phone's named byte stores (story 3.7), without any native module, so the tests can run them. A store holds bytes
// under a name that is a SHA-512 hex (128 characters) or the fixed name `index.json`; any other name is refused, so a
// person's file name never reaches a path. The native store (`attachmentStore.ts`) keeps the same contract on disk.

/** A store of named byte blobs. Names are a 128-character hash or a fixed text name; anything else is refused. */
export interface ByteStore {
  read(name: string): Promise<Uint8Array | undefined>;
  write(name: string, bytes: Uint8Array): Promise<boolean>;
  remove(name: string): Promise<void>;
}

/** Hashes and the index file are the only names. Nothing else can name a file on this phone. */
/**
 * A cached copy is named by its community and its hash (`<community key>-<hash>`), so one community's copy never answers
 * for another's. The pending bytes are named by hash alone.
 */
export const cacheNameOf = (community: string, hash: string): string => `${community}-${hash}`;

export const isStoreName = (name: string): boolean =>
  /^[0-9a-f]{128}$|^[0-9a-f]{64}-[0-9a-f]{128}$|^index\.json$/.test(name);

export function memoryByteStore(): ByteStore {
  const blobs = new Map<string, Uint8Array>();
  return {
    async read(name) {
      if (!isStoreName(name)) return undefined;
      const bytes = blobs.get(name);
      return bytes === undefined ? undefined : new Uint8Array(bytes);
    },
    async write(name, bytes) {
      if (!isStoreName(name)) return false;
      blobs.set(name, new Uint8Array(bytes));
      return true;
    },
    async remove(name) {
      blobs.delete(name);
    },
  };
}
