# UNIMATE.AZ

Study companion for students in Azerbaijan: AI Study (upload documents, summaries, quizzes, flashcards, exam simulation, document chat with citations), Campus (communities, posts, Q&A, events, study groups), Notes library, Planner and GPA, Career (listings, CV builder, interview prep), gamification, and an admin console. Default language is Azerbaijani.

**Honest status:** everything is tested locally only (unit tests plus a PGlite database). Nothing has run against a hosted Supabase project, a real AI provider, Deno edge functions, a device or a browser. See [docs/FINAL_DELIVERY_REPORT.md](docs/FINAL_DELIVERY_REPORT.md).

## Languages
az (default), tr, en, ru. All four are supported across web, admin, mobile, notifications and AI output. az/tr/ru copy needs native-speaker review. See [docs/I18N.md](docs/I18N.md).

## Layout
| Path | Contents |
| - | - |
| `apps/web` | Student web app (Next.js, port 3000) |
| `apps/admin` | Staff console (Next.js, port 3001) |
| `apps/mobile` | Expo / React Native app (Expo Router) |
| `packages/core` | Pure domain logic (quotas, GPA, XP, SRS, AI routing math) |
| `packages/db` | Database tests (PGlite) |
| `packages/pipeline` | Document extraction, RAG, provider adapters |
| `packages/i18n` | Catalogs and locale utilities |
| `packages/ui` | Design tokens, brand components, icons |
| `supabase/` | `config.toml`, `migrations/`, `functions/` (edge), `seed.sql`, auth email `templates/` |
| `scripts/`, `tools/lint/`, `tests/` | Brand asset build, ESLint toolchain, perf and journey tests |

## Quick start
```
npm install
npm test
```
Full setup (Supabase local stack, env vars, running the apps): [docs/LOCAL_SETUP.md](docs/LOCAL_SETUP.md).

## Scripts (root `package.json`)
| Command | Does |
| - | - |
| `npm test` | `vitest run` |
| `npm run typecheck` | `tsc --noEmit` in every workspace |
| `npm run lint` | installs `tools/lint`, runs ESLint |
| `npm run perf` | PGlite hot-path perf smoke ([docs/PERFORMANCE.md](docs/PERFORMANCE.md)) |
| `npm run brand:build` | regenerates brand assets ([docs/BRAND_IDENTITY.md](docs/BRAND_IDENTITY.md)) |
| `npm run build` | builds web and admin |
| `npm run dev -w @unimate/web` / `-w @unimate/admin` | dev servers |
| `npm run start -w @unimate/mobile` | Expo dev server |

## Docs
[LOCAL_SETUP](docs/LOCAL_SETUP.md) | [DEPLOYMENT](docs/DEPLOYMENT.md) | [MOBILE_BUILD](docs/MOBILE_BUILD.md) | [STORE_LISTING](docs/STORE_LISTING.md) | [RELEASE_CHECKLIST](docs/RELEASE_CHECKLIST.md) | [BETA_GUIDE](docs/BETA_GUIDE.md) | [FINAL_DELIVERY_REPORT](docs/FINAL_DELIVERY_REPORT.md) | [AI_PROVIDERS](docs/AI_PROVIDERS.md) | [AI_COST_OPTIMIZATION](docs/AI_COST_OPTIMIZATION.md) | [ADMIN](docs/ADMIN.md) | [ACCOUNT_DELETION](docs/ACCOUNT_DELETION.md) | [POSTGRES15](docs/POSTGRES15.md) | [I18N](docs/I18N.md) | [PERFORMANCE](docs/PERFORMANCE.md) | [DEPENDENCY_AUDIT](docs/DEPENDENCY_AUDIT.md) | [BRAND_IDENTITY](docs/BRAND_IDENTITY.md) | [PROGRESS](PROGRESS.md)
