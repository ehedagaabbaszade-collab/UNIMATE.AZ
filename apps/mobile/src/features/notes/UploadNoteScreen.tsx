import { NOTE_KINDS, NOTE_MIME_TYPES, NOTE_VISIBILITIES, courseLabel, precheckNoteFile, validateNoteForm, type NoteKind, type NoteVisibility } from "@unimate/core";
import type { MessageKey } from "@unimate/i18n";
import { useI18n } from "@unimate/i18n/react";
import * as Crypto from "expo-crypto";
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { useRouter } from "expo-router";
import { useState } from "react";
import { Switch, View } from "react-native";
import { PickerField } from "../../components/PickerField";
import { AppText, Button, Card, Input, Notice, Screen, ScreenHeader, Segmented, useToast } from "../../components/ui";
import { useAsync } from "../../lib/use-async";
import { useUser } from "../../state/session";
import { useTheme } from "../../theme/ThemeProvider";
import { createNote, listCourses } from "./api";

interface Picked {
  uri: string;
  name: string;
  mimeType: string;
}

export function UploadNoteScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const { toast } = useToast();
  const { theme } = useTheme();
  const { user, supabase: sb } = useUser();
  const courses = useAsync(() => listCourses(sb, user.id), [sb, user.id]);
  const [file, setFile] = useState<Picked | null>(null);
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

  async function pick() {
    setFileError(null);
    const res = await DocumentPicker.getDocumentAsync({ type: NOTE_MIME_TYPES, copyToCacheDirectory: true, multiple: false }).catch(() => null);
    const a = res && !res.canceled ? res.assets[0] : null;
    if (!a) return;
    setFile({ uri: a.uri, name: a.name, mimeType: a.mimeType ?? "" });
    if (!title.trim()) setTitle(a.name.replace(/\.[^.]+$/, "").slice(0, 200));
  }

  async function submit() {
    setSubmitError(null);
    const form = validateNoteForm({ title, description, kind, courseId, visibility, tagsText, hasFile: !!file });
    const next: Record<string, string> = {};
    if (!form.ok) for (const [k, code] of Object.entries(form.errors)) next[k] = t(`notes.upload.errors.${code}` as MessageKey);
    if (!confirmed) next.copyright = t("notes.upload.errors.copyright_required");
    setErrors(next);
    if (!form.ok || !confirmed || !file) return;

    setBusy(true);
    try {
      const bytes = await new File(file.uri).arrayBuffer();
      const check = precheckNoteFile({ name: file.name, size: bytes.byteLength, mimeType: file.mimeType, head: new Uint8Array(bytes, 0, Math.min(16, bytes.byteLength)) });
      if (!check.ok) {
        setFileError(t(`documents.upload_errors.${check.error}`));
        return;
      }
      await createNote(sb, user.id, Crypto.randomUUID(), { bytes, name: file.name, mimeType: check.mimeType, extension: check.extension, size: bytes.byteLength }, form.value);
      toast(t("notes.upload.success"), "success");
      router.back();
    } catch {
      setSubmitError(t("notes.upload.failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <ScreenHeader title={t("notes.upload.title")} onBack={() => router.back()} />
      <AppText muted>{t("notes.upload.intro")}</AppText>
      <Card>
        <AppText variant="label">{file ? file.name : t("notes.upload.noFile")}</AppText>
        <AppText variant="caption" muted>
          {t("notes.upload.fileHint")}
        </AppText>
        <Button title={file ? t("notes.upload.changeFile") : t("notes.upload.pickFile")} variant="secondary" onPress={() => void pick()} disabled={busy} />
        {errors.file || fileError ? <Notice text={fileError ?? errors.file ?? ""} /> : null}
      </Card>
      <Input label={t("notes.upload.titleLabel")} value={title} onChangeText={setTitle} maxLength={200} error={errors.title} />
      <Input label={t("notes.upload.descriptionLabel")} value={description} onChangeText={setDescription} multiline maxLength={2000} error={errors.description} />
      <PickerField
        label={t("notes.upload.courseLabel")}
        sections={[{ data: [{ id: "", label: t("notes.upload.courseNone") }, ...(courses.data ?? []).map((c) => ({ id: c.id, label: courseLabel(c) }))] }]}
        value={courseId}
        searchable
        loading={courses.loading}
        onChange={setCourseId}
        hint={courses.data && courses.data.length === 0 ? t("notes.upload.courseEmpty") : undefined}
      />
      <Segmented label={t("notes.upload.kindLabel")} value={kind} onChange={setKind} options={NOTE_KINDS.map((k) => ({ value: k, label: t(`notes.kind.${k}`) }))} />
      <Input label={t("notes.upload.tagsLabel")} hint={t("notes.upload.tagsHint")} value={tagsText} onChangeText={setTagsText} autoCapitalize="none" error={errors.tags} />
      <Segmented label={t("notes.upload.visibilityLabel")} value={visibility} onChange={setVisibility} options={NOTE_VISIBILITIES.map((v) => ({ value: v, label: t(`notes.upload.visibility.${v}`) }))} />
      <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
        <Switch value={confirmed} onValueChange={setConfirmed} accessibilityLabel={t("notes.upload.copyright")} trackColor={{ true: theme.primary, false: theme.border }} />
        <AppText style={{ flex: 1 }}>{t("notes.upload.copyright")}</AppText>
      </View>
      {errors.copyright ? <Notice text={errors.copyright} /> : null}
      {submitError ? <Notice text={submitError} /> : null}
      <Button title={busy ? t("notes.upload.submitting") : t("notes.upload.submit")} loading={busy} onPress={() => void submit()} />
    </Screen>
  );
}
