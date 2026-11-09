// Reproducible brand asset pipeline: `npm run brand:build`.
// Reads assets/branding/original/* (never modified) and writes derived, optimised PNGs.
// Logo shapes, colours and proportions are untouched: only resized, trimmed, background-to-alpha, and placed on tiles.
import sharp from "sharp";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const orig = (n) => join(root, "assets/branding/original", n);
const out = (p) => join(root, p);
const png = { compressionLevel: 9, effort: 10 };

/** White background -> alpha (standard "colour to alpha"): preserves colours and soft edges. */
async function whiteToAlpha(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const a = Math.max(255 - data[i], 255 - data[i + 1], 255 - data[i + 2]) / 255;
    if (a <= 0.004) { data[i] = data[i + 1] = data[i + 2] = data[i + 3] = 0; continue; }
    for (let c = 0; c < 3; c++) data[i + c] = Math.max(0, Math.min(255, Math.round(255 - (255 - data[i + c]) / a)));
    data[i + 3] = Math.round(a * 255);
  }
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } });
}
const buf = (s, o = png) => s.png(o).toBuffer();
const trim = async (b) => sharp(b).trim({ threshold: 8 }).toBuffer();

// ---- sources ----
const markT = await trim(await sharp(orig("unimate-brandmark.webp")).ensureAlpha().png().toBuffer()); // already transparent
const logoT = await trim(await buf(await whiteToAlpha(orig("unimate-logo-primary.webp"))));
const logoMeta = await sharp(logoT).metadata();

// white wordmark for dark surfaces: only the lettering/tagline region (below the mark), darkness -> white alpha
const fullRaw = await sharp(orig("unimate-logo-primary.webp")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const W = fullRaw.info.width, H = fullRaw.info.height;
const wm = Buffer.alloc(W * H * 4);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const i = (y * W + x) * 4;
  const inText = y >= 820 && y <= 1000;
  const lum = (fullRaw.data[i] + fullRaw.data[i + 1] + fullRaw.data[i + 2]) / 3;
  const a = inText ? Math.max(0, Math.min(1, ((255 - lum) / 255) * 1.05)) : 0;
  wm[i] = wm[i + 1] = wm[i + 2] = 255;
  wm[i + 3] = Math.round(a * 255);
}
const wordmarkWhite = await trim(await sharp(wm, { raw: { width: W, height: H, channels: 4 } }).png().toBuffer());

const roundedTile = (size, radiusRatio, fill) =>
  Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${Math.round(size * radiusRatio)}" fill="${fill}"/></svg>`);
const transparent = { r: 0, g: 0, b: 0, alpha: 0 };
const white = { r: 255, g: 255, b: 255, alpha: 1 };

async function centered(markBuf, canvas, markWidth, bg) {
  const m = await sharp(markBuf).resize({ width: markWidth, height: markWidth, fit: "inside" }).png().toBuffer();
  const mm = await sharp(m).metadata();
  return sharp({ create: { width: canvas, height: canvas, channels: 4, background: bg ?? transparent } })
    .composite([{ input: m, left: Math.round((canvas - mm.width) / 2), top: Math.round((canvas - mm.height) / 2) }]);
}
async function silhouette(markBuf, canvas, markWidth) {
  const m = await sharp(markBuf).resize({ width: markWidth, height: markWidth, fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < m.data.length; i += 4) { m.data[i] = m.data[i + 1] = m.data[i + 2] = 255; }
  const s = await sharp(m.data, { raw: { width: m.info.width, height: m.info.height, channels: 4 } }).png().toBuffer();
  return sharp({ create: { width: canvas, height: canvas, channels: 4, background: transparent } })
    .composite([{ input: s, left: Math.round((canvas - m.info.width) / 2), top: Math.round((canvas - m.info.height) / 2) }]);
}

const files = {};
files["logo-light.png"] = await buf(sharp(logoT).resize({ width: 800 }));
files["mark.png"] = await buf(sharp(markT).resize({ width: 320 }));
files["wordmark-white.png"] = await buf(sharp(wordmarkWhite).resize({ width: 640 }));
{ // mark on a light rounded tile, for dark surfaces (the navy cap would vanish on navy)
  const tile = await sharp(roundedTile(320, 0.22, "#FFFFFF")).png().toBuffer();
  const m = await sharp(markT).resize({ width: 220, height: 220, fit: "inside" }).png().toBuffer();
  const mm = await sharp(m).metadata();
  files["mark-tile.png"] = await buf(sharp(tile).composite([{ input: m, left: Math.round((320 - mm.width) / 2), top: Math.round((320 - mm.height) / 2) }]));
}
files["icon-32.png"] = await buf(await centered(markT, 32, 28));
files["icon-192.png"] = await buf(await centered(markT, 192, 150, white));
files["icon-512.png"] = await buf(await centered(markT, 512, 400, white));
files["maskable-512.png"] = await buf(await centered(markT, 512, 280, white)); // inside the 80% safe zone
files["apple-touch-icon.png"] = await buf(await centered(markT, 180, 128, white));
{ // Open Graph 1200x630
  const logo = await sharp(logoT).resize({ height: 420 }).png().toBuffer();
  const lm = await sharp(logo).metadata();
  files["og-image.png"] = await buf(
    sharp({ create: { width: 1200, height: 630, channels: 4, background: "#F1F5FF" } }).composite([{ input: logo, left: Math.round((1200 - lm.width) / 2), top: Math.round((630 - lm.height) / 2) }]),
  );
}
const darkTile = await sharp(roundedTile(1024, 0.22, "#FFFFFF")).png().toBuffer();
const mobile = {
  "icon.png": await buf((await centered(markT, 1024, 640, white)).flatten({ background: "#FFFFFF" })), // iOS: opaque, no alpha
  "adaptive-icon.png": await buf(await centered(markT, 1024, 560)), // foreground, inside the 66% safe zone
  "adaptive-icon-monochrome.png": await buf(await silhouette(markT, 1024, 560)), // Android 13 themed icon
  "splash-icon.png": await buf(await centered(markT, 1024, 560)),
  "splash-icon-dark.png": await buf(sharp(darkTile).composite([{ input: await sharp(markT).resize({ width: 600, height: 600, fit: "inside" }).png().toBuffer(), gravity: "center" }])),
  "notification-icon.png": await buf(await silhouette(markT, 96, 72)),
  "favicon.png": files["icon-32.png"],
};
const brandSet = (...names) => Object.fromEntries(names.map((n) => [n, files[n]]));
const targets = {
  "assets/branding/generated": { ...files, ...Object.fromEntries(Object.entries(mobile).filter(([k]) => k !== "favicon.png").map(([k, v]) => [`mobile-${k}`, v])) },
  "apps/web/public/brand": brandSet("logo-light.png", "mark.png", "mark-tile.png", "wordmark-white.png", "og-image.png"),
  "apps/web/public/icons": brandSet("icon-192.png", "icon-512.png", "maskable-512.png"),
  "apps/web/src/app": { "icon.png": files["icon-32.png"], "apple-icon.png": files["apple-touch-icon.png"], "opengraph-image.png": files["og-image.png"] },
  "apps/admin/public/brand": brandSet("logo-light.png", "mark.png", "mark-tile.png", "wordmark-white.png"),
  "apps/admin/app": { "icon.png": files["icon-32.png"], "apple-icon.png": files["apple-touch-icon.png"] },
  "apps/mobile/assets": { ...mobile, ...brandSet("logo-light.png", "mark.png", "mark-tile.png", "wordmark-white.png") },
};
for (const [dir, set] of Object.entries(targets)) {
  await mkdir(out(dir), { recursive: true });
  for (const [name, b] of Object.entries(set)) await writeFile(join(out(dir), name), b);
}
console.log("logo trimmed", logoMeta.width, "x", logoMeta.height, "| files written:", Object.values(targets).reduce((n, s) => n + Object.keys(s).length, 0));
