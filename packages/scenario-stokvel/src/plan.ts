// The fixed, fictional content of the scenario: people, the shopping list, two supplier
// quotes and the collection point. Everything is data so the scenario stays deterministic.

export type Role = "treasurer" | "member" | "node" | "driver";

export interface PersonSpec {
  /** Stable key: `m1`..`m5`, `node`, `driver`. Used in events instead of names. */
  readonly key: string;
  readonly name: string;
  readonly role: Role;
}

/** Five fictional members. `m1` is the treasurer, who creates the stokvel. */
export const MEMBERS: readonly PersonSpec[] = [
  { key: "m1", name: "Nomsa Dlamini", role: "treasurer" },
  { key: "m2", name: "Thabo Nkosi", role: "member" },
  { key: "m3", name: "Lerato Molefe", role: "member" },
  { key: "m4", name: "Zanele Khumalo", role: "member" },
  { key: "m5", name: "Pieter Botha", role: "member" },
];

export const NODE: PersonSpec = { key: "node", name: "OCN Node", role: "node" };
export const DRIVER: PersonSpec = { key: "driver", name: "Mandla Zulu", role: "driver" };

export const STOKVEL_NAME = "Ubuntu Savers Stokvel";
export const CURRENCY = "ZAR";
/** What each member contributes per order at most: the budget per member (R900.00). */
export const CONTRIBUTION_MINOR = 90_000;
/** The most the treasurer may approve to pay out in one go (R5 000.00). */
export const CEILING_MINOR = 500_000;
/** Pledges are the equal share rounded up to this step (R10.00); the difference is credited back. */
export const PLEDGE_ROUNDING_MINOR = 1_000;
/** The member whose first payment is declined by the simulated bank. */
export const DECLINED_MEMBER = "m4";

export interface ListItem {
  readonly name: string;
  readonly quantity: number;
}

export const ORDER_ITEMS: readonly ListItem[] = [
  { name: "Maize meal 12.5 kg", quantity: 10 },
  { name: "Rice 10 kg", quantity: 5 },
  { name: "Sugar 10 kg", quantity: 5 },
  { name: "Cooking oil 5 L", quantity: 5 },
  { name: "Pilchards in tomato sauce 400 g", quantity: 30 },
];

export interface SupplierSpec {
  readonly key: string;
  readonly name: string;
  readonly deliveryTerms: string;
  /** Unit price in minor units, in the same order as `ORDER_ITEMS`. */
  readonly unitPricesMinor: readonly number[];
}

export const SUPPLIERS: readonly SupplierSpec[] = [
  {
    key: "s1",
    name: "Mamelodi Wholesale Foods",
    deliveryTerms: "Delivery included, 3 working days",
    unitPricesMinor: [9_500, 16_000, 18_500, 14_500, 2_600],
  },
  {
    key: "s2",
    name: "Soweto Cash & Carry",
    deliveryTerms: "Delivery included, 5 working days",
    unitPricesMinor: [10_000, 16_500, 19_000, 15_000, 2_800],
  },
];

export function quoteTotalMinor(supplier: SupplierSpec): number {
  return ORDER_ITEMS.reduce(
    (sum, item, i) => sum + item.quantity * (supplier.unitPricesMinor[i] ?? 0),
    0,
  );
}

/** The supplier the treasurer picks: the lowest total. */
export const CHOSEN_SUPPLIER = SUPPLIERS[0] as SupplierSpec;

/** Held only on the OCN Node, never written to the record (AGENTS.md rule 6). Fictional. */
export const SUPPLIER_BANK = {
  name: "Mamelodi Wholesale Foods (Pty) Ltd",
  bankId: "fnb",
  accountNumber: "62999000123",
  accountType: "current",
} as const;

export interface PlacePoint {
  readonly label: string;
  readonly lat: number;
  readonly lng: number;
}

export const SUPPLIER_DEPOT: PlacePoint = {
  label: "Mamelodi Wholesale depot",
  lat: -25.7079,
  lng: 28.4004,
};

export const COLLECTION_POINT: PlacePoint = {
  label: "Orlando community hall, Soweto",
  lat: -26.2395,
  lng: 27.9094,
};

export const HOUR_MS = 3_600_000;
export const MINUTE_MS = 60_000;
export const DAY_MS = 24 * HOUR_MS;
