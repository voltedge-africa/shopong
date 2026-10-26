// The Node's `Routing` adapter (story 7.4): the labelled straight-line fallback. It passes the same contract suite as
// every routing adapter (AGENTS rule 1), and labels its routes so the card can say they are not road routes.
import { describe, expect, it } from "vite-plus/test";
import { runRoutingContract } from "@shopong/ports-contract";
import { STRAIGHT_LINE, StraightLineRouting } from "./routing.ts";

runRoutingContract(() => ({
  routing: new StraightLineRouting(),
  origin: { lat: -26.2485, lng: 27.854 }, // Soweto
  destination: { lat: -26.1035, lng: 28.0972 }, // Alexandra
  outside: { lat: -1.2921, lng: 36.8219 }, // Nairobi
}));

describe("StraightLineRouting", () => {
  it("labels every route as the straight-line fallback, never as a road tile release", async () => {
    const routing = new StraightLineRouting();
    const result = await routing.route({
      origin: { lat: -26.2485, lng: 27.854 },
      destination: { lat: -26.1035, lng: 28.0972 },
      costing: "auto",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.tileRelease).toBe(STRAIGHT_LINE);
  });
});
