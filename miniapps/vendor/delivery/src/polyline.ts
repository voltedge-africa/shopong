// Decodes a precision-6 encoded polyline (the Google algorithm, as the Node's routing writes it) into points. Plain
// arithmetic, no dependency. The page draws the line; the phone only passes the encoded text. A line that is cut short
// or holds a character outside the encoding is not a line: the decoder returns undefined, never NaN bounds (patch).

export interface LatLngPoint {
  readonly lat: number;
  readonly lng: number;
}

export function decodePolyline6(encoded: string): LatLngPoint[] | undefined {
  const points: LatLngPoint[] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  let broken = false;
  const next = (): number => {
    let result = 0;
    let shift = 1;
    let byte: number;
    do {
      if (index >= encoded.length) {
        broken = true;
        return 0;
      }
      byte = encoded.charCodeAt(index++) - 63;
      if (byte < 0 || byte > 63) {
        broken = true;
        return 0;
      }
      result += (byte & 0x1f) * shift;
      shift *= 32;
    } while (byte >= 0x20);
    return result % 2 === 1 ? -(result + 1) / 2 : result / 2;
  };
  while (index < encoded.length && !broken) {
    lat += next();
    lng += next();
    if (!broken) points.push({ lat: lat / 1e6, lng: lng / 1e6 });
  }
  return broken ? undefined : points;
}
