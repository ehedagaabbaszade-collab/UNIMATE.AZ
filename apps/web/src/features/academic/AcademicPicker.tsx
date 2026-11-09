"use client";

import { Select } from "@unimate/ui";
import { useAsync, unwrap } from "@/lib/use-async";
import { getBrowserClient } from "@/lib/supabase/browser";
import type { Faculty, Major, University } from "@/lib/db";
import { useT } from "@/i18n/provider";
import { groupInstitutions, institutionLabel } from "./institutions";

export interface AcademicValue {
  universityId: string;
  facultyId: string;
  majorId: string;
}

/** University -> faculty -> major cascade backed by the real tables. Empty tables render honest hints, never fake rows. */
export function AcademicPicker({
  value,
  onChange,
  errors,
  showMajor = true,
}: {
  value: AcademicValue;
  onChange: (v: AcademicValue) => void;
  errors?: Partial<Record<keyof AcademicValue, string>>;
  showMajor?: boolean;
}) {
  const t = useT();
  const unis = useAsync<University[]>(async () => unwrap(await getBrowserClient().from("universities").select("id,name,short_name,city,institution_type,affiliated_with").order("name")), []);
  const groups = groupInstitutions(unis.data ?? []);
  const faculties = useAsync<Faculty[]>(
    async () => unwrap(await getBrowserClient().from("faculties").select("id,university_id,name").eq("university_id", value.universityId).order("name")),
    [value.universityId],
    !!value.universityId,
  );
  const majors = useAsync<Major[]>(
    async () => unwrap(await getBrowserClient().from("majors").select("id,faculty_id,name,degree_level").eq("faculty_id", value.facultyId).order("name")),
    [value.facultyId],
    !!value.facultyId,
  );

  return (
    <div className="stack">
      <Select
        label={t("auth.university")}
        hint={unis.data && unis.data.length === 0 ? t("auth.noUniversities") : t("auth.universityHint")}
        value={value.universityId}
        error={errors?.universityId}
        disabled={unis.loading}
        onChange={(e) => onChange({ universityId: e.target.value, facultyId: "", majorId: "" })}
      >
        <option value="">{t("common.select")}</option>
        {groups.universities.length > 0 ? (
          <optgroup label={t("auth.universityGroup")}>
            {groups.universities.map((u) => (
              <option key={u.id} value={u.id}>
                {institutionLabel(u)}
              </option>
            ))}
          </optgroup>
        ) : null}
        {groups.colleges.length > 0 ? (
          <optgroup label={t("auth.collegeGroup")}>
            {groups.colleges.map((u) => (
              <option key={u.id} value={u.id}>
                {institutionLabel(u)}
              </option>
            ))}
          </optgroup>
        ) : null}
      </Select>
      {showMajor && value.universityId ? (
        <>
          <Select
            label={t("auth.faculty")}
            hint={faculties.data && faculties.data.length === 0 ? t("auth.noFaculties") : undefined}
            value={value.facultyId}
            disabled={faculties.loading || !faculties.data?.length}
            onChange={(e) => onChange({ ...value, facultyId: e.target.value, majorId: "" })}
          >
            <option value="">{t("common.select")}</option>
            {faculties.data?.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </Select>
          {value.facultyId ? (
            <Select
              label={t("auth.major")}
              hint={majors.data && majors.data.length === 0 ? t("auth.noMajors") : undefined}
              value={value.majorId}
              error={errors?.majorId}
              disabled={majors.loading || !majors.data?.length}
              onChange={(e) => onChange({ ...value, majorId: e.target.value })}
            >
              <option value="">{t("common.select")}</option>
              {majors.data?.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
