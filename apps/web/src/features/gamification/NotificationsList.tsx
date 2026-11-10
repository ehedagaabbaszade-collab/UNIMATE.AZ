"use client";

import { notificationHref, parseNotifications } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { Button, Card, EmptyState, ErrorState, Icon, Skeleton } from "@unimate/ui";
import Link from "next/link";
import { getBrowserClient } from "@/lib/supabase/browser";
import { unwrap, useAsync } from "@/lib/use-async";

/** Server notifications rendered in the user's profile language (RPC list_my_notifications). */
export function NotificationsList() {
  const { t, dateTime } = useI18n();
  const list = useAsync(async () => parseNotifications(unwrap(await getBrowserClient().rpc("list_my_notifications", { p_limit: 50 }))), []);
  const unread = (list.data ?? []).filter((n) => !n.read_at).length;

  async function mark(ids?: string[]) {
    await getBrowserClient().rpc("mark_notifications_read", ids ? { p_ids: ids } : {});
    list.reload();
  }

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>{t("notifications.title")}</h1>
        {unread > 0 ? (
          <Button variant="secondary" size="sm" onClick={() => void mark()}>
            {t("notifications.markAllRead")}
          </Button>
        ) : null}
      </div>
      {list.loading && !list.data ? (
        <Skeleton height={70} />
      ) : list.error ? (
        <ErrorState title={t("notifications.loadFailed")} description={list.error} action={<Button onClick={list.reload}>{t("common.retry")}</Button>} />
      ) : list.data?.length === 0 ? (
        <EmptyState title={t("notifications.empty")} />
      ) : (
        <ul className="list" style={{ listStyle: "none", padding: 0 }}>
          {list.data?.map((n) => (
            <li key={n.id}>
              <Card>
                <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                  <span className="list-item__title" style={{ fontWeight: n.read_at ? 400 : 700 }}>
                    {n.kind === "achievement" ? <Icon name="achievements" size={18} /> : null} {n.title}
                  </span>
                  {notificationHref(n) ? (
                    <Link className="um-btn um-btn--secondary um-btn--sm" href={notificationHref(n)!} onClick={() => { if (!n.read_at) void mark([n.id]); }}>
                      {t("notifications.open")}
                    </Link>
                  ) : null}
                  {!n.read_at ? (
                    <Button variant="ghost" size="sm" onClick={() => void mark([n.id])}>
                      {t("notifications.markRead")}
                    </Button>
                  ) : null}
                </div>
                {n.body ? <p className="um-muted">{n.body}</p> : null}
                <p className="um-muted">{dateTime(n.created_at)}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
