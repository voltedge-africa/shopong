// The member list on the Settings card (story 8.1): what each row says about the member's role.
import { describe, expect, it } from "vite-plus/test";
import type { HeldRole } from "@shopong/community";
import type { Did } from "@shopong/ports";
import { CREATOR_NOTE, NO_ROLE_NOTE, memberRowsOf } from "./memberRows";

const TREASURER = "did:key:z6MkhaXgBZDvotDkL5257faiztiGiC2QtKLGpbnnEGta2doK" as Did;
const DRIVER = "did:key:z6MkpTHR8VNsBxYAAWHut2Geadd9jSwuBV8xRoAnwWsdvktH" as Did;
const SILENT = "did:key:z6MkrZ1r5XBH4hEqJQGe7aaeFt1uHrdgfBNKd2Cn9H9xHcrr" as Did;

const driverRole: HeldRole = {
  holder: DRIVER,
  role: "driver",
  grantor: TREASURER,
  expiresAt: 1_793_600_000_000,
  grants: [],
};

describe("memberRowsOf", () => {
  it("labels the creator as the one who started the community, not as having no role", () => {
    const rows = memberRowsOf({
      members: [{ did: TREASURER, joinedAt: 0 }],
      roleHolders: [],
      creator: TREASURER,
    });
    expect(rows).toEqual([{ did: TREASURER, note: CREATOR_NOTE, roles: [] }]);
    expect(CREATOR_NOTE).toBe("Started this community (treasurer)");
  });

  it("gives a member with no role the 'No role given yet' note", () => {
    const rows = memberRowsOf({
      members: [{ did: SILENT, joinedAt: 0 }],
      roleHolders: [],
      creator: TREASURER,
    });
    expect(rows).toEqual([{ did: SILENT, note: NO_ROLE_NOTE, roles: [] }]);
    expect(NO_ROLE_NOTE).toBe("No role given yet");
  });

  it("shows a member's given role and its end date, with no note", () => {
    const rows = memberRowsOf({
      members: [{ did: DRIVER, joinedAt: 0 }],
      roleHolders: [driverRole],
      creator: TREASURER,
    });
    expect(rows).toEqual([{ did: DRIVER, note: undefined, roles: [driverRole] }]);
  });

  it("keeps the creator's note even when the creator also holds a role", () => {
    const rows = memberRowsOf({
      members: [{ did: TREASURER, joinedAt: 0 }],
      roleHolders: [{ ...driverRole, holder: TREASURER }],
      creator: TREASURER,
    });
    expect(rows[0]?.note).toBe(CREATOR_NOTE);
    expect(rows[0]?.roles).toHaveLength(1);
  });

  it("gives no note when the creator is not known yet, rather than guessing one", () => {
    const rows = memberRowsOf({
      members: [{ did: TREASURER, joinedAt: 0 }],
      roleHolders: [],
      creator: undefined,
    });
    expect(rows[0]?.note).toBe(NO_ROLE_NOTE);
  });

  it("lists members in the order the record gives them", () => {
    const rows = memberRowsOf({
      members: [
        { did: SILENT, joinedAt: 0 },
        { did: TREASURER, joinedAt: 0 },
      ],
      roleHolders: [],
      creator: TREASURER,
    });
    expect(rows.map((row) => row.did)).toEqual([SILENT, TREASURER]);
  });
});
