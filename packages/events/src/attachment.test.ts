import { describe, expect, it } from "vite-plus/test";
import {
  checkFileBytes,
  detectType,
  fileAttachedIssues,
  fromBase64,
  recordNameOf,
  stripMetadata,
  toBase64,
} from "./index.js";

const ascii = (text: string) => Array.from(text, (ch) => ch.charCodeAt(0));
const u16 = (n: number) => [(n >> 8) & 255, n & 255];
const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
const u32le = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];

/** A JPEG with an EXIF block carrying a GPS position and a time, a comment, and a scan with image bytes. */
function jpegWithGps(): Uint8Array {
  const exif = [
    ...ascii("Exif\0\0"),
    ...ascii("GPSLatitude 26.2041 S GPSLongitude 28.0473 E DateTimeOriginal 2026:10:26 09:14:02"),
  ];
  const comment = ascii("taken at home");
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xe1,
    ...u16(exif.length + 2),
    ...exif,
    0xff,
    0xfe,
    ...u16(comment.length + 2),
    ...comment,
    0xff,
    0xdb,
    ...u16(4),
    0x00,
    0x01,
    0xff,
    0xda,
    ...u16(4),
    0x01,
    0x02, // start of scan
    0x11,
    0x22,
    0x33, // image data
    0xff,
    0xd9,
  ]);
}

/** A PNG with a text chunk naming the author, an eXIf chunk with GPS, and the picture chunks. */
function pngWithGps(): Uint8Array {
  const chunk = (type: string, data: number[]) => [
    ...u32be(data.length),
    ...ascii(type),
    ...data,
    0,
    0,
    0,
    0,
  ];
  return new Uint8Array([
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a,
    ...chunk("IHDR", [0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]),
    ...chunk("tEXt", ascii("Author\0Thandi Mokoena")),
    ...chunk("eXIf", ascii("GPSLatitude 26.2041 S GPSLongitude 28.0473 E")),
    ...chunk("IDAT", [1, 2, 3]),
    ...chunk("IEND", []),
  ]);
}

/** A WebP with a VP8X header (EXIF, XMP and ICC flags set), an EXIF chunk with GPS, an XMP chunk and the picture. */
function webpWithGps(): Uint8Array {
  const chunk = (fourcc: string, data: number[]) => [
    ...ascii(fourcc),
    ...u32le(data.length),
    ...data,
    ...(data.length % 2 === 1 ? [0] : []),
  ];
  const body = [
    ...chunk("VP8X", [0x2c, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    ...chunk("EXIF", ascii("GPSLatitude 26.2041 S GPSLongitude 28.0473 E")),
    ...chunk("XMP ", ascii("<x:xmpmeta>creator Thandi</x:xmpmeta>")),
    ...chunk("VP8L", [0x2f, 0, 0, 0, 0]),
  ];
  return new Uint8Array([...ascii("RIFF"), ...u32le(4 + body.length), ...ascii("WEBP"), ...body]);
}

const text = (bytes: Uint8Array) => String.fromCharCode(...bytes);

describe("file types", () => {
  it("reads the type from the bytes, not from the name", () => {
    expect(detectType(jpegWithGps())).toBe("image/jpeg");
    expect(detectType(pngWithGps())).toBe("image/png");
    expect(detectType(webpWithGps())).toBe("image/webp");
    expect(detectType(new Uint8Array(ascii("%PDF-1.7 body")))).toBe("application/pdf");
  });

  it("refuses a zip and an HEIC file as the wrong kind", () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
    const heic = new Uint8Array([0, 0, 0, 24, ...ascii("ftypheic"), 0, 0, 0, 0]);
    expect(checkFileBytes(zip, "price-list")).toMatchObject({ ok: false, problem: "wrong_type" });
    expect(checkFileBytes(heic, "delivery-photo")).toMatchObject({
      ok: false,
      problem: "wrong_type",
    });
  });

  it("refuses a declared type the bytes do not have", () => {
    expect(checkFileBytes(jpegWithGps(), "delivery-photo", "image/png")).toMatchObject({
      ok: false,
      problem: "wrong_type",
    });
  });

  it("refuses a type the purpose does not take (a PDF photo, a WebP price list)", () => {
    expect(checkFileBytes(new Uint8Array(ascii("%PDF-1.7")), "delivery-photo")).toMatchObject({
      ok: false,
      problem: "wrong_type",
    });
    expect(checkFileBytes(webpWithGps(), "price-list")).toMatchObject({
      ok: false,
      problem: "wrong_type",
    });
  });
});

describe("size limits", () => {
  it("refuses a photo over 5 MB and accepts one at the limit", () => {
    const limit = 5 * 1024 * 1024;
    const over = new Uint8Array(limit + 1);
    over.set([0xff, 0xd8, 0xff]);
    expect(checkFileBytes(over, "delivery-photo")).toEqual({
      ok: false,
      problem: "too_big",
      message: "That file is too big (limit 5 MB).",
    });
    const atLimit = new Uint8Array(limit);
    atLimit.set([0xff, 0xd8, 0xff]);
    expect(checkFileBytes(atLimit, "delivery-photo")).toMatchObject({ problem: "unreadable" });
  });

  it("refuses a price list over 10 MB with its own sentence", () => {
    const over = new Uint8Array(10 * 1024 * 1024 + 1);
    over.set(ascii("%PDF-"));
    expect(checkFileBytes(over, "price-list")).toEqual({
      ok: false,
      problem: "too_big",
      message: "That file is too big (limit 10 MB).",
    });
  });
});

describe("metadata strip", () => {
  it("removes EXIF, GPS, time and comments from a JPEG, and keeps the image data", () => {
    const stored = stripMetadata(jpegWithGps(), "image/jpeg")!;
    expect(text(stored)).not.toContain("GPS");
    expect(text(stored)).not.toContain("Exif");
    expect(text(stored)).not.toContain("DateTimeOriginal");
    expect(text(stored)).not.toContain("taken at home");
    expect(Array.from(stored.slice(-6))).toEqual(
      [0x01, 0x02, 0x11, 0x22, 0x33, 0xff, 0xd9].slice(-6),
    );
    expect(detectType(stored)).toBe("image/jpeg");
  });

  it("removes text and EXIF chunks from a PNG and keeps the picture chunks", () => {
    const stored = stripMetadata(pngWithGps(), "image/png")!;
    expect(text(stored)).not.toContain("GPS");
    expect(text(stored)).not.toContain("Thandi");
    expect(text(stored)).not.toContain("tEXt");
    expect(text(stored)).toContain("IDAT");
    expect(text(stored)).toContain("IEND");
    expect(detectType(stored)).toBe("image/png");
  });

  it("removes EXIF and XMP from a WebP and clears their flags", () => {
    const stored = stripMetadata(webpWithGps(), "image/webp")!;
    expect(text(stored)).not.toContain("GPS");
    expect(text(stored)).not.toContain("Thandi");
    expect(text(stored)).not.toContain("EXIF");
    expect(text(stored)).toContain("VP8L");
    expect(stored[20]).toBe(0x00); // the VP8X flags byte: 0x2c with EXIF, XMP and ICC cleared
    expect(detectType(stored)).toBe("image/webp");
  });

  it("is the same on a second pass, so the Node and the phone agree on the hash", () => {
    for (const [bytes, type] of [
      [jpegWithGps(), "image/jpeg"],
      [pngWithGps(), "image/png"],
      [webpWithGps(), "image/webp"],
    ] as const) {
      const once = stripMetadata(bytes, type)!;
      expect(Array.from(stripMetadata(once, type)!)).toEqual(Array.from(once));
    }
  });

  it("refuses a file cut off in the middle, rather than keeping half of it", () => {
    const cut = pngWithGps().slice(0, 40);
    expect(checkFileBytes(cut, "delivery-photo")).toMatchObject({
      ok: false,
      problem: "unreadable",
    });
  });
});

describe("file.attached payload shape", () => {
  const photo = {
    hash: "a".repeat(128),
    size: 1000,
    type: "image/jpeg",
    name: "Delivery photo aaaaaaaa",
    purpose: "delivery-photo",
    order: "Spaza restock",
  };

  it("accepts a well-formed photo and price list", () => {
    expect(fileAttachedIssues(photo)).toEqual([]);
    expect(
      fileAttachedIssues({
        ...photo,
        type: "application/pdf",
        purpose: "price-list",
        name: "Price list aaaaaaaa",
        supplier: "Makro",
        size: 5000,
      }),
    ).toEqual([]);
  });

  it("refuses an extra field", () => {
    expect(fileAttachedIssues({ ...photo, gps: "26.2 S" }).length).toBeGreaterThan(0);
  });

  it("refuses a hash that is not 128 lowercase hex characters", () => {
    expect(fileAttachedIssues({ ...photo, hash: "A".repeat(128) }).map((i) => i.path)).toContain(
      "$.payload.hash",
    );
    expect(fileAttachedIssues({ ...photo, hash: "a".repeat(127) }).map((i) => i.path)).toContain(
      "$.payload.hash",
    );
  });

  it("refuses a size over the purpose's limit and a type the purpose does not take", () => {
    expect(
      fileAttachedIssues({ ...photo, size: 5 * 1024 * 1024 + 1 }).map((i) => i.path),
    ).toContain("$.payload.size");
    expect(fileAttachedIssues({ ...photo, type: "application/pdf" }).map((i) => i.path)).toContain(
      "$.payload.type",
    );
  });

  it("refuses a price list with no supplier, and a photo that names one", () => {
    expect(
      fileAttachedIssues({ ...photo, purpose: "price-list", type: "application/pdf" }).map(
        (i) => i.path,
      ),
    ).toContain("$.payload.supplier");
    expect(fileAttachedIssues({ ...photo, supplier: "Makro" }).map((i) => i.path)).toContain(
      "$.payload.supplier",
    );
  });

  it("refuses a traversal or a control character in the file name", () => {
    for (const name of ["../secret", "a/b", "Price list 1a2b3c4d\n", "x".repeat(121)]) {
      expect(fileAttachedIssues({ ...photo, name }).map((i) => i.path)).toContain("$.payload.name");
    }
    expect(recordNameOf("delivery-photo", "1a2b3c4d".padEnd(128, "0"))).toBe(
      "Delivery photo 1a2b3c4d",
    );
  });
});

describe("base64 for file bytes", () => {
  it("round-trips every length and rejects text that is not base64", () => {
    for (let n = 0; n < 9; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255);
      expect(Array.from(fromBase64(toBase64(bytes))!)).toEqual(Array.from(bytes));
    }
    expect(fromBase64("QUJD")).toEqual(new Uint8Array(ascii("ABC")));
    expect(fromBase64("QUI=")).toEqual(new Uint8Array(ascii("AB")));
    expect(fromBase64("QUJ")).toBeUndefined();
    expect(fromBase64("QU=D")).toBeUndefined();
    expect(fromBase64("Q!JD")).toBeUndefined();
  });
});

// ---- review patch: bytes after the image, scan stuffing, WebP allow-list, the record name --------------------------

/** A JPEG whose scan has a stuffed 0xFF00, a restart marker and a stray 0xFF fill, then the end marker, then a video blob. */
function jpegWithTrailer(): Uint8Array {
  const video = ascii("ftypmp42 mdat GPSLatitude 26.2041 S GPSLongitude 28.0473 E 2026:10:26");
  return new Uint8Array([
    0xff,
    0xd8,
    0xff,
    0xda,
    ...u16(4),
    0x01,
    0x02,
    0x11,
    0xff,
    0x00,
    0x22,
    0xff,
    0xd0,
    0x33,
    0x44,
    0xff,
    0xd9,
    ...video,
  ]);
}

const webpChunk = (fourcc: string, data: number[]) => [
  ...ascii(fourcc),
  ...u32le(data.length),
  ...data,
  ...(data.length % 2 === 1 ? [0] : []),
];

/** A WebP with a private vendor chunk carrying GPS, and bytes after the RIFF end. */
function webpWithVendorAndTrailer(): Uint8Array {
  const body = [
    ...webpChunk("VP8X", [0x2c, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
    ...webpChunk("VNDR", ascii("GPSLatitude 26.2041 S GPSLongitude 28.0473 E")),
    ...webpChunk("VP8L", [0x2f, 0, 0, 0, 0]),
  ];
  const riff = [...ascii("RIFF"), ...u32le(4 + body.length), ...ascii("WEBP"), ...body];
  return new Uint8Array([...riff, ...ascii("GPSLatitude trailing after the RIFF end")]);
}

describe("review patch: what is kept", () => {
  it("drops everything after the end-of-image marker, such as a motion photo's video with GPS", () => {
    const stored = stripMetadata(jpegWithTrailer(), "image/jpeg")!;
    expect(text(stored)).not.toContain("GPS");
    expect(text(stored)).not.toContain("ftyp");
    expect(Array.from(stored.slice(-2))).toEqual([0xff, 0xd9]);
  });

  it("keeps the scan's stuffed bytes and restart markers intact up to the end marker", () => {
    const stored = stripMetadata(jpegWithTrailer(), "image/jpeg")!;
    expect(Array.from(stored)).toEqual([
      0xff, 0xd8, 0xff, 0xda, 0x00, 0x04, 0x01, 0x02, 0x11, 0xff, 0x00, 0x22, 0xff, 0xd0, 0x33,
      0x44, 0xff, 0xd9,
    ]);
  });

  it("drops a private vendor chunk and every byte after the RIFF end from a WebP", () => {
    const stored = stripMetadata(webpWithVendorAndTrailer(), "image/webp")!;
    expect(text(stored)).not.toContain("GPS");
    expect(text(stored)).not.toContain("VNDR");
    expect(text(stored)).not.toContain("trailing");
    expect(text(stored)).toContain("VP8L");
    expect(detectType(stored)).toBe("image/webp");
  });
});

describe("review patch: the name in the record is generated, never the person's file name", () => {
  const hash = "a".repeat(128);
  const photo = {
    hash,
    size: 1000,
    type: "image/jpeg",
    name: "Delivery photo aaaaaaaa",
    purpose: "delivery-photo",
    order: "Spaza restock",
  };

  it("accepts the generated label for the purpose and the file's short hash", () => {
    expect(fileAttachedIssues(photo)).toEqual([]);
  });

  it("refuses a street address as the name, so it never reaches the record", () => {
    expect(
      fileAttachedIssues({ ...photo, name: "14 Kgosi Street gate.jpg" }).map((i) => i.path),
    ).toContain("$.payload.name");
  });

  it("refuses a generated label that does not match the purpose or the hash", () => {
    expect(
      fileAttachedIssues({ ...photo, name: "Price list aaaaaaaa" }).map((i) => i.path),
    ).toContain("$.payload.name");
    expect(
      fileAttachedIssues({ ...photo, name: "Delivery photo bbbbbbbb" }).map((i) => i.path),
    ).toContain("$.payload.name");
  });
});
