import { describe, expect, it } from "vitest";
import { dayStart, monthStart, planFromSubscription, summariseUsage } from "./usage";

describe("plan mapping", () => {
  it("defaults to FREE without a live subscription", () => {
    expect(planFromSubscription(null)).toBe("FREE");
    expect(planFromSubscription({ plan: "pro", status: "canceled" })).toBe("FREE");
    expect(planFromSubscription({ plan: "pro", status: "expired" })).toBe("FREE");
  });
  it("maps lowercase db plans to core PlanId for live statuses", () => {
    expect(planFromSubscription({ plan: "plus", status: "active" })).toBe("PLUS");
    expect(planFromSubscription({ plan: "pro", status: "trialing" })).toBe("PRO");
    expect(planFromSubscription({ plan: "free", status: "active" })).toBe("FREE");
  });
});

describe("usage periods and summary", () => {
  const now = new Date("2026-03-05T23:30:00Z");
  it("uses UTC day and month like the pipeline", () => {
    expect(dayStart(now)).toBe("2026-03-05");
    expect(monthStart(now)).toBe("2026-03-01");
  });
  it("reads only the current day/month counters", () => {
    const u = summariseUsage(
      null,
      [
        { kind: "ai_message", period_start: "2026-03-05", n: 4 },
        { kind: "ai_message", period_start: "2026-03-04", n: 9 },
        { kind: "upload_doc", period_start: "2026-03-01", n: 2 },
        { kind: "upload_doc", period_start: "2026-02-01", n: 3 },
      ],
      now,
    );
    expect(u).toMatchObject({ plan: "FREE", aiMessagesToday: 4, docsThisMonth: 2 });
    expect(u.limits.aiMessagesPerDay).toBe(10);
  });
});
