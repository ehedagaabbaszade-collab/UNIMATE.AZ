"use client";

import { useI18n } from "@unimate/i18n/react";
import { Icon } from "@unimate/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";

/** Bell with an unread dot. The count is the server's unread_notification_count RPC, refreshed on navigation. */
export function NotificationBell() {
  const { t } = useI18n();
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
  return (
    <Link href="/notifications" className="bell" aria-label={unread > 0 ? t("notifications.bellUnread", { n: unread }) : t("notifications.bell")}>
      <Icon name="notifications" size={22} />
      {unread > 0 ? <span className="bell__dot" aria-hidden="true" /> : null}
    </Link>
  );
}
