import { CardsView } from "@/features/flashcards/CardsView";
import { getT } from "@/i18n/server";

export default async function FlashcardsPage() {
  const { t } = await getT();
  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>{t("nav.flashcards")}</h1>
        <p>{t("cards.allDocs")}</p>
      </div>
      <CardsView />
    </div>
  );
}
