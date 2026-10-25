import { designBuild } from "./builder";
import { artifactOf } from "./ci";
import { appRecord, defaultForm, type PublishedApp } from "./publish";

const RESTOCK_REQUEST =
  "I run a spaza shop and keep running out of stock. I want to know what to reorder and who is cheapest";

/** When the demo app was published: 20 Oct 2026, 09:00. */
const PUBLISHED_AT = Date.UTC(2026, 9, 20, 9, 0);

const restock = designBuild(RESTOCK_REQUEST);

/**
 * Apps other people have published. Demo only: they are made here the same way an app you build is,
 * so they are drawn the same way, but their author is not you and not Shopong.
 */
export const communityApps: readonly PublishedApp[] = [
  appRecord({
    id: "community-spaza-restock",
    build: restock,
    artifact: artifactOf(restock),
    form: {
      ...defaultForm(restock),
      name: "Spaza restock",
      description:
        "See what is running low in your shop, what to reorder and which supplier is cheapest.",
    },
    now: PUBLISHED_AT,
  }),
].map((app) => ({ ...app, publisher: "Mthunzi Spaza Traders" }));
