"use client";

import { useI18n } from "@unimate/i18n/react";
import { Icon } from "@unimate/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";

/** Unread count from the server's unread_notification_count RPC, refreshed on navigation. Fetch once per shell. */
export function useUnreadCount(): number {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void getBrowserClient()
      .rpc("unread_notification_count")
      .then(({ data }) => {
        if (!cancelled) setUnread(typeof data === "number" ? data : 0);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);
  return unread;
}

/** Bell with an unread dot (presentational: the shell renders two, one per layout, from a single fetch). */
export function NotificationBell({ unread }: { unread: number }) {
  const { t } = useI18n();
  return (
    <Link href="/notifications" className="bell" aria-label={unread > 0 ? t("notifications.bellUnread", { n: unread }) : t("notifications.bell")}>
      <Icon name="notifications" size={22} />
      {unread > 0 ? <span className="bell__dot" aria-hidden="true" /> : null}
    </Link>
  );
}
