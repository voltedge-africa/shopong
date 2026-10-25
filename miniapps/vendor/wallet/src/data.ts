export type CardTone = "primary" | "raised" | "outline";

export type PaymentCard = {
  id: string;
  name: string;
  last4: string;
  expiry: string;
  /** Rand. */
  balance: number;
  tone: CardTone;
  /** Typical spend per day, which the chart's figures are built around. */
  dailySpend: number;
};

/** An Ionicons name. */
export type GlyphName =
  | "basket-outline"
  | "book-outline"
  | "business-outline"
  | "cafe-outline"
  | "restaurant-outline"
  | "shirt-outline"
  | "train-outline";

export type Transaction = {
  id: string;
  title: string;
  detail: string;
  when: string;
  /** Rand: negative is money out. */
  amount: number;
  icon?: GlyphName;
  /** A person rather than a merchant: drawn as their initials. */
  initials?: string;
  split?: boolean;
};

export type Range = "week" | "month" | "year";

export type SpendingPoint = { label: string; spent: number };

/* -------------------------------------------------------------------------- */
/* Sample data: nothing here is real, and no money moves.                      */
/* -------------------------------------------------------------------------- */

export const HOLDER = { name: "Nomsa Dlamini", initials: "ND" };

export const CARDS: readonly PaymentCard[] = [
  {
    id: "everyday",
    name: "Everyday",
    last4: "4821",
    expiry: "09/29",
    balance: 3240.18,
    tone: "primary",
    dailySpend: 460,
  },
  {
    id: "stokvel",
    name: "Stokvel",
    last4: "7713",
    expiry: "03/28",
    balance: 1186.4,
    tone: "raised",
    dailySpend: 210,
  },
  {
    id: "savings",
    name: "Savings",
    last4: "0094",
    expiry: "11/30",
    balance: 8053.78,
    tone: "outline",
    dailySpend: 40,
  },
];

/** Money that came in this month, for the line under the total. */
export const IN_THIS_MONTH = 13_070;

/** Who the Send button pays, and the fixed amounts of Send and Top up. */
export const PAYEE = { name: "Lindiwe Zulu", initials: "LZ" };
export const SEND_AMOUNT = 250;
export const TOP_UP_AMOUNT = 1000;

export const TRANSACTIONS: readonly Transaction[] = [
  {
    id: "t1",
    title: "Spar Clermont",
    detail: "Groceries",
    when: "Today, 12:40",
    amount: -386,
    icon: "basket-outline",
  },
  {
    id: "t2",
    title: "Thabo Mokoena",
    detail: "Paid you back",
    when: "Today, 09:12",
    amount: 1200,
    initials: "TM",
  },
  {
    id: "t3",
    title: "Vida e Caffè",
    detail: "Coffee",
    when: "Yesterday, 08:05",
    amount: -42,
    icon: "cafe-outline",
  },
  {
    id: "t4",
    title: "Taxi, Clermont",
    detail: "Transport",
    when: "Yesterday, 07:58",
    amount: -20,
    icon: "train-outline",
  },
  {
    id: "t5",
    title: "Exclusive Books",
    detail: "Books",
    when: "Mon, 18:31",
    amount: -279,
    icon: "book-outline",
  },
  {
    id: "t6",
    title: "Spur",
    detail: "Dinner",
    when: "Sun, 21:14",
    amount: -645,
    icon: "restaurant-outline",
  },
  {
    id: "t7",
    title: "Mzansi Foods",
    detail: "Salary",
    when: "Fri, 06:00",
    amount: 12_850,
    icon: "business-outline",
  },
  {
    id: "t8",
    title: "Lindiwe Zulu",
    detail: "Her half of dinner",
    when: "Thu, 22:47",
    amount: 215,
    initials: "LZ",
  },
  {
    id: "t9",
    title: "Mr Price",
    detail: "Clothing",
    when: "Wed, 16:20",
    amount: -489,
    icon: "shirt-outline",
  },
];

export const RANGES: readonly { id: Range; label: string; spent: string; by: string }[] = [
  { id: "week", label: "Week", spent: "Spent this week", by: "By" },
  { id: "month", label: "Month", spent: "Spent this month", by: "By day" },
  { id: "year", label: "Year", spent: "Spent this year", by: "By the end of" },
];

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* -------------------------------------------------------------------------- */
/* Logic                                                                      */
/* -------------------------------------------------------------------------- */

/** `-1234.5` as `−R 1 234.50`; `signed` puts a `+` on money in. */
export function money(value: number, signed = false): string {
  const sign = value < 0 ? "−" : signed && value > 0 ? "+" : "";
  const [whole = "0", cents = "00"] = Math.abs(value).toFixed(2).split(".");
  return `${sign}R ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")}.${cents}`;
}

/**
 * A stable number between 0 and 1 for a key.
 *
 * The chart needs figures that look measured, and a real random would redraw them on every render.
 * A mixed hash of the key gives the same figure for the same day every time.
 */
export function noise(key: string): number {
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0x5bd1e995);
  hash ^= hash >>> 15;
  return (hash >>> 0) / 4294967295;
}

/**
 * What one card has spent so far in the range, as a running total. A running total rather than each
 * day's figure: a month of day-to-day spending reads as noise, while the slope says how much has
 * gone, and when.
 */
export function spending(card: PaymentCard, range: Range): SpendingPoint[] {
  const day = (key: string, weekend: boolean) =>
    card.dailySpend * (0.35 + noise(`${card.id}:${key}`) * 1.3) * (weekend ? 1.6 : 1);

  const steps =
    range === "week"
      ? WEEKDAYS.map((label, index) => ({ label, amount: day(`w${index}`, index >= 5) }))
      : range === "month"
        ? Array.from({ length: 30 }, (_, index) => ({
            label: String(index + 1),
            amount: day(`m${index}`, index % 7 === 5 || index % 7 === 6),
          }))
        : MONTHS.map((label, index) => ({
            label,
            amount: card.dailySpend * 30 * (0.7 + noise(`${card.id}:y${index}`) * 0.6),
          }));

  let total = 0;
  return steps.map(({ label, amount }) => {
    total += amount;
    return { label, spent: Math.round(total * 100) / 100 };
  });
}

export const totalBalance = (cards: readonly PaymentCard[]): number =>
  cards.reduce((sum, card) => sum + card.balance, 0);

/** Can `card` send `amount`? A frozen card cannot, and neither can one without the money. */
export const canSend = (card: PaymentCard, frozen: boolean, amount = SEND_AMOUNT): boolean =>
  !frozen && card.balance >= amount;

export type WalletState = {
  cards: readonly PaymentCard[];
  transactions: readonly Transaction[];
  /** Counts the entries added so far, so each gets its own id. */
  added: number;
};

export const initialWallet = (): WalletState => ({
  cards: CARDS,
  transactions: TRANSACTIONS,
  added: 0,
});

/** Moves `amount` on `cardId` (negative sends) and records it as the newest activity. */
export function moveMoney(
  state: WalletState,
  cardId: string,
  amount: number,
  entry: Omit<Transaction, "id" | "amount">,
): WalletState {
  const added = state.added + 1;
  return {
    added,
    cards: state.cards.map((card) =>
      card.id === cardId
        ? { ...card, balance: Math.round((card.balance + amount) * 100) / 100 }
        : card,
    ),
    transactions: [{ ...entry, id: `new-${added}`, amount }, ...state.transactions],
  };
}

/** Halves a payment (money out only, once). The rest of the split is somebody else's to settle. */
export function splitTransaction(state: WalletState, id: string): WalletState {
  return {
    ...state,
    transactions: state.transactions.map((row) =>
      row.id === id && row.amount < 0 && !row.split
        ? { ...row, amount: row.amount / 2, split: true }
        : row,
    ),
  };
}

export const hideTransaction = (state: WalletState, id: string): WalletState => ({
  ...state,
  transactions: state.transactions.filter((row) => row.id !== id),
});
