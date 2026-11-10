import { courseLabel, type NoteListItem } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { Pressable, View } from "react-native";
import { Icon } from "../../components/Icon";
import { AppText, Badge, Card } from "../../components/ui";
import { useTheme } from "../../theme/ThemeProvider";

/** Read-only star row. */
export function Stars({ value, count }: { value: number; count?: number }) {
  const { t, number } = useI18n();
  const { theme } = useTheme();
  const rounded = Math.round(value);
  const empty = (count ?? 1) === 0;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }} accessible accessibilityLabel={empty ? t("notes.noRating") : t("notes.ratingValue", { n: number(value, { maximumFractionDigits: 1 }) })}>
      <View style={{ flexDirection: "row", gap: 2 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <Icon key={i} name="rating" size="sm" color={!empty && i <= rounded ? theme.warning : theme.textMuted} />
        ))}
      </View>
      <AppText variant="caption" muted>
        {empty ? t("notes.noRating") : `${number(value, { maximumFractionDigits: 1 })}${count !== undefined ? ` · ${t("notes.ratingCount", { n: count })}` : ""}`}
      </AppText>
    </View>
  );
}

/** Tappable 1-5 stars. */
export function StarInput({ value, onChange, disabled }: { value: number; onChange: (n: number) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const { theme } = useTheme();
  return (
    <View style={{ flexDirection: "row", gap: 6 }} accessibilityRole="radiogroup">
      {[1, 2, 3, 4, 5].map((i) => (
        <Pressable
          key={i}
          disabled={disabled}
          onPress={() => onChange(i)}
          hitSlop={6}
          accessibilityRole="radio"
          accessibilityState={{ selected: i === value, disabled: !!disabled }}
          accessibilityLabel={t("notes.reviews.ratingStar", { n: i })}
          style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}
        >
          <Icon name="rating" size="lg" color={i <= value ? theme.warning : theme.textMuted} />
        </Pressable>
      ))}
    </View>
  );
}

export function NoteCard({ item, onPress }: { item: NoteListItem; onPress: () => void }) {
  const { t, date } = useI18n();
  const course = courseLabel({ code: item.courseCode, title: item.courseTitle });
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={item.title}>
      <Card>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <Badge tone="info">{t(`notes.kind.${item.kind}`)}</Badge>
          {item.saved ? <Icon name="saved" size="sm" color="#F7C265" label={t("notes.tabs.saved")} /> : null}
        </View>
        <AppText variant="heading">{item.title}</AppText>
        {course ? (
          <AppText variant="caption" muted>
            {course}
          </AppText>
        ) : null}
        <Stars value={item.avgRating} count={item.ratingCount} />
        <AppText variant="caption" muted>
          {[t("notes.by", { name: item.uploaderName ?? t("notes.anonymous") }), date(item.createdAt)].join(" · ")}
        </AppText>
      </Card>
    </Pressable>
  );
}
