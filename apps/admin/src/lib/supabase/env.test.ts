import { describe, expect, it } from "vitest";
import { parseSupabaseEnv } from "./env";

describe("parseSupabaseEnv", () => {
  it("is null when either value is missing, so the app shows the not-configured state", () => {
    expect(parseSupabaseEnv(undefined, undefined)).toBeNull();
    expect(parseSupabaseEnv("https://x.supabase.co", undefined)).toBeNull();
    expect(parseSupabaseEnv(undefined, "key")).toBeNull();
    expect(parseSupabaseEnv("", "key")).toBeNull();
  });
  it("rejects malformed or non-http URLs", () => {
    expect(parseSupabaseEnv("not a url", "key")).toBeNull();
    expect(parseSupabaseEnv("javascript:alert(1)", "key")).toBeNull();
  });
  it("normalises a valid pair", () => {
    expect(parseSupabaseEnv("https://x.supabase.co/", "anon")).toEqual({ url: "https://x.supabase.co", anonKey: "anon" });
  });
});
