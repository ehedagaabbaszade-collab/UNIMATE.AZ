import { describe, expect, it } from "vitest";
import { DocumentDraftSchema, draftToText, renderDocumentHtml, renderSlidesHtml, type WritingLabels } from "./writing";

const L: WritingLabels = { kind: "SƏRBƏST İŞ", topic: "Mövzu", subject: "Fənn", student: "Tələbə", group: "Qrup", teacher: "Müəllim", contents: "Mündəricat", introduction: "Giriş", conclusion: "Nəticə", keyTerms: "Açar sözlər", references: "İstifadə olunmuş ədəbiyyat", referencesNote: "Oxuduğunuz mənbələri əlavə edin." };
const doc = DocumentDraftSchema.parse({ title: "Süni intellekt <və> təhsil", introduction: ["Aktuallıq."], sections: [{ heading: "I fəsil", paragraphs: ["A"] }, { heading: "II fəsil", paragraphs: ["B"] }], conclusion: ["Son."], searchKeywords: ["AI"] });

describe("writing renderers", () => {
  it("lays out the title page, contents and chapters, escaping text", () => {
    const html = renderDocumentHtml(doc, { university: "Bakı Dövlət Universiteti", student: "Aysel", city: "Bakı", year: "2026" }, L);
    expect(html).toContain("SƏRBƏST İŞ");
    expect(html).toContain("Bakı Dövlət Universiteti");
    expect(html).toContain("Süni intellekt &lt;və&gt; təhsil");
    expect(html).not.toContain("<və>");
    expect(html).toContain("Bakı – 2026");
    expect(html.indexOf(">Giriş<")).toBeLessThan(html.indexOf(">II fəsil<"));
    expect(html).toContain("Times New Roman");
  });
  it("renders a cover plus one page per slide", () => {
    const html = renderSlidesHtml({ title: "Deck", subtitle: "", slides: [1, 2, 3].map((i) => ({ title: `S${i}`, bullets: ["x"], notes: "" })), searchKeywords: ["k"] }, {});
    expect(html.match(/class="slide/g)).toHaveLength(4);
  });
  it("exports plain text for editing", () => {
    expect(draftToText(doc, L)).toMatch(/^Süni intellekt <və> təhsil\n\nGiriş\nAktuallıq\./);
  });
});
