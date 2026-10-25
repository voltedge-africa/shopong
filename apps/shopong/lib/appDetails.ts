import type { MiniApp } from "../components/miniapps";
import { detailRows, sentence } from "./publish";
import { shotsFor, type Shot } from "./screenshots";

export type AppDetails = {
  description: string;
  /** The row of screenshots; empty when the app has nothing to show. */
  shots: readonly Shot[];
  /** What is new in this version, when the publisher said. */
  whatsNew?: string;
  /** What the app may do, one thing per entry. Empty for the apps the app ships. */
  mayDo: readonly string[];
  /** Label and value pairs, in the order the details page lists them. */
  rows: readonly { label: string; value: string }[];
};

/** What the details page of an app says about it, in plain words. */
export function appDetails(app: MiniApp): AppDetails {
  const { published } = app;
  if (published) {
    return {
      description: published.description,
      shots: shotsFor(published.screenshots, published.build.screens),
      ...(published.notes === "" ? {} : { whatsNew: published.notes }),
      mayDo: [
        ...published.permissions.map(sentence),
        published.needsApproval ? "Asks for your OK before money moves" : "Never moves money",
      ],
      rows: [{ label: "Category", value: app.category }, ...detailRows(published)],
    };
  }
  const alone = app.content.kind !== "native";
  return {
    description: app.description,
    shots: [],
    mayDo: [],
    rows: [
      { label: "Category", value: app.category },
      { label: "Made by", value: app.publisher },
      { label: "Version", value: "1.0" },
      {
        label: "Runs",
        value: alone
          ? "On its own: it cannot reach the internet or your other apps"
          : "Inside Shopong",
      },
      { label: "Works without internet", value: "Yes" },
    ],
  };
}
