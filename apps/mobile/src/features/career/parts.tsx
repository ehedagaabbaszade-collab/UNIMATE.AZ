import { deadlineView, todayInBaku, type OpportunityKind, type OpportunityListItem, type TrackStatus } from "@unimate/core";
import type { IconName } from "@unimate/ui/icons";
import { useI18n } from "@unimate/i18n/react";
import { View } from "react-native";
import { Icon } from "../../components/Icon";
import { AppText, Badge, Card, type BadgeTone, PressableScale } from "../../components/ui";
import { useTheme } from "../../theme/ThemeProvider";

export const KIND_ICON: Record<OpportunityKind, IconName> = {
  internship: "internship",
  junior_job: "jobs",
  scholarship: "scholarship",
  exchange: "development",
  competition: "achievements",
  hackathon: "challenges",
  career_event: "event",
};
export const STATUS_TONE: Record<TrackStatus, BadgeTone> = { saved: "neutral", applied: "info", interview: "warning", offer: "success", rejected: "danger" };

/** Deadline text with a countdown, coloured by urgency. Dates are compared as calendar days in Azerbaijan (UTC+4). */
export function DeadlineLabel({ deadline }: { deadline: string | null }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  const v = deadlineView(deadline, todayInBaku());
  const text =
    v.state === "none" ? t("career.deadline.none") : v.state === "today" ? t("career.deadline.today") : v.state === "expired" ? t("career.deadline.passed", { n: v.days }) : t("career.deadline.left", { n: v.days });
  const color = v.state === "expired" ? theme.danger : v.state === "today" || v.state === "soon" ? theme.warning : theme.textMuted;
  return (
    <AppText variant="caption" style={{ color, fontWeight: v.state === "soon" || v.state === "today" ? "700" : "400" }}>
      {text}
    </AppText>
  );
}

export function OpportunityCard({ item, onPress }: { item: OpportunityListItem; onPress: () => void }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityLabel={`${item.title}, ${item.organizationName}`}>
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Icon name={KIND_ICON[item.kind]} size="sm" color={theme.active} />
          <Badge tone="info">{t(`career.kindOne.${item.kind}`)}</Badge>
          {item.remote ? <Badge tone="neutral">{t("career.card.remote")}</Badge> : null}
          {item.trackedStatus ? <Badge tone={STATUS_TONE[item.trackedStatus]}>{t("career.card.trackedAs", { status: t(`career.status.${item.trackedStatus}`) })}</Badge> : null}
        </View>
        <AppText variant="heading">{item.title}</AppText>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <AppText muted style={{ flexShrink: 1 }}>
            {item.organizationName}
          </AppText>
          {item.organizationVerified ? <Icon name="success" size="sm" color={theme.success} label={t("career.card.verified")} /> : null}
        </View>
        {item.location ? (
          <AppText variant="caption" muted>
            {item.location}
          </AppText>
        ) : null}
        <DeadlineLabel deadline={item.deadline} />
      </Card>
    </PressableScale>
  );
}
