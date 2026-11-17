import { useI18n } from "@unimate/i18n/react";
import { LinearGradient } from "expo-linear-gradient";
import { useEffect } from "react";
import { Text, View } from "react-native";
import RA, { ZoomIn, interpolate, useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";
import { useReducedMotion } from "../../lib/motion";
import { type CardBrand, maskCard } from "./card";
import { BrandMark } from "./parts";

const GRADIENT = ["#1E1B4B", "#3730A3", "#6366F1"] as const;
const face = { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderRadius: 20, overflow: "hidden", backfaceVisibility: "hidden" } as const;

/** Credit-card preview (1.586:1) that flips to the back while the CVV field is focused. Decorative: inputs carry the a11y. */
export function CardPreview({ number, holder, expiry, cvv, brand, flipped }: { number: string; holder: string; expiry: string; cvv: string; brand: CardBrand | null; flipped: boolean }) {
  const { t } = useI18n();
  const reduced = useReducedMotion();
  const flip = useSharedValue(0);
  useEffect(() => {
    const to = flipped ? 1 : 0;
    flip.value = reduced ? to : withSpring(to, { duration: 700, dampingRatio: 0.8 });
  }, [flipped, reduced, flip]);
  const front = useAnimatedStyle(() => ({ transform: [{ perspective: 1000 }, { rotateY: `${interpolate(flip.value, [0, 1], [0, 180])}deg` }] }));
  const back = useAnimatedStyle(() => ({ transform: [{ perspective: 1000 }, { rotateY: `${interpolate(flip.value, [0, 1], [180, 360])}deg` }] }));
  const white = { color: "#FFFFFF" } as const;
  return (
    <View importantForAccessibility="no-hide-descendants" accessibilityElementsHidden style={{ aspectRatio: 1.586, width: "100%", maxWidth: 420, alignSelf: "center", boxShadow: "0 12px 28px rgba(30,27,75,0.35)", borderRadius: 20 }}>
      <RA.View style={[face, front]}>
        <LinearGradient colors={GRADIENT} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ flex: 1, padding: 20, justifyContent: "space-between" }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", minHeight: 30 }}>
            <View style={{ width: 40, height: 30, borderRadius: 6, backgroundColor: "#E8C872", opacity: 0.9 }} />
            {brand ? (
              <RA.View key={brand} entering={ZoomIn.duration(220)}>
                <BrandMark brand={brand} height={26} />
              </RA.View>
            ) : null}
          </View>
          <Text adjustsFontSizeToFit numberOfLines={1} style={[white, { fontSize: 22, fontWeight: "600", letterSpacing: 2, fontVariant: ["tabular-nums"] }]}>
            {maskCard(number)}
          </Text>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", gap: 12 }}>
            <Text numberOfLines={1} style={[white, { flex: 1, fontSize: 14, fontWeight: "600", letterSpacing: 1, opacity: holder ? 1 : 0.6 }]}>
              {holder ? holder.toUpperCase() : t("mobile.checkout.holderPh")}
            </Text>
            <Text style={[white, { fontSize: 14, fontWeight: "600", fontVariant: ["tabular-nums"], opacity: expiry ? 1 : 0.6 }]}>{expiry || t("mobile.checkout.expiryPh")}</Text>
          </View>
        </LinearGradient>
      </RA.View>
      <RA.View style={[face, back]}>
        <LinearGradient colors={GRADIENT} start={{ x: 1, y: 0 }} end={{ x: 0, y: 1 }} style={{ flex: 1, paddingVertical: 24, gap: 18 }}>
          <View style={{ height: 44, backgroundColor: "#0B0B1A" }} />
          <View style={{ paddingHorizontal: 20, gap: 6, alignItems: "flex-end" }}>
            <Text style={[white, { fontSize: 11, fontWeight: "600", opacity: 0.8 }]}>{t("mobile.checkout.cvv")}</Text>
            <View style={{ width: "70%", height: 38, borderRadius: 6, backgroundColor: "#FFFFFF", justifyContent: "center", alignItems: "flex-end", paddingHorizontal: 12 }}>
              <Text style={{ color: "#1E1B4B", fontSize: 18, fontWeight: "700", letterSpacing: 3 }}>{"•".repeat(cvv.length)}</Text>
            </View>
          </View>
        </LinearGradient>
      </RA.View>
    </View>
  );
}
