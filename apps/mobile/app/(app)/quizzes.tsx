import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { AppText, Button, Card, EmptyState, ErrorState, Screen, ScreenHeader, Skeleton } from "../../src/components/ui";
import type { QuizRow } from "../../src/lib/db";
import { unwrap, useAsync } from "../../src/lib/use-async";
import { useUser } from "../../src/state/session";

/** All quizzes across documents. Generation happens inside a document; answers are graded server-side. */
export default function QuizzesRoute() {
  const { t, date } = useI18n();
  const router = useRouter();
  const { supabase: sb } = useUser();
  const quizzes = useAsync(async () => unwrap(await sb.from("quizzes").select("id,title,created_at").order("created_at", { ascending: false })) as QuizRow[], []);
  return (
    <Screen>
      <ScreenHeader title={t("mobile.quizzes.title")} onBack={() => router.back()} />
      {quizzes.loading && !quizzes.data ? (
        <Skeleton height={80} />
      ) : quizzes.error ? (
        <ErrorState title={t("common.genericError")} description={quizzes.error} action={<Button title={t("common.retry")} onPress={quizzes.reload} />} />
      ) : quizzes.data?.length === 0 ? (
        <EmptyState title={t("mobile.quizzes.empty")} description={t("mobile.quizzes.emptyBody")} />
      ) : (
        <View style={{ gap: 12 }}>
          {quizzes.data?.map((q) => (
            <Card key={q.id} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <AppText style={{ fontWeight: "700" }}>{q.title}</AppText>
                <AppText variant="caption" muted>
                  {date(q.created_at)}
                </AppText>
              </View>
              <Button small title={t("quiz.start")} onPress={() => router.push({ pathname: "/quiz/[id]", params: { id: q.id } })} />
            </Card>
          ))}
        </View>
      )}
    </Screen>
  );
}
