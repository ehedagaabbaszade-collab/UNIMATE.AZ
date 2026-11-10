"use client";

import { NOTE_KINDS, NOTE_MIME_TYPES, NOTE_VISIBILITIES, courseLabel, precheckNoteFile, validateNoteForm, type NoteKind, type NoteVisibility } from "@unimate/core";
import type { MessageKey } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import { Button, Card, Input, Select, Textarea, useToast } from "@unimate/ui";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { useUser } from "@/components/user";
import { getBrowserClient } from "@/lib/supabase/browser";
import { useAsync } from "@/lib/use-async";
import { createNote, listCourses } from "./api";

export function UploadNote() {
  const { t } = useI18n();
  const router = useRouter();
  const { toast } = useToast();
  const user = useUser();
  const courses = useAsync(() => listCourses(getBrowserClient(), user.id), [user.id]);
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [courseId, setCourseId] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [kind, setKind] = useState<NoteKind>("note");
  const [visibility, setVisibility] = useState<NoteVisibility>("university");
  const [confirmed, setConfirmed] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function onPick(f: File | undefined) {
    setFileError(null);
    if (!f) return;
    setFile(f);
    if (!title.trim()) setTitle(f.name.replace(/\.[^.]+$/, "").slice(0, 200));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    const form = validateNoteForm({ title, description, kind, courseId, visibility, tagsText, hasFile: !!file });
    const next: Record<string, string> = {};
    if (!form.ok) for (const [k, code] of Object.entries(form.errors)) next[k] = t(`notes.upload.errors.${code}` as MessageKey);
    if (!confirmed) next.copyright = t("notes.upload.errors.copyright_required");
    setErrors(next);
    if (!form.ok || !confirmed || !file) return;

    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    const check = precheckNoteFile({ name: file.name, size: file.size, mimeType: file.type, head });
    if (!check.ok) {
      setFileError(t(`documents.upload_errors.${check.error}`));
      return;
    }
    setBusy(true);
    try {
      await createNote(getBrowserClient(), user.id, crypto.randomUUID(), { bytes: file, name: file.name, mimeType: check.mimeType, extension: check.extension, size: file.size }, form.value);
      toast(t("notes.upload.success"), "success");
      router.push("/notes");
    } catch {
      setSubmitError(t("notes.upload.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack-lg" onSubmit={(e) => void submit(e)} noValidate style={{ maxWidth: 640 }}>
      <div className="page-head">
        <h1>{t("notes.upload.title")}</h1>
        <p>{t("notes.upload.intro")}</p>
      </div>
      <Card>
        <input ref={fileRef} id="note-file" className="um-sr-only" type="file" accept={NOTE_MIME_TYPES.join(",")} disabled={busy} onChange={(e) => onPick(e.target.files?.[0])} />
        <p>{file ? file.name : t("notes.upload.noFile")}</p>
        <p className="um-muted" style={{ fontSize: "var(--text-sm)" }}>{t("notes.upload.fileHint")}</p>
        <div className="row">
          <Button type="button" variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
            {file ? t("notes.upload.changeFile") : t("notes.upload.pickFile")}
          </Button>
        </div>
        {fileError || errors.file ? <p className="err-box" role="alert">{fileError ?? errors.file}</p> : null}
      </Card>
      <Input label={t("notes.upload.titleLabel")} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} error={errors.title} />
      <Textarea label={t("notes.upload.descriptionLabel")} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} error={errors.description} />
      <Select label={t("notes.upload.courseLabel")} value={courseId} onChange={(e) => setCourseId(e.target.value)} hint={courses.data && courses.data.length === 0 ? t("notes.upload.courseEmpty") : undefined}>
        <option value="">{t("notes.upload.courseNone")}</option>
        {(courses.data ?? []).map((c) => (
          <option key={c.id} value={c.id}>
            {courseLabel(c)}
          </option>
        ))}
      </Select>
      <Select label={t("notes.upload.kindLabel")} value={kind} onChange={(e) => setKind(e.target.value as NoteKind)}>
        {NOTE_KINDS.map((k) => (
          <option key={k} value={k}>
            {t(`notes.kind.${k}`)}
          </option>
        ))}
      </Select>
      <Input label={t("notes.upload.tagsLabel")} hint={t("notes.upload.tagsHint")} value={tagsText} onChange={(e) => setTagsText(e.target.value)} error={errors.tags} />
      <Select label={t("notes.upload.visibilityLabel")} value={visibility} onChange={(e) => setVisibility(e.target.value as NoteVisibility)}>
        {NOTE_VISIBILITIES.map((v) => (
          <option key={v} value={v}>
            {t(`notes.upload.visibility.${v}`)}
          </option>
        ))}
      </Select>
      <label className="row" style={{ flexWrap: "nowrap", alignItems: "flex-start" }}>
        <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} aria-invalid={errors.copyright ? true : undefined} />
        <span>{t("notes.upload.copyright")}</span>
      </label>
      {errors.copyright ? <p className="err-box" role="alert">{errors.copyright}</p> : null}
      {submitError ? <p className="err-box" role="alert">{submitError}</p> : null}
      <div className="row">
        <Button type="submit" loading={busy}>
          {busy ? t("notes.upload.submitting") : t("notes.upload.submit")}
        </Button>
        <Link className="um-btn um-btn--ghost" href="/notes">
          {t("common.cancel")}
        </Link>
      </div>
    </form>
  );
}
