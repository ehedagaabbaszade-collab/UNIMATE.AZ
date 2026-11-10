import { useI18n } from "@unimate/i18n/react";
import { useMemo, useState } from "react";
import { View } from "react-native";
import { AppText, Button, Card, Input, Notice, Segmented } from "../../components/ui";
import { LETTERS, computeGpa, type BandInput, type GpaRow, type ScaleMode } from "../../lib/gpa";

let seq = 0;
const nid = () => `r${++seq}`;
const blankRow = (): GpaRow => ({ id: nid(), name: "", credits: "", score: "", letter: "" });
const blankBand = (): BandInput => ({ id: nid(), min: "", letter: "", points: "" });

/** Credit-weighted GPA. All arithmetic is @unimate/core weightedGpa (via lib/gpa.ts validation). Works offline. */
export function GpaCalculator() {
  const { t, number } = useI18n();
  const [mode, setMode] = useState<ScaleMode>("az");
  const [rows, setRows] = useState<GpaRow[]>(() => [blankRow(), blankRow()]);
  const [bands, setBands] = useState<BandInput[]>(() => [blankBand()]);
  const out = useMemo(() => computeGpa(mode, bands, rows), [mode, bands, rows]);

  const patchRow = (id: string, p: Partial<GpaRow>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));
  const patchBand = (id: string, p: Partial<BandInput>) => setBands((bs) => bs.map((b) => (b.id === id ? { ...b, ...p } : b)));

  return (
    <View style={{ gap: 14 }}>
      <AppText muted>{t("gpa.subtitle")}</AppText>
      <Segmented
        label={t("gpa.scale")}
        value={mode}
        onChange={setMode}
        options={[
          { value: "az", label: t("gpa.scaleAz") },
          { value: "letter", label: t("gpa.scaleLetter") },
          { value: "custom", label: t("gpa.scaleCustom") },
        ]}
      />
      {mode === "custom" ? (
        <Card>
          {bands.map((b) => (
            <View key={b.id} style={{ gap: 8 }}>
              <Input label={t("gpa.bandMin")} value={b.min} onChangeText={(v) => patchBand(b.id, { min: v })} keyboardType="decimal-pad" />
              <Input label={t("gpa.bandLetter")} value={b.letter} onChangeText={(v) => patchBand(b.id, { letter: v })} autoCapitalize="characters" />
              <Input label={t("gpa.bandPoints")} value={b.points} onChangeText={(v) => patchBand(b.id, { points: v })} keyboardType="decimal-pad" />
              {bands.length > 1 ? <Button small variant="ghost" title={t("gpa.removeBand")} onPress={() => setBands((bs) => bs.filter((x) => x.id !== b.id))} /> : null}
            </View>
          ))}
          <Button small variant="secondary" title={t("gpa.addBand")} onPress={() => setBands((bs) => [...bs, blankBand()])} />
        </Card>
      ) : null}

      {rows.map((r) => (
        <Card key={r.id}>
          <Input label={t("gpa.course")} value={r.name} onChangeText={(v) => patchRow(r.id, { name: v })} />
          <Input label={t("gpa.credits")} value={r.credits} onChangeText={(v) => patchRow(r.id, { credits: v })} keyboardType="decimal-pad" error={out.rowErrors[r.id] === "validation.credits" ? t("validation.credits") : undefined} />
          {mode === "letter" ? (
            <Segmented label={t("gpa.letter")} value={r.letter} onChange={(v) => patchRow(r.id, { letter: v })} options={LETTERS.map((l) => ({ value: l, label: l }))} />
          ) : (
            <Input label={t("gpa.score")} value={r.score} onChangeText={(v) => patchRow(r.id, { score: v })} keyboardType="decimal-pad" error={out.rowErrors[r.id] === "validation.score" ? t("validation.score") : undefined} />
          )}
          {rows.length > 1 ? <Button small variant="ghost" title={t("gpa.removeCourse")} onPress={() => setRows((rs) => rs.filter((x) => x.id !== r.id))} /> : null}
        </Card>
      ))}
      <Button title={t("gpa.addCourse")} variant="secondary" onPress={() => setRows((rs) => [...rs, blankRow()])} />

      <Card accessibilityLiveRegion="polite">
        <AppText variant="heading">{t("gpa.result")}</AppText>
        {out.ok ? (
          out.gpa === null ? (
            <AppText muted>{t("gpa.resultNone")}</AppText>
          ) : (
            <>
              <AppText variant="display">{number(out.gpa, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</AppText>
              <AppText muted>{t("gpa.totalCredits", { n: out.totalCredits })}</AppText>
            </>
          )
        ) : out.reason === "scale" ? (
          <Notice text={t("gpa.scaleInvalid")} />
        ) : (
          <Notice text={t("gpa.invalid")} />
        )}
        <AppText variant="caption" muted>
          {t("gpa.assumption")}
        </AppText>
      </Card>
    </View>
  );
}
