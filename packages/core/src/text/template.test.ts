import { describe, expect, it } from "vitest";
import { escapeHtml, renderEmailTemplate, renderTemplate } from "./template";

describe("renderTemplate (single pass)", () => {
  it("substitutes known keys and leaves unknown ones", () => {
    expect(renderTemplate("Hi {name}, {x}", { name: "Aysel" })).toBe("Hi Aysel, {x}");
    expect(renderTemplate("{a}{a}", { a: 1 })).toBe("11");
    expect(renderTemplate("{a}|{b}", { a: null, b: undefined })).toBe("|");
  });
  it("never re-expands {key} inside substituted values, whatever the key order", () => {
    expect(renderTemplate("{name} / {plan}", { name: "{plan}", plan: "Pro" })).toBe("{plan} / Pro");
    expect(renderTemplate("{name} / {plan}", { plan: "{name}", name: "Ann" })).toBe("Ann / {name}");
  });
  it("does not resolve inherited properties", () => {
    expect(renderTemplate("{constructor} {toString}", {})).toBe("{constructor} {toString}");
  });
});

describe("escapeHtml / renderEmailTemplate", () => {
  it("escapes the five HTML metacharacters", () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe("&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;");
  });
  it("escapes substituted values but not the trusted template, and stays single-pass", () => {
    expect(renderEmailTemplate("<p>Hello {name}</p>", { name: "<img src=x onerror=alert(1)>" })).toBe("<p>Hello &lt;img src=x onerror=alert(1)&gt;</p>");
    expect(renderEmailTemplate("<b>{a}</b> {b}", { a: "{b}", b: "&" })).toBe("<b>{b}</b> &amp;");
  });
});
