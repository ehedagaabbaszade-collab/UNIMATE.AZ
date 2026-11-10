import { describe, expect, it } from "vitest";
import { changeLocale, localeFromTag, reconcileLocale, resolveLocale, type ReconcileInput, type ReconcileResult } from "./index";

describe("localeFromTag", () => {
  it.each([
    ["ru-RU", "ru"],
    ["tr-TR", "tr"],
    ["az-Latn-AZ", "az"],
    ["az_AZ", "az"],
    ["EN-us", "en"],
    ["en", "en"],
    ["de-DE", null],
    ["", null],
    [undefined, null],
    [42, null],
  ])("%s -> %s", (tag, expected) => expect(localeFromTag(tag)).toBe(expected));
});

describe("resolveLocale (pure)", () => {
  const cases: Array<[string, Parameters<typeof resolveLocale>[0], string]> = [
    ["nothing at all -> az", {}, "az"],
    ["unknown device -> az", { deviceLocales: ["de-DE", "fr"] }, "az"],
    ["device ru-RU -> ru", { deviceLocales: ["ru-RU"] }, "ru"],
    ["device tr-TR -> tr", { deviceLocales: ["tr-TR"] }, "tr"],
    ["device az-Latn-AZ -> az", { deviceLocales: ["az-Latn-AZ"] }, "az"],
    ["first supported device language wins", { deviceLocales: ["de", "ru-RU", "tr"] }, "ru"],
    ["stored beats device", { storedLocale: "en", deviceLocales: ["ru-RU"] }, "en"],
    ["invalid stored is skipped", { storedLocale: "zz", deviceLocales: ["tr-TR"] }, "tr"],
    ["profile beats stored and device", { profileLocale: "ru", storedLocale: "en", deviceLocales: ["tr"] }, "ru"],
    ["invalid profile is skipped", { profileLocale: "xx", storedLocale: "en" }, "en"],
    ["tr is a first-class profile locale", { profileLocale: "tr" }, "tr"],
  ];
  it.each(cases)("%s", (_n, input, expected) => expect(resolveLocale(input)).toBe(expected));
});

describe("reconcileLocale", () => {
  type Row = [string, ReconcileInput, ReconcileResult];
  const rows: Row[] = [
    // signed out: local fallback, never writes
    ["signed out, nothing known", { profile: null }, { effective: "az", shouldWriteProfile: false, shouldWriteLocal: false }],
    ["signed out, stored wins over device", { profile: null, storedLocale: "ru", deviceLocales: ["en"] }, { effective: "ru", shouldWriteProfile: false, shouldWriteLocal: false }],
    ["signed out, device only", { profile: null, deviceLocales: ["tr-TR"] }, { effective: "tr", shouldWriteProfile: false, shouldWriteLocal: false }],
    // first authenticated load, profile explicitly set: profile is the source of truth (cross-device sync)
    ["profile set, device B has stale local", { profile: { locale: "ru", localeSetAt: "2026-01-01T00:00:00Z" }, storedLocale: "en" }, { effective: "ru", shouldWriteProfile: false, shouldWriteLocal: true }],
    ["profile set, already in sync", { profile: { locale: "tr", localeSetAt: "2026-01-01T00:00:00Z" }, storedLocale: "tr" }, { effective: "tr", shouldWriteProfile: false, shouldWriteLocal: false }],
    ["profile set, no local copy yet (new device)", { profile: { locale: "en", localeSetAt: "2026-01-01T00:00:00Z" }, deviceLocales: ["ru"] }, { effective: "en", shouldWriteProfile: false, shouldWriteLocal: true }],
    // first login, profile never set: push the local / device choice
    ["never set + stored choice -> push", { profile: { locale: "az", localeSetAt: null }, storedLocale: "ru" }, { effective: "ru", shouldWriteProfile: true, shouldWriteLocal: false }],
    ["never set + device only -> push and store", { profile: { locale: "az", localeSetAt: null }, deviceLocales: ["tr-TR"] }, { effective: "tr", shouldWriteProfile: true, shouldWriteLocal: true }],
    ["never set + stored beats device", { profile: { locale: "az", localeSetAt: null }, storedLocale: "en", deviceLocales: ["ru"] }, { effective: "en", shouldWriteProfile: true, shouldWriteLocal: false }],
    ["never set + nothing local -> keep default, do not fake a choice", { profile: { locale: "az", localeSetAt: null } }, { effective: "az", shouldWriteProfile: false, shouldWriteLocal: true }],
    ["never set + unsupported device -> same", { profile: { locale: "az", localeSetAt: null }, deviceLocales: ["de"], storedLocale: undefined }, { effective: "az", shouldWriteProfile: false, shouldWriteLocal: true }],
    // garbage from the database must not crash
    ["invalid profile locale is treated as az", { profile: { locale: "zz", localeSetAt: "2026-01-01T00:00:00Z" }, storedLocale: "az" }, { effective: "az", shouldWriteProfile: false, shouldWriteLocal: false }],
  ];
  it.each(rows)("%s", (_n, input, expected) => expect(reconcileLocale(input)).toEqual(expected));

  it("persistence: after a choice is pushed, the next load is stable (no flip-flop)", () => {
    const first = reconcileLocale({ profile: { locale: "az", localeSetAt: null }, deviceLocales: ["ru-RU"] });
    expect(first).toMatchObject({ effective: "ru", shouldWriteProfile: true });
    // the database stamped locale_set_at and the app stored the local copy
    const second = reconcileLocale({ profile: { locale: first.effective, localeSetAt: "2026-03-05T00:00:00Z" }, storedLocale: first.effective, deviceLocales: ["ru-RU"] });
    expect(second).toEqual({ effective: "ru", shouldWriteProfile: false, shouldWriteLocal: false });
  });

  it("cross-device: a change on device A reaches device B at its next authenticated load", () => {
    // Device A (signed in) chooses tr: both stores are written.
    expect(changeLocale("tr", true)).toEqual({ effective: "tr", shouldWriteProfile: true, shouldWriteLocal: true });
    // Device B still has en locally, the profile now says tr (set).
    expect(reconcileLocale({ profile: { locale: "tr", localeSetAt: "2026-03-05T00:00:00Z" }, storedLocale: "en" })).toEqual({
      effective: "tr",
      shouldWriteProfile: false,
      shouldWriteLocal: true,
    });
  });

  it("a change while signed out writes only locally", () => {
    expect(changeLocale("ru", false)).toEqual({ effective: "ru", shouldWriteProfile: false, shouldWriteLocal: true });
  });
});
