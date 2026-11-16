"use client";

import { useI18n } from "@unimate/i18n/react";
import { Button, Card, EmptyState, ErrorState, Skeleton } from "@unimate/ui";
import { useRouter } from "next/navigation";
import { QuizTaker } from "@/features/documents/QuizPanel";
import type { QuizRow } from "@/lib/db";
import { getBrowserClient } from "@/lib/supabase/browser";
import { unwrap, useAsync } from "@/lib/use-async";

/** All quizzes across documents. Generation happens inside a document; answers are graded server-side. */
export function QuizzesPage() {
  const { t, date } = useI18n();
  const router = useRouter();
  const quizzes = useAsync(async () => unwrap(await getBrowserClient().from("quizzes").select("id,title,created_at").order("created_at", { ascending: false })) as QuizRow[], []);
  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>{t("mobile.quizzes.title")}</h1>
      </div>
      {quizzes.loading && !quizzes.data ? (
        <Skeleton height={80} />
      ) : quizzes.error ? (
        <ErrorState title={t("common.genericError")} description={quizzes.error} action={<Button onClick={quizzes.reload}>{t("common.retry")}</Button>} />
      ) : quizzes.data?.length === 0 ? (
        <EmptyState title={t("mobile.quizzes.empty")} description={t("mobile.quizzes.emptyBody")} />
      ) : (
        <div className="stack">
          {quizzes.data?.map((q) => (
            <div key={q.id} className="list-item">
              <div className="list-item__main">
                <span className="list-item__title">{q.title}</span>
                <span className="list-item__meta">{date(q.created_at)}</span>
              </div>
              <Button size="sm" onClick={() => router.push(`/quiz/${q.id}`)}>{t("quiz.start")}</Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function QuizRunPage({ quizId }: { quizId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>{t("documents.tabs.quiz")}</h1>
      </div>
      <Card flat>
        <QuizTaker quiz={{ id: quizId }} onExit={() => router.back()} />
      </Card>
    </div>
  );
}
