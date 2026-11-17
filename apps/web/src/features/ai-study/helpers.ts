import type { StructuredCitation } from "@/lib/edge";
import { pageLabel } from "@/features/documents/citations";

type T = (key: "chat.pageRange" | "chat.pageSingle", vars: Record<string, number>) => string;

/** "p. 3, p. 5–7": unique page labels of the citations that carry a page; "" when none do. */
export function pageLabels(cs: readonly Pick<StructuredCitation, "page_start" | "page_end">[], t: T): string {
  const out = cs.map((c) => {
    const l = pageLabel(c);
    return l.kind === "single" ? t("chat.pageSingle", { n: l.n }) : l.kind === "range" ? t("chat.pageRange", { a: l.a, b: l.b }) : "";
  });
  return out.filter((l, i) => l && out.indexOf(l) === i).join(", ");
}
