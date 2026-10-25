export type Notification = {
  id: string;
  /** The mini app that sent it; opening the notification opens that app. */
  appId: string;
  title: string;
  body: string;
  /** When it arrived, in milliseconds since the epoch. */
  at: number;
  read: boolean;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Demo notifications dated relative to `now`. Nothing sends real ones yet. */
export function demoNotifications(now: number): Notification[] {
  return [
    {
      id: "n1",
      appId: "chat",
      title: "Supplier",
      body: "Hi! The maize meal order is ready for collection.",
      at: now - 4 * MINUTE,
      read: false,
    },
    {
      id: "n2",
      appId: "wallet",
      title: "Top-up received",
      body: "R 250.00 was added to your wallet.",
      at: now - 2 * HOUR,
      read: false,
    },
    {
      id: "n3",
      appId: "shop",
      title: "Low stock",
      body: "Bread is running low.",
      at: now - 26 * HOUR,
      read: true,
    },
  ];
}

export const markRead = (list: readonly Notification[], id: string): Notification[] =>
  list.map((item) => (item.id === id ? { ...item, read: true } : item));

export const markAllRead = (list: readonly Notification[]): Notification[] =>
  list.map((item) => (item.read ? item : { ...item, read: true }));

export const unreadCount = (list: readonly Notification[]): number =>
  list.filter((item) => !item.read).length;

export type NotificationFilter = { showRead: boolean; showUnread: boolean };

/** Keeps the notifications whose read state is switched on. Order is preserved. */
export const filterNotifications = (
  list: readonly Notification[],
  { showRead, showUnread }: NotificationFilter,
): Notification[] => list.filter((item) => (item.read ? showRead : showUnread));

/** "now", "4 min ago", "2 h ago", "Yesterday", "3 days ago". A time in the future reads as "now". */
export function timeAgo(at: number, now: number): string {
  const elapsed = Math.max(0, now - at);
  if (elapsed < MINUTE) return "now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)} min ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)} h ago`;
  const days = Math.floor(elapsed / DAY);
  return days === 1 ? "Yesterday" : `${days} days ago`;
}
