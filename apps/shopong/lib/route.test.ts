// The phone's route card (story 7.4): the state for the Node's answer, and the plain words for a failed plan. The phone
// shows the sentences the Node wrote; it computes nothing about the route itself.
import { describe, expect, it } from "vite-plus/test";
import type { RouteAnswer } from "./nodeClient";
import {
  OFFLINE_PLAN_MESSAGE,
  arrivalSentence,
  arrivalWords,
  clockOf,
  planFailureMessage,
  roadLabelOf,
  routeLoadMessage,
  routeScreenOf,
} from "./route";

const route: RouteAnswer = {
  fingerprint: "c".repeat(128),
  origin: { id: "a".repeat(64), label: "Mamelodi Wholesale depot", area: "Mamelodi" },
  destination: { id: "b".repeat(64), label: "Orlando community hall", area: "Soweto" },
  costing: "auto",
  distanceMeters: 12_400,
  durationSeconds: 1_500,
  tileRelease: "straight-line",
  straightLine: true,
  polyline6: "_p~iF~ps|U",
  sentences: ["Route from A to B.", "About 12.4 km, about 25 minutes by car.", "Straight line."],
};

describe("planFailureMessage", () => {
  it("says a plan needs a connection when the Node does not answer", () => {
    expect(planFailureMessage({ kind: "offline", reason: "No answer" })).toBe(OFFLINE_PLAN_MESSAGE);
    expect(OFFLINE_PLAN_MESSAGE).toBe("Planning a route needs a connection.");
  });

  it("shows the Node's plain reason for a refusal", () => {
    expect(
      planFailureMessage({
        kind: "refused",
        status: 422,
        problem: "no_route",
        reason: "No road route was found between these places.",
      }),
    ).toBe("No road route was found between these places.");
  });
});

describe("routeScreenOf", () => {
  it("shows a route the Node gave, with its sentences", () => {
    const screen = routeScreenOf({ ok: true, value: route });
    expect(screen).toEqual({ state: "shown", route });
  });

  it("says the route is not a road route when the Node labelled it a straight line", () => {
    expect(roadLabelOf(route)).toBe("Not a road route");
    expect(roadLabelOf({ ...route, straightLine: false })).toBe("Road route");
  });

  it("keeps the failure plain when the Node cannot be reached", () => {
    expect(routeScreenOf({ ok: false, failure: { kind: "offline", reason: "x" } })).toEqual({
      state: "unreachable",
      message: "Planning a route needs a connection.",
    });
  });
});

describe("routeLoadMessage", () => {
  it("sends the page the line and the three sentences, and no coordinate of a place", () => {
    const message = routeLoadMessage(route);
    expect(message).toEqual({
      type: "load",
      map: {
        stops: [],
        legs: [],
        route: { polyline6: route.polyline6, sentences: route.sentences },
      },
    });
    expect(JSON.stringify(message)).not.toMatch(/"lat"|"lng"/);
  });
});

// Story 8.6: the arrival estimate is the planned start plus the Node's route duration, labelled "about".
describe("the arrival estimate (story 8.6)", () => {
  const SAT_START = Date.UTC(2026, 9, 26, 12, 5); // 14:05 in South Africa (UTC+2)

  it("says the Node's duration in whole minutes, labelled about", () => {
    expect(arrivalWords(2_400)).toBe("about 40 minutes");
    expect(arrivalWords(2_380)).toBe("about 40 minutes");
    expect(arrivalWords(2_340)).toBe("about 39 minutes");
    expect(arrivalWords(30)).toBe("about 1 minute");
  });

  it("says hours for a longer run", () => {
    expect(arrivalWords(3_600)).toBe("about 1 hour");
    expect(arrivalWords(3_900)).toBe("about 1 hour 5 minutes");
    expect(arrivalWords(7_200)).toBe("about 2 hours");
  });

  it("shows a clock in South Africa time", () => {
    expect(clockOf(SAT_START)).toBe("14:05");
    expect(clockOf(Date.UTC(2026, 9, 26, 22, 30))).toBe("00:30");
  });

  it("gives the planned start and the arrival in one plain sentence, from the same rounded minutes", () => {
    expect(arrivalSentence(SAT_START, 2_400)).toBe(
      "Planned start 14:05. Arrival about 14:45 (about 40 minutes).",
    );
    expect(arrivalSentence(SAT_START, 2_380)).toBe(
      "Planned start 14:05. Arrival about 14:45 (about 40 minutes).",
    );
  });
});
