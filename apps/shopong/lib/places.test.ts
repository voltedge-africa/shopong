// The treasurer's Places screen and the member's area (story 7.3): the form is checked on the phone with plain words,
// the demand is counted by area, and the coarsening rule is the one the record uses. The phone never sends a street.
import { describe, expect, it } from "vite-plus/test";
import {
  areaDemandOf,
  placeBodyOf,
  placeChoicesOf,
  placeFormProblem,
  placesCardSectionsOf,
  PLACE_FORM_MESSAGES,
  type PlaceForm,
} from "./places";

const form: PlaceForm = {
  label: "Mamelodi Wholesale depot",
  area: "Mamelodi",
  lat: "-25.7079",
  lng: "28.4004",
  address: "12 Church Street, Mamelodi",
};

describe("placeFormProblem", () => {
  it("accepts a complete form and turns it into the Node's body, with a registration key", () => {
    const checked = placeFormProblem(form, "d".repeat(32));
    expect(checked).toEqual({
      ok: true,
      body: {
        request: "d".repeat(32),
        label: "Mamelodi Wholesale depot",
        area: "Mamelodi",
        lat: -25.7079,
        lng: 28.4004,
        address: "12 Church Street, Mamelodi",
      },
    });
  });

  it("asks for every field left empty, in one plain sentence", () => {
    expect(placeFormProblem({ ...form, label: "  " }, "d".repeat(32))).toEqual({
      ok: false,
      message: PLACE_FORM_MESSAGES.missing,
    });
    expect(PLACE_FORM_MESSAGES.missing).toBe(
      "Fill in the name, the suburb or town, the latitude and longitude, and the address.",
    );
  });

  it("refuses a label that reads as an address: a place is named, never addressed", () => {
    expect(placeFormProblem({ ...form, label: "14 Mkhize Street" }, "d".repeat(32))).toEqual({
      ok: false,
      message: PLACE_FORM_MESSAGES.named,
    });
    expect(PLACE_FORM_MESSAGES.named).toBe("A place is named, never addressed.");
  });

  it("refuses a latitude or longitude that is not a number on the map", () => {
    expect(placeFormProblem({ ...form, lat: "north" }, "d".repeat(32))).toEqual({
      ok: false,
      message: PLACE_FORM_MESSAGES.point,
    });
    expect(placeFormProblem({ ...form, lng: "200" }, "d".repeat(32)).ok).toBe(false);
    expect(placeFormProblem({ ...form, lat: "91" }, "d".repeat(32)).ok).toBe(false);
  });

  it("refuses a suburb name that is really a street, as the record does", () => {
    const checked = placeFormProblem({ ...form, area: "Church Street" }, "d".repeat(32));
    expect(checked.ok).toBe(false);
  });
});

describe("placeChoicesOf and areaDemandOf", () => {
  it("lists each area once, in order, for the member's picker", () => {
    expect(
      placeChoicesOf([
        { id: "1", label: "A", area: "Umbilo" },
        { id: "2", label: "B", area: "Mamelodi" },
        { id: "3", label: "C", area: "Umbilo" },
      ]),
    ).toEqual(["Mamelodi", "Umbilo"]);
  });

  it("counts the members in each area, most first, and leaves out a member who gave none", () => {
    expect(
      areaDemandOf([
        { did: "x", area: "Umbilo" },
        { did: "y", area: "Mamelodi" },
        { did: "z", area: "Umbilo" },
      ]),
    ).toEqual([
      { area: "Umbilo", members: 2 },
      { area: "Mamelodi", members: 1 },
    ]);
    expect(areaDemandOf([{ did: "x", area: "" }])).toEqual([]);
  });
});

describe("placeBodyOf", () => {
  it("never carries anything but the registration fields", () => {
    expect(Object.keys(placeBodyOf(form, "d".repeat(32)) as object).sort()).toEqual(
      ["address", "area", "label", "lat", "lng", "request"].sort(),
    );
  });
});

describe("placesCardSectionsOf (product owner, story 7.3: areas and demand are visible to all members)", () => {
  it("shows a member the collection points, the demand by area and their own area, but no form", () => {
    expect(placesCardSectionsOf(false)).toEqual({
      collectionPoints: true,
      demandByArea: true,
      yourArea: true,
      registerForm: false,
    });
  });

  it("shows the treasurer the same sections, and the form to register a place", () => {
    expect(placesCardSectionsOf(true)).toEqual({
      collectionPoints: true,
      demandByArea: true,
      yourArea: true,
      registerForm: true,
    });
  });
});
