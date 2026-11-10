# UNIMATE.AZ brand identity

Source of truth: the three originals in `assets/branding/original/` (primary logo, brandmark, identity board). Logo shapes,
colours and proportions are never edited by hand or in code. Everything below is derived from them.

Status: tokens, logo components, icon set, web application and tests are **implemented and tested** (vitest, typecheck, web + admin
builds). Mobile (`app.json`, splash, adaptive icon, theme, `react-native-svg` wrapper) and the real admin UI are **not built yet**; the
icon data and tokens are shaped so they need no new drawings.

## Logo, brandmark, variants

| Asset (`apps/*/public/brand/`) | Size | Use |
| - | - | - |
| `logo-light.png` | 800x665 | Primary stacked logo (mark + UNIMATE.AZ + "Tələbə Platforması") on light backgrounds. Auth, landing, onboarding, error screens, emails (`{{ .SiteURL }}/brand/logo-light.png`). |
| `mark.png` | 320x380 | Brandmark (graduation cap "U") on light backgrounds. Small spaces. |
| `mark-tile.png` | 320x320 | Brandmark on its rounded tile, for dark backgrounds. |
| `wordmark-white.png` | 640x113 | White "UNIMATE.AZ" wordmark for dark backgrounds, always next to `mark-tile.png`. |
| `og-image.png`, `icons/*`, `app/icon.png`, `app/apple-icon.png` | | Social card, PWA/maskable icons, favicons. Generated. |

Rules: keep clear space of at least half the mark height; never recolour, stretch, rotate, add effects or place the light logo on a
dark or busy background; below about 28 px height use the mark alone, not the logo.

Components (`packages/ui/src/Brand.tsx`, exported from `@unimate/ui`):

- `BrandLogo({ label, variant, layout, height })`: `variant` is `light`, `dark` or `auto` (both artworks are rendered and CSS switches them with the
  same selectors as the theme tokens, so `data-theme` overrides and `prefers-color-scheme` both work with no JS and no flash).
  `layout="stacked"` (default): light = `logo-light.png`; dark = `mark-tile.png` above `wordmark-white.png`.
  `layout="row"`: dark lockup side by side (used in the always-dark sidebar and mobile top bar). There is no official horizontal light lockup.
- `BrandMark({ label, variant, height })`: light = `mark.png`, dark = `mark-tile.png`.
- Both set explicit `width`/`height` from the real PNG sizes (no layout shift), `alt=""` on the images and one `role="img"` + `aria-label` on the wrapper.
- In `apps/web` use `AppLogo` (`components/brand.tsx`): it supplies the translated label (`brand.logo`, `brand.mark`).

When to use what: sidebar and mobile top bar = `variant="dark" layout="row"` (these bars are navy in both themes); auth card, landing hero,
onboarding, backend-not-configured = `BrandLogo` auto; 404 and error screens, settings about card = `BrandMark` auto.

## Colours (tokens in `packages/ui/src/styles.css`; TS mirror `BRAND_COLORS` in `icons/paths.ts`)

| Token | Hex | Role |
| - | - | - |
| `--um-indigo` / `--primary` | `#4F46E5` | Brand primary: buttons, links, focus. White text on it is 6.3:1. |
| `--um-purple` | `#7C3AED` | Gradient stop, accents, module tiles. |
| `--um-blue` | `#3B82F6` | Gradient stop, decorative. **Not text-safe** (3.7:1 on white). |
| `--um-cyan` | `#06B6DA` | Decorative accent only. **Not text-safe.** |
| `--um-cloud` / `--bg` | `#F1F5FF` | Light page background. |
| `--um-navy` | `#10182B` | Text on light, sidebar and top bar. Kept from the previous system (the wordmark navy was not re-sampled). |
| `--um-mint` | `#21C9A8` | Auxiliary and success accent. Text uses the deepened `--accent` (`#0A7060` light). |
| `--brand-gradient` | indigo to purple to blue (135 deg) | Sparingly: avatars, progress ring/bars, onboarding steps. Same in both themes. |

Dark theme: `--primary #8E9BFF`, `--primary-hover #A9B3FF`, `--primary-soft #26286B`, `--focus #A9B3FF`, surfaces `#0B1020 / #141B30 / #1A2340`.
The two dark blocks in `styles.css` (media query and `[data-theme="dark"]`) must stay identical.
`packages/ui/src/contrast.test.ts` parses `styles.css` and enforces 4.5:1 for text pairs (3:1 for focus rings) in both themes, plus 3:1 for module tile
gradients against their white glyph and 4.5:1 for labelled file tiles. Add a pair there when you add a text/background token pair.

## Typography

Decision: keep the system font stack (`--font-sans`, `--font-display`: Segoe UI Variable / system-ui). The board's wordmark is a geometric sans
(Montserrat-like) but it exists only inside the logo artwork. Adding a self-hosted variable font would cost payload and needs a licence entry;
revisit only if product wants brand type in headings. Az/Tr/Ru glyph coverage is the reason not to rely on a decorative face.

## Icon system

One drawing per function. Source: `packages/ui/src/icons/paths.ts`, framework-neutral (`{ viewBox: "0 0 24 24", paths: string[] }`,
no React, no CSS variables). Rules: 24 px grid with 2 px padding, stroke `ICON_STROKE` = 1.75 (`--icon-stroke`), round caps and joins, stroke only,
`currentColor`. Sizes: `xs 16, sm 20, md 24, lg 32, xl 48` (`ICON_SIZES`, `--icon-*`). A dot is a zero-length segment (`M12 17h.01`).

Web components (`@unimate/ui`):

- `<Icon name="home" size="md" label? />`: typed `IconName` union, `aria-hidden` unless `label` is given. Renders `<svg>` as a direct child, so it can be styled by its container.
- `<ModuleIcon module="ai-study" size={48} />`: white glyph on a rounded gradient tile (`MODULE_TILES` hex pairs).
- `<FileIcon kind="pdf" />`: accent tile with PDF/DOCX/PPTX/XLSX/ZIP label, glyph for image/video/audio (`FILE_TYPES`; `fileKindFromMime`).
- `<StatusIcon status="success" />`: semantic theme colour (`--accent`, `--info`, `--warning`, `--danger`, `--text-muted`).
- `<LanguageChip code="az" />`: text chip (AZ, TR, EN, RU) with a flat accent stripe. Flags are deliberately not drawn.

Groups follow the board: modules, AI Study, Campus, Notes, Planner, Career, Gamification, system, file types, statuses (`ICON_GROUPS`).
App navigation mapping: home = `home`, Documents = `ai-study`, Flashcards = `flashcard`, Planner = `planner`, Focus = `pomodoro`, GPA = `gpa`,
Settings = `settings`, sign out = `sign-out`, upload = `upload`, empty state = `materials`, error state = `error`, offline = `offline`, toast close = `close`.

### Add an icon
1. Draw it on the 24 grid with stroke only (round caps/joins); add `name: icon("M...", ...)` to `defs` in `icons/paths.ts` (reuse the helpers `circle`, `rect`, `dot`).
2. Add the name to the right `ICON_GROUPS` entry if it belongs to a board group, and to the hard-coded list in `icons/icons.test.tsx`.
3. Use `<Icon name="..." />`. Do not add inline `<svg>` or glyph characters in `apps/web` (`apps/web/src/brand/no-legacy-icons.test.ts` fails).

### React Native (later)
`import { ICON_PATHS, ICON_STROKE, MODULE_TILES, FILE_TYPES } from "@unimate/ui/icons"` (data only, no DOM). A wrapper renders
`<Svg viewBox={d.viewBox}>{d.paths.map(p => <Path d={p} fill="none" stroke={color} strokeWidth={ICON_STROKE} strokeLinecap="round" strokeLinejoin="round" />)}</Svg>`;
module tiles use `expo-linear-gradient` with `MODULE_TILES`. No new drawings needed.

## Web metadata

`apps/web/src/app/manifest.ts` (name UNIMATE.AZ, short_name UNIMATE, theme `#4F46E5`, background `#F1F5FF`, icons 192/512/maskable from `public/icons`),
`viewport.themeColor` (light `#F1F5FF`, dark `#0B1020`), Open Graph and Twitter metadata in `app/layout.tsx` (`metadataBase` from `NEXT_PUBLIC_SITE_URL`,
default `http://localhost:3000`; set it in production so social URLs are absolute), `app/opengraph-image.png` and `app/twitter-image.png`.
Admin: `apps/admin/app/layout.tsx` (title, noindex, theme colour) with favicons from `app/icon.png`/`apple-icon.png`.

## Regeneration

`npm run brand:build` (script `scripts/build-brand-assets.mjs`) rebuilds `assets/branding/generated/*` and copies them to `apps/*/public/brand|icons`
and app icon files. Run it only when the originals change. Then re-read PNG sizes into `BRAND_ASSETS` (`packages/ui/src/Brand.tsx`); `brand.test.tsx` checks the files exist.

## Known limits

- The three originals were received as WebP (board 2000x1125, not 3840x2160). True PNG/SVG originals are needed for a lossless pipeline and a vector logo.
- There is no SVG logo; the logo is a PNG at 800 px wide, fine up to about 400 CSS px on 2x screens.
- The native dark-mode logo is a derivative: `mark-tile.png` (the mark on a white-ish tile) plus `wordmark-white.png`. It is not an official dark lockup; ask the brand owner to confirm.
- No official horizontal light lockup exists, so light surfaces use the stacked logo or the mark alone.
- Module tile colours for Notes, Gamification and Career follow the board's warm/purple tints, darkened for 3:1 contrast with the white glyph; the glyphs are redrawn in a single line style and are not pixel copies of the board's 3D icons.
- Language chips are text, not flags.
- Navy `#10182B` was kept without re-sampling the wordmark.
- Visual QA was done with headless Chrome for sign-in, landing, 404 and a temporary shell/icon gallery (deleted). Dashboard, documents, planner and onboarding pages need a Supabase session and were not rendered with real data.
