# Dependency audit (2026-11-10)

Commands: `npm audit` (root workspaces) and `npm audit` inside `tools/lint` (the isolated ESLint toolchain). `npm audit fix` (without `--force`) was run at the root: it changed nothing, because no advisory has a non-breaking fix.

## Remaining advisories: 5 moderate, 0 high, 0 critical (root)

| Package | Severity | Advisory | Why it remains |
| - | - | - | - |
| `minimatch` 7.0.0 - 11.0.0 (installed 10.2.6) | moderate | GHSA-g3hv-75wg-m249: denial of service via globparts amplification | Pulled in by Expo's CLI tooling (`@expo/cli`, `@expo/fingerprint`) through `glob`. npm's only offered fix is `--force`, which installs `expo@53.0.11` (a downgrade across five major versions from the project's `~58.0.23`). Rejected. |
| `glob` 9.0.0 - 14.0.1 (installed 13.0.7) | moderate | GHSA-3g3m-2fjr-6pw4: AbortSignal cancellation bypass allows filesystem traversal after a timeout | Same chain as above. |
| `@expo/cli`, `@expo/fingerprint`, `expo` | moderate | Transitive: depend on the vulnerable `glob` / `minimatch` | Same chain; fixed upstream only by a newer Expo release than 58.x. |

Exposure assessment: all five are in the Expo build/dev tooling (`expo export`, Metro, the CLI), run on developer and CI machines against our own source tree. The shipped mobile bundle does not include `glob` or `minimatch`. Neither advisory is reachable from untrusted input in that setting (the globs and patterns come from our config). Action: update Expo when a release bumps `@expo/cli`'s `glob` to a patched version, then re-run `npm audit`.

## `tools/lint` (dev-only ESLint toolchain): 10 moderate

The same `minimatch` advisory, reached through `eslint` (`@eslint/config-array`) and `typescript-eslint` (`@typescript-eslint/typescript-estree`). The "fix" npm offers is a downgrade to `eslint@9.39.5` / `typescript-eslint@8.36.0`, which is wrong direction and is not applied. Exposure: linting our own files locally and in CI only; nothing from this toolchain is shipped. Re-check on the next `eslint` / `typescript-eslint` release.

## Notes

- Application runtime packages (`next`, `@supabase/*`, `zod`, `react`, `unpdf`, `fflate`, `tesseract.js`) report no advisories.
- `tesseract.js` has an install script (`opencollective-postinstall`) that npm warns is not yet approved under `allowScripts`; it only prints a funding message and is harmless. Decide whether to approve or block it.
- `typescript-eslint` does not yet support TypeScript 7 (native compiler, no JS API). That is why ESLint is installed in `tools/lint` with TypeScript 6.0.3 and is not a root workspace; the repository itself still compiles with TypeScript 7.
