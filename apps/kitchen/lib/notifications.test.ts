import { describe, expect, it } from "vite-plus/test";

import { installedMiniApps } from "../components/miniapps";
import {
  demoNotifications,
  filterNotifications,
  markAllRead,
  markRead,
  timeAgo,
  unreadCount,
} from "./notifications";

const NOW = Date.UTC(2026, 9, 25, 12, 0, 0);

describe("demoNotifications", () => {
  it("has unique ids and comes from installed mini apps, newest first", () => {
    const list = demoNotifications(NOW);
    expect(new Set(list.map((item) => item.id)).size).toBe(list.length);
    for (const item of list) {
      expect(installedMiniApps.map((app) => app.id)).toContain(item.appId);
    }
    expect(list.map((item) => item.at)).toEqual(list.map((item) => item.at).sort((a, b) => b - a));
  });

  it("starts with some unread", () => {
    expect(unreadCount(demoNotifications(NOW))).toBe(2);
  });
});

describe("marking read", () => {
  it("marks one notification read and leaves the others", () => {
    const next = markRead(demoNotifications(NOW), "n1");
    expect(next.find((item) => item.id === "n1")?.read).toBe(true);
    expect(unreadCount(next)).toBe(1);
  });

  it("ignores an unknown id and does not change the list it was given", () => {
    const list = demoNotifications(NOW);
    expect(markRead(list, "nope")).toEqual(list);
    markRead(list, "n1");
    expect(unreadCount(list)).toBe(2);
  });

  it("marks everything read", () => {
    expect(unreadCount(markAllRead(demoNotifications(NOW)))).toBe(0);
  });
});

describe("filterNotifications", () => {
  const ids = (filter: { showRead: boolean; showUnread: boolean }) =>
    filterNotifications(demoNotifications(NOW), filter).map((item) => item.id);

  it("shows everything when both are on, in order", () => {
    expect(ids({ showRead: true, showUnread: true })).toEqual(["n1", "n2", "n3"]);
  });

  it("hides read ones when only unread is on", () => {
    expect(ids({ showRead: false, showUnread: true })).toEqual(["n1", "n2"]);
  });

  it("hides unread ones when only read is on", () => {
    expect(ids({ showRead: true, showUnread: false })).toEqual(["n3"]);
  });

  it("shows nothing when both are off", () => {
    expect(ids({ showRead: false, showUnread: false })).toEqual([]);
  });
});

describe("timeAgo", () => {
  it.each([
    [0, "now"],
    [59_000, "now"],
    [60_000, "1 min ago"],
    [4 * 60_000 + 30_000, "4 min ago"],
    [59 * 60_000, "59 min ago"],
    [60 * 60_000, "1 h ago"],
    [23 * 3_600_000 + 59 * 60_000, "23 h ago"],
    [24 * 3_600_000, "Yesterday"],
    [47 * 3_600_000, "Yesterday"],
    [48 * 3_600_000, "2 days ago"],
    [10 * 24 * 3_600_000, "10 days ago"],
  ])("reads %d ms ago as %s", (elapsed, text) => {
    expect(timeAgo(NOW - elapsed, NOW)).toBe(text);
  });

  it("reads a time in the future as now", () => {
    expect(timeAgo(NOW + 5_000, NOW)).toBe("now");
  });
});
