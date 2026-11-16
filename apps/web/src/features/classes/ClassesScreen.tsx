"use client";

import { isInviteCode, normalizeInviteCode } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { Badge, Button, EmptyState, ErrorState, Input, Skeleton, useToast } from "@unimate/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useUser } from "@/components/user";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useAsync } from "@/lib/use-async";
import { createClass, joinClass, myClasses } from "./api";
import { useAppMode, useClassError } from "./hooks";

/**
 * Classes: a teacher creates classes (private study groups) and opens them; a student joins one with the teacher's code.
 * `forceTeacher`: the /teacher/classes route; elsewhere the portal cookie decides.
 */
export function ClassesScreen({ forceTeacher = false }: { forceTeacher?: boolean }) {
  const { t } = useI18n();
  const router = useRouter();
  const { toast } = useToast();
  const onError = useClassError();
  useUser();
  const teacher = useAppMode() === "teacher" || forceTeacher;
  const list = useAsync(() => myClasses(getBrowserClient()), []);
  const reload = list.reload;
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);

  async function run(kind: "create" | "join") {
    setBusy(kind);
    try {
      const sb = getBrowserClient();
      const id = kind === "create" ? await createClass(sb, name.trim()) : await joinClass(sb, code);
      toast(t(kind === "create" ? "teach.class.created" : "teach.class.joined"), "success");
      setName("");
      setCode("");
      reload();
      router.push(`/class/${id}`);
    } catch (e) {
      onError(e);
    } finally {
      setBusy(null);
    }
  }

  // Every class shows in both modes (a student may moderate one, a teacher may sit in a colleague's); teaching ones first.
  const classes = [...(list.data ?? [])].sort((a, b) => Number(b.teaching) - Number(a.teaching));
  return (
    <div className="stack">
      <header className="page-head">
        <h1>
          {t("teach.class.title")} {t("teach.class.heroStrong")}
        </h1>
      </header>

      {list.data === undefined ? null : teacher ? (
        <details className="um-card" open={list.data.every((c) => !c.teaching)}>
          <summary>
            <strong>{t("teach.class.create")}</strong>
          </summary>
          <form
            className="stack"
            style={{ marginTop: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim().length >= 2 && !busy) void run("create");
            }}
          >
            <Input label={t("teach.class.name")} placeholder={t("teach.class.namePlaceholder")} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} />
            <Button type="submit" loading={busy === "create"} disabled={name.trim().length < 2 || !!busy}>
              {t("teach.class.create")}
            </Button>
          </form>
        </details>
      ) : (
        <details className="um-card" open={list.data.every((c) => c.teaching)}>
          <summary>
            <strong>{t("teach.class.join")}</strong>
          </summary>
          <form
            className="stack"
            style={{ marginTop: 12 }}
            onSubmit={(e) => {
              e.preventDefault();
              if (isInviteCode(code) && !busy) void run("join");
            }}
          >
            <Input label={t("teach.class.code")} value={code} onChange={(e) => setCode(normalizeInviteCode(e.target.value))} autoCapitalize="characters" autoCorrect="off" autoComplete="off" />
            <Button type="submit" loading={busy === "join"} disabled={!isInviteCode(code) || !!busy}>
              {t("teach.class.join")}
            </Button>
          </form>
        </details>
      )}

      {list.loading && !list.data ? (
        <Skeleton height={72} />
      ) : list.error && !list.data ? (
        <ErrorState title={t("teach.class.errors.generic")} action={<Button onClick={reload}>{t("common.retry")}</Button>} />
      ) : classes.length === 0 ? (
        <EmptyState title={t("teach.class.empty")} description={t(teacher ? "teach.class.emptyTeacher" : "teach.class.emptyStudent")} />
      ) : (
        classes.map((c) => (
          <Link key={c.id} href={`/class/${c.id}`} className="list-item">
            <span className="list-item__main">
              <span className="list-item__title">{c.name}</span>
              <span className="list-item__meta">{t("teach.class.members", { n: c.member_count })}</span>
            </span>
            {c.teaching ? <Badge tone="primary">{t("teach.class.teaching")}</Badge> : null}
          </Link>
        ))
      )}
    </div>
  );
}
