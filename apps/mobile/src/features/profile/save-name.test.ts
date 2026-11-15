import { describe, expect, it } from "vitest";
import { saveDisplayName } from "./save-name";

const fake = (result: { data: unknown; error: unknown }) =>
  ({ from: () => ({ update: () => ({ eq: () => ({ select: () => ({ single: async () => result }) }) }) }) }) as never;

describe("saveDisplayName", () => {
  it("rejects empty and too long names without calling the server", async () => {
    expect((await saveDisplayName(fake({ data: null, error: null }), "u", "  ")).ok).toBe(false);
    expect(await saveDisplayName(fake({ data: { id: "u" }, error: null }), "u", "x".repeat(81))).toMatchObject({ ok: false, kind: "validation" });
  });
  it("returns the trimmed name on success", async () => {
    expect(await saveDisplayName(fake({ data: { id: "u" }, error: null }), "u", " Aysel ")).toEqual({ ok: true, name: "Aysel" });
  });
  it("treats a 0-row update as a server error", async () => {
    expect(await saveDisplayName(fake({ data: null, error: { code: "PGRST116" } }), "u", "Aysel")).toEqual({ ok: false, kind: "server" });
    expect(await saveDisplayName(fake({ data: null, error: null }), "u", "Aysel")).toEqual({ ok: false, kind: "server" });
  });
});
