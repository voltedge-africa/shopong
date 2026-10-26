// Where this phone keeps a file's bytes (story 3.7). Two areas, both named by hash (or a fixed name), never by a
// person's file name, so no name can reach a path:
//  - `pending`: bytes of a photo or price list that the Node has not yet kept. It must survive a restart, so it is in
//    the app's documents folder. It is removed once the Node has the bytes.
//  - `cache`: copies of files the Node already holds, so an open does not fetch them again. The phone may delete any of
//    these at any time (low storage, a sign-out, a repair): they are fetched again from the Node when opened.
// Native: expo-file-system (one file per hash). Web: memory only, so a reload loses pending bytes (shortcut S-3.7-8).

import type { Directory } from "expo-file-system";
import { Platform } from "react-native";

import { isStoreName, memoryByteStore, type ByteStore } from "./byteStore";
import { sha512Hex } from "./sha512";

export { type ByteStore } from "./byteStore";

/** One file per name in a folder. A write goes to a temporary file that is then moved over the old one. */
/**
 * expo-file-system is loaded only on native, when a store is made. The web build never loads it (it is not supported
 * there), so importing this module on web has no file-system side effect (review patch 2).
 */
function nativeFiles(): typeof import("expo-file-system") {
  return require("expo-file-system") as typeof import("expo-file-system");
}

export function fileByteStore(folder: Directory): ByteStore {
  const { File } = nativeFiles();
  return {
    async read(name) {
      if (!isStoreName(name)) return undefined;
      const file = new File(folder, name);
      if (!file.exists) return undefined;
      return file.bytes();
    },
    async write(name, bytes) {
      if (!isStoreName(name)) return false;
      try {
        const temp = new File(folder, `${name}.${Date.now()}.tmp`);
        temp.create({ overwrite: true, intermediates: true });
        await temp.write(bytes);
        const target = new File(folder, name);
        if (target.exists) target.delete();
        await temp.move(target);
        return true;
      } catch {
        return false;
      }
    },
    async remove(name) {
      if (!isStoreName(name)) return;
      const file = new File(folder, name);
      if (file.exists) file.delete();
    },
  };
}

/** The pending and cache stores of one identity. The DID is hashed into the folder name; it never appears in a path. */
export function createAttachmentStores(did: string): { pending: ByteStore; cache: ByteStore } {
  if (Platform.OS === "web") return { pending: memoryByteStore(), cache: memoryByteStore() };
  const { Directory, Paths } = nativeFiles();
  const id = sha512Hex(did).slice(0, 32);
  const pending = new Directory(Paths.document, `attachments-${id}`);
  const cache = new Directory(Paths.cache, `attachments-${id}`);
  // Creating a folder that exists is not an error for the store: each write makes its own file.
  for (const folder of [pending, cache]) {
    try {
      folder.create({ intermediates: true });
    } catch {
      // Already there.
    }
  }
  return { pending: fileByteStore(pending), cache: fileByteStore(cache) };
}
