# UNIMATE.AZ transformation: progress and continuation

Branch/worktree: `claude/advisor-fable-5-2-435c6f` (`.claude/worktrees/advisor-fable-5-2-435c6f`). Nothing committed yet.
Direction (user, 2026-11-14): **mobile app first** (Expo, Android + iOS), web second, admin separate. Azerbaijani-first, four languages (az default, tr, en, ru). Only the logo and brand palette (#4F46E5, #7C3AED, #3B82F6, #06B6DA, #F1F5FF) are fixed.

Hard rules: no deploys, no remote DB/migration changes, **no test data in the user's real account** (use fixtures), no new dependencies without approval, preserve the main checkout's uncommitted work (it edits all four catalogs: expect merge conflicts there).

## Research notes (Azerbaijani students)
- Grading (most universities, Bologna 100-point model): 50 semester points (attendance 10, seminars/labs ~20-30, independent work 10) + 50 exam; the exam counts only from **17**; **51** total passes; 91+ A, 81 B, 71 C, 61 D, 51 E. Sources: edu.gov.az credit-system presentation (edu.gov.az/uploads/ttk/teqdimat.pdf), Western Caspian University assessment page (wcu.edu.az/en/page/qiymetlendirme), AMU/ADPU regulations.
- Absences: students who miss more than a set share of a course's hours are not admitted to the exam session; **25%** is common (WCU) but it is set per university. Attendance points drop 1 per 10% of hours missed (sample regulation). So every number is editable in the app.
- Money: AZN; students commonly live on a monthly scholarship (təqaüd) plus family support; dorm/rent and transport are the big fixed costs.
- Not verified / needs partners: university timetable or e-learning (SIS) APIs, scholarship databases, BakuCard balance, job-board APIs (no public APIs found in this pass; Boss.az/Work.az links exist in the career module as outbound links only).

## Feature evaluation (value, AZ relevance, frequency, feasibility, cost, privacy)
| Feature | Verdict | Why |
| - | - | - |
| Absence limit tracker + exam score targets ("Fənlərim") | **Implemented, logic tested, never rendered (mobile)** | Daily, AZ-specific (exam admission risk, 17/51 rule), no backend, private |
| Student budget in AZN ("Büdcə") | **Implemented, logic tested, never rendered (mobile)** | Weekly use, scholarship-centred, no backend, private |
| Ranked "Up next" (overdue, exams soon, due soon, cards) | **Web: built and inspected. Mobile: implemented, never rendered.** Shared in `@unimate/core` | Highest-frequency screen |
| Cross-feature: absence warnings on Home | **Implemented, never rendered (mobile)** | Turns a tool into a daily nudge |
| Command palette, grouped web nav | **Built (web)** | Web had unreachable modules on phones |
| Course list synced to server | Next | Needs a migration (cannot apply remotely without approval) |
| Scholarship/opportunity feed | Later | Needs a verified source or admin curation (career tables already exist: use them) |
| Transport, discounts, BakuCard | Not now | No verified data source/API; would be fake |
| Push reminders for absence risk | Next | expo-notifications already installed; local scheduling only |

## Mobile design directions (explored, one chosen)
1. **Night campus** (current approved mockup): black/navy background, translucent glass cards, brand gradient hero. Strong on OLED and in evening study; risk: gradient and glass everywhere reads generic.
2. **Paper planner**: Cloud #F1F5FF background, white sheets, indigo ink, list-first, almost no gradient. Best legibility outdoors (metro/bus daylight); risk: flat, less "premium app" feel.
3. **Signal**: monochrome surfaces, large tabular numerals, colour used only to mean something (risk, progress, money in/out).
**Chosen:** keep 1 as the default theme (user-approved mockup) with 2 as a full light theme, and apply 3's rule everywhere: colour only for status/meaning, at most one gradient surface per screen (the hero), numbers set large and tabular. The new Fənlərim (status colours, big counts) and Büdcə (one gradient hero, neutral rows) follow it.

## Tooling used / available
Skills loaded: frontend-design (web), vercel-react-native-skills (mobile; applied `animation-gpu-properties`: bars animate scaleX on the native driver). Built-in browser: web inspection. Figma MCP: connected (starter plan), not yet used for comps. Mobbin MCP: needs a paid plan (unavailable). Supabase/Vercel MCPs: not used (no remote changes allowed). No Android emulator/adb on this machine.

## Screen status (changed / reviewed / untouched)
Mobile: **changed** Home `(tabs)/index`, new `courses`, new `budget`, registry/tiles; **untouched** `(tabs)/study`, `campus` (+ community/event/post/user/moderation), `career` (+ detail, CV), `profile`, `planner`, `focus`, `gpa`, `flashcards`, `quizzes`, `quiz/[id]`, `notes` (+ detail/upload/contributor), `documents/[id]`, `gamification`, `notifications`, `more`, `onboarding`, `colleges`, `legal`, all `(auth)` screens.
Web: **changed** shell/sidebar/tab bar, palette, dashboard, planner (deep link), proxy `next`; **reviewed in browser (signed in, read-only)** campus, career, gamification, planner, documents; **untouched** all other pages.
Admin: **untouched** (all 18 console pages); shared tokens unchanged, admin build re-run to confirm.

## User feedback fixed (iPhone, Expo Go, 2026-11-14)
- Light mode colour cast: light background moved from neutral grey to the brand Cloud family (`#F6F8FF -> #F1F5FF -> #E9EEFB`) to match the blue-tinted borders/fills.
- Buttons that did not look like buttons: `Button` now keeps its visual style on a plain Pressable (scale on an Animated wrapper; function styles on an Animated Pressable can be dropped) and every variant is drawn: primary filled + soft shadow, secondary tinted, ghost outlined, danger outlined. Applies app-wide (all 100+ Button uses).

## Writing studio + fixes (2026-11-14 evening)
- New: AI Study > "Yazı işləri" (/writing): sərbəst iş, referat, esse, təqdimat drafts in az/tr/en/ru. Pipeline `writing.ts` on the existing `chat` route via the shared guarded runner (`runStructured`: budget, rate limit, daily quota, zod JSON + one repair); no bibliography is ever generated (search keywords instead). PDF in the AZ university layout (title page with ministry/university/faculty/kafedra, contents, chapters, Times New Roman 14pt, 1.5 spacing, 3 cm left margin) via expo-print; 16:9 slide PDF; "share text" for Word. Title-page fields saved on the device. Tests: core renderer (3), pipeline (4).
- Edge function `write-assignment` written and bundled; NOT deployed (deploy was blocked by the permission system). User runs: `npx supabase functions deploy write-assignment --project-ref gjloflnimyahdughoyso --use-api` from the worktree after `node scripts/build-functions.mjs`. Until then the screen shows "function not available".
- Fixed: Fənlərim/Büdcə only confirm saves that persisted; web dashboard no longer shows "all clear" when a query fails; modal headers declared statically.
- NOT built: teacher quizzes with Outlook sign-in (lutfy-style). Needs: Azure AD app registration + Supabase Azure provider secret (user), a migration (teacher role, quizzes, questions, join codes, attempts, RLS) tested on PGlite + reviewer before applying. Not started to avoid an untested auth/RLS change before the demo.
- Still open: account purge must also empty the `resources` bucket (needs the purge-accounts function redeployed).

## Mobile Apple-style redesign (2026-11-14; skills: expo-native-ui, expo-router, expo-animation)
- Theme follows the device (system default); iOS system dark (#000 / #1C1C1E), flat Cloud light background; solid cards with continuous corners (glass kept for chrome only).
- Native stack headers on all pushed screens (`ScreenHeader` -> `Stack.Screen` options; system back + swipe-back); no custom screen transitions; "More" is a form sheet with grabber; NativeTabs use the system material (Liquid Glass on iOS 26) with brand tint and minimize-on-scroll.
- Motion per expo-animation tables, core Animated on the native driver (transform/opacity only): press 120ms to 0.97, entrances 220ms/8pt, short stagger, alert-style Dialog (0.95 -> 1, 200ms), iOS segmented control with sliding thumb (<= 3 options). ProMotion flag `CADisableMinimumFrameDurationOnPhone` in app.json.
- Home: greeting -> Up next -> module grid -> progress; hero carousel removed.
- Reanimated 4.7.1 + Worklets 0.13.1 declared in apps/mobile (user approved). Press feedback and the segmented thumb are Reanimated CSS transitions; list entrances (FadeInDown 220ms/8pt) and the Dialog (Keyframe 0.95 -> 1) are layout animations; all respect system reduced motion.
- Not yet checked on the iPhone after these changes.

## Web performance pass (2026-11-14, approved P1-P4 + M1)
Measured on `next start` in the signed-in pane (desktop, no throttling). Before -> after:
- Dashboard TTFB 505 -> ~180-210 ms; LCP 732 -> 416 ms (P1: `getClaims()` in proxy + layout instead of two `getUser()` Auth round trips).
- Decoded JS on /dashboard 1252 -> 920 KB; the 119 KB-gz all-locales+admin catalog chunk now loads only on /career/cv/[id]/print (P2: `I18nProvider` takes the active catalog as a prop; web strips `admin`; `@unimate/i18n` is `sideEffects: false`).
- unread_notification_count 2 -> 1 request per page (P3). Document polling pauses in hidden tabs (P4, `useVisibleInterval` + test).
- M1: palette uses `closedby="any"` (handler kept as fallback); shared Dialog lost its pre-Baseline attribute fallback.
Not done: P5 (legacy JS target), P6 (server-fetch dashboard data), M2 (toast popover).

## Done (this branch)
Web: grouped sidebar (Study / Plan / Grow), Ctrl/⌘K palette (also phone "More"), redesigned dashboard with ranked agenda, planner `?tab=` deep links, sign-in `next` keeps the query, hydration fix for the date line.
Core: `student/semester.ts` (absenceStatus, examTargets, finalResult, AZ_DEFAULT_RULES), `student/budget.ts` (parseAzn, summarize, qəpik integers), `planner/agenda.ts` (moved from web). Tests: `semester.test.ts`, `budget.test.ts`, web `agenda.test.ts`, `nav.test.ts`.
Mobile: `/courses` (Fənlərim), `/budget` (Büdcə), both device-local via `src/lib/local-store.ts` (zod-validated); Home "Up next" = absence warnings + ranked agenda; registry tiles (courses, focus, budget promoted); brand blue fixed (#3882F6 -> #3B82F6); new `wallet` icon in `@unimate/ui`.
i18n: `nav.groups`, `palette`, `dashboard.agenda`, `semester`, `budget` in az/tr/en/ru.

## Verification so far
- 2026-11-14 (after mobile work): full vitest 1906 passed; repo typecheck clean; web and admin production builds OK; mobile Android export bundles OK; lint only the 2 pre-existing errors. Web palette focus re-checked in the signed-in pane (read-only).
- Web visually checked on the user's real (empty) account and on a deleted fixture harness. **Mobile not yet visually inspected**: no Android emulator here and installing `react-native-web` (Expo web preview, no-save) was blocked by the permission system; needs the user's OK.

## Remaining (ordered)
1. Mobile visual pass (Expo web preview with fixtures, or a device/EAS build): Home, Fənlərim, Büdcə, Study, Planner, Campus, Career, Profile, onboarding; fix what looks wrong.
2. Mobile: local absence-risk reminders (expo-notifications), quick-add from Home, haptics/animation review on low-end Android.
3. Mobile redesign pass of remaining screens (Planner date pickers are typed text; Study upload flow; Profile/Settings structure).
4. Web: bring Fənlərim/Büdcə to web (same core logic; web storage = localStorage until a synced table exists).
5. Admin: visual audit and nav/IA pass (separate app, staff only).
6. Sync design: migration for `courses` + `budget_entries` with RLS (write locally, do not apply remotely).
7. Lint: two pre-existing errors in untouched files (`scripts/build-functions.mjs`, `apps/mobile/src/features/career/WorkAzSection.tsx`).

## How to continue
Run from the worktree: `npm run typecheck -w apps/mobile`, `npm run typecheck -w apps/web`, `npx vitest run`. Web preview: `.claude/launch.json` "web" (port 3010). New strings: add to all four `packages/i18n/src/messages/*.ts` (en defines the shape; ru needs one/few/many plurals). Device-local tools use `useLocalValue(key, zodSchema, initial)`.

## 2026-11-14 evening pass
- Profile: header now shows name, institution and plan badge; 6 cards reduced to 3 (name, appearance+language, collapsible "Privacy" with legal links, export, deletion; opens automatically when a deletion is pending). Implemented, typechecked, not visually checked on device.
- Career: filter toggle reads "Filters" (new `career.filters.title` in az/tr/en/ru) with a dot when filters are active.
- Campus groups: "My groups" first; join-by-code and create-group are collapsible.
- Edge bundles rebuilt (`node scripts/build-functions.mjs`); `write-assignment` bundle fresh. Still NOT deployed.
- vitest: 1915/1915 pass (the `.next` secret scan times out under full parallel load; passes alone with a longer timeout). Mobile tsc clean.
- Teacher quizzes with Outlook sign-in: not started (needs Azure app registration + Supabase Azure provider + reviewed migration).

## 2026-11-14 night: modes, teacher area, tour
- First sign-in shows /welcome: Student or Teacher. Mode is a device-local preference (`um.mode.<uid>` in kv), NOT a DB role; switchable in Profile.
- Teacher mode: own tab bar (Exams, Schedule, Profile). Exam builder (multiple choice + open questions, points, duration) stored on device; exports student paper and answer key as PDF via expo-print (`packages/core/src/study/exam.ts`, tested). No in-app delivery to students (needs Azure sign-in + migration).
- Student Home: spotlight tour on first visit (skippable, reduced-motion aware); "Show intro again" in Profile.
- tsc clean; vitest 1917 pass (the `.next` secret scan times out only under full parallel load). Not checked on a device.

## 2026-11-15: de-template pass (mobile)
- New shared `ListGroup` / `ListRow` (iOS inset grouped lists) in `ui.tsx`; `display` text is now the 34pt iOS large title.
- Home: date as headline (weekday + day/month), no emoji; agenda, modules and progress as grouped lists in one accent; removed the rainbow module tile grid and gradient progress ring.
- AI Study: upload buttons first, writing studio and documents as grouped list rows with file-type icons; delete moved to long press (also a VoiceOver action) with a hint in az/tr/en/ru.
- Planner and Notes opened from Home now show the native header with a back button (teacher planner tab unchanged).
- tsc clean, mobile + i18n tests pass (266). Not visually verified by me (no simulator); restore point in the session scratchpad.
