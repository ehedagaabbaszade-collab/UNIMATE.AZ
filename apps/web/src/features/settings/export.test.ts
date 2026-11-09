import { describe, expect, it } from "vitest";
import { EXPORT_TABLES, OWNER_COLUMN, buildExport } from "./export";

describe("buildExport", () => {
  it("collects readable tables and records failures instead of hiding them", () => {
    const b = buildExport("u1", [{ table: "tasks", rows: [{ id: 1 }] }, { table: "xp_events", rows: null, error: "denied" }], new Date("2026-01-01T00:00:00Z"));
    expect(b.tables).toEqual({ tasks: [{ id: 1 }] });
    expect(b.errors).toEqual({ xp_events: "denied" });
    expect(b.exportedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(b.userId).toBe("u1");
  });
  it("covers the user-owned tables and never includes audit logs", () => {
    expect(EXPORT_TABLES).toContain("documents");
    expect((EXPORT_TABLES as readonly string[]).includes("audit_logs")).toBe(false);
  });
  it("filters every directly-owned table by owner (profiles are visible to other users under RLS)", () => {
    expect(OWNER_COLUMN.profiles).toBe("id");
    for (const t of EXPORT_TABLES) {
      if (t === "messages" || t === "questions") expect(OWNER_COLUMN[t]).toBeNull();
      else expect(OWNER_COLUMN[t], t).toBeTruthy();
    }
  });
});
