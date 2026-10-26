// The route fingerprint (story 7.4): SHA-512 of the route's line and the tile release it was computed on, as hex.
// `delivery.planned` carries it, so the record names one route without holding the line, which stays on the Node.

import { canonicalize } from "./canonical.js";
import { encodeUtf8 } from "./utf8.js";
import { sha512Hex, type Sha512 } from "./hash.js";

/** SHA-512 (128 hex characters) of the canonical JSON of the polyline and the tile release. */
export function routeFingerprint(
  polyline6: string,
  tileRelease: string,
  sha512: Sha512,
): Promise<string> {
  return sha512Hex(encodeUtf8(canonicalize({ polyline6, tileRelease })), sha512);
}
