import { describe, expect, it } from "vitest";
import { groupTemplates, renderNotification, type NotificationTemplate } from "./index";

const rows = [
  { key: "welcome", locale: "az", title: "UniMate-ə xoş gəldiniz", body: "Salam, {name}!" },
  { key: "welcome", locale: "tr", title: "UniMate'e hoş geldiniz", body: "Merhaba {name}!" },
  { key: "welcome", locale: "en", title: "Welcome to UniMate", body: "Hi {name}!" },
  { key: "welcome", locale: "ru", title: "Добро пожаловать в UniMate", body: "Привет, {name}!" },
  { key: "welcome", locale: "de", title: "ignored", body: "ignored" },
  { key: "az_only", locale: "az", title: "Yalnız az: {name}", body: null },
];
const templates = groupTemplates(rows);
const welcome = templates.get("welcome")!;

describe("groupTemplates", () => {
  it("groups by key and ignores unsupported locales", () => {
    expect(Object.keys(welcome.translations).sort()).toEqual(["az", "en", "ru", "tr"]);
    expect(templates.size).toBe(2);
  });
});

describe("renderNotification", () => {
  it("renders in each of the four locales", () => {
    expect(renderNotification(welcome, { name: "Aysel" }, "az")).toMatchObject({ title: "UniMate-ə xoş gəldiniz", body: "Salam, Aysel!", locale: "az" });
    expect(renderNotification(welcome, { name: "Aysel" }, "tr").body).toBe("Merhaba Aysel!");
    expect(renderNotification(welcome, { name: "Aysel" }, "en").body).toBe("Hi Aysel!");
    expect(renderNotification(welcome, { name: "Айсель" }, "ru")).toMatchObject({ body: "Привет, Айсель!", locale: "ru" });
  });
  it("falls back to az for a missing translation, an unknown locale or a bad value", () => {
    const azOnly = templates.get("az_only")!;
    expect(renderNotification(azOnly, { name: "X" }, "ru")).toEqual({ title: "Yalnız az: X", body: null, locale: "az" });
    expect(renderNotification(welcome, { name: "X" }, "de").locale).toBe("az");
    expect(renderNotification(welcome, { name: "X" }, "").locale).toBe("az");
    expect(renderNotification(welcome, { name: "X" }).locale).toBe("az");
  });
  it("falls back to legacy title/body, then to the key, when there is no usable translation", () => {
    const legacy: NotificationTemplate = { key: "old", translations: {}, legacy: { title: "Old title", body: "Old body" } };
    expect(renderNotification(legacy, {}, "ru")).toEqual({ title: "Old title", body: "Old body", locale: "az" });
    expect(renderNotification({ key: "k.unknown", translations: {} }, {}, "en")).toEqual({ title: "k.unknown", body: null, locale: "az" });
  });
  it("HTML-escapes substituted values by default and stays single pass", () => {
    const r = renderNotification(welcome, { name: `<img src=x onerror="alert(1)">&` }, "en");
    expect(r.body).toBe("Hi &lt;img src=x onerror=&quot;alert(1)&quot;&gt;&amp;!");
    expect(renderNotification(welcome, { name: "{other}", other: "x" }, "en").body).toBe("Hi {other}!");
  });
  it("does not escape the trusted template text, and `escape: false` gives plain text for React / push", () => {
    const t: NotificationTemplate = { key: "k", translations: { en: { title: "Tom & Jerry <b>{n}</b>" } } };
    expect(renderNotification(t, { n: "<i>" }, "en").title).toBe("Tom & Jerry <b>&lt;i&gt;</b>");
    expect(renderNotification(t, { n: "<i>" }, "en", { escape: false }).title).toBe("Tom & Jerry <b><i></b>");
  });
  it("unknown placeholders stay as written; null params render empty", () => {
    expect(renderNotification(welcome, {}, "en").body).toBe("Hi {name}!");
    expect(renderNotification(welcome, { name: null }, "en").body).toBe("Hi !");
  });
  it("escapes legacy text too (it is user-influenced)", () => {
    const legacy: NotificationTemplate = { key: "old", translations: {}, legacy: { title: "<script>", body: null } };
    expect(renderNotification(legacy).title).toBe("&lt;script&gt;");
    expect(renderNotification(legacy, {}, "az", { escape: false }).title).toBe("<script>");
  });
});
