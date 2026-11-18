import Link from "next/link";
import { LEGAL_SLUGS, type LegalSlug } from "@/content/legal";
import type { getT } from "@/i18n/server";

const NAV_KEYS: Record<LegalSlug, "privacy" | "terms" | "aiDisclaimer" | "community" | "retention"> = {
  privacy: "privacy",
  terms: "terms",
  "ai-disclaimer": "aiDisclaimer",
  "community-guidelines": "community",
  "data-retention": "retention",
};

/** Tabs across every legal page, including the open-source licenses page. */
export function LegalNav({ t, current }: { t: Awaited<ReturnType<typeof getT>>["t"]; current: LegalSlug | "licenses" }) {
  return (
    <nav className="legal-nav" aria-label={t("legal.title")}>
      {LEGAL_SLUGS.map((s) => (
        <Link key={s} href={`/legal/${s}`} aria-current={s === current ? "page" : undefined}>
          {t(`legal.${NAV_KEYS[s]}`)}
        </Link>
      ))}
      <Link href="/licenses" aria-current={current === "licenses" ? "page" : undefined}>
        {t("legal.licenses.title")}
      </Link>
    </nav>
  );
}
