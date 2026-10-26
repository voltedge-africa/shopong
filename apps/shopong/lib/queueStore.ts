// Where this phone keeps its offline queue (story 3.4, Q1 and reviews P1, P5, P6). Native: one JSON file per identity
// in the app's private documents folder (`outboxName.ts`). Each write goes to a temporary file with its own name, and
// the temporary file is then moved over the old one, so a cut power leaves the old list or the new one. An unreadable
// file is moved aside. Web: memory only, so a reload loses the queue (the card says so). The queue holds envelopes only.

import { Directory, File, Paths } from "expo-file-system";
import { Platform } from "react-native";

import { createFileQueue, memoryQueue, type FileIo, type OfflineQueue } from "./offlineQueue";
import { outboxNameFor } from "./outboxName";

/** The queue of one identity. The DID is hashed into the file name; it never appears in a path. */
export function createQueueStore(did: string): OfflineQueue {
  if (Platform.OS === "web") return memoryQueue();
  const folder: Directory = Paths.document;
  const name = outboxNameFor(did);
  const file = new File(folder, name);
  let writes = 0;

  /** Temporary files of this queue, oldest first. Their names carry a zero-padded time, so they sort by age. */
  const temporaries = (): File[] =>
    folder
      .list()
      .filter(
        (entry): entry is File =>
          entry instanceof File && entry.name.startsWith(`${name}.`) && entry.name.endsWith(".tmp"),
      )
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const io: FileIo = {
    read: async () => {
      if (file.exists) return file.text();
      // A write was cut between removing the old file and moving the new one: the newest temporary file holds the list.
      const newest = temporaries().at(-1);
      return newest === undefined ? null : newest.text();
    },
    write: async (text) => {
      writes += 1;
      const temp = new File(
        folder,
        `${name}.${Date.now().toString().padStart(15, "0")}-${writes}.tmp`,
      );
      temp.create({ overwrite: true, intermediates: true });
      await temp.write(text);
      if (file.exists) file.delete();
      await temp.move(file);
      for (const leftover of temporaries()) leftover.delete();
    },
    setAside: async () => {
      const bad = new File(folder, `${name}.bad-${Date.now()}`);
      if (file.exists) {
        await file.move(bad);
        return;
      }
      const newest = temporaries().at(-1);
      if (newest !== undefined) await newest.move(bad);
    },
  };
  return createFileQueue(io);
}
