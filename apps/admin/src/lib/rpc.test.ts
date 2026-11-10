import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { RpcError, errorKey, keyForCode } from "./errors";
import { PAGE_SIZE, createAdminApi, likeEscape } from "./rpc";

interface Call {
  fn: string;
  args: Record<string, unknown>;
}
/** Fake client: rpc() records the call and returns the canned reply; from() returns a chainable query that resolves to `table`. */
function fake(reply: { data: unknown; error?: { code?: string; message?: string } | null }, table?: { data: unknown; error?: { code?: string } | null; count?: number | null }) {
  const calls: Call[] = [];
  const chain: Record<string, unknown> = {};
  const q = new Proxy(chain, {
    get(_t, prop) {
      if (prop === "then") return (resolve: (v: unknown) => void) => resolve({ data: table?.data ?? [], error: table?.error ?? null, count: table?.count ?? null });
      return () => q;
    },
  });
  const sb = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { data: reply.data, error: reply.error ?? null };
    },
    from: () => q,
  } as unknown as SupabaseClient;
  return { api: createAdminApi(sb), calls };
}

const USER = { id: "u1", display_name: "Aysel", username: null, role: "student", university_name: null, plan: "free", created_at: "2026-01-01T00:00:00Z", suspended: false, total: "42" };

describe("RPC wrappers validate responses", () => {
  it("parses rows, coerces bigint totals and maps the page", async () => {
    const { api, calls } = fake({ data: [USER] });
    const page = await api.listUsers("  ays  ", 2);
    expect(page.total).toBe(42);
    expect(page.rows[0]!.display_name).toBe("Aysel");
    expect(calls[0]).toEqual({ fn: "admin_list_users", args: { p_search: "ays", p_limit: PAGE_SIZE, p_offset: 2 * PAGE_SIZE } });
  });
  it("an empty search is sent as null", async () => {
    const { api, calls } = fake({ data: [] });
    await api.listUsers("   ", 0);
    expect(calls[0]!.args.p_search).toBeNull();
  });
  it("a malformed row becomes BAD_RESPONSE instead of rendering wrong data", async () => {
    const { api } = fake({ data: [{ ...USER, role: "owner" }] });
    await expect(api.listUsers("", 0)).rejects.toMatchObject({ code: "BAD_RESPONSE" });
    const { api: api2 } = fake({ data: "not an array" });
    await expect(api2.listUsers("", 0)).rejects.toBeInstanceOf(RpcError);
  });
  it("counters: moderator payload has no platform counters, admin payload does", async () => {
    const mod = await fake({ data: { open_reports: 1, open_takedowns: 0, pending_resources: 2, pending_events: 3 } }).api.counters();
    expect(mod.users_total).toBeUndefined();
    const admin = await fake({ data: { open_reports: 1, open_takedowns: 0, pending_resources: 2, pending_events: 3, users_total: "10", expiring_subscriptions_7d: 4 } }).api.counters();
    expect(admin.users_total).toBe(10);
    await expect(fake({ data: { open_reports: "x" } }).api.counters()).rejects.toMatchObject({ code: "BAD_RESPONSE" });
  });
  it("maps database error codes to RpcError carrying only the code (never server text)", async () => {
    const { api } = fake({ data: null, error: { code: "42501", message: "super_admin privileges required: secret detail" } });
    const err = await api.setRole("u1", "admin", "because").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).code).toBe("42501");
    expect((err as RpcError).message).toBe("42501");
  });
});

describe("RPC argument mapping", () => {
  it("grantPlan sends the expiry and reason", async () => {
    const { api, calls } = fake({ data: "sub-id" });
    await api.grantPlan("u1", "pro", "2027-01-01T00:00:00.000Z", "ticket 9");
    expect(calls[0]).toEqual({ fn: "admin_grant_plan", args: { p_user_id: "u1", p_plan: "pro", p_until: "2027-01-01T00:00:00.000Z", p_reason: "ticket 9" } });
  });
  it("suspend, moderation and takedown use the audited RPCs with reasons", async () => {
    const a = fake({ data: true });
    await a.api.setSuspended("u1", true, "abuse");
    await a.api.moderateContent("post", "p1", "remove", "spam");
    await a.api.reviewContent("resource", "r1", "approve", "ok");
    expect(a.calls.map((c) => c.fn)).toEqual(["admin_set_user_suspended", "admin_moderate_content", "admin_review_content"]);
    expect(a.calls[1]!.args).toEqual({ p_kind: "post", p_id: "p1", p_action: "remove", p_reason: "spam" });
    const b = fake({ data: null });
    await b.api.resolveTakedown("t1", "accepted", "valid claim");
    expect(b.calls[0]).toEqual({ fn: "admin_resolve_takedown", args: { p_id: "t1", p_decision: "accepted", p_reason: "valid claim" } });
  });
  it("sweeper returns the RPC count", async () => {
    expect(await fake({ data: 3 }).api.runExpiry()).toBe(3);
  });
  it("table reads parse rows and the exact count", async () => {
    const { api } = fake({ data: null }, { data: [{ id: "o1", name: "Acme", description: null, website: null, verified: true }], count: 7 });
    const p = await api.organizations("ac", 0);
    expect(p.total).toBe(7);
    expect(p.rows[0]!.verified).toBe(true);
    const bad = fake({ data: null }, { data: [{ id: 1 }] });
    await expect(bad.api.organizations("", 0)).rejects.toMatchObject({ code: "BAD_RESPONSE" });
    const denied = fake({ data: null }, { data: null, error: { code: "42501" } });
    await expect(denied.api.prompts(0)).rejects.toMatchObject({ code: "42501" });
  });
  it("likeEscape neutralises wildcards", () => {
    expect(likeEscape("50%_off\\")).toBe("50\\%\\_off\\\\");
  });
});

describe("error keys are i18n keys, never server text", () => {
  it("maps known codes and falls back to generic", () => {
    expect(keyForCode("42501")).toBe("admin.err.forbidden");
    expect(keyForCode("22023")).toBe("admin.err.invalid");
    expect(keyForCode("55000")).toBe("admin.err.conflict");
    expect(keyForCode("P0002")).toBe("admin.err.notFound");
    expect(keyForCode("23505")).toBe("admin.err.duplicate");
    expect(keyForCode("PGRST301")).toBe("admin.err.session");
    expect(keyForCode("whatever")).toBe("admin.err.generic");
    expect(errorKey(new Error("boom"))).toBe("admin.err.generic");
    expect(errorKey(new RpcError("42501"))).toBe("admin.err.forbidden");
  });
});
