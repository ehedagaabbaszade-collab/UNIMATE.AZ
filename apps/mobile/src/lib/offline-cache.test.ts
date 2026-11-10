import { describe, expect, it } from "vitest";
import { clearSchedule, loadSchedule, saveSchedule, type KvStore, type ScheduleSnapshot } from "./offline-cache";

const store = (): KvStore & { m: Map<string, string> } => {
  const m = new Map<string, string>();
  return { m, getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => void m.set(k, v), removeItem: async (k) => void m.delete(k) };
};
const snap = (userId: string): ScheduleSnapshot => ({ userId, savedAt: "2026-01-01T00:00:00Z", timetable: [], tasks: [], exams: [] });

describe("offline schedule cache", () => {
  it("round-trips per user and never returns another user's data", async () => {
    const s = store();
    expect(await saveSchedule(s, snap("a"))).toBe(true);
    expect((await loadSchedule(s, "a"))?.userId).toBe("a");
    expect(await loadSchedule(s, "b")).toBeNull();
  });
  it("drops corrupt or mismatched payloads", async () => {
    const s = store();
    s.m.set("um.schedule.a", "{not json");
    expect(await loadSchedule(s, "a")).toBeNull();
    s.m.set("um.schedule.a", JSON.stringify({ userId: "other", savedAt: "x", timetable: [], tasks: [], exams: [] }));
    expect(await loadSchedule(s, "a")).toBeNull();
    s.m.set("um.schedule.a", JSON.stringify({ userId: "a", savedAt: "x", timetable: {}, tasks: [], exams: [] }));
    expect(await loadSchedule(s, "a")).toBeNull();
  });
  it("clears and survives a failing store", async () => {
    const s = store();
    await saveSchedule(s, snap("a"));
    await clearSchedule(s, "a");
    expect(await loadSchedule(s, "a")).toBeNull();
    const fail = async () => {
      throw new Error("x");
    };
    const bad: KvStore = { getItem: fail, setItem: fail, removeItem: fail };
    expect(await saveSchedule(bad, snap("a"))).toBe(false);
    expect(await loadSchedule(bad, "a")).toBeNull();
  });
});
