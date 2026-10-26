import { describe, expect, it } from "vite-plus/test";
import {
  arrivalWords,
  collectionWords,
  disputeWords,
  progressWords,
  type ProofView,
} from "./index";

const DRIVER = "did:key:z6MkDriver";
const ME = "did:key:z6MkMe";
const OTHER = "did:key:z6MkOther";

const planned: ProofView = {
  arrived: false,
  plannedDriver: DRIVER,
  shares: [
    { member: ME, collected: false },
    { member: OTHER, collected: false },
  ],
  disputes: [],
};
const arrived: ProofView = {
  ...planned,
  arrived: true,
  delivered: { event: "e".repeat(128), driver: DRIVER, photoSha512: "f".repeat(128), claimedAt: 1 },
};

describe("where the delivery stands, in plain words", () => {
  it("says nothing is planned when no route names a driver", () => {
    expect(arrivalWords({ ...planned, plannedDriver: undefined }, ME)).toEqual({
      state: "not_planned",
      words: "No delivery is planned for this order yet.",
    });
  });

  it("asks the planned driver, and only the planned driver, to confirm", () => {
    expect(arrivalWords(planned, DRIVER).state).toBe("driver_to_confirm");
    expect(arrivalWords(planned, ME).state).toBe("waiting_for_driver");
  });

  it("says it arrived once the arrival is recorded", () => {
    expect(arrivalWords(arrived, ME)).toEqual({
      state: "arrived",
      words: "Arrived. The goods are with the members.",
    });
  });
});

describe("the collection and the progress", () => {
  it("counts the members who have collected, of those with a share", () => {
    expect(progressWords(2, 5)).toBe("2 of 5 collected");
    expect(progressWords(0, 0)).toBe("No members have a share in this order yet.");
  });

  it("offers a member their own collection only after arrival, and says when it is done", () => {
    expect(collectionWords(planned, ME)).toBeUndefined();
    expect(collectionWords(arrived, ME)).toBe("Confirm that you have collected your share.");
    const done = { ...arrived, shares: [{ member: ME, collected: true }] };
    expect(collectionWords(done, ME)).toBe("You have confirmed your collection.");
    expect(collectionWords(arrived, "did:key:z6MkStranger")).toBeUndefined();
  });
});

describe("disputes", () => {
  it("shows each dispute with the note the person wrote, or without one", () => {
    expect(
      disputeWords({
        ...arrived,
        disputes: [{ by: OTHER, note: "2 of 10 bags did not arrive" }, { by: ME }],
      }),
    ).toEqual([
      "A member says: 2 of 10 bags did not arrive",
      "A member says a share did not arrive.",
    ]);
    expect(disputeWords(arrived)).toEqual([]);
  });
});
