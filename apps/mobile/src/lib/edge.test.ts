import { describe, expect, it, vi } from "vitest";
import { askResultSchema, callEdge, edgeErrorMessageKey, mapEdgeFailure, processResponseSchema } from "./edge";

const deps = (fetchImpl: typeof fetch, token: string | null = "tok") => ({ baseUrl: "https://x.supabase.co", anonKey: "anon", getAccessToken: async () => token, fetchImpl });
const res = (status: number, body: unknown) => Promise.resolve(new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));

describe("mapEdgeFailure", () => {
  it("maps provider-not-configured (503 ai_not_configured)", () => {
    const e = mapEdgeFailure(503, { error: "ai_not_configured" });
    expect(e.kind).toBe("provider_not_configured");
    expect(edgeErrorMessageKey(e)).toBe("ai.providerNotConfigured");
  });
  it("maps quota, readiness and upload states explicitly", () => {
    expect(mapEdgeFailure(429, { error: "quota_exceeded" }).kind).toBe("quota_exceeded");
    expect(mapEdgeFailure(409, { error: "not_ready" }).kind).toBe("not_ready");
    expect(mapEdgeFailure(409, { error: "not_uploaded" }).kind).toBe("not_uploaded");
    expect(mapEdgeFailure(401, { error: "unauthorized" }).kind).toBe("unauthorized");
    expect(mapEdgeFailure(502, { error: "provider_http" }).kind).toBe("upstream");
  });
  it("keeps pipeline messages for 422 and distinguishes a missing function from a missing item", () => {
    const e = mapEdgeFailure(422, { error: "feature_not_in_plan", message: "Quiz not in plan" });
    expect(e.kind).toBe("unprocessable");
    expect(e.message).toBe("Quiz not in plan");
    expect(mapEdgeFailure(404, null).kind).toBe("function_missing");
    expect(mapEdgeFailure(404, { error: "not_found" }).kind).toBe("not_found");
  });
  it("falls back to a generic error for unknown bodies", () => {
    expect(edgeErrorMessageKey(mapEdgeFailure(500, "<html>boom</html>"))).toBe("common.genericError");
  });
});

describe("callEdge", () => {
  it("sends the user JWT and anon key and zod-parses a good response", async () => {
    const f = vi.fn(() => res(202, { jobId: "j1", created: true }));
    const r = await callEdge(deps(f as unknown as typeof fetch), "process-document", { documentId: "d" }, processResponseSchema);
    expect(r).toEqual({ ok: true, data: { jobId: "j1", created: true } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://x.supabase.co/functions/v1/process-document");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
  });
  it("treats a malformed 200 as bad_response instead of trusting it", async () => {
    const r = await callEdge(deps((() => res(200, { answer: 5 })) as unknown as typeof fetch), "ask-document", {}, askResultSchema);
    expect(r).toMatchObject({ ok: false, error: { kind: "bad_response" } });
  });
  it("rejects citations whose chunk id is not a UUID", () => {
    const base = { answer: "x", grounded: true, conversationId: crypto.randomUUID(), messageId: crypto.randomUUID() };
    expect(askResultSchema.safeParse({ ...base, citations: [{ chunk_id: "not-a-uuid", page_start: 1, page_end: 1 }] }).success).toBe(false);
    expect(askResultSchema.safeParse({ ...base, citations: [{ chunk_id: crypto.randomUUID(), page_start: 1, page_end: null }] }).success).toBe(true);
  });
  it("reports network failure and missing session without calling the server", async () => {
    const boom = await callEdge(deps((() => Promise.reject(new Error("down"))) as unknown as typeof fetch), "ask-document", {}, askResultSchema);
    expect(boom).toMatchObject({ ok: false, error: { kind: "network" } });
    const f = vi.fn();
    const none = await callEdge(deps(f as unknown as typeof fetch, null), "ask-document", {}, askResultSchema);
    expect(none).toMatchObject({ ok: false, error: { kind: "unauthorized" } });
    expect(f).not.toHaveBeenCalled();
  });
});

describe("friendly AI limit messages", () => {
  it("maps budget_exceeded and rate_limited to their own kinds (before the generic 429 -> quota)", () => {
    expect(mapEdgeFailure(429, { error: "budget_exceeded" }).kind).toBe("budget_exceeded");
    expect(mapEdgeFailure(429, { error: "rate_limited" }).kind).toBe("rate_limited");
    expect(edgeErrorMessageKey(mapEdgeFailure(429, { error: "budget_exceeded" }))).toBe("mobile.ai.budgetExceeded");
    expect(edgeErrorMessageKey(mapEdgeFailure(503, { error: "ai_not_configured" }))).toBe("ai.providerNotConfigured");
    expect(mapEdgeFailure(429, { error: "quota_exceeded" }).kind).toBe("quota_exceeded");
  });
});
