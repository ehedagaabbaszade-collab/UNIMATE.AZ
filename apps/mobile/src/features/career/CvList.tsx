import { CV_DEFAULT_TEMPLATE, CV_LANGUAGES, CV_MAX_DOCUMENTS, cvTemplateMeta, emptyCv, type CvLanguage, type CvTemplate } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { ActivityIndicator, Image, View, useWindowDimensions } from "react-native";
import { Icon } from "../../components/Icon";
import { AppText, Badge, Button, Card, Dialog, EmptyState, ErrorState, Input, PressableScale, Skeleton, useToast } from "../../components/ui";
import { useAsync } from "../../lib/use-async";
import { useUser } from "../../state/session";
import { useTheme } from "../../theme/ThemeProvider";
import { spacing } from "../../theme/tokens";
import { createCv, deleteCv, duplicateCv, getCv, listCvs, renameCv, setDefaultCv, type CvListItem } from "./api";
import { exportCvPdf } from "./cv-export";
import { TemplateGallery, cvPreviewFor } from "./TemplatePicker";

/** CV management: thumbnail, title, last modified, default badge; create / edit / rename / duplicate / default / export / delete. */
export function CvList() {
  const { t, date, locale } = useI18n();
  const thumb = useWindowDimensions().width < 360 ? 52 : 64;
  const router = useRouter();
  const { theme } = useTheme();
  const [menu, setMenu] = useState<CvListItem | null>(null);
  const iconBtn = { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: theme.primarySoft } as const;
  const { toast } = useToast();
  const { user, supabase: sb } = useUser();
  const cvs = useAsync(() => listCvs(sb), [sb]);
  const [busy, setBusy] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [toDelete, setToDelete] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<CvListItem | null>(null);
  const [name, setName] = useState("");
  const firstFocus = useRef(true);
  const { reload } = cvs;
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) firstFocus.current = false;
      else reload();
    }, [reload]),
  );
  const run = async (key: string, fn: () => Promise<void>, fail = t("career.cv.saveFailed")) => {
    setBusy(key);
    try {
      await fn();
    } catch {
      toast(fail, "error");
    } finally {
      setBusy(null);
    }
  };
  const create = (template: CvTemplate) =>
    run("new", async () => {
      const lang: CvLanguage = (CV_LANGUAGES as readonly string[]).includes(locale) ? (locale as CvLanguage) : "az";
      const r = await createCv(sb, user.id, { title: t("career.cv.untitled"), language: lang, template, data: emptyCv() });
      setPicking(false);
      if (r.ok) router.push({ pathname: "/career/cv/[id]", params: { id: r.id } });
      else toast(r.error === "limit" ? t("career.cv.limit") : t("career.cv.saveFailed"), "error");
    });
  const duplicate = (id: string) =>
    run(id, async () => {
      const r = await duplicateCv(sb, user.id, id, "(2)");
      if (r.ok) toast(t("career.cv.duplicated"), "success");
      else toast(r.error === "limit" ? t("career.cv.limit") : t("career.cv.saveFailed"), "error"); // 54000 = 10-CV cap
      reload();
    });
  const makeDefault = (id: string) =>
    run(id, async () => {
      await setDefaultCv(sb, id);
      toast(t("cvMobile.defaultSet"), "success");
      reload();
    });
  const rename = () => {
    const c = renaming;
    setRenaming(null);
    if (c && name.trim()) void run(c.id, async () => {
      await renameCv(sb, c.id, name);
      toast(t("cvMobile.renamed"), "success");
      reload();
    });
  };
  const remove = () => {
    const id = toDelete;
    setToDelete(null);
    if (id) void run(id, async () => {
      await deleteCv(sb, id);
      toast(t("career.cv.removed"), "success");
      reload();
    });
  };
  const exportPdf = (id: string) =>
    run(
      id,
      async () => {
        const cv = await getCv(sb, id);
        if (!cv) throw new Error("gone");
        const r = await exportCvPdf(sb, cv);
        if (r.kind === "missing") toast(`${t("career.cv.required")}: ${r.fields.map((k) => t(`career.cv.field.${k as "fullName"}`)).join(", ")}`, "error");
        else if (r.kind === "unavailable") toast(t("career.cv.sharingUnavailable"), "error");
      },
      t("career.cv.exportFailed"),
    );

  if (cvs.loading && !cvs.data) return <Skeleton height={100} />;
  if (cvs.error && !cvs.data) return <ErrorState title={t("career.loadFailed")} description={cvs.error} action={<Button title={t("common.retry")} onPress={cvs.reload} />} />;
  const list = cvs.data ?? [];
  const open = (id: string) => router.push({ pathname: "/career/cv/[id]", params: { id } });
  return (
    <View style={{ gap: spacing.lg }}>
      <Button title={t("career.cv.create")} icon={<Icon name="add" size="sm" />} loading={busy === "new"} disabled={list.length >= CV_MAX_DOCUMENTS} onPress={() => setPicking(true)} />
      <TemplateGallery open={picking} current={CV_DEFAULT_TEMPLATE} busy={busy === "new"} actionLabel={t("career.cv.createWithTemplate")} onClose={() => setPicking(false)} onUse={(id) => void create(id)} />
      {list.length >= CV_MAX_DOCUMENTS ? (
        <AppText variant="caption" muted>
          {t("career.cv.limit")}
        </AppText>
      ) : null}
      <Dialog open={menu !== null} title={menu?.title ?? ""} onClose={() => setMenu(null)} actions={<Button small variant="secondary" title={t("common.close")} onPress={() => setMenu(null)} />}>
        {menu ? (
          <View style={{ gap: 8 }}>
            <Button variant="secondary" title={t("cvMobile.rename")} onPress={() => { const c = menu; setMenu(null); setName(c.title); setRenaming(c); }} />
            <Button variant="secondary" title={t("career.cv.duplicate")} disabled={list.length >= CV_MAX_DOCUMENTS} onPress={() => { const c = menu; setMenu(null); void duplicate(c.id); }} />
            {menu.isDefault ? null : <Button variant="secondary" title={t("cvMobile.setDefault")} onPress={() => { const c = menu; setMenu(null); void makeDefault(c.id); }} />}
            <Button variant="danger" title={t("career.cv.delete")} onPress={() => { const c = menu; setMenu(null); setToDelete(c.id); }} />
          </View>
        ) : null}
      </Dialog>
      <Dialog open={toDelete !== null} title={t("career.cv.delete")} onClose={() => setToDelete(null)} actions={<><Button small variant="secondary" title={t("common.cancel")} onPress={() => setToDelete(null)} /><Button small variant="danger" title={t("common.delete")} onPress={remove} /></>}>
        <AppText>{t("career.cv.deleteConfirm")}</AppText>
      </Dialog>
      <Dialog open={renaming !== null} title={t("cvMobile.renameTitle")} onClose={() => setRenaming(null)} actions={<><Button small title={t("cvMobile.confirm")} disabled={!name.trim()} onPress={rename} /><Button small variant="secondary" title={t("common.cancel")} onPress={() => setRenaming(null)} /></>}>
        <Input label={t("career.cv.title")} value={name} onChangeText={setName} maxLength={120} />
      </Dialog>
      {list.length === 0 ? (
        <EmptyState title={t("career.empty.cvs")} description={t("career.empty.cvsBody")} />
      ) : (
        list.map((c) => (
          <Card key={c.id}>
            <View style={{ flexDirection: "row", gap: 12 }}>
              <Image source={cvPreviewFor(c.template)} accessibilityIgnoresInvertColors style={{ width: thumb, aspectRatio: 400 / 566, borderRadius: 6 }} resizeMode="cover" />
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <AppText variant="heading" numberOfLines={2}>
                  {c.title}
                </AppText>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                  {c.isDefault ? <Badge tone="success">{t("cvMobile.defaultBadge")}</Badge> : null}
                  <Badge tone="info">{t(`career.lang.${c.language}`)}</Badge>
                  <Badge tone="neutral">{t(cvTemplateMeta(c.template).nameKey)}</Badge>
                </View>
                <AppText variant="caption" muted>
                  {t("cvMobile.modified", { date: date(c.updatedAt) })}
                </AppText>
              </View>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Button small style={{ flex: 1 }} title={t("cvMobile.editCv")} icon={<Icon name="pencil" size="sm" />} onPress={() => open(c.id)} />
              <PressableScale accessibilityRole="button" accessibilityLabel={`${t("cvMobile.exportPdf")}: ${c.title}`} disabled={busy === c.id} onPress={() => void exportPdf(c.id)} style={iconBtn}>
                {busy === c.id ? <ActivityIndicator color={theme.text} /> : <Icon name="download" size="sm" color={theme.text} />}
              </PressableScale>
              <PressableScale accessibilityRole="button" accessibilityLabel={`${t("cvMobile.more")}: ${c.title}`} onPress={() => setMenu(c)} style={iconBtn}>
                <Icon name="more-horizontal" size="sm" color={theme.text} />
              </PressableScale>
            </View>
          </Card>
        ))
      )}
    </View>
  );
}
