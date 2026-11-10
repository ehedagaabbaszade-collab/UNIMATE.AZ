import { describe, expect, it } from "vitest";
import { parseSupabaseEnv } from "./env";

describe("parseSupabaseEnv", () => {
  it("returns null when unset or invalid (backend not configured screen)", () => {
    expect(parseSupabaseEnv(undefined, "k")).toBeNull();
    expect(parseSupabaseEnv("https://x.supabase.co", undefined)).toBeNull();
    expect(parseSupabaseEnv("", "k")).toBeNull();
    expect(parseSupabaseEnv("not a url", "k")).toBeNull();
    expect(parseSupabaseEnv("ftp://x.co", "k")).toBeNull();
  });
  it("normalises trailing slashes", () => {
    expect(parseSupabaseEnv("https://x.supabase.co//", "anon")).toEqual({ url: "https://x.supabase.co", anonKey: "anon" });
  });
});
