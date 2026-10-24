#!/usr/bin/env python3
"""Generate the synthetic supplier documents in this directory.

    python3 samples/generate.py

Needs python3 and Pillow (`pip install pillow`) for the PNG; the PDFs use only the standard library.
Everything is fictional and watermarked "SAMPLE - NOT REAL". Output is deterministic (fixed seeds,
no timestamps) so re-running should reproduce the files, and it rewrites the ground-truth blocks in
samples/README.md and samples/ground-truth.json from the same data.
"""
import json
import random
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
CURRENCY = "ZAR"
WATERMARK = "SAMPLE - NOT REAL"
FOOTER = "Synthetic document for software testing. Fictional supplier, fictional prices."

# --- data ------------------------------------------------------------------------------------
# Ground-truth row: item, unit (what the price applies to), packSize (printed pack contents or None),
# priceMinorUnits (cents), currency.

MZANSI = "Mzansi Wholesale Traders (SAMPLE)"
KAROO = "Karoo Grain Mills (SAMPLE)"
UBUNTU = "Ubuntu Cash & Carry (SAMPLE)"
BUYER = "Sunrise Stokvel Buying Club (SAMPLE)"

PL_MZANSI = [  # (item, packSize, unit, cents)
    ("Super maize meal", "12.5 kg", "bag", 12990),
    ("Super maize meal", "5 kg", "bag", 5990),
    ("Long grain white rice", "10 kg", "bag", 16450),
    ("Sunflower cooking oil", "12 x 750 ml", "carton", 48900),
    ("White sugar", "10 kg", "bag", 17900),
    ("Iodated table salt", "6 x 2 kg", "carton", 6240),
    ("Pilchards in tomato sauce", "24 x 400 g", "case", 39500),
    ("Rooibos tea bags", "12 x 80s", "case", 29880),
]
PL_KAROO = [
    ("Samp", "10 kg", "bag", 11499),
    ("Sugar beans", "10 kg", "bag", 21900),
    ("Cake wheat flour", "6 x 2.5 kg", "carton", 12750),
    ("Maize meal special", "12.5 kg", "bag", 12499),
    ("Brown bread flour", "10 kg", "bag", 9850),
    ("Mealie rice", "10 kg", "bag", 10200),
]
PL_UBUNTU = [
    ("Super maize meal", "25 kg", "bag", 24500),
    ("Long grain white rice", "2 kg x 6", "carton", 9890),
    ("Sunflower cooking oil", "5 L", "drum", 11990),
    ("Sunflower cooking oil", "750 ml x 12", "carton", 47500),
    ("White sugar", "2.5 kg x 4", "carton", 8990),
    ("Instant porridge", "500 g x 20", "carton", 25600),
    ("Peanut butter", "400 g x 12", "carton", 31200),
    ("Tinned baked beans", "410 g x 24", "case", 27800),
    ("Washing powder", "2 kg x 6", "carton", 28900),
]
# Invoice / delivery lines: (item, packSize, unit, unit price cents, qty ordered, qty delivered)
INV_MZANSI = [
    ("Super maize meal", "12.5 kg", "bag", 12990, 20, 20),
    ("Long grain white rice", "10 kg", "bag", 16450, 10, 10),
    ("Sunflower cooking oil", "12 x 750 ml", "carton", 48900, 4, 3),
    ("White sugar", "10 kg", "bag", 17900, 6, 6),
]
INV_UBUNTU = [
    ("Super maize meal", "25 kg", "bag", 24500, 8, 8),
    ("Instant porridge", "500 g x 20", "carton", 25600, 3, 3),
    ("Peanut butter", "400 g x 12", "carton", 31200, 2, 2),
    ("Tinned baked beans", "410 g x 24", "case", 27800, 2, 1),
    ("Washing powder", "2 kg x 6", "carton", 28900, 1, 1),
]


def rand(cents):
    return f"{cents // 100}.{cents % 100:02d}"


def price_row(r):
    return {"item": r[0], "unit": r[2], "packSize": r[1], "priceMinorUnits": r[3], "currency": CURRENCY}


def invoice_rows(lines):
    return [
        {**price_row(l), "quantity": l[4], "lineTotalMinorUnits": l[3] * l[4]} for l in lines
    ]


def delivery_rows(lines):
    return [
        {"item": l[0], "unit": l[2], "packSize": l[1], "quantityOrdered": l[4], "quantityDelivered": l[5]}
        for l in lines
    ]


# --- minimal PDF writer (Helvetica, no timestamps) --------------------------------------------
class Pdf:
    W, H = 595, 842

    def __init__(self):
        self.ops = []

    @staticmethod
    def esc(s):
        s.encode("latin-1")  # fail loudly on anything outside WinAnsi
        return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

    def text(self, x, y, s, size=10, bold=False, gray=0.0, right=False):
        w = self.width(s, size, bold)
        if right:
            x -= w
        self.ops.append(
            f"BT /{'F2' if bold else 'F1'} {size} Tf {gray:.2f} g {x:.1f} {self.H - y:.1f} Td ({self.esc(s)}) Tj ET"
        )

    @staticmethod
    def width(s, size, bold=False):
        return len(s) * size * (0.58 if bold else 0.54)  # rough Helvetica average; layout only

    def line(self, x1, y1, x2, y2, w=0.5, gray=0.0):
        self.ops.append(f"{gray:.2f} G {w} w {x1} {self.H - y1} m {x2} {self.H - y2} l S")

    def rect(self, x, y, w, h, gray):
        self.ops.append(f"{gray:.2f} g {x} {self.H - y - h} {w} {h} re f")

    def watermark(self):
        import math

        a = math.radians(35)
        c, s = math.cos(a), math.sin(a)
        # first in the stream, so page content is drawn on top of it
        self.ops.insert(0,
            f"BT /F2 54 Tf 0.86 g {c:.4f} {s:.4f} {-s:.4f} {c:.4f} 70 250 Tm ({self.esc(WATERMARK)}) Tj ET"
        )

    def save(self, path):
        self.watermark()
        self.text(40, 820, FOOTER, 7, gray=0.4)
        stream = "\n".join(self.ops).encode("latin-1")
        objs = [
            b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {self.W} {self.H}] /Contents 4 0 R "
            "/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>".encode(),
            b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"\nendstream",
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
        ]
        out = bytearray(b"%PDF-1.4\n")
        offsets = []
        for i, body in enumerate(objs, 1):
            offsets.append(len(out))
            out += f"{i} 0 obj\n".encode() + body + b"\nendobj\n"
        xref = len(out)
        out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
        for o in offsets:
            out += f"{o:010d} 00000 n \n".encode()
        out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
        Path(path).write_bytes(bytes(out))


def table(pdf, x, y, cols, rows, row_h=20, header_gray=0.88):
    """cols: [(title, width, align)]; rows: list of lists of str. Returns y below the table."""
    total = sum(w for _, w, _ in cols)
    pdf.rect(x, y, total, row_h, header_gray)
    cx = x
    for title, w, align in cols:
        pdf.text(cx + (w - 6 if align == "r" else 6), y + 14, title, 9, bold=True, right=align == "r")
        cx += w
    y += row_h
    for r in rows:
        cx = x
        for (_, w, align), cell in zip(cols, r):
            pdf.text(cx + (w - 6 if align == "r" else 6), y + 14, cell, 9.5, right=align == "r")
            cx += w
        y += row_h
        pdf.line(x, y, x + total, y, 0.3, 0.6)
    pdf.line(x, y - row_h * (len(rows) + 1), x, y, 0.5)
    pdf.line(x + total, y - row_h * (len(rows) + 1), x + total, y, 0.5)
    return y


def header(pdf, supplier, title, lines):
    pdf.text(40, 60, supplier, 16, bold=True)
    pdf.text(40, 82, title, 12)
    y = 104
    for l in lines:
        pdf.text(40, y, l, 9.5, gray=0.25)
        y += 14
    return y + 12


def pdf_price_list_clean(path):
    p = Pdf()
    y = header(p, MZANSI, "PRICE LIST - effective 1 November 2026",
               ["12 Fictional Road, Nowhereville 0000", "Prices in South African Rand (ZAR), per pack as sold. Not valid for real orders."])
    cols = [("Item", 200, "l"), ("Pack size", 110, "l"), ("Sold per", 80, "l"), ("Price (R)", 125, "r")]
    table(p, 40, y, cols, [[i, ps, u, rand(c)] for i, ps, u, c in PL_MZANSI], 24)
    p.save(path)


def pdf_price_list_packs(path):
    p = Pdf()
    y = header(p, UBUNTU, "WHOLESALE PRICE LIST - pack sizes and case prices",
               ["77 Imaginary Street, Faketown 1111", "Prices in ZAR. A 'case' or 'carton' is priced as a whole; 'drum' and 'bag' as one."])
    cols = [("Product", 170, "l"), ("Pack size", 120, "l"), ("Unit", 70, "l"), ("Price per unit (R)", 135, "r")]
    table(p, 40, y, cols, [[i, ps, u, rand(c)] for i, ps, u, c in PL_UBUNTU], 26)
    p.text(40, y + 26 * (len(PL_UBUNTU) + 1) + 24, "Pack size reads 'N x S' = N items of size S inside one case/carton.", 8.5, gray=0.3)
    p.save(path)


def pdf_invoice(path, supplier, number, date, lines):
    p = Pdf()
    y = header(p, supplier, f"TAX INVOICE {number}", [f"Date: {date}", f"Bill to: {BUYER}", "Terms: payment on delivery. Not a real invoice."])
    cols = [("Item", 175, "l"), ("Pack size", 90, "l"), ("Unit", 50, "l"), ("Qty", 35, "r"), ("Unit price", 75, "r"), ("Total (R)", 90, "r")]
    rows = [[i, ps, u, str(q), rand(c), rand(c * q)] for i, ps, u, c, q, _ in lines]
    y = table(p, 40, y, cols, rows, 22)
    sub = sum(l[3] * l[4] for l in lines)
    vat = round(sub * 15 / 115)
    p.text(515, y + 22, f"Total incl. VAT: R {rand(sub)}", 11, bold=True, right=True)
    p.text(515, y + 38, f"of which VAT 15%: R {rand(vat)}", 9.5, right=True)
    p.save(path)
    return sub


def pdf_delivery_note(path, supplier, number, ref, date, lines):
    p = Pdf()
    y = header(p, supplier, f"DELIVERY NOTE {number}", [f"Date: {date}", f"Deliver to: {BUYER}", f"Ref: {ref}"])
    cols = [("Item", 190, "l"), ("Pack size", 100, "l"), ("Unit", 55, "l"), ("Ordered", 70, "r"), ("Delivered", 80, "r")]
    rows = [[i, ps, u, str(q), str(d)] for i, ps, u, _, q, d in lines]
    y = table(p, 40, y, cols, rows, 22)
    short = [l for l in lines if l[5] < l[4]]
    if short:
        p.text(40, y + 28, "Short delivered: " + "; ".join(f"{l[0]} ({l[5]} of {l[4]})" for l in short), 9.5, bold=True)
    p.text(40, y + 70, "Received by: ____________________   Signature: ____________________", 9.5)
    p.save(path)


# --- low-contrast "photographed" PNG ------------------------------------------------------------
def png_price_list_photo(path):
    from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

    W, H = 1000, 1400
    sans = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    bold = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"

    def font(f, size):
        try:
            return ImageFont.truetype(f, size)
        except OSError:
            return ImageFont.load_default(size)

    page = Image.new("L", (W, H), 176)  # grey paper, deliberately low contrast
    d = ImageDraw.Draw(page)
    ink = 118
    d.text((70, 90), KAROO, font=font(bold, 38), fill=ink)
    d.text((70, 150), "PRICE LIST  Nov 2026", font=font(sans, 28), fill=ink)
    d.text((70, 195), "Prices in Rand. Per pack. Sample only.", font=font(sans, 22), fill=ink + 6)
    y = 270
    f = font(sans, 27)
    d.text((70, y), "Product", font=font(bold, 24), fill=ink)
    d.text((470, y), "Pack", font=font(bold, 24), fill=ink)
    d.text((690, y), "Per", font=font(bold, 24), fill=ink)
    d.text((900, y), "Price", font=font(bold, 24), fill=ink, anchor="ra")
    y += 44
    d.line((60, y - 8, 940, y - 8), fill=ink + 14, width=2)
    for item, pack, unit, cents in PL_KAROO:
        d.text((70, y), item, font=f, fill=ink)
        d.text((470, y), pack, font=f, fill=ink)
        d.text((690, y), unit, font=f, fill=ink)
        d.text((930, y), f"R{rand(cents)}", font=f, fill=ink, anchor="ra")
        y += 62
        d.line((60, y - 14, 940, y - 14), fill=ink + 40, width=1)
    # watermark
    wm = Image.new("L", (900, 160), 0)
    ImageDraw.Draw(wm).text((10, 40), WATERMARK, font=font(bold, 80), fill=26)
    wm = wm.rotate(30, expand=True)
    page.paste(ImageChops.subtract(page.crop((50, 750, 50 + wm.width, 750 + wm.height)), wm), (50, 750))
    d.text((70, H - 70), "Synthetic document for software testing. Fictional.", font=font(sans, 17), fill=ink + 20)
    # photo effects: slight skew, uneven light, blur, sensor noise
    page = page.rotate(1.6, resample=Image.BICUBIC, fillcolor=120, expand=False)
    light = Image.radial_gradient("L").resize((W, H))  # 0 centre -> 255 edge
    page = ImageChops.subtract(page, light.point(lambda v: v * 55 // 255))
    page = page.filter(ImageFilter.GaussianBlur(1.1))
    rng = random.Random(20261024)
    noise = Image.frombytes("L", (W, H), rng.randbytes(W * H)).point(lambda v: v // 32)  # 0..7
    page = ImageChops.add(page, noise, 1, -3)
    page = page.point(lambda v: v // 6 * 6)  # coarse levels keep the PNG small
    page.save(path, optimize=True)


# --- README ground truth --------------------------------------------------------------------------
DOCS = {
    "price-list-mzansi-clean.pdf": ("price list", [price_row(r) for r in PL_MZANSI]),
    "price-list-karoo-photo.png": ("price list", [price_row(r) for r in PL_KAROO]),
    "price-list-ubuntu-pack-sizes.pdf": ("price list", [price_row(r) for r in PL_UBUNTU]),
    "invoice-mzansi-0001.pdf": ("invoice", invoice_rows(INV_MZANSI)),
    "invoice-ubuntu-0007.pdf": ("invoice", invoice_rows(INV_UBUNTU)),
    "delivery-note-mzansi-0001.pdf": ("delivery note", delivery_rows(INV_MZANSI)),
    "delivery-note-ubuntu-0007.pdf": ("delivery note", delivery_rows(INV_UBUNTU)),
}


def main():
    pdf_price_list_clean(HERE / "price-list-mzansi-clean.pdf")
    pdf_price_list_packs(HERE / "price-list-ubuntu-pack-sizes.pdf")
    png_price_list_photo(HERE / "price-list-karoo-photo.png")
    pdf_invoice(HERE / "invoice-mzansi-0001.pdf", MZANSI, "SAMPLE-INV-0001", "3 November 2026", INV_MZANSI)
    pdf_invoice(HERE / "invoice-ubuntu-0007.pdf", UBUNTU, "SAMPLE-INV-0007", "4 November 2026", INV_UBUNTU)
    pdf_delivery_note(HERE / "delivery-note-mzansi-0001.pdf", MZANSI, "SAMPLE-DN-0001", "SAMPLE-INV-0001", "5 November 2026", INV_MZANSI)
    pdf_delivery_note(HERE / "delivery-note-ubuntu-0007.pdf", UBUNTU, "SAMPLE-DN-0007", "SAMPLE-INV-0007", "5 November 2026", INV_UBUNTU)

    truth = {name: {"kind": kind, "rows": rows} for name, (kind, rows) in DOCS.items()}
    (HERE / "ground-truth.json").write_text(json.dumps(truth, indent=2) + "\n")

    blocks = "\n\n".join(
        f"#### `{name}` ({kind})\n\n```json\n{json.dumps(rows, indent=2)}\n```" for name, (kind, rows) in DOCS.items()
    )
    readme = HERE / "README.md"
    text = readme.read_text()
    new = re.sub(
        r"(<!-- ground-truth:start -->\n).*?(\n<!-- ground-truth:end -->)",
        lambda m: m.group(1) + "\n" + blocks + "\n" + m.group(2),
        text,
        flags=re.S,
    )
    readme.write_text(new)


if __name__ == "__main__":
    main()
