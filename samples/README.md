# Synthetic supplier documents

Fictional suppliers, fictional prices, every page watermarked **SAMPLE - NOT REAL**. They exist to
exercise OCR and extraction (story 6.1, technology-register F-6) and the bulk-order demo
(maize meal, rice, cooking oil, sugar and similar groceries) without using anyone's real documents.
Nothing here is a real business, price or order.

| File                               | What it is                                                        |
| ---------------------------------- | ----------------------------------------------------------------- |
| `price-list-mzansi-clean.pdf`      | Clean text PDF price list (Mzansi Wholesale Traders)              |
| `price-list-karoo-photo.png`       | Photographed-style, low-contrast, slightly skewed, noisy PNG      |
| `price-list-ubuntu-pack-sizes.pdf` | Table with pack sizes in mixed forms (`25 kg`, `2 kg x 6`, `5 L`) |
| `invoice-mzansi-0001.pdf`          | Invoice from Mzansi for 4 lines                                   |
| `invoice-ubuntu-0007.pdf`          | Invoice from Ubuntu for 5 lines                                   |
| `delivery-note-mzansi-0001.pdf`    | Delivery note for the Mzansi invoice; one carton of oil short     |
| `delivery-note-ubuntu-0007.pdf`    | Delivery note for the Ubuntu invoice; one case of beans short     |

The two invoice/delivery pairs reconcile with each other on purpose, including one short delivery
each, so that later stories can test invoice-versus-delivery matching.

## Regenerating

```sh
python3 samples/generate.py   # needs python3 and Pillow; PDFs use only the standard library
```

Output is deterministic for a given Pillow version. The script also rewrites `ground-truth.json`
and the ground-truth section below from the same data, so they cannot drift from the documents.
Each file is well under 500 KB.

## Ground truth

Row fields, as an extractor should return them:

- `item`: product name as printed.
- `unit`: what the price applies to, as printed (`bag`, `carton`, `case`, `drum`).
- `packSize`: pack contents as printed (`12.5 kg`, `12 x 750 ml`), or `null` when none is printed.
- `priceMinorUnits`: price in cents as an integer (R129.90 is `12990`). On invoices this is the unit price.
- `currency`: ISO 4217 code, always `ZAR` here.

Invoices add `quantity` and `lineTotalMinorUnits`; delivery notes carry `quantityOrdered` and
`quantityDelivered` instead of a price. The same data is in `ground-truth.json`.
Accuracy tests should compare after trimming whitespace and ignoring case in `item`, `unit` and `packSize`.

<!-- ground-truth:start -->

#### `price-list-mzansi-clean.pdf` (price list)

```json
[
  {
    "item": "Super maize meal",
    "unit": "bag",
    "packSize": "12.5 kg",
    "priceMinorUnits": 12990,
    "currency": "ZAR"
  },
  {
    "item": "Super maize meal",
    "unit": "bag",
    "packSize": "5 kg",
    "priceMinorUnits": 5990,
    "currency": "ZAR"
  },
  {
    "item": "Long grain white rice",
    "unit": "bag",
    "packSize": "10 kg",
    "priceMinorUnits": 16450,
    "currency": "ZAR"
  },
  {
    "item": "Sunflower cooking oil",
    "unit": "carton",
    "packSize": "12 x 750 ml",
    "priceMinorUnits": 48900,
    "currency": "ZAR"
  },
  {
    "item": "White sugar",
    "unit": "bag",
    "packSize": "10 kg",
    "priceMinorUnits": 17900,
    "currency": "ZAR"
  },
  {
    "item": "Iodated table salt",
    "unit": "carton",
    "packSize": "6 x 2 kg",
    "priceMinorUnits": 6240,
    "currency": "ZAR"
  },
  {
    "item": "Pilchards in tomato sauce",
    "unit": "case",
    "packSize": "24 x 400 g",
    "priceMinorUnits": 39500,
    "currency": "ZAR"
  },
  {
    "item": "Rooibos tea bags",
    "unit": "case",
    "packSize": "12 x 80s",
    "priceMinorUnits": 29880,
    "currency": "ZAR"
  }
]
```

#### `price-list-karoo-photo.png` (price list)

```json
[
  {
    "item": "Samp",
    "unit": "bag",
    "packSize": "10 kg",
    "priceMinorUnits": 11499,
    "currency": "ZAR"
  },
  {
    "item": "Sugar beans",
    "unit": "bag",
    "packSize": "10 kg",
    "priceMinorUnits": 21900,
    "currency": "ZAR"
  },
  {
    "item": "Cake wheat flour",
    "unit": "carton",
    "packSize": "6 x 2.5 kg",
    "priceMinorUnits": 12750,
    "currency": "ZAR"
  },
  {
    "item": "Maize meal special",
    "unit": "bag",
    "packSize": "12.5 kg",
    "priceMinorUnits": 12499,
    "currency": "ZAR"
  },
  {
    "item": "Brown bread flour",
    "unit": "bag",
    "packSize": "10 kg",
    "priceMinorUnits": 9850,
    "currency": "ZAR"
  },
  {
    "item": "Mealie rice",
    "unit": "bag",
    "packSize": "10 kg",
    "priceMinorUnits": 10200,
    "currency": "ZAR"
  }
]
```

#### `price-list-ubuntu-pack-sizes.pdf` (price list)

```json
[
  {
    "item": "Super maize meal",
    "unit": "bag",
    "packSize": "25 kg",
    "priceMinorUnits": 24500,
    "currency": "ZAR"
  },
  {
    "item": "Long grain white rice",
    "unit": "carton",
    "packSize": "2 kg x 6",
    "priceMinorUnits": 9890,
    "currency": "ZAR"
  },
  {
    "item": "Sunflower cooking oil",
    "unit": "drum",
    "packSize": "5 L",
    "priceMinorUnits": 11990,
    "currency": "ZAR"
  },
  {
    "item": "Sunflower cooking oil",
    "unit": "carton",
    "packSize": "750 ml x 12",
    "priceMinorUnits": 47500,
    "currency": "ZAR"
  },
  {
    "item": "White sugar",
    "unit": "carton",
    "packSize": "2.5 kg x 4",
    "priceMinorUnits": 8990,
    "currency": "ZAR"
  },
  {
    "item": "Instant porridge",
    "unit": "carton",
    "packSize": "500 g x 20",
    "priceMinorUnits": 25600,
    "currency": "ZAR"
  },
  {
    "item": "Peanut butter",
    "unit": "carton",
    "packSize": "400 g x 12",
    "priceMinorUnits": 31200,
    "currency": "ZAR"
  },
  {
    "item": "Tinned baked beans",
    "unit": "case",
    "packSize": "410 g x 24",
    "priceMinorUnits": 27800,
    "currency": "ZAR"
  },
  {
    "item": "Washing powder",
    "unit": "carton",
    "packSize": "2 kg x 6",
    "priceMinorUnits": 28900,
    "currency": "ZAR"
  }
]
```

#### `invoice-mzansi-0001.pdf` (invoice)

```json
[
  {
    "item": "Super maize meal",
    "unit": "bag",
    "packSize": "12.5 kg",
    "priceMinorUnits": 12990,
    "currency": "ZAR",
    "quantity": 20,
    "lineTotalMinorUnits": 259800
  },
  {
    "item": "Long grain white rice",
    "unit": "bag",
    "packSize": "10 kg",
    "priceMinorUnits": 16450,
    "currency": "ZAR",
    "quantity": 10,
    "lineTotalMinorUnits": 164500
  },
  {
    "item": "Sunflower cooking oil",
    "unit": "carton",
    "packSize": "12 x 750 ml",
    "priceMinorUnits": 48900,
    "currency": "ZAR",
    "quantity": 4,
    "lineTotalMinorUnits": 195600
  },
  {
    "item": "White sugar",
    "unit": "bag",
    "packSize": "10 kg",
    "priceMinorUnits": 17900,
    "currency": "ZAR",
    "quantity": 6,
    "lineTotalMinorUnits": 107400
  }
]
```

#### `invoice-ubuntu-0007.pdf` (invoice)

```json
[
  {
    "item": "Super maize meal",
    "unit": "bag",
    "packSize": "25 kg",
    "priceMinorUnits": 24500,
    "currency": "ZAR",
    "quantity": 8,
    "lineTotalMinorUnits": 196000
  },
  {
    "item": "Instant porridge",
    "unit": "carton",
    "packSize": "500 g x 20",
    "priceMinorUnits": 25600,
    "currency": "ZAR",
    "quantity": 3,
    "lineTotalMinorUnits": 76800
  },
  {
    "item": "Peanut butter",
    "unit": "carton",
    "packSize": "400 g x 12",
    "priceMinorUnits": 31200,
    "currency": "ZAR",
    "quantity": 2,
    "lineTotalMinorUnits": 62400
  },
  {
    "item": "Tinned baked beans",
    "unit": "case",
    "packSize": "410 g x 24",
    "priceMinorUnits": 27800,
    "currency": "ZAR",
    "quantity": 2,
    "lineTotalMinorUnits": 55600
  },
  {
    "item": "Washing powder",
    "unit": "carton",
    "packSize": "2 kg x 6",
    "priceMinorUnits": 28900,
    "currency": "ZAR",
    "quantity": 1,
    "lineTotalMinorUnits": 28900
  }
]
```

#### `delivery-note-mzansi-0001.pdf` (delivery note)

```json
[
  {
    "item": "Super maize meal",
    "unit": "bag",
    "packSize": "12.5 kg",
    "quantityOrdered": 20,
    "quantityDelivered": 20
  },
  {
    "item": "Long grain white rice",
    "unit": "bag",
    "packSize": "10 kg",
    "quantityOrdered": 10,
    "quantityDelivered": 10
  },
  {
    "item": "Sunflower cooking oil",
    "unit": "carton",
    "packSize": "12 x 750 ml",
    "quantityOrdered": 4,
    "quantityDelivered": 3
  },
  {
    "item": "White sugar",
    "unit": "bag",
    "packSize": "10 kg",
    "quantityOrdered": 6,
    "quantityDelivered": 6
  }
]
```

#### `delivery-note-ubuntu-0007.pdf` (delivery note)

```json
[
  {
    "item": "Super maize meal",
    "unit": "bag",
    "packSize": "25 kg",
    "quantityOrdered": 8,
    "quantityDelivered": 8
  },
  {
    "item": "Instant porridge",
    "unit": "carton",
    "packSize": "500 g x 20",
    "quantityOrdered": 3,
    "quantityDelivered": 3
  },
  {
    "item": "Peanut butter",
    "unit": "carton",
    "packSize": "400 g x 12",
    "quantityOrdered": 2,
    "quantityDelivered": 2
  },
  {
    "item": "Tinned baked beans",
    "unit": "case",
    "packSize": "410 g x 24",
    "quantityOrdered": 2,
    "quantityDelivered": 1
  },
  {
    "item": "Washing powder",
    "unit": "carton",
    "packSize": "2 kg x 6",
    "quantityOrdered": 1,
    "quantityDelivered": 1
  }
]
```

<!-- ground-truth:end -->
