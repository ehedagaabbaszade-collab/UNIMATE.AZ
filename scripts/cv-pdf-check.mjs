// Real PDF check of the shared CV renderer (packages/core/src/career/cv-render.ts), no mocks:
// renders a long Azerbaijani CV (all sections + a photo) for every builder template (designed) and the ATS mode, prints each
// with the locally installed headless Chrome/Edge, then extracts the text with unpdf and asserts:
//   all Azerbaijani letters are real text, page count, fonts embedded (only the bundled families), ATS text order is linear.
// Fonts are passed as data URIs, exactly like mobile (expo-print).
// Usage:
//   node scripts/cv-pdf-check.mjs [outDir]            PDFs + page-1 PNGs + summary table (exit 1 on a failed check)
//   node scripts/cv-pdf-check.mjs --previews          also writes gallery previews (600 px, A4) to
//                                                     apps/web/public/cv-templates/<id>.png and apps/mobile/assets/cv-templates/<id>.png
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "esbuild";
import sharp from "sharp";
import { extractText } from "unpdf";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const previews = args.includes("--previews");
const outDir = path.resolve(args.find((a) => !a.startsWith("--")) ?? path.join(os.tmpdir(), "unimate-cv-check"));
mkdirSync(outDir, { recursive: true });

const browser = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].find((p) => p && existsSync(p));
if (!browser) throw new Error("No Chrome/Edge found (set CHROME_PATH). This script never downloads a browser.");

// ---- load the TypeScript renderer + i18n through esbuild (same code the apps ship)
const entry = path.join(outDir, "entry.ts");
writeFileSync(entry, `export * from ${JSON.stringify(path.join(root, "packages/core/src/index.ts"))};\nexport { t } from ${JSON.stringify(path.join(root, "packages/i18n/src/index.ts"))};\n`);
const bundle = path.join(outDir, "renderer.mjs");
await build({ entryPoints: [entry], bundle: true, format: "esm", platform: "node", outfile: bundle, logLevel: "error" });
const core = await import(pathToFileURL(bundle).href);
const { CV_FONT_FACES, CV_PRINT_LABEL_KEYS, CV_TEMPLATES, CvDataSchema, renderCvHtml, resolveCvDesign, t } = core;

const labels = Object.fromEntries(CV_PRINT_LABEL_KEYS.map((k) => [k, t("az", `career.cv.sectionPrint.${k}`)]));
const fontData = Object.fromEntries(CV_FONT_FACES.map((f) => [f.file, `data:font/woff2;base64,${readFileSync(path.join(root, "apps/web/public/cv-fonts", f.file)).toString("base64")}`]));
const fonts = (file) => fontData[file];
const photo = `data:image/png;base64,${(
  await sharp({ create: { width: 240, height: 240, channels: 3, background: "#7c8da6" } })
    .composite([{ input: Buffer.from('<svg width="240" height="240"><circle cx="120" cy="95" r="52" fill="#e9edf3"/><ellipse cx="120" cy="235" rx="95" ry="75" fill="#e9edf3"/></svg>') }])
    .png()
    .toBuffer()
).toString("base64")}`;

// ---- long Azerbaijani sample (every az letter: ə Ə ğ Ğ ş Ş ç Ç ö Ö ü Ü ı İ)
const AZ_LETTERS = "əƏğĞşŞçÇöÖüÜıİ";
const para = "Çətin layihələrdə komanda ilə işləyərək müştərilərin ehtiyaclarını öyrəndim, hesabatları hazırladım və prosesləri sadələşdirdim.";
const cv = CvDataSchema.parse({
  personal: {
    fullName: "Əhməd Şükürov", headline: "Məlumat analitiki · Ğəniyev Holdinq üçün müraciət", email: "ahmed.sukurov@example.az", phone: "+994 50 123 45 67",
    city: "Bakı", address: "Nizami küçəsi 10", linkedin: "linkedin.com/in/ahmed-sukurov", github: "https://github.com/ahmedsukurov", portfolio: "https://ahmed.example.az",
    birthDate: "1999-04-12", nationality: "Azərbaycan", photoUrl: "",
  },
  summary: `Öyrənməyə açıq, Ölçülə bilən nəticələrə fokuslanan analitik. Üç illik təcrübəm var: SQL, Python və Power BI ilə işləmişəm. İşimdə dəqiqlik və şəffaflıq əsasdır. ${para}`,
  experience: Array.from({ length: 6 }, (_, i) => ({
    role: ["Məlumat analitiki", "Biznes analitik (təcrübəçi)", "Hesabat mütəxəssisi", "Kiçik analitik", "Satış koordinatoru", "Müştəri dəstəyi əməkdaşı"][i],
    company: ["Azərişıq ASC", "Ğəniyev Holdinq", "Şəki Şərab MMC", "Çıraq Texnologiya", "Ödəniş Sistemləri", "Ümid Bank"][i],
    location: "Bakı", start: `202${3 - Math.min(i, 3)}-0${(i % 9) + 1}`, end: i === 0 ? "" : `202${4 - Math.min(i, 3)}-1${i % 3}`, current: i === 0,
    employmentType: ["full_time", "internship", "part_time", "contract", "full_time", "freelance"][i],
    bullets: [para, "Gündəlik və həftəlik KPİ hesabatlarını avtomatlaşdırdım; İş saatlarına qənaət etdim.", "Ölkə üzrə satış göstəricilərini təhlil etdim və rəhbərliyə təqdim etdim."],
    achievements: i < 3 ? ["Hesabat hazırlama vaxtını 40% azaltdım.", "Şirkətdaxili təlim keçirdim: 25 iştirakçı."] : [],
  })),
  education: [
    { institution: "Bakı Dövlət Universiteti", degree: "Bakalavr", field: "Kompüter elmləri", start: "2017", end: "2021", gpa: "91", city: "Bakı", description: "Diplom işi: Böyük verilənlərin təhlili üçün açıq mənbəli alətlərin müqayisəsi." },
    { institution: "ADA Universiteti", degree: "Magistr", field: "Məlumat elmi", start: "2021", end: "2023", gpa: "3.8", city: "Bakı", description: "Ümumi yük: 120 kredit. Seçmə fənlər: maşın öyrənməsi, statistika." },
  ],
  skills: ["SQL", "Python", "Power BI", "Excel", { name: "Statistika", level: 4, kind: "technical" }, { name: "Komanda işi", level: 5, kind: "soft" }, { name: "Ünsiyyət", level: 4, kind: "soft" }, { name: "Tableau", level: 3, kind: "technical" }],
  languages: [{ name: "Azərbaycan dili", native: true }, { name: "İngilis dili", listening: "C1", reading: "C1", spokenProduction: "B2", spokenInteraction: "B2", writing: "B2" }, { name: "Türk dili", level: "C2" }, { name: "Rus dili", level: "B1" }],
  projects: Array.from({ length: 3 }, (_, i) => ({ name: `Açıq məlumat paneli ${i + 1}`, role: "Müəllif", link: "https://github.com/ahmedsukurov/panel", description: `${para} İstifadəçi sayı ${i + 2}00-ü ötdü.`, tech: ["Python", "Pandas", "Streamlit"] })),
  certificates: [
    { name: "Google Data Analytics", issuer: "Coursera", date: "2022-06", expiry: "", credentialUrl: "https://coursera.org/verify/ABC" },
    { name: "Microsoft Power BI Data Analyst", issuer: "Microsoft", date: "2023-02", expiry: "2025-02", credentialUrl: "https://learn.microsoft.com/cred/1" },
  ],
  courses: [{ name: "Statistikaya giriş", provider: "Stepik", date: "2021-03", description: "Ehtimal, paylanmalar, hipotez yoxlanması." }, { name: "Çevik idarəetmə", provider: "Udemy", date: "2022-09" }],
  volunteer: [{ role: "Mentor", organization: "Gənclər Fondu", location: "Gəncə", start: "2020", end: "2022", description: "Şagirdlərə proqramlaşdırma öyrətdim; Ümumilikdə 40 dərs keçdim." }],
  publications: [{ title: "Azərbaycanda açıq məlumatların vəziyyəti", publisher: "İqtisadiyyat jurnalı", date: "2023", link: "https://example.az/paper" }, { title: "Kiçik bizneslər üçün BI alətləri", publisher: "Konfrans materialları", date: "2022" }],
  honours: [{ title: "Ən yaxşı diplom işi", issuer: "BDU", date: "2021", description: "Fakültə üzrə birinci yer." }],
  activities: [{ title: "Tələbə Elmi Cəmiyyəti", place: "BDU", date: "2019-2021", description: "Seminarlar təşkil etdim." }],
  hobbies: [{ title: "Şahmat" }, { title: "Dağ yürüşü" }, { title: "Fotoqrafiya" }],
  references: [{ name: "Gülşən Əliyeva", position: "Departament rəhbəri", company: "Azərişıq ASC", email: "g.aliyeva@example.az", phone: "+994 12 000 00 00" }, { name: "", onRequest: true }],
});

const runs = [...CV_TEMPLATES.map((id) => ({ id, label: id, design: {} })), { id: "ats-classic", label: "ATS mode (modern-minimal)", design: { mode: "ats" }, tpl: "modern-minimal" }];
const FAMILY = { inter: "Inter", "noto-sans": "NotoSans", "noto-serif": "NotoSerif" };
const chrome = (extra, html) => execFileSync(browser, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check", `--user-data-dir=${path.join(outDir, "profile")}`, "--hide-scrollbars", ...extra, pathToFileURL(html).href], { stdio: "pipe", timeout: 120_000 });

const rows = [];
let failed = false;
for (const r of runs) {
  const template = r.tpl ?? r.id;
  const design = resolveCvDesign(template, r.design);
  const name = r.design.mode === "ats" ? "ats-mode" : r.id;
  const html = renderCvHtml(cv, { template, design: r.design, language: "az", title: "CV", labels, fonts, assets: { photoSrc: photo } });
  const htmlPath = path.join(outDir, `${name}.html`);
  writeFileSync(htmlPath, html);
  const pdfPath = path.join(outDir, `${name}.pdf`);
  rmSync(pdfPath, { force: true });
  chrome(["--no-pdf-header-footer", "--run-all-compositor-stages-before-draw", "--virtual-time-budget=5000", `--print-to-pdf=${pdfPath}`], htmlPath);
  // Screen render of page 1 (with the print margins as padding) for the PNG.
  const m = { narrow: 10, normal: 15, wide: 25 }[design.margins];
  const band = design.mode !== "ats" && design.columns === "two" && ["creative", "two-column", "modern-european"].includes(template);
  const shotHtml = path.join(outDir, `${name}.screen.html`);
  writeFileSync(shotHtml, html.replace("</head>", `<style>body{box-sizing:border-box;width:210mm;padding:${band ? `${m}mm 0` : `${m}mm`}}</style></head>`));
  const pngPath = path.join(outDir, `${name}.png`);
  chrome(["--window-size=794,1123", "--virtual-time-budget=5000", `--screenshot=${pngPath}`], shotHtml);

  const bytes = new Uint8Array(readFileSync(pdfPath));
  const pdfText = Buffer.from(bytes).toString("latin1");
  const { totalPages, text } = await extractText(bytes, { mergePages: false });
  const all = text.join("\n");
  const missingLetters = [...AZ_LETTERS].filter((c) => !all.includes(c));
  const fontNames = [...new Set([...pdfText.matchAll(/\/BaseFont\s*\/(?:[A-Z]{6}\+)?([A-Za-z0-9-]+)/g)].map((x) => x[1]))];
  const embedded = /\/FontFile[23]?\b/.test(pdfText);
  const want = FAMILY[design.font];
  const fontsOk = embedded && fontNames.length > 0 && fontNames.every((f) => f.replace(/-.*/, "").startsWith(want));
  const checks = { letters: missingLetters.length === 0, pages: totalPages >= 2, fonts: fontsOk };
  if (design.mode === "ats") {
    // Linear text layer: section headings appear in the design order, and an experience line reads "Role | Company | Dates".
    const heads = design.sectionOrder.filter((s) => !design.hidden.includes(s)).map((s) => labels[s]);
    const pos = heads.map((h) => all.indexOf(h));
    checks.linear = pos.every((p) => p >= 0) && pos.every((p, i) => i === 0 || p > pos[i - 1]);
    checks.atsLine = /Məlumat analitiki \| Azərişıq ASC, Bakı · Tam ştat \| 2023-01 – Hazırda/.test(all.replace(/\s+/g, " "));
  }
  if (!Object.values(checks).every(Boolean)) failed = true;
  rows.push({ template: r.label, pages: totalPages, azLetters: missingLetters.length ? `MISSING ${missingLetters.join("")}` : "ok", fonts: `${fontsOk ? "ok" : "FAIL"} (${fontNames.join(", ") || "none"})`, ...(design.mode === "ats" ? { linear: checks.linear ? "ok" : "FAIL", atsLine: checks.atsLine ? "ok" : "FAIL" } : {}) });

  if (previews && !r.design.mode) {
    const img = await sharp(pngPath).resize({ width: 600 }).png({ compressionLevel: 9, palette: true }).toBuffer();
    for (const dir of ["apps/web/public/cv-templates", "apps/mobile/assets/cv-templates"]) writeFileSync(path.join(root, dir, `${r.id}.png`), img);
  }
}
rmSync(path.join(outDir, "profile"), { recursive: true, force: true });
console.table(rows);
console.log(`PDFs, PNGs and HTML in ${outDir}`);
if (failed) {
  console.error("CV PDF check FAILED");
  process.exit(1);
}
