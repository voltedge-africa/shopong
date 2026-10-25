export type Day = { day: string; revenue: number; orders: number };

/** Demo data: a week of takings for a spaza shop, in rand. */
export const week: readonly Day[] = [
  { day: "Mon", revenue: 1180, orders: 31 },
  { day: "Tue", revenue: 1320, orders: 36 },
  { day: "Wed", revenue: 1090, orders: 28 },
  { day: "Thu", revenue: 1560, orders: 42 },
  { day: "Fri", revenue: 2240, orders: 58 },
  { day: "Sat", revenue: 2710, orders: 71 },
  { day: "Sun", revenue: 1980, orders: 49 },
];

export const categories = [
  { category: "Groceries", orders: 112 },
  { category: "Airtime", orders: 74 },
  { category: "Drinks", orders: 58 },
  { category: "Household", orders: 41 },
] as const;

export type Summary = {
  revenue: number;
  orders: number;
  /** Percentage change of the latest half of the period over the half before it. */
  revenueTrend: number;
  ordersTrend: number;
};

const sum = (days: readonly Day[], key: "revenue" | "orders") =>
  days.reduce((total, day) => total + day[key], 0);

const change = (before: number, after: number) =>
  before === 0 ? 0 : ((after - before) / before) * 100;

export function summarise(days: readonly Day[]): Summary {
  // Two halves of equal length; with an odd number of days the oldest one is left out.
  const half = Math.floor(days.length / 2);
  const first = half === 0 ? [] : days.slice(-2 * half, -half);
  const second = half === 0 ? [] : days.slice(-half);
  return {
    revenue: sum(days, "revenue"),
    orders: sum(days, "orders"),
    revenueTrend: change(sum(first, "revenue"), sum(second, "revenue")),
    ordersTrend: change(sum(first, "orders"), sum(second, "orders")),
  };
}

export const formatRand = (amount: number) =>
  "R " +
  Math.round(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ");
