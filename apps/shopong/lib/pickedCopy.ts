// Removes the picker's own cached copy of an image once the Node has its bytes (story 3.7, review item 10). The web build
// must never call expo-file-system (it is not supported there), so the platform and the file calls are inputs: the caller
// passes `isWeb`, and the native file calls are only made when it is false. Cleanup never fails the attach: any error
// answers false.

export interface PickedCopyEnv {
  /** True on web: nothing is removed and no file call is made. */
  readonly isWeb: boolean;
  /** The app's cache folder, as a URI prefix. Only a copy under it is removed. */
  readonly cacheUri: () => Promise<string>;
  /** Removes one file by URI. */
  readonly removeFile: (uri: string) => Promise<void>;
}

/** True when the copy was removed. Never throws. */
export async function discardPickedCopy(uri: string, env: PickedCopyEnv): Promise<boolean> {
  if (env.isWeb) return false;
  try {
    const cache = await env.cacheUri();
    if (cache === "" || !uri.startsWith(cache)) return false;
    await env.removeFile(uri);
    return true;
  } catch {
    return false;
  }
}

export interface ReadPickedEnv {
  readonly isWeb: boolean;
  /** Web: reads a blob or http URI. */
  readonly fetchBytes: (uri: string) => Promise<Uint8Array>;
  /** Native: reads the picker's file with the file system. */
  readonly readFile: (uri: string) => Promise<Uint8Array>;
}

/**
 * The bytes of the picked image. On native, `fetch` cannot open the picker's file path (it is double-encoded, and fetch
 * answers the 14-byte text "File not found", which then looks like a file of the wrong kind), so the file system reads it.
 */
export async function readPickedBytes(uri: string, env: ReadPickedEnv): Promise<Uint8Array> {
  return env.isWeb ? env.fetchBytes(uri) : env.readFile(uri);
}
