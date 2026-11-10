import { TRACK_STATUSES, matchSkills, safeExternalUrl, type TrackStatus } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { Linking, View } from "react-native";
import { Icon } from "../../components/Icon";
import { AppText, Badge, Button, Card, EmptyState, ErrorState, Input, Screen, ScreenHeader, Segmented, Skeleton, useToast } from "../../components/ui";
import { useAsync } from "../../lib/use-async";
import { useTheme } from "../../theme/ThemeProvider";
import { useUser } from "../../state/session";
import { getOpportunity, myCvSkills, myTracking, removeTracking, trackOpportunity } from "./api";
import { DeadlineLabel, KIND_ICON } from "./parts";

export function OpportunityDetailScreen({ id }: { id: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const { toast } = useToast();
  const { theme } = useTheme();
  const { supabase: sb } = useUser();
  const detail = useAsync(() => getOpportunity(sb, id), [sb, id]);
  const mine = useAsync(() => myTracking(sb), [sb, id]);
  const cvSkills = useAsync(() => myCvSkills(sb), [sb]);
  const entry = mine.data?.find((i) => i.opportunityId === id);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => setNotes(entry?.notes ?? ""), [entry?.id, entry?.notes]);

  const header = <ScreenHeader title={t("career.title")} onBack={() => router.back()} />;
  if (detail.loading && !detail.data) {
    return (
      <Screen>
        {header}
        <Skeleton height={200} />
      </Screen>
    );
  }
  if (detail.error) {
    return (
      <Screen>
        {header}
        <ErrorState title={t("career.loadFailed")} description={detail.error} action={<Button title={t("common.retry")} onPress={detail.reload} />} />
      </Screen>
    );
  }
  const o = detail.data;
  if (!o) {
    return (
      <Screen>
        {header}
        <EmptyState title={t("career.notFound")} description={t("career.notFoundBody")} />
      </Screen>
    );
  }
  const url = safeExternalUrl(o.applyUrl);
  const match = matchSkills(cvSkills.data ?? [], o.skills);
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      mine.reload();
    } catch {
      toast(t("career.detail.trackFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      {header}
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Icon name={KIND_ICON[o.kind]} size="sm" color={theme.active} />
          <Badge tone="info">{t(`career.kindOne.${o.kind}`)}</Badge>
          {o.remote ? <Badge tone="neutral">{t("career.card.remote")}</Badge> : null}
        </View>
        <AppText variant="title" accessibilityRole="header">
          {o.title}
        </AppText>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <AppText variant="heading" style={{ flexShrink: 1 }}>
            {o.organization.name}
          </AppText>
          {o.organization.verified ? <Icon name="success" size="sm" color={theme.success} label={t("career.card.verified")} /> : null}
        </View>
        {o.location ? <AppText muted>{`${t("career.detail.location")}: ${o.location}`}</AppText> : null}
        <DeadlineLabel deadline={o.deadline} />
        {o.deadline ? (
          <AppText variant="caption" muted>
            {`${t("career.detail.deadline")}: ${o.deadline}`}
          </AppText>
        ) : null}
        {url ? <Button title={t("career.detail.applyCta")} icon={<Icon name="jobs" size="sm" color="#FFFFFF" />} onPress={() => void Linking.openURL(url)} /> : <AppText muted>{t("career.detail.linkBlocked")}</AppText>}
        <AppText variant="caption" muted>
          {t("career.detail.applyNote")}
        </AppText>
      </Card>

      <Card>
        <AppText variant="heading">{t("career.detail.track")}</AppText>
        {entry ? (
          <>
            <Segmented label={t("career.detail.status")} value={entry.status} onChange={(s: TrackStatus) => void run(() => trackOpportunity(sb, id, s))} options={TRACK_STATUSES.map((s) => ({ value: s, label: t(`career.status.${s}`) }))} />
            <Input label={t("career.detail.notes")} placeholder={t("career.detail.notesPlaceholder")} value={notes} onChangeText={setNotes} multiline numberOfLines={4} maxLength={2000} style={{ minHeight: 90, textAlignVertical: "top" }} />
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <Button small title={t("career.detail.saveNotes")} disabled={busy || notes === entry.notes} onPress={() => void run(() => trackOpportunity(sb, id, entry.status, notes))} />
              <Button small variant="danger" title={t("career.detail.untrack")} disabled={busy} onPress={() => void run(() => removeTracking(sb, entry.id))} />
            </View>
          </>
        ) : (
          <Button title={t("career.detail.track")} variant="secondary" icon={<Icon name="saved" size="sm" />} loading={busy} onPress={() => void run(() => trackOpportunity(sb, id, "saved"))} />
        )}
      </Card>

      {o.description ? (
        <Card>
          <AppText variant="heading">{t("career.detail.description")}</AppText>
          <AppText>{o.description}</AppText>
        </Card>
      ) : null}
      {o.requirements ? (
        <Card>
          <AppText variant="heading">{t("career.detail.requirements")}</AppText>
          <AppText>{o.requirements}</AppText>
        </Card>
      ) : null}

      <Card>
        <AppText variant="heading">{t("career.detail.match")}</AppText>
        {o.skills.length === 0 ? (
          <AppText muted>{t("career.detail.matchNoSkills")}</AppText>
        ) : !cvSkills.data || cvSkills.data.length === 0 ? (
          <>
            <AppText muted>{t("career.detail.matchNoCv")}</AppText>
            <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
              {o.skills.map((s) => (
                <Badge key={s} tone="neutral">
                  {s}
                </Badge>
              ))}
            </View>
          </>
        ) : (
          <>
            <AppText>{t("career.detail.matchBody", { matched: match.matched.length, total: match.matched.length + match.missing.length })}</AppText>
            {match.matched.length ? (
              <View style={{ gap: 6 }}>
                <AppText variant="label">{t("career.detail.have")}</AppText>
                <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                  {match.matched.map((s) => (
                    <Badge key={s} tone="success">
                      {s}
                    </Badge>
                  ))}
                </View>
              </View>
            ) : null}
            {match.missing.length ? (
              <View style={{ gap: 6 }}>
                <AppText variant="label">{t("career.detail.missing")}</AppText>
                <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                  {match.missing.map((s) => (
                    <Badge key={s} tone="warning">
                      {s}
                    </Badge>
                  ))}
                </View>
              </View>
            ) : null}
          </>
        )}
      </Card>

      {o.organization.description || o.organization.website ? (
        <Card>
          <AppText variant="heading">{t("career.detail.organization")}</AppText>
          {o.organization.description ? <AppText>{o.organization.description}</AppText> : null}
          {safeExternalUrl(o.organization.website) ? <Button small variant="secondary" title={t("career.detail.website")} onPress={() => void Linking.openURL(o.organization.website!)} /> : null}
        </Card>
      ) : null}
      {o.sourceNote ? (
        <AppText variant="caption" muted>
          {`${t("career.detail.source")}: ${o.sourceNote}`}
        </AppText>
      ) : null}
    </Screen>
  );
}
