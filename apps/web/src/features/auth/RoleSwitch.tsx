import Link from "next/link";
import { useT } from "@unimate/i18n/react";
import type { AppMode } from "@/lib/mode";

/** Student / teacher entry switch. Plain links so it works without state and keeps `next`. */
export function RoleSwitch({ as, path, next }: { as: AppMode; path: "/sign-in" | "/sign-up"; next?: string }) {
  const t = useT();
  const href = (m: AppMode) => {
    const q = new URLSearchParams();
    if (m === "teacher") q.set("as", "teacher");
    if (next) q.set("next", next);
    const s = q.toString();
    return s ? `${path}?${s}` : path;
  };
  return (
    <nav className="role-switch" aria-label={t("auth.roleLabel")}>
      {(["student", "teacher"] as const).map((m) => (
        <Link key={m} href={href(m)} aria-current={m === as ? "page" : undefined}>
          {t(`teach.welcome.${m}`)}
        </Link>
      ))}
    </nav>
  );
}
