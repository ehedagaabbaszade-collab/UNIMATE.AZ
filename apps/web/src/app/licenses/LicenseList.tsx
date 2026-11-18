"use client";

import { useI18n } from "@unimate/i18n/react";
import { Badge, Input } from "@unimate/ui";
import { useEffect, useState } from "react";

type Entry = { name: string; version: string; license: string; url: string };

export function LicenseList() {
  const { t } = useI18n();
  const [items, setItems] = useState<Entry[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => {
    fetch("/licenses/third-party.json").then((r) => r.json()).then(setItems).catch(() => setItems([]));
  }, []);
  const needle = q.trim().toLowerCase();
  const shown = needle ? items.filter((i) => `${i.name} ${i.license}`.toLowerCase().includes(needle)) : items;
  return (
    <div>
      <Input label={t("legal.licenses.search")} type="search" value={q} onChange={(e) => setQ(e.target.value)} />
      <p className="um-muted">{t("legal.licenses.count", { n: shown.length })}</p>
      <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
        {shown.map((i) => (
          <li key={`${i.name}@${i.version}`} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: "6px 0", overflowWrap: "anywhere" }}>
            {i.url ? <a href={i.url} target="_blank" rel="noopener noreferrer">{i.name}</a> : <span>{i.name}</span>}
            <span className="um-muted">{i.version}</span>
            <Badge>{i.license || "?"}</Badge>
          </li>
        ))}
      </ul>
    </div>
  );
}
