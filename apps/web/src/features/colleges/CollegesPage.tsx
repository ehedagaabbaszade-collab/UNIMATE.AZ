"use client";

import { useI18n } from "@unimate/i18n/react";
import { Badge, Card, EmptyState, ErrorState, Input, Select, Skeleton, Tabs } from "@unimate/ui";
import Link from "next/link";
import { useDeferredValue, useMemo, useState } from "react";
import { getBrowserClient } from "@/lib/supabase/browser";
import { unwrap, useAsync } from "@/lib/use-async";
import { NO_FILTERS, collegeLabel, filterPrograms, summarizeColleges, type CatalogFilters, type CollegeRow, type ProgramRow } from "./college-catalog";

const PROGRAM_COLS = "id,college_id,code,specialty,division,language,study_format,seats,tuition_azn,state_funded,special_ability,source_page,needs_verification";

/** Loads the whole catalog once (55 colleges, 783 programs): search and filters then run locally. */
function useCatalog() {
  const state = useAsync(async () => {
    const sb = getBrowserClient();
    const [c, p] = await Promise.all([sb.from("admission_colleges").select("id,heading,parent_institution,college_name").limit(1000), sb.from("college_programs").select(PROGRAM_COLS).limit(2000)]);
    return { colleges: unwrap(c) as CollegeRow[], programs: unwrap(p) as ProgramRow[] };
  }, []);
  const byId = useMemo(() => new Map((state.data?.colleges ?? []).map((c) => [c.id, c])), [state.data]);
  return { ...state, byId };
}

function Filters({ value, onChange }: { value: CatalogFilters; onChange: (f: CatalogFilters) => void }) {
  const { t } = useI18n();
  return (
    <div className="form-grid">
      <div className="span-all">
        <Input label={t("colleges.search")} value={value.query} onChange={(e) => onChange({ ...value, query: e.target.value })} autoComplete="off" type="search" />
      </div>
      <Select label={t("colleges.language")} value={value.language} onChange={(e) => onChange({ ...value, language: e.target.value as CatalogFilters["language"] })}>
        <option value="all">{t("colleges.langAll")}</option>
        <option value="az">{t("colleges.langAz")}</option>
        <option value="ru">{t("colleges.langRu")}</option>
        <option value="az_ru">{t("colleges.langAzRu")}</option>
      </Select>
      <Select label={t("colleges.format")} value={value.format} onChange={(e) => onChange({ ...value, format: e.target.value as CatalogFilters["format"] })}>
        <option value="all">{t("colleges.formatAll")}</option>
        <option value="full_time">{t("colleges.formatFull")}</option>
        <option value="part_time">{t("colleges.formatPart")}</option>
      </Select>
      <Select label={t("colleges.funding")} value={value.funding} onChange={(e) => onChange({ ...value, funding: e.target.value as CatalogFilters["funding"] })}>
        <option value="all">{t("colleges.fundAll")}</option>
        <option value="state">{t("colleges.fundState")}</option>
        <option value="paid">{t("colleges.fundPaid")}</option>
      </Select>
    </div>
  );
}

function ProgramItem({ p, college }: { p: ProgramRow; college: CollegeRow | undefined }) {
  const { t, number } = useI18n();
  return (
    <Card>
      <div className="stack">
        <h3>
          <Link href={`/colleges/program/${p.id}`}>{p.specialty}</Link>
        </h3>
        {college ? <small className="um-hint">{collegeLabel(college)}</small> : null}
        <div className="row">
          <Badge>{p.code}</Badge>
          <Badge tone={p.state_funded ? "success" : "warning"}>{p.state_funded ? t("colleges.stateFunded") : t("colleges.fee", { n: number(p.tuition_azn ?? 0) })}</Badge>
          <Badge tone="primary">{t("colleges.seats", { n: p.seats })}</Badge>
          <Badge tone="info">{t(p.study_format === "full_time" ? "colleges.formatFull" : "colleges.formatPart")}</Badge>
          {p.special_ability ? <Badge tone="danger">*</Badge> : null}
        </div>
      </div>
    </Card>
  );
}

function Loading() {
  return (
    <div className="stack">
      <Skeleton height={72} />
      <Skeleton height={72} />
      <Skeleton height={72} />
    </div>
  );
}

export function CollegesPage() {
  const { t, number } = useI18n();
  const cat = useCatalog();
  const [view, setView] = useState<"colleges" | "specialties">("colleges");
  const [filters, setFilters] = useState<CatalogFilters>(NO_FILTERS);
  const deferred = useDeferredValue(filters);
  const programs = useMemo(() => (cat.data ? filterPrograms(cat.data.programs, cat.byId, deferred) : []), [cat.data, cat.byId, deferred]);
  const colleges = useMemo(() => (cat.data ? summarizeColleges(cat.data.colleges, programs) : []), [cat.data, programs]);

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>{t("colleges.title")}</h1>
        <p>{t("colleges.subtitle")}</p>
      </div>
      {cat.error ? (
        <ErrorState title={t("colleges.loadFailed")} />
      ) : cat.loading && !cat.data ? (
        <Loading />
      ) : (
        <>
          <Tabs
            label={t("colleges.title")}
            onChange={(id) => setView(id as typeof view)}
            items={[
              { id: "colleges", label: t("colleges.viewColleges"), content: null },
              { id: "specialties", label: t("colleges.viewSpecialties"), content: null },
            ]}
          />
          <Filters value={filters} onChange={setFilters} />
          <p className="um-hint" aria-live="polite">
            {t("colleges.results", { n: number(view === "colleges" ? colleges.length : programs.length) })}
          </p>
          {view === "colleges" ? (
            colleges.length === 0 ? (
              <EmptyState title={t("colleges.noResults")} />
            ) : (
              colleges.map((c) => (
                <Card key={c.id}>
                  <div className="stack">
                    <h3>
                      <Link href={`/colleges/${c.id}`}>{c.college_name}</Link>
                    </h3>
                    {c.parent_institution ? <small className="um-hint">{c.parent_institution}</small> : null}
                    <div className="row">
                      <Badge tone="primary">{t("colleges.programCount", { n: c.programs })}</Badge>
                      <Badge>{t("colleges.seatTotal", { n: number(c.seats) })}</Badge>
                    </div>
                  </div>
                </Card>
              ))
            )
          ) : programs.length === 0 ? (
            <EmptyState title={t("colleges.noResults")} />
          ) : (
            programs.map((p) => <ProgramItem key={p.id} p={p} college={cat.byId.get(p.college_id)} />)
          )}
          <p className="um-hint">{t("colleges.notice")}</p>
        </>
      )}
    </div>
  );
}

export function CollegePage({ id }: { id: string }) {
  const { t, number } = useI18n();
  const cat = useCatalog();
  const [filters, setFilters] = useState<CatalogFilters>(NO_FILTERS);
  const deferred = useDeferredValue(filters);
  const college = cat.byId.get(id);
  const programs = useMemo(() => (cat.data ? filterPrograms(cat.data.programs, cat.byId, { ...deferred, collegeId: id }) : []), [cat.data, cat.byId, deferred, id]);
  const seats = programs.reduce((n, p) => n + p.seats, 0);

  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>{college?.college_name ?? t("colleges.college")}</h1>
        {college?.parent_institution ? <p>{t("colleges.parent")}: {college.parent_institution}</p> : null}
      </div>
      {cat.loading && !cat.data ? (
        <Loading />
      ) : cat.error || !college ? (
        <ErrorState title={t("colleges.loadFailed")} />
      ) : (
        <>
          <Filters value={filters} onChange={setFilters} />
          <p className="um-hint" aria-live="polite">
            {t("colleges.programCount", { n: number(programs.length) })} · {t("colleges.seatTotal", { n: number(seats) })}
          </p>
          {programs.length === 0 ? <EmptyState title={t("colleges.noResults")} /> : programs.map((p) => <ProgramItem key={p.id} p={p} college={college} />)}
          <p className="um-hint">{t("colleges.notice")}</p>
        </>
      )}
    </div>
  );
}

export function ProgramPage({ id }: { id: string }) {
  const { t, number } = useI18n();
  const cat = useCatalog();
  const p = cat.data?.programs.find((x) => x.id === id);
  const college = p ? cat.byId.get(p.college_id) : undefined;

  if (cat.loading && !cat.data) return <Loading />;
  if (cat.error || !p) return <ErrorState title={t("colleges.loadFailed")} />;
  const rows: Array<[string, string]> = [
    [t("colleges.code"), p.code],
    ...(college ? ([[t("colleges.college"), college.college_name]] as Array<[string, string]>) : []),
    ...(college?.parent_institution ? ([[t("colleges.parent"), college.parent_institution]] as Array<[string, string]>) : []),
    ...(p.division ? ([[t("colleges.division"), p.division]] as Array<[string, string]>) : []),
    [t("colleges.language"), t(p.language === "az" ? "colleges.langAz" : p.language === "ru" ? "colleges.langRu" : "colleges.langAzRu")],
    [t("colleges.format"), t(p.study_format === "full_time" ? "colleges.formatFull" : "colleges.formatPart")],
    [t("colleges.seatsTitle"), t("colleges.seats", { n: p.seats })],
    [t("colleges.tuition"), p.state_funded ? t("colleges.stateFunded") : t("colleges.fee", { n: number(p.tuition_azn ?? 0) })],
  ];
  return (
    <div className="stack-lg">
      <div className="page-head">
        <h1>{t("colleges.detail")}</h1>
      </div>
      <Card>
        <div className="stack">
          <h2>{p.specialty}</h2>
          <div className="row">
            <Badge tone={p.state_funded ? "success" : "warning"}>{p.state_funded ? t("colleges.stateFunded") : t("colleges.paid")}</Badge>
            {p.special_ability ? <Badge tone="danger">{t("colleges.special")}</Badge> : null}
            {p.needs_verification ? <Badge tone="warning">{t("colleges.needsCheck")}</Badge> : null}
          </div>
        </div>
      </Card>
      <Card>
        <div className="stack">
          {rows.map(([k, v]) => (
            <div key={k} className="row row--between">
              <small className="um-hint">{k}</small>
              <span>{v}</span>
            </div>
          ))}
          <small className="um-hint">{t("colleges.sourcePage", { n: p.source_page })}</small>
        </div>
      </Card>
      {college ? (
        <Card>
          <Link href={`/colleges/${college.id}`}>{collegeLabel(college)} ›</Link>
        </Card>
      ) : null}
      <p className="um-hint">{t("colleges.notice")}</p>
    </div>
  );
}
