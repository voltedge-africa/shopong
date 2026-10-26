import type { MiniAppManifest } from "@shopong/miniapp";

export {
  TimelineHostContext,
  type TimelineAnswer,
  type TimelineHost,
  type TimelinePayment,
} from "./host";
export { SHORT_ID, agreementTone, paymentLabel, stepLines, type StepLine } from "./lines";

export const manifest: MiniAppManifest = {
  id: "timeline",
  title: "Payment timeline",
  icon: "git-commit-outline",
  category: "Money",
  description:
    "See every step of one of your payments, from the pledge to the pool books, and whether the record and the books agree. This is a demo: no real money moves.",
  // Loaded the first time it is opened, not when the app starts.
  content: { kind: "native", load: () => import("./Timeline") },
};
