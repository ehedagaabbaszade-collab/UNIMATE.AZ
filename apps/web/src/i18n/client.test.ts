// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

const eq = vi.fn();
const update = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ update }));
const updateUser = vi.fn();
let configured = true;
vi.mock("@/lib/supabase/browser", () => ({
  getBrowserClient: () => {
    if (!configured) throw new Error("not configured");
    return { from, auth: { updateUser } };
  },
}));

import { persistLocale } from "./client";

beforeEach(() => {
  configured = true;
  eq.mockReset().mockResolvedValue({ error: null });
  update.mockClear();
  from.mockClear();
  updateUser.mockReset().mockResolvedValue({});
  document.cookie = "um-locale=; Max-Age=0; Path=/";
  document.documentElement.lang = "az";
});

describe("persistLocale", () => {
  it("signed out: cookie and <html lang> only, no network", async () => {
    expect(await persistLocale("ru", null)).toBe(true);
    expect(document.cookie).toContain("um-locale=ru");
    expect(document.documentElement.lang).toBe("ru");
    expect(from).not.toHaveBeenCalled();
  });
  it("signed in: writes the cookie, profiles.locale (tr is stored as tr) and auth metadata", async () => {
    expect(await persistLocale("tr", "user-1")).toBe(true);
    expect(document.cookie).toContain("um-locale=tr");
    expect(from).toHaveBeenCalledWith("profiles");
    expect(update).toHaveBeenCalledWith({ locale: "tr" });
    expect(eq).toHaveBeenCalledWith("id", "user-1");
    expect(updateUser).toHaveBeenCalledWith({ data: { locale: "tr" } });
  });
  it("reports failure but keeps the local change when the profile write fails", async () => {
    eq.mockResolvedValue({ error: { message: "boom" } });
    expect(await persistLocale("en", "user-1")).toBe(false);
    expect(document.cookie).toContain("um-locale=en");
  });
  it("does not throw when Supabase is not configured", async () => {
    configured = false;
    expect(await persistLocale("en", "user-1")).toBe(false);
    expect(document.cookie).toContain("um-locale=en");
  });
});
