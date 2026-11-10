#!/usr/bin/env python
"""
Extracts the DIM 2026/2027 "orta ixtisas tehsili muessiselerinin bos qalan yerleri" tables to JSON.

usage: python scripts/dim-extract.py <dim.pdf> <out_dir>

The PDF uses legacy font encodings (Azerbaijani letters come out as Cyrillic/Greek/Latin-1 look-alikes), so text is
repaired with an explicit map and any character outside the expected alphabet is reported, never guessed.
Layout (checked on the pages): two table columns per page; institution heading = 14pt, division ("Azerbaycan bolmesi")
= 10pt, rows = code+name 9pt with form/seats 8pt and fee 7pt on the same line (or vertically centred for multi-line
names). Output keeps source page numbers; rows failing validation are flagged and listed in report.json.
"""
import collections, json, os, re, sys
import pymupdf

FIX = {"ԥ": "ə", "Ԥ": "Ə", "Ω": "ə", "Ӂ": "Ə", "ӂ": "ə", "ú": "ş", "ù": "Ş", "Õ": "ı", "ø": "İ", "÷": "ğ", "Ǻ": "Ə", "Ψ": "Ə"}
ALPHABET = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 .,;:()-–—/\"'«»“”*%&+_!?əƏıİöÖüÜçÇşŞğĞ")
CODE = re.compile(r"^\s*(\*?)(\d{6})\b\s*(.*)$")
fix = lambda s: "".join(FIX.get(c, c) for c in s)


def page_lines(page, left):
    mid = page.rect.width / 2
    spans = []
    for b in page.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            for s in l["spans"]:
                if s["font"].startswith(("Arial-Black", "Tahoma")) or s["size"] > 30:
                    continue
                x0, y0, x1, y1 = s["bbox"]
                if (x0 < mid) == left:
                    spans.append({"x0": x0, "x1": x1, "y": (y0 + y1) / 2, "size": round(s["size"], 1), "text": s["text"]})
    lines = []
    for sp in sorted(spans, key=lambda s: s["y"]):
        if lines and abs(lines[-1]["y"] - sp["y"]) <= 2.2:
            lines[-1]["spans"].append(sp)
        else:
            lines.append({"y": sp["y"], "spans": [sp]})
    for ln in lines:
        ln["spans"].sort(key=lambda s: s["x0"])
        ln["spans"] = [s for s in ln["spans"] if s["text"].strip()] or ln["spans"]
        ln["size"] = ln["spans"][0]["size"]
        joined = ""
        prev = None
        for s in ln["spans"]:
            if prev is not None and s["x0"] - prev["x1"] > 1.2 and not joined.endswith(" ") and not s["text"].startswith(" "):
                joined += " "
            joined += s["text"]
            prev = s
        ln["text"] = re.sub(r"\s+", " ", fix(joined)).strip()
    return lines


def kind(ln):
    if ln["text"].isdigit():  # page number
        return "text"
    if ln["size"] >= 13:
        return "head"
    if ln["size"] >= 9.6:
        return "div"
    if CODE.match(ln["text"]) and ln["size"] >= 8.5:
        return "row"
    return "val" if ln["size"] < 8.6 else "text"


def main(pdf, out):
    doc = pymupdf.open(pdf)
    records, headings = [], []
    unknown = collections.Counter()
    page_counts = {}
    inst, division = None, None
    for pno in range(len(doc)):
        page = doc[pno]
        raw = fix(page.get_text())
        raw_codes = set(re.findall(r"(?<!\d)(\d{6})(?!\d)", raw))
        parsed = 0
        for left in (True, False):
            cur, pending = None, []
            blocks = []
            for ln in page_lines(page, left):
                k = kind(ln)
                if k in ("head", "div"):
                    cur = None
                    blocks.append((k, ln))
                elif k == "row":
                    cur = {"row": ln, "cont": [], "vals": []}
                    blocks.append(("rec", cur))
                elif cur is not None:
                    cur["vals" if k == "val" else "cont"].append(ln)
                elif ln["text"] and not ln["text"].isdigit():
                    unknown["orphan:" + ln["text"][:50]] += 1
            heads, was_head = [], False
            for k, b in blocks:
                if k == "head":
                    if not was_head:
                        heads = []
                    heads.append(b["text"])
                    was_head = True
                    continue
                if was_head:
                    inst, division = " ".join(heads).strip(), None
                    headings.append({"page": pno + 1, "text": inst})
                    was_head = False
                if k == "div":
                    division = b["text"]
                    continue
                parsed += 1
                row = b["row"]
                star, code = CODE.match(row["text"]).group(1, 2)
                name_spans = [s for s in row["spans"] if s["size"] >= 8.5]
                vals = [s for s in row["spans"] if s["size"] < 8.6]
                first = CODE.match(fix("".join(s["text"] for s in name_spans)).strip())
                parts = [first.group(3).strip()] + [c["text"] for c in b["cont"]]
                for v in b["vals"]:
                    vals += v["spans"]
                name = re.sub(r"\s+", " ", " ".join(p for p in parts if p)).strip()
                toks = [t for t in (fix(s["text"]).strip() for s in sorted(vals, key=lambda s: s["x0"])) if t]
                form = next((t for t in toks if t in ("Ə", "Q")), None)
                rest = [t for t in toks if t not in ("Ə", "Q")]
                seats = int(rest[0]) if len(rest) >= 1 and rest[0].isdigit() else None
                fee_tok = rest[1] if len(rest) >= 2 else None
                special = bool(star) or "*" in name
                name = name.replace("*", "").strip()
                flags = []
                if not inst:
                    flags.append("no institution")
                if form is None:
                    flags.append("no form")
                if seats is None:
                    flags.append("no seats")
                if len(rest) != 2 or not (fee_tok == "DH" or (fee_tok or "").isdigit()):
                    flags.append("fee/DH unreadable")
                for c in name + (inst or "") + (division or ""):
                    if c not in ALPHABET:
                        unknown[c] += 1
                        flags.append(f"char {c!r}")
                records.append({
                    "code": code, "specialty": name, "institution": inst, "division": division, "form": form,
                    "seats": seats, "fee": int(fee_tok) if fee_tok and fee_tok.isdigit() else None,
                    "state_funded": fee_tok == "DH", "special_ability": special, "page": pno + 1, "flags": sorted(set(flags)),
                })
            if was_head:
                inst, division = " ".join(heads).strip(), None
                headings.append({"page": pno + 1, "text": inst})
        if parsed:
            page_counts[pno + 1] = {"six_digit_numbers_in_text": len(raw_codes), "rows_parsed": parsed}
    os.makedirs(out, exist_ok=True)
    meta = {"source": "DİM 2026/2027 - orta ixtisas təhsili müəssisələrinin boş qalan yerləri (tam orta təhsil bazası)"}
    json.dump({**meta, "records": records}, open(f"{out}/colleges.json", "w", encoding="utf8"), ensure_ascii=False, indent=1)
    flagged = [r for r in records if r["flags"]]
    json.dump({"flagged": flagged, "unknown_chars": unknown, "headings": headings, "page_counts": page_counts}, open(f"{out}/report.json", "w", encoding="utf8"), ensure_ascii=False, indent=1)
    print("records", len(records), "flagged", len(flagged), "headings", len(headings))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
