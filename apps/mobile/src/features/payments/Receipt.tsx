import { useI18n } from "@unimate/i18n/react";
import { StyleSheet, View } from "react-native";
import { Icon } from "../../components/Icon";
import { AppText } from "../../components/ui";
import { useTheme } from "../../theme/ThemeProvider";
import { radii, spacing } from "../../theme/tokens";
import { DemoBadge } from "./parts";

const HOLES = 14;
const HOLE = 14;

/** Perforated edge: a row of background-coloured circles cutting into the card (card clips with overflow hidden). */
function Perforation({ bottom }: { bottom?: boolean }) {
  const { theme } = useTheme();
  return (
    <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, [bottom ? "bottom" : "top"]: -HOLE / 2, flexDirection: "row", justifyContent: "space-around" }}>
      {Array.from({ length: HOLES }, (_, i) => (
        <View key={i} style={{ width: HOLE, height: HOLE, borderRadius: HOLE / 2, backgroundColor: theme.bg }} />
      ))}
    </View>
  );
}

function Dashed() {
  const { theme } = useTheme();
  return (
    <View style={{ height: 1, overflow: "hidden" }}>
      <View style={{ height: 2, borderWidth: 1, borderStyle: "dashed", borderColor: theme.border }} />
    </View>
  );
}

export interface ReceiptProps {
  planName: string;
  amount: number;
  methodLabel: string;
  transactionId: string;
  at: Date;
  /** Small phones: tighter spacing and no caption so the receipt fits without scrolling. */
  compact?: boolean;
}

/** Demo receipt card. States clearly that it is not a real payment. */
export function Receipt({ planName, amount, methodLabel, transactionId, at, compact = false }: ReceiptProps) {
  const { t, number, dateTime } = useI18n();
  const { theme } = useTheme();
  const full = number(amount, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const whole = full.slice(0, -3);
  const cents = full.slice(-3);
  const row = (label: string, value: string, strong = false) => (
    <View key={label} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: spacing.md }}>
      <AppText muted>{label}</AppText>
      <AppText style={{ fontWeight: strong ? "700" : "600", flexShrink: 1, textAlign: "right" }}>{value}</AppText>
    </View>
  );
  return (
    <View style={{ backgroundColor: theme.card, borderRadius: radii.xl, borderCurve: "continuous", overflow: "hidden", borderWidth: StyleSheet.hairlineWidth, borderColor: theme.cardBorder, paddingHorizontal: spacing.xl, paddingVertical: compact ? spacing.lg : spacing.xl + 6, gap: compact ? spacing.sm : spacing.lg }}>
      <Perforation />
      <View style={{ alignItems: "center", gap: spacing.xs, paddingTop: spacing.sm }}>
        <AppText variant="label" muted>
          {t("mobile.checkout.rAmount")}
        </AppText>
        <View style={{ flexDirection: "row", alignItems: "baseline" }}>
          <AppText style={{ fontSize: compact ? 34 : 44, lineHeight: compact ? 40 : 50, fontWeight: "700", letterSpacing: -1 }}>{whole}</AppText>
          <AppText muted style={{ fontSize: 26, lineHeight: 50, fontWeight: "600" }}>
            {cents}
          </AppText>
          <AppText muted style={{ fontSize: 22, lineHeight: 50, marginLeft: 6 }}>
            {t("mobile.checkout.price", { amount: "" }).trim()}
          </AppText>
        </View>
      </View>
      <Dashed />
      <View style={{ gap: compact ? spacing.xs : spacing.md }}>
        {row(t("mobile.checkout.plan"), planName)}
        {row(t("mobile.checkout.rDate"), dateTime(at))}
        {row(t("mobile.checkout.rTx"), transactionId)}
        {row(t("mobile.checkout.rMethod"), methodLabel)}
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
          <AppText muted>{t("mobile.checkout.rStatus")}</AppText>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name="check" size={16} color={theme.success} />
            <AppText style={{ color: theme.success, fontWeight: "700" }}>{t("mobile.checkout.rOk")}</AppText>
          </View>
        </View>
      </View>
      <Dashed />
      <View style={{ alignItems: "center", gap: spacing.sm }}>
        <DemoBadge />
        {compact ? null : (
          <AppText variant="caption" muted style={{ textAlign: "center" }}>
            {t("mobile.checkout.receiptDemo")}
          </AppText>
        )}
      </View>
      <Perforation bottom />
    </View>
  );
}
