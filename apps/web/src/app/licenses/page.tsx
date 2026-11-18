import Link from "next/link";
import { AppLogo } from "@/components/brand";
import { LegalNav } from "@/components/LegalNav";
import { LocaleSwitcher } from "@/components/prefs";
import { getT } from "@/i18n/server";
import list from "../../../public/licenses/third-party.json";

type Entry = { name: string; version: string; license: string; url: string };

const LICENSE_NAMES: Record<string, string> = {
  MIT: "MIT License",
  ISC: "ISC License",
  "Apache-2.0": "Apache License 2.0",
  "BSD-2-Clause": "BSD 2-Clause License",
  "BSD-3-Clause": "BSD 3-Clause License",
  "0BSD": "Zero-Clause BSD License",
  "MPL-2.0": "Mozilla Public License 2.0",
  Unlicense: "The Unlicense",
  "CC0-1.0": "Creative Commons Zero 1.0",
  "CC-BY-4.0": "Creative Commons Attribution 4.0",
  "BlueOak-1.0.0": "Blue Oak Model License 1.0.0",
  "Python-2.0": "Python Software Foundation License 2.0",
};

/** Packages grouped by license, largest group first. */
const groups = Object.entries(
  (list as Entry[]).reduce<Record<string, Entry[]>>((acc, e) => {
    (acc[e.license || "UNKNOWN"] ??= []).push(e);
    return acc;
  }, {}),
).sort((a, b) => b[1].length - a[1].length);

export default async function LicensesPage() {
  const { t } = await getT();
  return (
    <>
      <header className="topbar">
        <Link href="/" className="auth__brand">
          <AppLogo kind="mark" height={36} />
        </Link>
        <LocaleSwitcher compact />
      </header>
      <main id="main" className="page">
        <div className="prose">
          <LegalNav t={t} current="licenses" />
          <h1>{t("legal.licenses.title")}</h1>
          <p>{t("legal.licenses.ownership")}</p>
          <p>{t("legal.licenses.intro")}</p>
          {groups.map(([id, entries]) => (
            <section key={id} className="license-group">
              <h2>{LICENSE_NAMES[id] ?? id}</h2>
              <p className="um-muted">
                SPDX: {id} · {t("legal.licenses.count", { n: entries.length })}
              </p>
              <details>
                <summary>{t("legal.licenses.showPackages")}</summary>
                <ul className="license-pkgs">
                  {entries.map((e) => (
                    <li key={`${e.name}@${e.version}`}>
                      {e.url ? (
                        <a href={e.url} target="_blank" rel="noopener noreferrer">
                          {e.name}
                        </a>
                      ) : (
                        e.name
                      )}{" "}
                      <span className="um-muted">{e.version}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </section>
          ))}
          <section>
            <h2>{t("legal.licenses.fullTextHeading")}</h2>
            <p>{t("legal.licenses.fullTextBody")}</p>
            <p>
              <a href="/licenses/THIRD_PARTY_NOTICES.txt">{t("legal.licenses.fullText")}</a>
            </p>
          </section>
        </div>
      </main>
    </>
  );
}
