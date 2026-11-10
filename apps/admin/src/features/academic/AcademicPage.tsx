"use client";

import { Badge, Button, Input, Select } from "@unimate/ui";
import { useI18n } from "@unimate/i18n/react";
import type { MessageKey } from "@unimate/i18n";
import { useState } from "react";
import { Async, DataTable, PageHead, Pager, ReasonDialog, SearchBox, TabPanel, TabsNav, useActionToast, useAdminApi, type Column } from "../../components/kit";
import type { AdminApi, CourseRow, FacultyRow, InstitutionRow, MajorRow } from "../../lib/rpc";
import { courseSchema, facultySchema, fieldErrors, formObject, institutionSchema, majorSchema } from "../../lib/schemas";
import { useAsync } from "../../lib/use-async";

type Tab = "institutions" | "faculties" | "majors" | "courses";
type Kind = "university" | "faculty" | "major" | "course";

const SOURCE_KEY = { "edu.gov.az": "official", wikipedia: "wikipedia", user_supplied_unverified: "unverified", admin_verified: "verified" } as const;

export function AcademicPage() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("institutions");
  const items = [
    { id: "institutions", label: t("admin.academic.institutions") },
    { id: "faculties", label: t("admin.academic.faculties") },
    { id: "majors", label: t("admin.academic.majors") },
    { id: "courses", label: t("admin.academic.courses") },
  ] as const;
  return (
    <>
      <PageHead title={t("admin.academic.title")} />
      <TabsNav label={t("admin.academic.tabs")} items={items} active={tab} onChange={setTab} />
      <TabPanel id={tab}>
        {tab === "institutions" ? <Institutions /> : null}
        {tab === "faculties" ? <Faculties /> : null}
        {tab === "majors" ? <Majors /> : null}
        {tab === "courses" ? <Courses /> : null}
      </TabPanel>
    </>
  );
}

/** Institution picker shared by the faculty / major / course panels. */
function InstitutionSelect({ api, value, onChange, label }: { api: AdminApi; value: string; onChange: (v: string) => void; label: string }) {
  const { t } = useI18n();
  const options = useAsync(() => api.institutionOptions(), []);
  return (
    <Select label={label} value={value} onChange={(e) => onChange(e.target.value)} disabled={options.loading}>
      <option value="">{t("admin.common.selectPlaceholder")}</option>
      {(options.data ?? []).map((o) => (
        <option key={o.id} value={o.id}>
          {o.name}
        </option>
      ))}
    </Select>
  );
}

function DeleteDialog({ api, target, onClose, onDone }: { api: AdminApi; target: { kind: Kind; id: string } | null; onClose: () => void; onDone: () => void }) {
  const { t } = useI18n();
  const toast = useActionToast();
  return (
    <ReasonDialog
      open={target !== null}
      title={t("admin.academic.deleteTitle")}
      body={t("admin.academic.deleteBody")}
      confirmLabel={t("admin.common.delete")}
      danger
      onClose={onClose}
      onConfirm={async (reason) => {
        if (!target) return;
        await api.deleteAcademic(target.kind, target.id, reason);
        toast.ok();
        onDone();
      }}
    />
  );
}

// ------------------------------------------------------------------ institutions
function Institutions() {
  const { t } = useI18n();
  const api = useAdminApi();
  const toast = useActionToast();
  const [search, setSearch] = useState("");
  const [unverified, setUnverified] = useState(false);
  const [page, setPage] = useState(0);
  const [edit, setEdit] = useState<InstitutionRow | "new" | null>(null);
  const [verify, setVerify] = useState<InstitutionRow | null>(null);
  const [del, setDel] = useState<{ kind: Kind; id: string } | null>(null);
  const state = useAsync(() => api.institutions(search, unverified, page), [search, unverified, page]);
  const pending = useAsync(() => api.institutions("", true, 0), []);
  const [errors, setErrors] = useState<Record<string, MessageKey>>({});

  const columns: Column<InstitutionRow>[] = [
    { key: "name", header: t("admin.common.name"), cell: (r) => <strong>{r.name}</strong> },
    { key: "type", header: t("admin.academic.colType"), cell: (r) => t(`admin.academic.type.${r.institution_type}`) },
    { key: "own", header: t("admin.academic.colOwnership"), cell: (r) => t(`admin.academic.ownership.${r.ownership}`) },
    { key: "city", header: t("admin.academic.colCity"), cell: (r) => r.city ?? t("admin.common.none") },
    { key: "src", header: t("admin.academic.colSource"), cell: (r) => <Badge tone={r.source === "user_supplied_unverified" ? "warning" : "success"}>{t(`admin.academic.source.${SOURCE_KEY[r.source]}`)}</Badge> },
    {
      key: "act",
      header: t("admin.common.actions"),
      cell: (r) => (
        <span className="row">
          {r.source === "user_supplied_unverified" ? (
            <Button size="sm" variant="secondary" onClick={() => setVerify(r)}>
              {t("admin.academic.verify")}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => { setErrors({}); setEdit(r); }}>
            {t("admin.common.edit")}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDel({ kind: "university", id: r.id })}>
            {t("admin.common.delete")}
          </Button>
        </span>
      ),
    },
  ];
  const editing = edit && edit !== "new" ? edit : null;
  const reload = () => {
    state.reload();
    pending.reload();
  };

  return (
    <>
      {pending.data && pending.data.total > 0 ? <p className="warn-box" style={{ marginBottom: "var(--space-4)" }}>{t("admin.academic.unverifiedBanner", { n: pending.data.total })}</p> : null}
      <div className="row row--between">
        <SearchBox label={t("admin.common.search")} value={search} onSearch={(v) => { setSearch(v); setPage(0); }} />
        <div className="row">
          <label className="row">
            <input type="checkbox" checked={unverified} onChange={(e) => { setUnverified(e.target.checked); setPage(0); }} />
            <span>{t("admin.academic.unverifiedOnly")}</span>
          </label>
          <Button onClick={() => { setErrors({}); setEdit("new"); }}>{t("admin.academic.newInstitution")}</Button>
        </div>
      </div>
      <Async state={state} isEmpty={(d) => d.rows.length === 0}>
        {(d) => (
          <>
            <DataTable caption={t("admin.academic.institutions")} columns={columns} rows={d.rows} rowKey={(r) => r.id} />
            <Pager page={page} total={d.total} onPage={setPage} />
          </>
        )}
      </Async>
      <ReasonDialog
        open={edit !== null}
        title={editing ? t("admin.academic.editInstitution") : t("admin.academic.newInstitution")}
        confirmLabel={t("admin.common.save")}
        onClose={() => setEdit(null)}
        validate={(fd) => {
          const r = institutionSchema.safeParse({ ...formObject(fd), reason: "valid" });
          const e = r.success ? {} : fieldErrors(r.error);
          setErrors(e);
          return r.success ? null : e;
        }}
        onConfirm={async (reason, fd) => {
          const v = institutionSchema.parse({ ...formObject(fd), reason });
          await api.upsertInstitution({ id: editing?.id ?? null, name: v.name, shortName: v.shortName, city: v.city, type: v.type, ownership: v.ownership, affiliated: v.affiliated, reason: v.reason });
          toast.ok();
          reload();
        }}
      >
        <Input name="name" label={t("admin.common.name")} defaultValue={editing?.name ?? ""} error={errors.name && t(errors.name)} />
        <Input name="shortName" label={t("admin.academic.shortName")} defaultValue={editing?.short_name ?? ""} error={errors.shortName && t(errors.shortName)} />
        <Input name="city" label={t("admin.academic.city")} defaultValue={editing?.city ?? ""} error={errors.city && t(errors.city)} />
        <Select name="type" label={t("admin.academic.colType")} defaultValue={editing?.institution_type ?? "university"}>
          <option value="university">{t("admin.academic.type.university")}</option>
          <option value="college">{t("admin.academic.type.college")}</option>
        </Select>
        <Select name="ownership" label={t("admin.academic.colOwnership")} defaultValue={editing?.ownership ?? "state"}>
          <option value="state">{t("admin.academic.ownership.state")}</option>
          <option value="private">{t("admin.academic.ownership.private")}</option>
        </Select>
        <Input name="affiliated" label={t("admin.academic.affiliated")} defaultValue={editing?.affiliated_with ?? ""} error={errors.affiliated && t(errors.affiliated)} />
      </ReasonDialog>
      <ReasonDialog
        open={verify !== null}
        title={t("admin.academic.verifyTitle")}
        body={verify ? `${verify.name}. ${t("admin.academic.verifyBody")}` : undefined}
        confirmLabel={t("admin.academic.verify")}
        onClose={() => setVerify(null)}
        onConfirm={async (reason) => {
          if (!verify) return;
          await api.verifyInstitution(verify.id, reason);
          toast.ok();
          reload();
        }}
      />
      <DeleteDialog api={api} target={del} onClose={() => setDel(null)} onDone={reload} />
    </>
  );
}

// ------------------------------------------------------------------ faculties
function Faculties() {
  const { t } = useI18n();
  const api = useAdminApi();
  const toast = useActionToast();
  const [uni, setUni] = useState("");
  const [page, setPage] = useState(0);
  const [edit, setEdit] = useState<FacultyRow | "new" | null>(null);
  const [del, setDel] = useState<{ kind: Kind; id: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, MessageKey>>({});
  const state = useAsync(() => api.faculties(uni, page), [uni, page], uni !== "");
  const editing = edit && edit !== "new" ? edit : null;
  const columns: Column<FacultyRow>[] = [
    { key: "name", header: t("admin.academic.colFaculty"), cell: (r) => <strong>{r.name}</strong> },
    {
      key: "act",
      header: t("admin.common.actions"),
      cell: (r) => (
        <span className="row">
          <Button size="sm" variant="ghost" onClick={() => { setErrors({}); setEdit(r); }}>{t("admin.common.edit")}</Button>
          <Button size="sm" variant="ghost" onClick={() => setDel({ kind: "faculty", id: r.id })}>{t("admin.common.delete")}</Button>
        </span>
      ),
    },
  ];
  return (
    <>
      <div className="row row--between" style={{ alignItems: "flex-end", marginBottom: "var(--space-4)" }}>
        <InstitutionSelect api={api} value={uni} onChange={(v) => { setUni(v); setPage(0); }} label={t("admin.academic.pickInstitution")} />
        <Button disabled={!uni} onClick={() => { setErrors({}); setEdit("new"); }}>{t("admin.academic.newFaculty")}</Button>
      </div>
      {!uni ? <p className="um-muted">{t("admin.academic.needInstitution")}</p> : (
        <Async state={state} isEmpty={(d) => d.rows.length === 0}>
          {(d) => (
            <>
              <DataTable caption={t("admin.academic.faculties")} columns={columns} rows={d.rows} rowKey={(r) => r.id} />
              <Pager page={page} total={d.total} onPage={setPage} />
            </>
          )}
        </Async>
      )}
      <ReasonDialog
        open={edit !== null}
        title={editing ? t("admin.academic.editFaculty") : t("admin.academic.newFaculty")}
        confirmLabel={t("admin.common.save")}
        onClose={() => setEdit(null)}
        validate={(fd) => {
          const r = facultySchema.safeParse({ universityId: uni, name: fd.get("name"), reason: "valid" });
          const e = r.success ? {} : fieldErrors(r.error);
          setErrors(e);
          return r.success ? null : e;
        }}
        onConfirm={async (reason, fd) => {
          const v = facultySchema.parse({ universityId: uni, name: fd.get("name"), reason });
          await api.upsertFaculty({ id: editing?.id ?? null, universityId: v.universityId, name: v.name, reason: v.reason });
          toast.ok();
          state.reload();
        }}
      >
        <Input name="name" label={t("admin.academic.colFaculty")} defaultValue={editing?.name ?? ""} error={errors.name && t(errors.name)} />
      </ReasonDialog>
      <DeleteDialog api={api} target={del} onClose={() => setDel(null)} onDone={state.reload} />
    </>
  );
}

// ------------------------------------------------------------------ majors
function Majors() {
  const { t } = useI18n();
  const api = useAdminApi();
  const toast = useActionToast();
  const [uni, setUni] = useState("");
  const [fac, setFac] = useState("");
  const [page, setPage] = useState(0);
  const [edit, setEdit] = useState<MajorRow | "new" | null>(null);
  const [del, setDel] = useState<{ kind: Kind; id: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, MessageKey>>({});
  const faculties = useAsync(() => api.facultyOptions(uni), [uni], uni !== "");
  const state = useAsync(() => api.majors(fac, page), [fac, page], fac !== "");
  const editing = edit && edit !== "new" ? edit : null;
  const columns: Column<MajorRow>[] = [
    { key: "name", header: t("admin.academic.colMajor"), cell: (r) => <strong>{r.name}</strong> },
    { key: "deg", header: t("admin.academic.colDegree"), cell: (r) => t(`admin.academic.degree.${r.degree_level}`) },
    {
      key: "act",
      header: t("admin.common.actions"),
      cell: (r) => (
        <span className="row">
          <Button size="sm" variant="ghost" onClick={() => { setErrors({}); setEdit(r); }}>{t("admin.common.edit")}</Button>
          <Button size="sm" variant="ghost" onClick={() => setDel({ kind: "major", id: r.id })}>{t("admin.common.delete")}</Button>
        </span>
      ),
    },
  ];
  return (
    <>
      <div className="row" style={{ alignItems: "flex-end", marginBottom: "var(--space-4)" }}>
        <InstitutionSelect api={api} value={uni} onChange={(v) => { setUni(v); setFac(""); setPage(0); }} label={t("admin.academic.pickInstitution")} />
        <Select label={t("admin.academic.pickFaculty")} value={fac} onChange={(e) => { setFac(e.target.value); setPage(0); }} disabled={!uni}>
          <option value="">{t("admin.common.selectPlaceholder")}</option>
          {(faculties.data ?? []).map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </Select>
        <Button disabled={!fac} onClick={() => { setErrors({}); setEdit("new"); }}>{t("admin.academic.newMajor")}</Button>
      </div>
      {!fac ? <p className="um-muted">{t("admin.academic.needFaculty")}</p> : (
        <Async state={state} isEmpty={(d) => d.rows.length === 0}>
          {(d) => (
            <>
              <DataTable caption={t("admin.academic.majors")} columns={columns} rows={d.rows} rowKey={(r) => r.id} />
              <Pager page={page} total={d.total} onPage={setPage} />
            </>
          )}
        </Async>
      )}
      <ReasonDialog
        open={edit !== null}
        title={editing ? t("admin.academic.editMajor") : t("admin.academic.newMajor")}
        confirmLabel={t("admin.common.save")}
        onClose={() => setEdit(null)}
        validate={(fd) => {
          const r = majorSchema.safeParse({ facultyId: fac, name: fd.get("name"), degree: fd.get("degree"), reason: "valid" });
          const e = r.success ? {} : fieldErrors(r.error);
          setErrors(e);
          return r.success ? null : e;
        }}
        onConfirm={async (reason, fd) => {
          const v = majorSchema.parse({ facultyId: fac, name: fd.get("name"), degree: fd.get("degree"), reason });
          await api.upsertMajor({ id: editing?.id ?? null, facultyId: v.facultyId, name: v.name, degree: v.degree, reason: v.reason });
          toast.ok();
          state.reload();
        }}
      >
        <Input name="name" label={t("admin.academic.colMajor")} defaultValue={editing?.name ?? ""} error={errors.name && t(errors.name)} />
        <Select name="degree" label={t("admin.academic.degreeLevel")} defaultValue={editing?.degree_level ?? "bachelor"}>
          <option value="bachelor">{t("admin.academic.degree.bachelor")}</option>
          <option value="master">{t("admin.academic.degree.master")}</option>
          <option value="phd">{t("admin.academic.degree.phd")}</option>
        </Select>
      </ReasonDialog>
      <DeleteDialog api={api} target={del} onClose={() => setDel(null)} onDone={state.reload} />
    </>
  );
}

// ------------------------------------------------------------------ courses
function Courses() {
  const { t, number } = useI18n();
  const api = useAdminApi();
  const toast = useActionToast();
  const [uni, setUni] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [edit, setEdit] = useState<CourseRow | "new" | null>(null);
  const [del, setDel] = useState<{ kind: Kind; id: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, MessageKey>>({});
  const majors = useAsync(() => api.majorOptions(uni), [uni], uni !== "");
  const state = useAsync(() => api.courses(uni, search, page), [uni, search, page], uni !== "");
  const editing = edit && edit !== "new" ? edit : null;
  const columns: Column<CourseRow>[] = [
    { key: "code", header: t("admin.academic.colCode"), cell: (r) => <code>{r.code}</code> },
    { key: "title", header: t("admin.academic.colTitle"), cell: (r) => <strong>{r.title}</strong> },
    { key: "cr", header: t("admin.academic.colCredits"), cell: (r) => (r.credits === null ? t("admin.common.none") : number(r.credits)) },
    {
      key: "act",
      header: t("admin.common.actions"),
      cell: (r) => (
        <span className="row">
          <Button size="sm" variant="ghost" onClick={() => { setErrors({}); setEdit(r); }}>{t("admin.common.edit")}</Button>
          <Button size="sm" variant="ghost" onClick={() => setDel({ kind: "course", id: r.id })}>{t("admin.common.delete")}</Button>
        </span>
      ),
    },
  ];
  const parse = (fd: FormData, reason: string) => courseSchema.safeParse({ universityId: uni, majorId: fd.get("majorId"), code: fd.get("code"), title: fd.get("title"), credits: fd.get("credits"), reason });
  return (
    <>
      <div className="row row--between" style={{ alignItems: "flex-end", marginBottom: "var(--space-4)" }}>
        <InstitutionSelect api={api} value={uni} onChange={(v) => { setUni(v); setPage(0); }} label={t("admin.academic.pickInstitution")} />
        <Button disabled={!uni} onClick={() => { setErrors({}); setEdit("new"); }}>{t("admin.academic.newCourse")}</Button>
      </div>
      {uni ? <SearchBox label={t("admin.common.search")} value={search} onSearch={(v) => { setSearch(v); setPage(0); }} /> : null}
      {!uni ? <p className="um-muted">{t("admin.academic.needInstitution")}</p> : (
        <Async state={state} isEmpty={(d) => d.rows.length === 0}>
          {(d) => (
            <>
              <DataTable caption={t("admin.academic.courses")} columns={columns} rows={d.rows} rowKey={(r) => r.id} />
              <Pager page={page} total={d.total} onPage={setPage} />
            </>
          )}
        </Async>
      )}
      <ReasonDialog
        open={edit !== null}
        title={editing ? t("admin.academic.editCourse") : t("admin.academic.newCourse")}
        confirmLabel={t("admin.common.save")}
        onClose={() => setEdit(null)}
        validate={(fd) => {
          const r = parse(fd, "valid");
          const e = r.success ? {} : fieldErrors(r.error);
          setErrors(e);
          return r.success ? null : e;
        }}
        onConfirm={async (reason, fd) => {
          const v = courseSchema.parse({ universityId: uni, majorId: fd.get("majorId"), code: fd.get("code"), title: fd.get("title"), credits: fd.get("credits"), reason });
          await api.upsertCourse({ id: editing?.id ?? null, universityId: v.universityId, majorId: v.majorId, code: v.code, title: v.title, credits: v.credits, reason: v.reason });
          toast.ok();
          state.reload();
        }}
      >
        <Input name="code" label={t("admin.academic.code")} defaultValue={editing?.code ?? ""} error={errors.code && t(errors.code)} />
        <Input name="title" label={t("admin.academic.courseTitle")} defaultValue={editing?.title ?? ""} error={errors.title && t(errors.title)} />
        <Input name="credits" inputMode="decimal" label={t("admin.academic.credits")} defaultValue={editing?.credits ?? ""} error={errors.credits && t(errors.credits)} />
        <Select name="majorId" label={t("admin.academic.pickMajor")} defaultValue={editing?.major_id ?? ""}>
          <option value="">{t("admin.common.none")}</option>
          {(majors.data ?? []).map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </Select>
      </ReasonDialog>
      <DeleteDialog api={api} target={del} onClose={() => setDel(null)} onDone={state.reload} />
    </>
  );
}
