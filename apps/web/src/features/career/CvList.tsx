"use client";

import { CV_DEFAULT_TEMPLATE, CV_LANGUAGES, CV_MAX_DOCUMENTS, cvTemplateMeta, emptyCv, type CvLanguage, type CvTemplate } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { Badge, Button, Card, Dialog, EmptyState, ErrorState, Icon, Input, Skeleton, useToast } from "@unimate/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useUser } from "@/components/user";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useAsync } from "@/lib/use-async";
import { createCv, deleteCv, duplicateCv, listCvs, renameCv, setDefaultCv, type CvListItem } from "./api";
import { TemplateGallery } from "./TemplateGallery";

/** CV management: cards with thumbnail, last edit and default badge; create (gallery), rename, duplicate, delete, set default, PDF. */
export function CvList() {
  const { t, date, locale } = useI18n();
  const router = useRouter();
  const { toast } = useToast();
  const user = useUser();
  const cvs = useAsync(() => listCvs(getBrowserClient()), []);
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState(false);
  const [del, setDel] = useState<CvListItem | null>(null);
  const [ren, setRen] = useState<{ item: CvListItem; title: string } | null>(null);
  const lang: CvLanguage = (CV_LANGUAGES as readonly string[]).includes(locale) ? (locale as CvLanguage) : "az";
  const list = cvs.data ?? [];
  const full = list.length >= CV_MAX_DOCUMENTS;
  const fail = (e: "limit" | string) => toast(e === "limit" ? t("cvWeb.list.limitReached") : t("cvWeb.list.failed"), "error");

  const create = async (template: CvTemplate) => {
    setBusy(true);
    const r = await createCv(getBrowserClient(), user.id, { title: t("career.cv.untitled"), language: lang, template, data: emptyCv() });
    setBusy(false);
    if (r.ok) router.push(`/career/cv/${r.id}`);
    else fail(r.error);
  };
  const duplicate = async (c: CvListItem) => {
    const r = await duplicateCv(getBrowserClient(), user.id, c.id, t("cvWeb.list.copySuffix"));
    if (r.ok) {
      toast(t("career.cv.duplicated"), "success");
      cvs.reload();
    } else fail(r.error);
  };
  const makeDefault = async (c: CvListItem) => {
    try {
      await setDefaultCv(getBrowserClient(), c.id);
      toast(t("cvWeb.list.defaultSet"), "success");
      cvs.reload();
    } catch {
      fail("failed");
    }
  };
  const doRename = async () => {
    const r = ren;
    if (!r) return;
    if (await renameCv(getBrowserClient(), r.item.id, r.title)) {
      setRen(null);
      toast(t("cvWeb.list.renamed"), "success");
      cvs.reload();
    } else fail("failed");
  };
  const doDelete = async () => {
    const d = del;
    setDel(null);
    if (!d) return;
    try {
      await deleteCv(getBrowserClient(), d.id);
      toast(t("career.cv.deleted"), "success");
      cvs.reload();
    } catch {
      fail("failed");
    }
  };
  if (cvs.loading && !cvs.data) return <Skeleton height={100} />;
  if (cvs.error && !cvs.data) return <ErrorState title={t("career.loadFailed")} description={cvs.error} action={<Button onClick={cvs.reload}>{t("common.retry")}</Button>} />;
  return (
    <div className="stack-lg cv-touch">
      <div className="row">
        <Button loading={busy} disabled={full} onClick={() => setPicking(true)}>
          <Icon name="add" size="sm" />
          {t("career.cv.create")}
        </Button>
        {full ? <span className="um-muted">{t("career.cv.limit")}</span> : null}
      </div>
      {list.length === 0 ? (
        <EmptyState title={t("career.empty.cvs")} description={t("career.empty.cvsBody")} />
      ) : (
        <div className="cv-gal">
          {list.map((c) => (
            <Card key={c.id} className="doc-card">
              <div className="stack" style={{ gap: 8, minWidth: 0 }}>
                <Link href={`/career/cv/${c.id}`} aria-label={`${t("cvWeb.list.edit")}: ${c.title}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- static template thumbnail */}
                  <img src={`/cv-templates/${cvTemplateMeta(c.template).id}.png`} alt="" loading="lazy" style={{ width: "100%", aspectRatio: "400 / 566", objectFit: "cover", objectPosition: "top", borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", display: "block" }} />
                </Link>
                <div className="row" style={{ gap: 6 }}>
                  {c.isDefault ? <Badge tone="success">{t("cvWeb.list.default")}</Badge> : null}
                  <Badge tone="info">{t(`career.lang.${c.language}`)}</Badge>
                  <Badge>{t(cvTemplateMeta(c.template).nameKey)}</Badge>
                </div>
                <h3 style={{ overflowWrap: "anywhere" }}>
                  <Link href={`/career/cv/${c.id}`}>{c.title}</Link>
                </h3>
                <p className="um-muted" style={{ fontSize: "var(--text-xs)" }}>
                  {t("cvWeb.list.edited", { date: date(c.updatedAt) })}
                </p>
                <div className="row cv-card-actions" style={{ gap: 6 }} role="group" aria-label={t("cvWeb.list.actions", { title: c.title })}>
                  <Button size="sm" onClick={() => router.push(`/career/cv/${c.id}`)}>
                    {t("cvWeb.list.edit")}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setRen({ item: c, title: c.title })}>
                    {t("cvWeb.list.rename")}
                  </Button>
                  <Button size="sm" variant="secondary" disabled={full} onClick={() => void duplicate(c)}>
                    {t("cvWeb.list.duplicate")}
                  </Button>
                  {c.isDefault ? null : (
                    <Button size="sm" variant="secondary" onClick={() => void makeDefault(c)}>
                      {t("cvWeb.list.setDefault")}
                    </Button>
                  )}
                  <Button size="sm" variant="secondary" onClick={() => router.push(`/career/cv/${c.id}/print?autoprint=1`)}>
                    <Icon name="download" size="sm" />
                    {t("cvWeb.list.download")}
                  </Button>
                  <Button size="sm" variant="danger" aria-label={`${t("career.cv.delete")}: ${c.title}`} onClick={() => setDel(c)}>
                    {t("common.delete")}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      <Dialog open={picking} title={t("cvWeb.gallery.title")} onClose={() => setPicking(false)} actions={<Button variant="secondary" onClick={() => setPicking(false)}>{t("common.cancel")}</Button>}>
        <div className="cv-wide cv-touch">
          <TemplateGallery value={CV_DEFAULT_TEMPLATE} language={lang} busy={busy} onPick={(id) => void create(id)} />
        </div>
      </Dialog>
      <Dialog
        open={ren !== null}
        title={t("cvWeb.list.rename")}
        onClose={() => setRen(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setRen(null)}>
              {t("common.cancel")}
            </Button>
            <Button disabled={!ren?.title.trim()} onClick={() => void doRename()}>
              {t("common.save")}
            </Button>
          </>
        }
      >
        {ren ? <Input label={t("career.cv.title")} value={ren.title} maxLength={120} onChange={(e) => setRen({ ...ren, title: e.target.value })} /> : null}
      </Dialog>
      <Dialog
        open={del !== null}
        title={t("career.cv.delete")}
        onClose={() => setDel(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDel(null)}>
              {t("common.cancel")}
            </Button>
            <Button variant="danger" onClick={() => void doDelete()}>
              {t("common.delete")}
            </Button>
          </>
        }
      >
        <p>{del ? `${del.title}: ${t("career.cv.deleteConfirm")}` : ""}</p>
      </Dialog>
    </div>
  );
}
