"use client";

import { isFunctionMissing, legalErrorKind, legalGate, type LegalGate as Gate } from "@unimate/core";
import { useI18n } from "@unimate/i18n/react";
import { Button, Dialog } from "@unimate/ui";
import { useEffect, useState } from "react";
import { useSignOut } from "@/components/sign-out";
import { getBrowserClient } from "@/lib/supabase/browser";
import { ConsentFields, birthIssue, type Checked, type ConsentType } from "./ConsentFields";

/** Blocks the signed-in app until the birth date is on file and every required document is (re)accepted. */
export function LegalGate() {
  const { t } = useI18n();
  const signOut = useSignOut();
  const [gate, setGate] = useState<Gate | null>(null);
  const [birth, setBirth] = useState("");
  const [checked, setChecked] = useState<Checked>({});
  const [busy, setBusy] = useState(false);
  const [underage, setUnderage] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const sb = getBrowserClient();
    void Promise.all([sb.rpc("legal_profile_status"), sb.rpc("legal_consent_status")]).then(([p, c]) => {
      // Fail open only when the functions are not deployed yet (remote DB not migrated).
      if (p.error || c.error || isFunctionMissing(p.error) || isFunctionMissing(c.error)) return;
      const g = legalGate(p.data, c.data);
      if (g.needsBirth || g.pending.length) setGate(g);
    });
  }, []);

  if (!gate) return null;
  const pending = gate.pending as ConsentType[];
  const birthErr = gate.needsBirth ? birthIssue(birth) : null;
  const ready = !birthErr && pending.every((k) => checked[k]);

  async function submit() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    const sb = getBrowserClient();
    const b = gate!.needsBirth ? await sb.rpc("set_birth_date", { p_birth: birth }) : null;
    const r = b?.error ? b : pending.length ? await sb.rpc("record_consents", { p_types: pending, p_platform: "web", p_context: "reconsent" }) : null;
    setBusy(false);
    if (r?.error) {
      if (legalErrorKind(r.error) === "underage") return setUnderage(true);
      return setError(t("common.genericError"));
    }
    setGate(null);
  }

  return (
    <Dialog open onClose={() => undefined} title={t("consent.gateTitle")}>
      {underage ? (
        <div className="stack">
          <p className="err-box" role="alert">{t("consent.errUnderage")}</p>
          <Button onClick={signOut}>{t("settings.signOutTitle")}</Button>
        </div>
      ) : (
        <div className="stack">
          <p className="um-muted">{t("consent.gateBody")}</p>
          {error ? <p className="err-box" role="alert">{error}</p> : null}
          <ConsentFields {...(gate.needsBirth ? { birth, onBirth: setBirth, birthError: birth && birthErr ? t(birthErr) : undefined } : {})} types={pending} checked={checked} onCheck={(k, v) => setChecked((c) => ({ ...c, [k]: v }))} />
          <Button block loading={busy} disabled={!ready} onClick={submit}>{t("consent.gateCta")}</Button>
          <Button variant="secondary" block onClick={signOut}>{t("settings.signOutTitle")}</Button>
        </div>
      )}
    </Dialog>
  );
}
