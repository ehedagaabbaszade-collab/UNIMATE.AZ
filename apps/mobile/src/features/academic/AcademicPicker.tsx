import { useT } from "@unimate/i18n/react";
import { useEffect, useMemo } from "react";
import { View } from "react-native";
import { PickerField, type PickerSection } from "../../components/PickerField";
import type { Faculty, Major, University } from "../../lib/db";
import { groupInstitutions, institutionLabel } from "../../lib/institutions";
import { unwrap, useAsync } from "../../lib/use-async";
import { useSession } from "../../state/session";

export interface AcademicValue {
  universityId: string;
  facultyId: string;
  majorId: string;
}

const toOption = (u: University) => ({ id: u.id, label: institutionLabel(u), searchText: `${u.short_name ?? ""} ${u.city ?? ""} ${u.name}` });

/** University -> faculty -> major cascade backed by the real tables. Empty tables show honest hints, never fake rows. */
export function AcademicPicker({ value, onChange, showMajor = true, errors }: { value: AcademicValue; onChange: (v: AcademicValue) => void; showMajor?: boolean; errors?: Partial<Record<keyof AcademicValue, string>> }) {
  const t = useT();
  const { supabase: sb } = useSession();
  const unis = useAsync<University[]>(async () => unwrap(await sb!.from("universities").select("id,name,short_name,city,institution_type,affiliated_with").order("name")), [], !!sb);
  const faculties = useAsync<Faculty[]>(async () => unwrap(await sb!.from("faculties").select("id,university_id,name").eq("university_id", value.universityId).order("name")), [value.universityId], !!sb && !!value.universityId);
  const majors = useAsync<Major[]>(async () => unwrap(await sb!.from("majors").select("id,faculty_id,name,degree_level").eq("faculty_id", value.facultyId).order("name")), [value.facultyId], !!sb && !!value.facultyId);

  // Colleges have a single faculty ("Orta ixtisas təhsili"): select it automatically and hide the redundant step.
  const onlyFaculty = faculties.data?.length === 1 ? faculties.data[0]!.id : null;
  useEffect(() => {
    if (onlyFaculty && value.facultyId !== onlyFaculty) onChange({ ...value, facultyId: onlyFaculty, majorId: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onlyFaculty]);

  const sections = useMemo<PickerSection[]>(() => {
    const g = groupInstitutions(unis.data ?? []);
    return [
      { title: t("auth.universityGroup"), data: g.universities.map(toOption) },
      { title: t("auth.collegeGroup"), data: g.colleges.map(toOption) },
    ];
  }, [unis.data, t]);

  return (
    <View style={{ gap: 12 }}>
      <PickerField
        label={t("auth.university")}
        sections={sections}
        value={value.universityId}
        loading={unis.loading}
        searchable
        error={errors?.universityId}
        hint={unis.data && unis.data.length === 0 ? t("auth.noUniversities") : t("auth.universityHint")}
        onChange={(id) => onChange({ universityId: id, facultyId: "", majorId: "" })}
      />
      {showMajor && value.universityId && !onlyFaculty ? (
        <PickerField
          label={t("auth.faculty")}
          sections={[{ data: (faculties.data ?? []).map((f) => ({ id: f.id, label: f.name })) }]}
          value={value.facultyId}
          loading={faculties.loading}
          disabled={!faculties.data?.length}
          hint={faculties.data && faculties.data.length === 0 ? t("auth.noFaculties") : undefined}
          onChange={(id) => onChange({ ...value, facultyId: id, majorId: "" })}
        />
      ) : null}
      {showMajor && value.facultyId ? (
        <PickerField
          label={t("auth.major")}
          sections={[{ data: (majors.data ?? []).map((m) => ({ id: m.id, label: m.name })) }]}
          value={value.majorId}
          loading={majors.loading}
          disabled={!majors.data?.length}
          error={errors?.majorId}
          hint={majors.data && majors.data.length === 0 ? t("auth.noMajors") : undefined}
          onChange={(id) => onChange({ ...value, majorId: id })}
        />
      ) : null}
    </View>
  );
}
