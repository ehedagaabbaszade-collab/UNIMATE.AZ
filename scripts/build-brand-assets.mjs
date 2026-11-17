// Reproducible brand asset pipeline: `npm run brand:build`.
// Inputs ONLY from assets/branding/official (the user's brand pack, never modified). Artwork is only resized
// proportionally and composited onto plain squares; never redrawn, recoloured or filtered.
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = (kind, color) => join(root, `assets/branding/official/PNG/${kind}/UNIMATE_${kind}_${color}.png`);
const out = (p) => join(root, p);
const png = { compressionLevel: 9, effort: 10 };
const buf = (s) => s.png(png).toBuffer();
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
const white = { r: 255, g: 255, b: 255, alpha: 1 };

const resized = (file, o) => sharp(file).resize({ ...o, fit: "inside" }).png(png).toBuffer();
/** Icon_Only centered with padding on a square (transparent when bg is omitted). */
async function icon(file, canvas, markH, bg = transparent) {
  const m = await resized(file, { height: markH });
  const mm = await sharp(m).metadata();
  return sharp({ create: { width: canvas, height: canvas, channels: 4, background: bg } })
    .composite([{ input: m, left: Math.round((canvas - mm.width) / 2), top: Math.round((canvas - mm.height) / 2) }]);
}
/** Android themed/notification glyph: the official mark's alpha channel only, flat white. */
async function mono(file, canvas, markH) {
  const m = await sharp(await resized(file, { height: markH })).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < m.data.length; i += 4) m.data[i] = m.data[i + 1] = m.data[i + 2] = 255;
  const s = await sharp(m.data, { raw: { width: m.info.width, height: m.info.height, channels: 4 } }).png().toBuffer();
  return sharp({ create: { width: canvas, height: canvas, channels: 4, background: transparent } })
    .composite([{ input: s, left: Math.round((canvas - m.info.width) / 2), top: Math.round((canvas - m.info.height) / 2) }]);
}

const G = "Original_Gradient", W = "White";
const files = {
  "full-logo.png": await resized(src("Full_Logo", G), { width: 800 }),
  "full-logo-white.png": await resized(src("Full_Logo", W), { width: 800 }),
  "mark.png": await resized(src("Icon_Only", G), { width: 320 }),
  "mark-white.png": await resized(src("Icon_Only", W), { width: 320 }),
  "wordmark.png": await resized(src("Wordmark", G), { width: 640 }),
  "wordmark-white.png": await resized(src("Wordmark", W), { width: 640 }),
};
const mk = src("Icon_Only", G), mkW = src("Icon_Only", W);
files["icon-32.png"] = await buf(await icon(mk, 32, 28));
files["icon-192.png"] = await buf(await icon(mk, 192, 150, white));
files["icon-512.png"] = await buf(await icon(mk, 512, 400, white));
files["maskable-512.png"] = await buf(await icon(mk, 512, 280, white)); // inside the 80% safe zone
files["apple-touch-icon.png"] = await buf(await icon(mk, 180, 128, white));
{ // Open Graph 1200x630, full logo on light
  const logo = await resized(src("Full_Logo", G), { height: 420 });
  const lm = await sharp(logo).metadata();
  files["og-image.png"] = await buf(
    sharp({ create: { width: 1200, height: 630, channels: 4, background: "#F1F5FF" } }).composite([{ input: logo, left: Math.round((1200 - lm.width) / 2), top: Math.round((630 - lm.height) / 2) }]),
  );
}
const mobile = {
  "icon.png": await buf((await icon(mk, 1024, 640, white)).flatten({ background: "#FFFFFF" })), // iOS: opaque
  "adaptive-icon.png": await buf(await icon(mk, 1024, 560)), // foreground, inside the 66% safe zone
  "adaptive-icon-monochrome.png": await buf(await mono(mk, 1024, 560)),
  "splash-icon.png": await buf(await icon(mk, 1024, 560)), // light splash
  "splash-icon-dark.png": await buf(await icon(mkW, 1024, 560)), // dark splash (white mark, transparent)
  "notification-icon.png": await buf(await mono(mk, 96, 72)),
  "favicon.png": files["icon-32.png"],
};
const brandSet = (...names) => Object.fromEntries(names.map((n) => [n, files[n]]));
const logos = ["full-logo.png", "full-logo-white.png", "mark.png", "mark-white.png", "wordmark.png", "wordmark-white.png"];
const targets = {
  "assets/branding/generated": { ...files, ...Object.fromEntries(Object.entries(mobile).filter(([k]) => k !== "favicon.png").map(([k, v]) => [`mobile-${k}`, v])) },
  "apps/web/public/brand": brandSet(...logos, "og-image.png"),
  "apps/web/public/icons": brandSet("icon-192.png", "icon-512.png", "maskable-512.png"),
  "apps/web/src/app": { "icon.png": files["icon-32.png"], "apple-icon.png": files["apple-touch-icon.png"], "opengraph-image.png": files["og-image.png"] },
  "apps/admin/public/brand": brandSet(...logos),
  "apps/admin/src/app": { "icon.png": files["icon-32.png"], "apple-icon.png": files["apple-touch-icon.png"] },
  "apps/mobile/assets": { ...mobile, ...brandSet(...logos) },
};
for (const [dir, set] of Object.entries(targets)) {
  await mkdir(out(dir), { recursive: true });
  for (const [name, b] of Object.entries(set)) await writeFile(join(out(dir), name), b);
}
for (const n of logos) { const m = await sharp(files[n]).metadata(); console.log(n, m.width, "x", m.height); }
console.log("files written:", Object.values(targets).reduce((n, s) => n + Object.keys(s).length, 0));
