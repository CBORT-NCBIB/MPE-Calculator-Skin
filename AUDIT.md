# Pre-Submission Audit — MPE-Calculator-Skin

Adversarial review of `CBORT-NCBIB/MPE-Calculator-Skin` at `main` = `3bf27c9` (2026-05-28),
performed 2026-07-26 ahead of an intended JOSS submission. This document records ground
truth (Phase 0) and the findings of five review passes (Phase 1). No repository file other
than this report and `FIX_PLAN.md` was modified. Severities: **Blocker** (would stop a JOSS
review or is a safety-relevant correctness defect), **Major** (a reviewer would file an
issue and wait), **Minor** (a reviewer would note it), **Nit**.

Method notes and limits of this audit:

- All commands were run in a fresh clone under a clean virtual environment (Python 3.11.15,
  Node 22.22.2, npm 10.9.7). CI uses Node 20; no Node-version-sensitive behavior was
  observed. Full logs are preserved in the session scratchpad (`repro/logs/`).
- The sandbox's egress proxy blocks `unpkg.com` and `cdn.jsdelivr.net`. This prevented an
  in-sandbox Playwright e2e run against the CDN-loading page (the suite passes on real CI,
  verified from the Actions history), and it incidentally provided an authentic test of the
  page's offline behavior. Functional browser testing was done by vendoring the same
  pinned library versions from the npm registry and pointing a copy of the page at them.
- No paper copy of ICNIRP 2013 (Health Phys 105(3):271–295) is available in this
  environment; `joss.readthedocs.io`/`joss.theoj.org` are also proxy-blocked. Numerical
  verification is against my working knowledge of the standard cross-checked with
  secondary sources retrieved via web search, and every proposed change to a physical
  value is gated on author confirmation against the printed standard (see FIX_PLAN, NEEDS
  AUTHOR). Nothing in this audit silently trusts a remembered constant: findings state
  what was checked and how.
- One correction made during the audit itself: the session's working clone was created
  without tags, so an early draft of §0.1 reported "0 tags". A direct `git ls-remote`
  against the remote revealed three tags (and disconnected pre-main history); §0.1 below
  reflects the corrected remote-verified facts.

---

## Phase 0 — Ground truth

### 0.1 Development history (JOSS screening gate)

Evidence, gathered from `git` and the GitHub API:

```
GitHub repo    created 2026-03-23, public, org CBORT-NCBIB; 1 star; 0 forks;
               no description, no homepage, no topics
tags           3 annotated tags, each pointing at a SINGLE PARENTLESS SNAPSHOT
               commit with no history and no connection to main:
                 v1.0.0  2026-03-28  (1 commit, "v1.0.0: General MPE calculator")
                 v2.0.0  2026-03-30  (1 commit, message still says "v1.0.0: …")
                 v3.0.0  2026-04-02  (1 commit, "v3.0.0 audit fixes: C_A→Cₐ …")
releases       0 GitHub Releases (tags were never released or archived)
main branch    restarted 2026-04-15 as its own snapshot (root commit cb4ea96,
               "Add scanning sub-tabs and visual refresh" — not an initial-commit
               message); NO common ancestor with any tag
main commits   59, 2026-04-15 → 2026-05-28 (43 days; 2026-04: 32, 2026-05: 27;
               nothing since)
contributors   1 person under 3 emails: isaac@mgb.org,
               igallegos@mgh.harvard.edu, isaactgall@gmail.com
issues         0 (open or closed)
pull requests  3, all authored by the maintainer (itgall) and self-merged
               (#1 2026-05-11, #2 2026-05-14, #3 2026-05-22)
```

So the full public record is: three history-less snapshot uploads across the first ten
days (Mar 28 – Apr 2), then a fresh 59-commit line over 43 days (Apr 15 – May 28) that is
disconnected from those snapshots, then two months of silence. Real development visibly
predates main's root — but none of its day-by-day history is public, and the default
branch's log begins mid-project.

The current JOSS criteria (retrieved 2026-07-26 via web search of
`joss.readthedocs.io/en/latest/review_criteria.html` and the January 2026 JOSS blog post
"Preparing JOSS for a generative AI future"; direct fetch is blocked from this sandbox)
include, for substantial scholarly effort and its screening:

- a rule-of-thumb minimum of **three months of work** for an individual;
- for software developed privately and made public later, **public availability with
  demonstrated use for at least six months**;
- evidence of **sustained development over time** ("preferably months or years") rather
  than rapid, recent code generation;
- **community engagement** (multiple developers, issues/discussions from external users);
- and an explicit desk-rejection trigger: reviewers who find *"a repository made public
  days before submission, or a commit history concentrated into a short window"* are told
  to flag it to the handling editor immediately, who *"can then close the review and issue
  a desk rejection."*

**Verdict: (c) — the timeline gate is not met today, and submission now risks desk
rejection regardless of code quality.**

The public record is a textbook instance of the pattern the 2026 criteria name: the
default branch's history is 59 commits concentrated in a 43-day window, by one person,
followed by two months of silence — and the only earlier public evidence is three
history-less snapshot commits. Snapshot-style tags disconnected from the default branch
read to a reviewer as "the code arrived; its history did not", which is precisely the
profile the private-then-public clause exists for: it asks for **public availability with
demonstrated use for at least six months**, and there is no demonstrated use on record —
0 issues, 0 forks, 1 star, all PRs self-merged, 0 Releases. The six-month public mark
itself arrives 2026-09-23, but public *age* alone does not satisfy the clause.

What would genuinely strengthen the gate (in decreasing order of weight):

1. Real external use: even one outside lab opening issues, or a documented deployment,
   converts "0 community signals" into evidence. The paper's own placeholder text
   (`paper.md:77`) suggests such users may exist (a group in Spain, a co-author's
   publication); if true, getting them onto the public record (issues, citations,
   discussions) is worth more than any code fix in this audit.
2. If a fuller day-by-day history exists (the tags prove work predates main's root, and
   main's own root is a mid-project snapshot), publishing that original history — or at
   minimum explaining the restart in the README — converts the disconnected-snapshot
   liability into ordinary provenance. NEEDS AUTHOR: does such a history exist?
3. Sustained visible activity between now and submission: the fix plan in `FIX_PLAN.md`,
   executed as reviewable increments over weeks rather than one burst, is itself evidence
   of sustained development.
4. A real, archived Release: v1–v3 tags exist but no GitHub Release or Zenodo DOI was
   ever cut, and the current tags point off-branch. Tag the post-fix state on `main` and
   archive it.
5. Waiting until at least 2026-09-23 (six months public) before submitting, with 1–4
   accrued in the interim.

This finding outranks everything else in this audit.

### 0.2 Inventory and reproduction

**Inventory.** 90 tracked files. Approximate line counts of the load-bearing parts:

| Area | Files | Lines |
|---|---|---|
| Python package `src/laser_mpe/` | 6 + `py.typed` | 1,162 |
| Python tests `tests/*.py`, `tests/lsp/`, `tests/conformance/` | 7 | ~2,900 |
| JS engine `web/engine.js` | 1 | 3,424 |
| React UI `web/calculator.jsx` | 1 | 7,798 |
| LSP subsystem `web/lsp/*`, `web/lsp.worker.js` | 5 | ~3,580 |
| JS/Node tests `tests/*.mjs`, `tests/lsp/*.mjs` | 12 | ~6,000 |
| e2e `tests/e2e/` + config | 7 | ~900 |
| Generated, committed | `web/index.html` | 23,828 (1.19 MB) |
| Standards data | `web/standards/*.json` | 2 files (ICNIRP 2013, ANSI Z136.1-2022) |
| Docs/meta | README, docs/, paper/, CHANGELOG, CONTRIBUTING, CITATION.cff | ~900 |

Committed derived artifacts and their reproducibility status:

| Artifact | Reproducible from source? |
|---|---|
| `web/index.html` | **Not byte-reproducible.** Rebuild with today's toolchain differs in 8 lines (+184 B), entirely inside the esbuild-minified Ajv bundle — `esbuild` is specified as `^0.28.0` with no lockfile (`package-lock.json` is gitignored; CI runs `npm install`, not `npm ci`). The application-source part (engine, compiled JSX) showed no drift at HEAD. See E-3. |
| `tests/outputs/*.txt`, `tests/outputs/SUMMARY.txt` | **Stale.** Reference test-class names that no longer exist (`TestICNIRP_400_1400` vs current `Test_400_1400`), a test that no longer exists (`test_nm_um_equivalence`), count "39 passed" for a file that now has 38, and "All 330 checks pass across 4 test suites" — while `README.md:158` says 126 and `CHANGELOG.md:99` says 329. See D-20. |
| `examples/outputs/*.txt` | **Current.** Three of four are byte-identical to fresh runs; `mpe_comparison_output.txt` differs only in its last line ("Plot saved…") because it was generated with matplotlib installed (matplotlib is not a declared dependency; the script degrades gracefully without it). |
| `tests/conformance/corpus.json` | Reproducible by `generate_conformance.mjs` — but generated **by the JS engine**, see B-2. |
| `docs/requirements_traceability.json` | Cites test evidence that does not exist in the repository. See D-22. |

**Fresh-clone install, exactly as README instructs.**

- The README's clone command (`README.md:74` and `:86`) points at
  `github.com/itgall/MPE-Calculator-Skin.git` — the wrong owner. The canonical repo is
  `CBORT-NCBIB/MPE-Calculator-Skin`. A reviewer's first copied command fails or fetches a
  personal fork. The same wrong owner appears in `CITATION.cff:8`, `pyproject.toml:41-43`,
  and `package.json:10` — 7 occurrences across 5 files. (Cloning was done from a local
  mirror to proceed.)
- "For users" path (`pip install -e .`): succeeds; `import laser_mpe` works;
  `skin_mpe(532, 10e-9)` returns 0.02 J/cm² as documented. But the README's Testing
  section (`README.md:161`) then instructs `pytest tests/ -v`, which fails with
  `No module named pytest` — pytest lives only in the `[test]` extra that the users path
  never installs.
- "For contributors" path (`pip install -e ".[test]"`): succeeds.

**Test suites, actual counts (this environment, fresh clone at HEAD):**

| Suite | Command | Result | Time |
|---|---|---|---|
| Python (pytest) | `pytest tests/ -v` | **126 passed** (38 `test_skin_mpe` + 32 `test_skin_parameters` + 1 `test_correction_factors` + 55 parametrized `tests/lsp/test_schema.py`) | 0.3 s |
| — collection side effects | | `tests/conformance/test_conformance_py.py` contributes **0 collected tests**: its 101 cases execute at import time during collection and can only fail via `sys.exit(1)`. `tests/verify_exhaustive.py` (254 checks) is **never collected** (doesn't match the `test_*.py` glob) and never runs in CI. | |
| JS engine | `node tests/test_engine_js.mjs` | 78 passed | <1 s |
| Tracer | `node tests/test_tracer.mjs` | 63 passed — **but crashes with MODULE_NOT_FOUND unless `npm install` has been run in `web/` first**; no doc says so, and CI never runs this suite | |
| Tracer stage 2 | `node tests/test_tracer_stage2.mjs` | 54 passed (same undocumented dependency) | |
| T_point | `node tests/verify_Tpoint.mjs` | runs, prints a table, **contains zero assertions** — cannot fail | |
| T_point edge cases | `node tests/verify_Tpoint_edge_cases.mjs` | 18 passed | |
| Cross-language conformance (JS) | `node tests/conformance/test_conformance_js.mjs` | 101 passed — tautological, see B-2 | |
| LSP validate / factory / canonicalize / worker | | 43 / 48 / 52 / 31 passed | |
| LSP bundle / UI helpers (post-build) | | 9 / 40 passed | |
| Build | `python3 web/build.py` (after `npm install` in `web/`) | exit 0, ~1 s, Babel path taken; rebuilt `index.html` ≠ committed (Ajv-bundle minification drift only) | |
| Examples | all four | pass; three outputs byte-identical to committed | |
| e2e | `npx playwright test` | **Not completable in this sandbox**: the page loads React/Recharts/echarts from `unpkg.com`/`cdn.jsdelivr.net`, which the sandbox proxy blocks, so every test times out waiting for mount. Authoritative evidence is CI: the `e2e-tests` job on HEAD run 26592654550 passed (25 tests, 18 s). A version note: `@playwright/test` is specified `^1.49.0` and resolved to 1.62.0 here — another floating-dependency data point. | |

**Browser pass** (vendored copies of the same pinned CDN libraries, served locally;
exploratory script, not assertions):

- App mounts; title "Laser Skin MPE Calculator". All three tabs (MPE Calculator, Scanning
  Protocols, Photoacoustic SNR Optimizer) and all three scanning sub-tabs (General, OCT,
  Photoacoustic) render and switch.
- Exports genuinely work: 7 download events captured — `mpe_vs_wavelength.csv`,
  `mpe_vs_wavelength.svg`, `mpe-report.html` (×2 buttons), `mpe-trace-<hash>.json`, and
  the SVG/CSV pair again from a second chart. A default-state MPE result renders.
- Theme toggle button present ("☾"). UI strings include decorative glyphs
  (⇅ ☾ 🔍 ⤓ ▶) — see D-9.
- Console: no application errors (one `ERR_CONNECTION_RESET` for a Google-Fonts
  subresource, a sandbox artifact).
- **Offline behavior, authentic test**: loading the unmodified `web/index.html` with CDNs
  unreachable leaves `#root` empty and shows "Failed to load: React, ReactDOM, PropTypes,
  Recharts, echarts." This directly falsifies `README.md:29`/`:93` ("No Python
  installation, server, or build step is required" / self-contained) and
  `web/README.md:44` ("completely self-contained") as an offline claim. See E-5.

**CI verification.** `.github/workflows/ci.yml` defines 5 jobs (python-tests ×4 matrix,
python-lint, js-tests, e2e-tests, build). The HEAD run (26592654550) shows all 8 job
instances green, and the job steps match the workflow file. A genuinely red run exists in
history (run 26540847672 on `8919809`, failed by ruff, fixed in the next commit), which
demonstrates that a failure does fail the build. Gaps: 5 JS suites and
`verify_exhaustive.py` are not wired into any job (see D-18/E-7), and the build job checks
9 grep markers but never diffs the rebuilt `index.html` against the committed one (E-3).

### 0.3 README claim-by-claim verification

Every checkable factual claim in `README.md`, against this audit's runs. ✔ = verified
true, ✘ = false, ◐ = partly true / misleading.

| Line | Claim | Verdict | Evidence |
|---|---|---|---|
| 8 | overview image exists | ✔ | `docs/images/skin_mpe_overview.png` present |
| 17 | wavelength coverage 180 nm–1000 µm | ✔ | JSON `wl_range_nm: [180, 1000000]`; probed both edges |
| 18 | durations 10⁻⁹–3×10⁴ s | ◐ | lower edge inclusive; **t = 30000 s returns NaN** (strict `<` at every region), contradicting the declared inclusive range and `docs/API.md:20`. See A-3. |
| 20 | UV dual-limit logic | ✔ | `min(thermal, photochemical)` verified at the crossover and against Table 5 |
| 21 | Cₐ over 400–1400 nm | ✔ | endpoints probed; C_A(700)=1, C_A(1050⁻)=5.0119, C_A(1050)=5, C_A(1400)=5 |
| 22 | "Rule 1 … and Rule 2 (average power), " | ◐ | trailing comma + space; reads as truncated text (D-4) |
| 23 | T_max, apertures, large-area, UV de-rating | ◐ | features exist; **T_max is not an ICNIRP value** by the data file's own admission, and `get_Tmax_skin(250)`→30000 s feeds `skin_mpe` NaN (A-3, C-9) |
| 25 | "**Verified:** verification scripts compare to the ICNIRP standard" | ◐ | scripts compare the engine to constants transcribed by the same project, and the largest one never runs in CI (D-18); the cross-language corpus is generated by the JS engine (B-2) |
| 27–49 | first "Web Calculator" section: 3 tabs, CSV/SVG export | ✔ | all confirmed in browser pass |
| 29 | "No Python installation, server, or build step is required." | ◐ | true only online; page is CDN-dependent and fails offline (E-5) |
| 33 | limiting-aperture logic in beam evaluation | ✔ | UI shows "Limiting aperture: 3.5 mm (skin, ICNIRP 2013 Table 8)" |
| 41 | "analytical Gaussian cross-check ensuring grid approximations never cause unsafe underestimates" | ✘ | conditional on `scan_params` (engine.js:2776); the test named "never underestimates" accepts a 5 % underestimate (test_engine_js.mjs:680-681); the engine's own comment admits the cross-check may not match custom-path geometry and cites a document that does not exist (A-13, A-14) |
| 45 | "high-PRF systems (100–400 kHz) via pulse subsampling" | ◐ | subsampling exists; the numbers 100–400 kHz appear nowhere in the code (actual knobs: `DEFAULT_MAX_COMPUTE_PULSES`=500000, `OP_BUDGET`=40e6) |
| 48 | PA optimizer "based on the Francis et al. framework" | ✘ (unverifiable) | "Francis et al. (2026)" has no title, venue, or DOI anywhere in the repo; cited 4× (README:48, CITATION.cff:17, CHANGELOG:71 "Equations 5–12", web/README.md:36). A-17. |
| 52 | "All values are verified against the loaded standard (default: ICNIRP 2013)." | ✘ | falsified by the data file itself for T_max: `icnirp_2013.json` `t_max.description` says the values are "conservative engineering guidance for typical scenarios, **not directly from a specific ICNIRP 2013 table**". `docs/API.md:90` repeats the misattribution ("T_max (default, ICNIRP 2013)"). C-9. |
| 58 | T_max row in Standards Compliance table | ✘ | same as above |
| 61 | large-area correction threshold "100 cm²" | ◐ | correct for ICNIRP, but hard-codes a standard-specific value the project elsewhere claims lives only in JSON (`CHANGELOG.md:50`) |
| 64 | "Boundary conventions follow the standard exactly: t₁ ≤ t < t₂ and λ₁ ≤ λ < λ₂." | ✘ | the code deliberately deviates at the top wavelength edge: last-band/last-region inclusive-upper via float `==` (`engine.py:194, 322`); the JSON's own C_A note reads "1050 ≤ λ ≤ 1400 nm"; and t = 30000 s is excluded everywhere despite the declared range (A-3, A-15) |
| 74, 86 | clone URLs | ✘ | wrong owner `itgall` (Phase 0.2) |
| 76/88 | `pip install -e .` / `-e ".[test]"` | ✔ | both succeed |
| 97–98 | Python ≥ 3.9, NumPy ≥ 1.21 | ✔ | matches `pyproject.toml`; CI matrix 3.9–3.12 |
| 102 | `docs/API.md` is "a complete list of every function" | ✘ | exported `band_name` and `rep_pulse` are absent from API.md (C-8) |
| 111/115 | quick-start outputs 20.00 / 100.00 mJ/cm² | ✔ | reproduced exactly |
| 120–132 | `per_pulse_MPE` example | ◐ | runs, but has a dangling argument slot (blank line before `)`), and unlike the other examples prints nothing (D-5) |
| 145 | `get_Tmax_skin(800)` → "600 s for NIR" | ◐ | returns 600, but the value is not ICNIRP-sourced (C-9) |
| 148–153 | aperture / conversion snippets | ✔ | behave as shown |
| 158 | "Python tests (126 checks)" | ✔ | 126 collected and passed — **but the number has already drifted once** (git history shows 71→126 hand-edits), and two sibling artifacts contradict it (SUMMARY.txt "330", CHANGELOG "329") |
| 164/217 | "JavaScript engine tests (78 checks)" | ✔ | 78 passed |
| 170 | "cross-language equivalence (20 boundary points verified against Python)" | ✘ | the 20 expected values are hard-coded literals in the JS file; Python is never executed by that test. The real 101-case conformance corpus exists but is unmentioned — and is itself generated by the JS engine (B-2). This audit's dense differential (25,452 finite points) found max relative discrepancy **2.9 × 10⁻¹⁶** (B-1), so the claim is also a massive understatement. |
| 172–181 | e2e "25 checks", commands | ✔ | 25 tests; pass on CI |
| 184–189 | CI description | ◐ | trigger description accurate; job list omits the LSP suites CI does run, and none of the tracer/T_point/conformance-JS suites are in CI at all |
| 191 | "Python test outputs are available in tests/outputs/" | ✘ | stale, see 0.2 |
| 196–231 | package-structure tree | ✘ | comment columns misaligned at :201-203; omits `paper/`, `tests/conformance/`, `tests/lsp/`, `web/lsp/`, `web/standards/ansi_z136_2022.json`, `CHANGELOG.md`, `package.json`, `playwright.config.ts`, `scripts/`, `.github/` — including the JOSS submission directory itself |
| 234–236 | second "Web Calculator" section: "dark/light theme, shareable URLs, and PDF export" | ✘ | duplicate section; **shareable URLs and PDF export do not exist** (0 code hits for URL-state or jsPDF; browser pass found no such buttons). `CHANGELOG.md:99` records these exact claims as already removed — from `web/README.md`; the root README kept them. |
| 238–247 | "Project Outline" checkbox roadmap | ◐ | exists; final unchecked item is "JOSS paper submission" (D-3) |
| 255 | "cite using CITATION.cff" | ◐ | the file credits only the entity "OCT Research", no humans, no ORCIDs (C-11) |
| 259 | MIT license | ✔ | proper OSI text in `LICENSE` |
| 261–263 | safety disclaimer | ✔ (keep) | substantive and appropriate; slightly over-stacked (D-16) |
| 267–269 | ICNIRP reference | ◐ | no DOI (10.1097/HP.0b013e3182983fd4), double space, "1,000 um", no volume/pages |
| 273 | five authors | ◐ | disagrees with `paper.md` (4 authors — no Nicholas Borges) and with `CITATION.cff` (0 humans) and with `LICENSE` (1 person) — four different answers (C-10) |

---

## Pass A — Numerical and physical correctness

Verification basis: ICNIRP 2013 (Health Phys 105(3):271–295), verified against the primary
source — the full standard PDF supplied by the author. Skin UV limits equal the ocular
limits of Table 5 (the standard sets them equal over 180–400 nm); the visible/NIR/FIR skin
limits are Table 7; apertures are Table 8.

> **CORRECTION (post-review, against Table 5).** An earlier draft of this pass raised two
> UV findings — A-1 (Blocker) and A-2 (Minor) — on the belief that the photochemical
> constant region should end at 302.5 nm. **Both are WITHDRAWN.** Table 5 of the supplied
> standard uses integer-nanometre bins: 30 J/m² for `180 ≤ λ < 302`, then `302 ≤ λ < 303`
> → 40 J/m², … `312 ≤ λ < 313` → 4.0 kJ/m², and a single `313 ≤ λ < 315` → 6.3 kJ/m² bin.
> `icnirp_2013.json` encodes exactly this. The "302.5" was a reviewer mis-recollection of
> the older ACGIH/actinic-UV boundary, which does not apply to this table. No physics was
> changed on the strength of that memory: per Standing Rule 5 the change was gated on the
> printed table, and the table refuted it. The rows and findings below are corrected in
> place.

### A-0. Constants table (icnirp_2013.json vs. ICNIRP 2013)

| Quantity | Code value (JSON) | Standard value | Clause/table | Match? |
|---|---|---|---|---|
| UV thermal limit, 180–400 nm, 10⁻⁹ ≤ t < 10 s | 0.56·t^0.25 J/cm² | 5.6·t^0.25 kJ/m² | Table 5 / Table 7 (UV = ocular) | ✔ |
| UV photochemical, 180 ≤ λ < 302 nm | 30 J/m² | 30 J/m² for 180 ≤ λ < 302 nm | Table 5 | ✔ |
| UV photochemical ladder, 302–313 nm (integer-nm bins) | [302,303)→40 … [312,313)→4000 J/m² | same, integer-nm bins from 302 | Table 5 | ✔ |
| UV photochemical, 313 ≤ λ < 315 nm | 6300 J/m² (single bin) | 6.3 kJ/m² (single bin, 313 ≤ λ < 315) | Table 5 | ✔ |
| UV photochemical, 315–400 nm, t ≥ 10 s | 10⁴ J/m² (`below_t_min: not_applicable`) | 10⁴ J/m² (10 s–3×10⁴ s) | Table 5 | ✔ |
| Vis/NIR 400–1400 nm, 10⁻⁹ ≤ t < 10⁻⁷ s | 0.02·C_A J/cm² | 200·C_A J/m² | Table 7 | ✔ |
| Vis/NIR, 10⁻⁷ ≤ t < 10 s | 1.1·C_A·t^0.25 J/cm² | 11·C_A·t^0.25 kJ/m² | Table 7 | ✔ |
| Vis/NIR, 10 ≤ t < 3×10⁴ s | 0.2·C_A·t J/cm² (= 0.2·C_A W/cm²) | 2·C_A kW/m² | Table 7 | ✔ |
| C_A: 400–700 / 700–1050 / 1050–1400 nm | 1.0 / 10^(0.002(λ−700)) / 5.0 | same | Table 7 (C_A definition) | ✔ (step at 1050 nm is the standard's own rounding of 10^0.7; A-18) |
| FIR 1400–1500 nm: t<10⁻³ / 10⁻³–10 / ≥10 s | 0.1 J/cm² / 0.56·t^0.25 / 0.1·t | 1 kJ/m² / 5.6·t^0.25 kJ/m² / 1 kW/m² | Table 7 | ✔ |
| FIR 1500–1800 nm: 10⁻⁹–10 / ≥10 s | 1.0 J/cm² / 0.1·t | 10 kJ/m² / 1 kW/m² | Table 7 | ✔ |
| FIR 1800–2600 nm | as 1400–1500 | same | Table 7 | ✔ |
| FIR 2600 nm–1 mm: t<10⁻⁷ / 10⁻⁷–10 / ≥10 s | 0.01 J/cm² / 0.56·t^0.25 / 0.1·t | 100 J/m² / 5.6·t^0.25 kJ/m² / 1 kW/m² | Table 7 | ✔ |
| Limiting apertures: 3.5 mm (<100 µm), 11 mm (0.1–1 mm) | JSON `supplementary` ✔; **also hardcoded as silent fallbacks** in `web/engine.js:917,937` | 3.5 / 11 mm | Table 8 (skin column) | values ✔; architecture ✘ (A-8) |
| Large-area correction: threshold 100 cm², cap 1000 cm², cap 10 mW/cm², coefficient 10000 mW·cm⁻²·cm² | JSON ✔; **thresholds duplicated as `.get()` defaults** in `skin_parameters.py:126-128` | 0.01 m² / 0.1 m² / 100 W/m² | Table 7 note c | values ✔; architecture ✘ (A-8); applicability gates missing in the exported Python function (A-7) |
| UV successive-day de-rating: ×0.4 (=1/2.5), 280–400 nm | JSON ✔; duplicated as defaults `skin_parameters.py:170-172` | factor 2.5 reduction | §"Repeated exposures of the skin" | ✔ values; architecture ✘ (A-8) |
| T_max lookup (30000 / 600 / 600 / 10 s) | JSON `supplementary.t_max` | **no ICNIRP source** — the JSON itself says so | — | see C-9; and A-3 for the 30000 s composition bug |
| Rule 3 (N^−1/4) excluded for skin | prose only (`repetitive_pulse.py:6-8`, JSON `repetitive_pulse_skin` block that no code reads) | Rule 3 not applied to skin | §"Repetitively pulsed exposure" | ✔ intent; enforcement is by omission, not data (A-11) |

### A-1. ~~Blocker~~ — WITHDRAWN. UV photochemical boundary is 302 nm and the code is correct.

Original claim: the 30 J/m² constant region should end at 302.5 nm, making `skin_mpe(302.4, ·)`
= 0.004 non-conservative by ×1.33. **Refuted against ICNIRP 2013 Table 5** (supplied PDF,
p.283): the region is `180 ≤ λ < 302` → 30 J/m², and `302 ≤ λ < 303` → 40 J/m² — integer-nm
bins, boundary at 302, not 302.5. `skin_mpe(302.4, 100 s)` = 0.004 J/cm² is the correct
Table-5 value. `icnirp_2013.json`, `verify_exhaustive.py:156`, and the corpus are all
faithful. No change. (Root cause of the false finding: the reviewer applied the older
ACGIH/actinic 302.5 nm anchor from memory; the standing rule to gate on the printed table
prevented a bad edit.)

### A-2. ~~Minor~~ — WITHDRAWN. The `313 ≤ λ < 315` bin at 6.3 kJ/m² is correct.

Original claim: `[314, 315)` should be 10⁴ J/m², not 6300. **Refuted against Table 5**:
`313 ≤ λ < 315` is a single bin at 6.3 kJ/m² (= 0.63 J/cm²); the 10 kJ/m² value applies to
`315 ≤ λ < 400`, not to [314,315). `skin_mpe(314.5, 100 s)` = 0.63 is correct. No change.

### A-3. **Blocker.** t = 3×10⁴ s is excluded by every region, contradicting the declared domain — and the package's own T_max composes to NaN

- `standard.dur_range_s` declares `[1e-9, 30000]`; `docs/API.md:20` documents the same
  inclusive range; every region test is `t_min ≤ t < t_max` (`engine.py:266`), so
  `skin_mpe(λ, 30000)` = NaN for every λ.
- Composition bug, demonstrated live: `get_Tmax_skin(250)` → 30000.0 (the package's own
  recommended maximum exposure duration for UV), then `skin_mpe(250, 30000.0)` → **NaN**.
  Two documented public APIs, composed as any user would, produce NaN with no diagnostic.
  Same in JS. Also breaks `per_pulse_MPE(..., T=30000)` (Rule 2 basis NaN → NaN result).
- Fix: make the top duration edge inclusive (mirroring the existing inclusive-upper
  handling of the top wavelength edge), pin with tests at 29999.999/30000/30000.001, and
  cite the Table 7 duration column upper bound (3×10⁴ s) in the change.

### A-4. **Blocker.** A missing/misspelled discrete-lookup table silently degrades UV limits to thermal-only — 140× too permissive — and both validators accept it

- Demonstrated: rename the `uv_discrete_steps` table in a copy of the standard;
  `validate_standard()` returns **zero errors** in Python; `loadStandard()` in JS also
  reports zero errors; `skin_mpe(302, 1 s)` then returns 0.56 J/cm² instead of 0.004 —
  **140× the correct limit** — because `_uv_discrete_lookup` returns NaN
  (`engine.py:220-222`) and `_eval_dual_limit` (`engine.py:285-290`) treats a NaN
  photochemical limit as "absent" and returns the thermal limit alone.
- This is the exact failure mode the project's "copy the JSON and edit it" extensibility
  story (`web/standards/README.md`) invites, and it fails in the dangerous direction.
- Fix: both validators must resolve every `discrete` region's `lookup` key at load time;
  `_eval_dual_limit` must treat NaN-from-lookup as an error, not an absent limit. Pin
  with a test that loads a broken standard and expects a load-time failure.

### A-5. **Blocker.** JS `getAperture()` returns 11 mm for garbage input; Python raises — divergent, silent, non-conservative

- Measured (JS): `getAperture(NaN)` = 11, `getAperture(-1)` = 11, `getAperture(0)` = 11,
  `getAperture(5)` = 11, `getAperture(2e6)` = 11. Python `get_skin_limiting_aperture`
  raises ValueError for 0/−1/NaN/2e6 — and silently µm-guesses 5 → 3.5 mm (A-9).
- Aperture area scales permissible energy in the beam evaluation
  (`beamEval`/max-permissible-pulse-energy): 11 mm vs 3.5 mm is a (11/3.5)² ≈ **9.9×
  overstatement** of permissible energy if a NaN/out-of-range wavelength ever reaches the
  engine. No UI guarantee prevents that (free-text numeric fields).
- Fix: JS aperture selection must fail closed (throw or return NaN that the caller
  surfaces) on unmatched wavelength, matching Python's raise; add engine tests both sides.

### A-6. Major. `ca()` returns 1.0 for any invalid/out-of-range wavelength (both engines)

`ca(NaN)` = `ca(-1)` = `ca(1400.0001)` = `ca(2e6)` = 1.0 via `default_outside_range`
(`engine.py:204`). Inside `skin_mpe` this is masked (band dispatch already returned NaN),
but `ca`/`CA` is exported and documented standalone: a caller who passes µm (0.8 for
800 nm) gets C_A = 1.0 instead of 1.585 with no signal — non-conservative for any
700–1400 nm use. Fix under the raise-on-invalid posture: range-check the input; keep
`default_outside_range` semantics only for values inside the standard's declared
wavelength domain but outside the C_A table (i.e. FIR), which is its documented purpose.

### A-7. Major. `large_area_MPE_skin()` — NaN/inf produce a confident number; the standard's applicability gates are missing

Measured: `large_area_MPE_skin(float('nan'))` → 10.0 mW/cm²; `(inf)` → 10.0; `(0)`/`(-1)`
→ None. And the function takes only `beam_area_cm2`, so it cannot apply the JSON's own
`wl_min_nm: 1400` / `t_min_s: 10` applicability conditions (Table 7 note c applies to
1400 nm–1 mm, t ≥ 10 s). The dead twin `engine.large_area_irradiance_limit`
(`engine.py:418-455`) implements the gates correctly and is exported nowhere. A caller
applying the exported function at 532 nm gets a "large-area MPE" the standard does not
define for that regime. Fix: give the exported API the wavelength/duration gates (or
replace it with the gated implementation), validate inputs, pin tests.

### A-8. Major. Physical constants duplicated as silent fallbacks outside the data file

Six ICNIRP values live a second life as `.get()` defaults in
`skin_parameters.py:126-128,170-172` (100 cm², 1000 cm², 10 mW/cm², 280 nm, 400 nm, 2.5)
and two more as hardcoded fallbacks in `web/engine.js:917,937` (3.5/11 mm apertures,
1.0 mm small-beam threshold) directly beneath a file header claiming "No
standard-specific numbers are hardcoded here" (`engine.js:4-5`). Demonstrated: delete
`supplementary.limiting_apertures` from a standard → JS silently serves ICNIRP apertures
(3.5/11) for it; delete `large_area_correction`/`uv_successive_day_derate` → Python
silently serves ICNIRP values (validated with zero errors both times). For a
"standard-agnostic, data-driven" design this is the failure mode that matters: a non-ICNIRP
standard silently inherits ICNIRP numbers. Fix: validators require the `supplementary`
blocks; fallback constants deleted.

### A-9. Major. Silent nm-vs-µm auto-guessing with a cliff at 10, inconsistent between modules

`skin_parameters.py:39,80,165`: `if wl <= 10.0: wl *= 1000` (≤). `legacy.py:145`:
`wl if wl > 10.0 else wl*1000` (>) — the two agree numerically but the cliff is live:
`get_Tmax_skin(10)` = 10.0 (10 µm), `get_Tmax_skin(10.0001)` raises (10.0001 nm out of
range). `H_skin_ICNIRP_MPE(10)` = 0.56 (FIR); `H_skin_ICNIRP_MPE(10.0001)` raises. A user
who believes they passed nm is silently reinterpreted as µm for any value ≤ 10 with no
diagnostic, in a safety API. Untested for any wavelength in (0, 10]. Fix under the chosen
posture: remove the guess from the primary API (require nm, raise otherwise); keep it
only in `legacy.py` where the µm-era signatures live, documented.

### A-10. Major. Repetitive-pulse Rule 2 is evaluated only at the endpoint T — up to ~2.2 % non-conservative

`per_pulse_MPE`/`rep_pulse` compute Rule 2 as `skin_mpe(λ, T)/max(f·T, 1)` at the caller's
single T (`repetitive_pulse.py:43-56`). ICNIRP's Rule 2 applies to *any* group of pulses
within the exposure ("T varies from the pulse duration to the total exposure duration" —
quoted in the JSON's own `repetitive_pulse_skin.rule_2_note`). Because H(t) switches from
t^0.25 to linear at t = 10 s, the binding sub-window for T > 10 s is T′ = 10 s, not T.
Measured: 800 nm, 100 Hz, T = 100 s → endpoint gives 3.170 mJ/cm² per pulse, swept
minimum gives 3.114 mJ/cm² — endpoint is **1.018× too permissive** (analytic worst case
0.2/0.19561 = 1.0224 in Vis/NIR; 1.0042 in FIR bands). The JS scanning path has per-point
T machinery (`T_point`), so this asymmetry is Python-specific for T > 10 s.
Physics judgment + API change → FIX_PLAN option with NEEDS AUTHOR sign-off: evaluate
Rule 2 as min over T′ ∈ {T, 10 s} (sufficient given piecewise-monotone H), cite the
rule text, pin tests at T = 12 s, 100 s, 1000 s.

### A-11. Major. N = f·T is not integerized and PRF ≤ 0 / NaN pass silently (Python)

- `per_pulse_MPE(800 nm, 10 ns, f=1.5 Hz, T=1 s)` divides the cumulative limit by 1.5.
  If 2 pulses are delivered in the window (any phase), the per-pulse allowance is 33 %
  high. ICNIRP's rule divides by the number of pulses in the group — an integer.
  Conservative fix: `N = ceil(f·T)` for N ≥ 1 (cite the Rule 2 definition; pin tests).
- `f = 0` and `f = −10` silently return the single-pulse limit (N ≤ 1 branch);
  `f = NaN` returns NaN. The JS engine flags the same inputs `binding: "Invalid"` —
  better, and divergent (B-5). Python should raise under the chosen posture.
- Rule 3 exclusion for skin: correctly excluded, but by omission — no code reads the
  JSON's `repetitive_pulse_skin` block (documented-vs-enforced gap; fold into A-8's
  validator work or document explicitly).

### A-12. Major. Standard-data validators accept overlap, gaps, and unordered regions; first match wins

Demonstrated: prepend a looser duplicate region (a = 99, full time range) to the Vis/NIR
band → zero validation errors, and `skin_mpe(532, 10 ns)` = 99.0 J/cm² (the injected
region wins silently). Delete the 10⁻⁷–10 s region → zero errors, `skin_mpe(532, 1 ms)` =
NaN. `validate_standard` (`engine.py:49-108`) checks key presence and formula names only;
`_validateStandard` (JS) similarly never checks coverage. For files whose entire purpose
is to be edited by third parties, load-time coverage/overlap validation is the missing
safety net. (Same family as A-4.)

### A-13. Major. The "never underestimates" guarantee is conditional, and its test tolerates a 5 % underestimate

- Enforcement (`engine.js:2762-2802`) applies `max(grid_peak, analytical_peak)` only
  when `scan_params` is passed with `v_mm_s > 0`.
- The test named `"separable: conservative safety (never underestimates)"`
  (`test_engine_js.mjs:656`) asserts `peak_sep >= peak_bf * 0.95` — it cannot fail on a
  genuine ≤5 % underestimate. A guarantee whose test allows violations of the guarantee
  is not a guarantee.
- `engine.js:2768-2773` concedes the cross-check "may not match the actual geometry" for
  custom paths, citing an "engine archaeology report" that does not exist in the repo.
- Fix: README claim rewritten to the precise conditional statement (Phase 3); test
  tightened to a justified tolerance; nonexistent-document citations removed (D-13). The
  UI-level divergence this interacts with is A-14.

### A-14. Major. Displayed verdict and exported audit trace use different conservatism for custom scan paths

The scan worker always passes a synthesized raster `scan_params`
(`calculator.jsx:2482` and its two copies), enabling the analytical override; the
trace-panel re-evaluation passes `null` for custom LSP imports (`calculator.jsx:3755` and
copies), disabling it. For a custom-path import, the number in the UI and the number in
the exported `mpe-trace.json`/hazard worksheet can differ. An LSO who cross-checks the
export against the screen will find the tool disagreeing with itself. Fix: one policy,
both paths (pass the same `scan_params` object to both evaluations).

### A-15. Minor. Edge-convention inventory (float `==`, top-edge special cases, three behaviors at 1 mm)

- Float equality at `engine.py:194,322` implements the last-band inclusive upper edge
  (λ = 10⁶ nm valid for `skin_mpe`) — while `get_Tmax_skin(10⁶)` and
  `get_skin_limiting_aperture(10⁶)` raise, and `band_name(10⁶)` matches only via its
  fallback. Three behaviors for the same physical edge.
- The wavelength sub-filter used by UV photochemical regions (`engine.py:263,272`) does
  *not* have the inclusive-upper exception (harmless today: UV sub-bands are interior).
- README:64's "exactly t₁ ≤ t < t₂ and λ₁ ≤ λ < λ₂" is contradicted by all of the above
  plus A-3. Fix: document the real convention (half-open with inclusive top edge of the
  outermost band and, after A-3, of the duration domain), make the supplementary tables
  follow it, and replace `==` with an explicit named constant comparison.

### A-16. Major. `band_name()` labels every invalid input "Far-IR" (both engines)

`band_name(NaN)` = `band_name(-1)` = `band_name(0)` = `band_name(2e6)` = "Far-IR"
(`engine.py:371` fallback; same in JS). A UI/report label that confidently mislabels
garbage. Fix: raise (Python) / return null and surface (JS); pin tests. (Display-level,
but it feeds exported reports.)

### A-17. Major. Photoacoustic SNR optimizer cannot be verified — its framework citation is unresolvable

The optimizer (`paEffFluence`, `paRelSNR`, `paOptimalPRF`) is documented as implementing
"the Francis et al. framework" (README:48) with "Equations 5–12" (CHANGELOG:71), but
"Francis et al. (2026)" appears nowhere with a title, venue, or DOI — not in
`paper/paper.bib` (which is empty), not anywhere. Verification against the framework is
therefore impossible for any reviewer (and for this audit). NEEDS AUTHOR: the full
citation (it is presumably also the `[enter PA paper citation]` placeholder at
`paper.md:77`). Until then the README/UI must not imply external validation.

### A-18. Informational (no action). Discontinuities that are the standard's own

- C_A steps from 5.0119 to 5.0 at 1050 nm: ICNIRP defines C_A = 5 on 1050–1400 nm; the
  0.24 % step is the standard's rounding of 10^0.7, faithfully reproduced.
- `skin_mpe(350, ·)` steps 0.9958 → 1.0 J/cm² at t = 10 s: the standard's thermal column
  ends at 10 s and the 10⁴ J/m² photochemical value takes over; the step is in the
  standard.
- The UV ladder's within-bin flatness (value of the bin's upper edge) matches the
  published table's own convention. These should be *documented*, not "fixed".
- `skin_mpe(400–1400 nm, ·)` steps **down** ~2.2 % at t = 10⁻⁷ s: the constant region
  `0.02·C_A J/cm²` (200 C_A J/m²) meets the `1.1·C_A·t^0.25 J/cm²` (11 C_A t^0.25 kJ/m²)
  region, and `1.1·(10⁻⁷)^0.25 = 0.01956 < 0.02`. The two Table 7 regions do not join
  continuously; the JSON reproduces both faithfully, so this is ICNIRP's own
  discontinuity, not an error (verified against Table 7 — no constant changed). It is the
  **only** point where `skin_mpe` is non-monotonic in duration: above ~10⁻⁷ s it is
  non-decreasing for every band. This qualifies the scanning engine's T_point-vs-T_total
  conservatism note (was previously written as an unqualified "monotonically
  non-decreasing"); the note and a pinning test (`test_engine_js.mjs`, A-22) now record it.

### A-19. Adversarial-input matrix — summary of behavior at HEAD

Everything below was measured (both engines unless noted). Under the agreed
raise-on-invalid posture, each "silent" cell becomes a raise (Python) / explicit error
(JS boundary) in Phase 3.

| Input | `skin_mpe` | `ca` | `band_name` | `get_Tmax_skin` | aperture | `large_area` | `per_pulse_MPE` |
|---|---|---|---|---|---|---|---|
| NaN | NaN (silent) | 1.0 (silent, wrong) | "Far-IR" (wrong) | raises ✔ | py raises ✔ / **js 11 mm** | **10.0 mW/cm²** | NaN |
| −1 / 0 | NaN | 1.0 | "Far-IR" | raises ✔ | py raises ✔ / js 11 mm | None (0/−1) | f=0 → silent Rule-1-only (py); "Invalid" (js) |
| +inf | NaN | 1.0 | "Far-IR" | raises | py raises / js 11 mm | 10.0 | — |
| 5 (µm-guess zone) | NaN | 1.0 | "Far-IR" | 10.0 s (as 5 µm) | py 3.5 mm (as 5 µm) / js 11 mm | — | — |
| t = 30000 s | **NaN** (A-3) | — | — | — | — | — | NaN via Rule 2 |
| array len 0 / len 1 | [] / [1.1] ✔ | — | — | — | — | — | ([], []) ✔ |
| array with OOR member | element-wise NaN (silent) | — | — | — | — | — | — |
| bad unit string | — | — | — | — | — | — | conversions raise ✔ |

---

## Pass B — Cross-implementation consistency

### B-1. Dense differential result (the good news)

A dense cross-language sweep — 257 wavelengths (log-spaced 180 nm–10⁶ nm plus every band
edge probed at `nextafter` resolution) × 107 durations (log-spaced 10⁻⁹–3×10⁴ s plus
every breakpoint) = 27,499 points — compared `skin_mpe`/`skinMPE` and `ca`/`CA` directly:

```
skin_mpe: 25,452 points finite in both engines; 2,047 NaN in both;
          0 points where one engine is NaN and the other finite;
          max relative discrepancy 2.9e-16 (at 1050 nm — pure float noise)
CA:       identical to the last bit at all 257 wavelengths
```

The two engines are numerically the same function over the shared JSON. This is far
stronger than the README's "20 boundary points" claim (0.3, line 170) and should replace
it — as an *executed* CI check, not a prose claim (see B-2, FIX_PLAN).

### B-2. Major. The conformance corpus is generated by the JS engine — the JS conformance test is a tautology and the documented verification direction is backwards

`tests/conformance/generate_conformance.mjs:43-48` produces `corpus.json`'s `expected`
values by calling the JS engine; `test_conformance_js.mjs` then replays them into the same
engine (regression pin, not verification), while `web/README.md:55` claims "The JavaScript
calculation engine has been verified against the Python reference implementation" — the
actual direction is Python-checked-against-JS. Additional defects: the 13 CA cases meant
to be exact-match are silently degraded by `tolerance: tolerance || 1e-9`
(`generate_conformance.mjs:56` — `0 || 1e-9` = 1e-9); `power_offset` is declared a
coverage target (`:11`) but never covered (only the ANSI file uses it, and the generator
loads only ICNIRP) while `scripts/generate_validation_report.mjs:218` claims "all 7
formula types" verified; and `test_conformance_py.py:81-91` re-implements Rule 1/2
binding logic inline instead of calling the library, so the library's own binding path is
untested by the corpus. Fix direction (Phase 3): generate expected values from the
**Python** engine, run both suites in CI, fix the tolerance bug, describe the corpus
truthfully.

### B-3. Major. Duplicated-value map (everything that exists in more than one place)

| Value / logic | Locations | Status |
|---|---|---|
| Skin apertures 3.5/11 mm + 100 µm split | JSON; `engine.js:917` hardcoded fallback | silent second source (A-5/A-8) |
| Small-beam threshold 1.0 mm | JSON; `engine.js:937` fallback | same |
| Large-area thresholds + UV derate | JSON; `skin_parameters.py:126-128,170-172` defaults | same (A-8) |
| `VALID_FORMULAS` | `engine.py:42-46` (8) = `engine.js:23` (8); `web/standards/README.md` table lists 7, prose says "six" | three different answers in docs (B-7) |
| Standard-JSON validator | `engine.py:49-108` vs `engine.js:25-79` | **diverged**: JS checks CA region `type` and `power_offset` `b`+`c`; Python checks neither — demonstrated: ANSI with `c` removed from its one `power_offset` region passes Python validation ([]) and *fails* JS validation, **but JS loads it anyway** (B-4) |
| Rule 1/2 kernel | `repetitive_pulse.py:43-56` ≡ `engine.py:402-411` (`rep_pulse`) ≡ `engine.py:512-521` (`rep_pulse_area`, dead) + JS `engine.js:612-661` + inline re-implementation in `test_conformance_py.py:81-91` | five copies |
| `minSafeVelocity` / `maxPermissiblePower` | `engine.js:2999,3254` (exported, **zero callers**, bisection tol 0.001) vs re-implementations inside worker source strings `calculator.jsx:2497-2510` etc. (tol 0.01) | **already diverged**; README:43 advertises the dead ones (D-24) |
| Version | `pyproject.toml` 3.0.0 = `__init__.py` = `package.json` = `CITATION.cff`; `engine.js:117` `_ENGINE_VERSION` = **"2.7.0"** | diverged (E-2) |
| Engine source in the shipped page | `web/engine.js` inlined + embedded again as `__ENGINE_SOURCE__` string | 2 copies in `index.html` (~430 KB of 1.19 MB) — by design (worker), worth a build comment only |
| Scan UI | `GeneralScanContent` / `OCTScanContent` / `PAScanContent`, `calculator.jsx:2060/3787/5670` | ~5,600 of 7,798 lines are near-verbatim triplicates; every physics-adjacent UI fix must be made three times (recommendation only — out of repair scope) |

### B-4. Major. JS validator is fail-open

Demonstrated with the `power_offset`-missing-`c` case: `engine.js`'s validator *detects*
the error and prints "Standard data validation errors: … requires 'c'", then
`loadStandard` **loads the standard anyway** and later evaluation produces NaN in the
affected region. Python's `load_standard` correctly raises when its validator reports
errors — but its validator misses this case entirely. So: Python = blind but fail-closed;
JS = sighted but fail-open. Both need to be sighted and fail-closed.

### B-5. Major. Divergent adversarial semantics between engines (same inputs, different philosophies)

| Input | Python | JS |
|---|---|---|
| `rep_pulse`, PRF = −10 | silently returns Rule-1-only, N = −10 | `binding: "Invalid"`, NaN |
| `rep_pulse`, PRF = NaN | NaN result, N = NaN | `binding: "Invalid"`, N = 0 |
| aperture, NaN/−1/0/2e6 | raises ValueError | returns 11 mm (A-5) |
| large-area block missing from standard | fabricates ICNIRP values (A-8) | returns null |
| wavelength 5 | µm-guess → 3.5 mm aperture, T_max 10 s | no µm-guess → 11 mm aperture |

Two implementations of a safety calculation should not disagree about what is an error.
Phase 3 aligns both to fail-closed.

### B-6. Major. Python has no T-windowed Rule-2 machinery at all

The JS scanning engine evaluates Rule 2 with per-point exposure windows (`T_point`,
`engine.js:2722-2727`, tested in `verify_Tpoint_edge_cases.mjs`); the Python library
evaluates Rule 2 at a single caller-supplied T (A-10). The two engines therefore answer
different questions for the same physical scenario above 10 s. Document the asymmetry
(API docs) and close the Python endpoint gap per A-10.

### B-7. Minor. `web/standards/README.md` does not match the files it documents

"Six formula types" in prose; seven in its table; eight accepted by both engines
(`power_offset` missing from the table — the one formula only the ANSI file uses).
`ansi_z136_2022.json` (22 KB, shipped) is never mentioned; `uv_deep_steps`,
`irradiance_primary`, and `repetitive_pulse_skin` keys are undocumented; "the engine reads
these files at runtime" is false for the browser build (frozen at build time by
`build.py:409`). The schema documentation also never states the bin-edge conventions that
the UV photochemical ladder depends on.

### B-8. Nit. Undocumented test dependency

`tests/test_tracer.mjs` and `test_tracer_stage2.mjs` crash with MODULE_NOT_FOUND unless
`npm install` has been run in `web/` (they `require` Ajv from `web/node_modules`). No
documentation mentions this; CI never runs them (E-7).

### Pass A addendum — scanning-engine internals

**A-20. Major.** When the fluence grid hits `MAX_GRID_CELLS` (4×10⁶), the downscale
recomputes `dx` from the x-extent only while `ny` was scaled independently
(`engine.js:1119-1124, 1191-1196`), so y-spacing is silently inconsistent for non-square
domains. No warning is emitted and no test exercises the cap path. Fix: isotropic rescale
of both axes from both extents + a test at the cap.

**A-21. Major.** The erf-vs-discrete regime switch uses the overlap parameter of the
*first* path segment only (`ρ` from `pathSegs[0].v_mm_s`, `engine.js:1641`). A
mixed-velocity custom path (fast transit first, slow exposure later) picks its
approximation regime from the wrong segment. Fix: per-segment regime choice, or the most
conservative regime across segments; test with a two-velocity path.

**A-22. Minor.** `TIE_TOL` (1e-6, `engine.js:2711,2744-2759`) can select a
within-tolerance cell for reporting, slightly under-reporting `worst_ratio`/margin (the
pass/fail verdict itself uses the unrounded maxima and is unaffected). The
T_point-monotonicity conservatism argument is stated in comments but pinned by no test.

---

## Pass C — JOSS criteria audit

Criteria text retrieved 2026-07-26 via web search (readthedocs/theoj.org direct fetches
are blocked from this environment): review_criteria, review_checklist, paper format, the
2026 "Preparing JOSS for a generative AI future" post, and the AI policy on
`joss.theoj.org/about`.

**C-1. License — pass.** Plain-text OSI MIT at `LICENSE`, consistent across
`pyproject.toml`, `package.json`, `CITATION.cff`, README. Two attribution wrinkles: the
copyright year (2025) predates every commit (first commit 2026-04-15), and the holder is
one individual while the paper lists four authors and two institutions (→ C-10).

**C-2. Substantial scholarly effort / scope — fails today on history (0.1); the
significance argument needs to be made, and can be.** As a *band lookup*, this is exactly
the "minor utility" shape an editor may challenge: `skin_mpe` is ~200 lines over a JSON
table. The defensible substantive contributions are elsewhere, and the paper currently
does not argue them: (a) the scanning-exposure model (segment-superposition fluence
accumulation, per-point Rule-2 exposure windows (T_point), separable fast paths with an
analytical cross-check, high-PRF subsampling); (b) the machine-readable standards layer
(two encoded standards + validation + a documented schema); (c) the LSP-JSON scan-pattern
interchange format with schema validation and an e2e-tested import pipeline; (d) a
dual-implementation equivalence argument — which this audit strengthened to a
25,452-point differential at 2.9e-16 (B-1) but which the repo currently understates ("20
boundary points") and partly inverts (B-2). The paper must make (a)–(d) the story.

**C-3. Web-tool scope clause — currently argued dishonestly; must be fixed.** JOSS
accepts web tools when they expose a core library or demonstrate rigorous domain
modeling/testing. The true architecture is: an independent JS engine sharing the JSON
data layer with the Python library (not a thin view over it), plus a React UI over the JS
engine. That is *arguable* under the clause (shared data layer + demonstrated
equivalence + serious testing) — but `paper.md:63` instead claims a C++ desktop
application that does not exist anywhere in the repository, and `paper.md:59` +
`CITATION.cff:15` claim IEC support with no IEC data file. Both claims must be deleted;
the honest dual-engine + shared-data argument should replace them (NEEDS AUTHOR: paper
is out of scope for this pass by request).

**C-4. Documentation checklist.**

| Item | Status |
|---|---|
| Statement of need | ✔ in paper (labelled) and README intro |
| Installation instructions | ◐ present; wrong clone URL (0.2); users-path can't run the documented test command |
| Example usage | ✔ README quick-start + 4 example scripts (byte-verified outputs); ✘ the paper's Example-usage subsections are empty |
| API documentation | ◐ `docs/API.md` covers 15 functions but omits exported `band_name` and `rep_pulse` while README calls it complete; `docs/API.md:159` ("legacy functions take micrometers") is false for `H_skin_ICNIRP_MPE`, which unit-guesses (A-9); zero documentation of the JS engine's public surface |
| Community guidelines: contribute | ✔ CONTRIBUTING.md (with wrong test instructions, D-23) |
| Community guidelines: report issues | ✔ CONTRIBUTING.md §Reporting Issues |
| Community guidelines: **seek support** | ✘ absent everywhere — a literal checklist item |
| Code of conduct | ◐ two generic sentences in CONTRIBUTING, no reporting mechanism, no CODE_OF_CONDUCT.md |

**C-5. Functionality — pass with caveats.** Core functionality installs and runs from a
fresh clone (0.2); the caveats are the clone URL, the users-path pytest gap, and the
CDN-online requirement for the web tool.

**C-6. Tests — present and CI-enforced; scientific coverage overstated.** 126 pytest +
78 engine-JS + 4 LSP suites + 25 e2e run in CI and a red run demonstrably fails the
build. But: the largest numeric body (`verify_exhaustive.py`, 254 checks) never runs
anywhere (D-18); the cross-language corpus is self-referential (B-2); the two tracer
suites (117 checks) and the T_point edge suite exist but are absent from CI (E-7); one
"verify" file contains no assertions (D-18); and no e2e test asserts a single numeric MPE
or verdict (E-15). A reviewer who looks past the counts will find the *scientific* core
(UV ladder edges, Rule-2 windows, scanning conservatism) is exactly where coverage is
thinnest — A-3 (the t=3e4 composition bug) survived the entire suite until this review.

**C-7. Paper (`paper/paper.md`) — content audit against the required sections.**
(The paper itself is untouched by this review at the author's request; findings only.)

| Required section | Present? | Substantive? |
|---|---|---|
| Summary | ✔ | first sentence contains a word-order error ("The of use laser-based systems has significantly grown"); tone drifts to marketing ("an exciting tool") |
| Statement of need | ✔ labelled | usable core |
| State of the field | ✔ | names LIA and KenTek EASY-HAZ with pricing claims, zero citations; two absolute negatives ("no software currently…", "no existing software…") that a reviewer will attack; the tools it compares against are uncited |
| Software design | ✔ | contains the false C++-app and IEC claims (C-3); says "two core principles" then lists three; otherwise close to the "generic description" pattern the criteria call not acceptable |
| Example usage | ✘ | `## Basic usage` and `## Scanning protocols` are headings with zero body |
| Research impact statement | ✘ | three unfilled placeholders, including "[enter PA paper citation]", "[reference Ryan's example publication]", and "[research group in Spain Judith sent it to]" — the last names a third party; remaining text is aspirational ("we anticipate adoption…"), which the criteria explicitly call not acceptable |
| AI usage disclosure | ◐ | present, but asserts "No generative AI tools were used in the writing of this manuscript, or in the preparation of supporting materials" — contradicted inside the repository itself: `.github/workflows/ci.yml:31-32` carries an AI-audit annotation ("FIX (audit dim 5)…"), and HEAD commit `3bf27c9` (titled "Update README.md") is in fact an em-dash-removal pass over `web/standards/README.md`, a characteristic AI-prose cleanup. Under the 2026 policy, an inaccurate disclosure is an ethics problem, not a style problem. Also "Claude code, was used" (agreement). A corrected skeleton is provided in FIX_PLAN → NEEDS AUTHOR. |
| Acknowledgements | ✔ | fine |
| References | ✘ | `# References` heading with an **empty `paper.bib` (1 byte)** and zero `[@…]` citations in the text — ICNIRP 2013, the standard the software implements, is cited nowhere in citable form |
| Word count | ✔ | 1,159 words — within the current 750–1750 guidance |
| No API docs in paper | ✔ | correctly absent |

**C-8. API reference accuracy.** See C-4; `docs/API.md:21` documents the silent-NaN
contract in one line with no safety warning (changes under the raise-on-invalid decision).

**C-9. Major. T_max misattribution.** `icnirp_2013.json` (`supplementary.t_max.description`)
says plainly the T_max values are "conservative engineering guidance for typical
scenarios, not directly from a specific ICNIRP 2013 table" — while `README.md:52` claims
"All values are verified against the loaded standard", `README.md:58` lists T_max in the
Standards-Compliance table, `docs/API.md:90` titles it "T_max (default, ICNIRP 2013)",
and `tests/test_skin_parameters.py:40` labels it "Table 4". For a safety tool, presenting
project-chosen values as standard values is the single most consequential prose defect in
the repo. Fix: label honestly everywhere (the JSON already does). Also A-3's composition
bug (T_max(UV) = 30000 s → skin_mpe NaN).

**C-10. Blocker (submission metadata). Authorship is inconsistent four ways and the
ORCIDs are wrong.** `paper.md` lists 4 authors — Gallegos, McAuley, Bouma, Veysset — with
**three of them sharing one ORCID** (0009-0007-9290-6289) and McAuley's empty;
`README.md:273` lists 5 (adding Nicholas Borges); `CITATION.cff` credits only the entity
"OCT Research" with no humans, no ORCIDs, no affiliations; `LICENSE` names one person.
JOSS requires the submitting author and co-authors to be real, consented, and correctly
identified. NEEDS AUTHOR: one authoritative author list, real per-person ORCIDs,
CITATION.cff rewritten to match (with affiliations), README aligned.

**C-11. Major. CITATION.cff not fit for submission.** Beyond authorship: wrong
`repository-code` owner (itgall), `url:` points at a lab homepage, no `doi`/`identifiers`
(fine pre-archive, but the field should be planned), abstract repeats the IEC claim and
the unresolvable Francis reference. Version (3.0.0) and date (2026-04-02) are
internally consistent with CHANGELOG but eight weeks behind HEAD.

**C-12. Blocker (paper). References.** Empty `paper.bib`; the ICNIRP 2013 DOI is
`10.1097/HP.0b013e3182983fd4` and appears nowhere in the repository; "Francis et al.
(2026)" is unresolvable (A-17); the state-of-the-field tools are uncited. Also
`paper/README.md` and `paper/Figures/README.md` are 1-byte empty files and `paper/Figures/`
contains no figures (a paper with no figure is acceptable; empty scaffolding directories
are noise).

**C-13. Minor. Repository presentation.** No description, homepage, or topics on the
GitHub repo (not settable from this session — NEEDS AUTHOR); no CI badge in the README
despite green CI; tags v1–v3 exist but carry **zero GitHub Releases** and no
Zenodo/archive DOI, and all three point at snapshot commits off the default branch (0.1)
— a reviewer clicking "Releases: 0" and then finding orphaned tags gets the worst of both
impressions. Re-tag/release on `main` after the fix pass.

---

## Pass D — Machine-generated text and structure audit

Disposition legend: **delete** (remove outright), **compress** (shorten in place, keep
the author's wording where any exists), **correct** (make true), **NEEDS AUTHOR** (facts
only the authors hold). Items already carried as A/B/C findings are not repeated.

| # | Sev | Where | What | Disposition |
|---|---|---|---|---|
| D-1 | Major | `README.md:234-236` | Second `## Web Calculator` section (pre-v2 leftover) claiming dark/light theme, shareable URLs, PDF export | delete (fold the one true fact — theme — into the first section; shareable URLs and PDF export do not exist; `CHANGELOG.md:99` already recorded removing these claims from `web/README.md` but the root README kept them) |
| D-2 | Minor | `README.md:238-247` | "Project Outline" checkbox roadmap whose final unchecked box is "JOSS paper submission" | delete (a reviewer-facing README is not a tracker; the unchecked box literally announces the submission is unfinished) |
| D-3 | Nit | `README.md:22` | Feature bullet ends "…Rule 2 (average power), " — trailing comma + space, reads as truncated | correct |
| D-4 | Nit | `README.md:125-132` | `per_pulse_MPE(` example has a blank argument slot before `)` (a deleted 5th argument); block prints nothing unlike its siblings | correct |
| D-5 | Minor | `README.md:196-231` | Package tree: `#` columns misaligned at :201-203; omits `paper/`, `tests/conformance/`, `tests/lsp/`, `web/lsp/`, `ansi_z136_2022.json`, `CHANGELOG.md`, `.github/`, `scripts/`, `playwright.config.ts` | correct (align and complete, or prune to top level) |
| D-6 | Minor | `README.md:158,164,172,217-218` | Test counts hard-coded in headings; all three verified true *today* (126/78/25) but git history shows they drifted once already (71→126, 62→78) and two sibling artifacts still contradict them (D-19) | compress: keep the commands, drop the numbers from headings |
| D-7 | Minor | `README.md:29` vs `:93`, `web/README.md:25`, `CHANGELOG.md:46` | "No build step/server/installation" restated 4×; "No code changes needed to switch standards" restated 4× (`web/standards/README.md:5,50`, `CHANGELOG.md:69`, `paper.md:61`) | compress to one statement each |
| D-8 | Minor | `README.md:261-263` | Safety disclaimer stacks five hedges | compress to the load-bearing two (not certified / not sole basis) — **keep the disclaimer itself**, it is substantive and appropriate here |
| D-9 | Minor | UI strings (`calculator.jsx`), test runners | UI buttons carry decorative glyphs (⇅ ☾ 🔍 ⤓ ▶); test runners print ✅/❌ | tests: delete with D-10; UI glyphs: author's stylistic call, flag only |
| D-10 | Minor | `test_skin_mpe.py:403-452` ≈ `test_skin_parameters.py:264-307` | ~50-line hand-rolled reflection-based test runner duplicated verbatim (with emoji output), plus `if __name__ == "__main__"` blocks in four test files — pytest re-implemented inside a pytest suite | delete (pytest is the runner; CI already uses it) |
| D-11 | Minor | `test_skin_mpe.py:52,77,144,148,…`, `test_skin_parameters.py:95,145,170`, `test_correction_factors.py:5` | De-branding residue: docstrings mass-rewritten to "Verified against the standard." (×6), comments mangled to "# UV Band (180-400 nm) 5 and 7" (was "Tables 5 and 7"), unbalanced parentheses, and a false citation "page 76" (ICNIRP 2013 spans pp. 271–295) | correct: restore accurate table references (they are verifiable: Tables 5/7/8, note c) |
| D-12 | Minor | `test_skin_parameters.py:113-123` | Committed stream-of-consciousness comments narrating the author's unit confusion, plus a discarded first call whose result is overwritten | delete the narration, keep one correct assertion |
| D-13 | Major | `engine.js:2772`, `engine.js:1532` | Safety-relevant justifications cite documents that do not exist: "(see engine archaeology report)" and "'Generalized Gaussian Fluence Accumulation from Arbitrary Scan Paths' (framework document, April 2026)" — unverifiable provenance for conservatism decisions. (Related: PR #1's body cites `IMPLEMENTATION_SUMMARY.md`, absent from the repo — history is immutable; note only.) | correct: replace with the actual inline argument or delete the reference |
| D-14 | Minor | `.github/workflows/ci.yml:31-32` and ~60 similar lines | Self-referential audit annotations ("FIX (audit dim 5): …") and step-narrating comments that reference an internal audit no reader can resolve | compress (keep the one substantive warning about raw-script execution, drop the audit bookkeeping) |
| D-15 | Minor | `web/build.py:110-146,233-260,462-468` | Essay-in-source: "Why esbuild…" benchmark claims ("the fastest bundler in the ecosystem", "~40 ms"), speculative browser-bug rationale for not revoking a blob URL | compress to the one-line decisions |
| D-16 | Minor | `docs/API.md` (10 horizontal rules), `CHANGELOG.md:15-50` (34 bold-label bullets under six `####` headings), `README.md` (15 bold-label bullets) | Uniform machine cadence: decorative rules partitioning 5-line sections, bold-label bullet walls | compress where it costs nothing; do not re-voice |
| D-17 | Minor | `verify_exhaustive.py:181,349,446-460`, `test_skin_mpe.py:280,392-396` | Assertions that cannot fail: `check(..., True, True)` ×3, a locally-computed-constant comparison, a redundant float `!=`, a shape-only "array input" test with no numeric check | correct: make each assert a real value or delete it |
| D-18 | Major | `tests/verify_exhaustive.py`, `tests/verify_Tpoint.mjs`, `tests/conformance/test_conformance_py.py` | Verification files that don't verify: 254 checks never collected by pytest/CI; a "verify_" script with zero assertions; a conformance file with zero tests that runs at collection time and mutates the engine's global standard state (E-9) | correct: wire into pytest/CI as real tests (Phase 3) |
| D-19 | Major | `tests/outputs/` (5 files) | Stale committed outputs: old class names, a vanished test, "39 passed" vs 38 methods, "All 330 checks" vs README's 126 vs CHANGELOG's 329 | delete the directory (stale committed output is worse than none); document the command that regenerates instead |
| D-20 | Major | `CHANGELOG.md` | Claims Keep-a-Changelog + SemVer, but the version record is incoherent three ways: the changelog's entries are `0.1.0`/`0.2.0`/`3.0.0` while the repo's actual tags are `v1.0.0` (2026-03-28) / `v2.0.0` (2026-03-30) / `v3.0.0` (2026-04-02) — names disagree for the first two though the dates roughly align; all three tags point at parentless snapshot commits unreachable from `main` (0.1); `:61` references v2.0.0, which exists as a tag but has no changelog entry; `[0.1.0]` is dated bare "2025", before the repository existed; the 0.2.0→3.0.0 numbering jump is unexplained; reference-style links have no targets; and ~2 months / 20+ commits are undocumented including four safety-relevant T_point fixes | correct: reconcile against `git log` and the real tags honestly (align entry names to the tags that exist, add an Unreleased section from real commits, fix the links, state the history restart as fact); no invented dates or tags |
| D-21 | Major | `docs/requirements_traceability.json` | Cites verification evidence that does not exist: "Stage 4 adversarial audit (63 checks)", "(T7: XSS injection test)" — there is no XSS test in the repository; meanwhile `doExport` (`calculator.jsx:1435`) interpolates the user-loadable standard name into report HTML unescaped (the sibling `_generateTraceReport` does escape) | correct the matrix to reality; fix the escaping gap it falsely claims is tested |
| D-22 | Major | `CONTRIBUTING.md:20-26,44-46` | Instructs contributors to run tests via raw `python tests/test_*.py` — the exact method CI's own comment warns "can silently exit 0 on import errors"; "all four test suites" is stale; the Code of Conduct is two sentences with no reporting mechanism; no support channel (C-4) | correct: align with CI (`pytest`), enumerate the real suites, add a real CoC file + support guidance (contact address → NEEDS AUTHOR) |
| D-23 | Major | `engine.py:418-521`, `engine.js:2999-3054,3254-3293,1086`, `web/compute-sri.js`, `web/lsp/factory.js`, `web/lsp/validate.js:22,114` | Dead and diverged code: 104 lines of never-called Python (3 functions incl. the *gated* large-area implementation the exported one lacks); `minSafeVelocity`/`maxPermissiblePower` exported with zero callers while diverged re-implementations live in worker strings — and README:43 advertises them; `MAX_SEGMENTS` declared/exported/never read; an SRI tool whose output was never applied and whose script list is stale; a stale comment documenting the CDN-Ajv approach the build replaced, plus an `Ajv2020 \|\| Ajv` fallback that would silently validate under the wrong JSON-Schema draft; `factory.js` (703 lines) ships nowhere but is CI-tested | delete the dead paths (fold the gated large-area logic into the exported API per A-7); document `factory.js` as a dev tool; fix or delete compute-sri per E-4 |
| D-24 | Minor | `src/laser_mpe/*` | 94 banner-comment lines in three dialects (`═══`, `====`, `───`); `__init__.py`'s 76-line one-import-per-block ceremony with a "Legacy API" banner sitting *below* two of the legacy imports it introduces; `correction_factors.py` is a 25-line module wrapping a one-line delegation | compress (mechanical; keep public API unchanged except as decided elsewhere) |
| D-25 | Minor | `verify_exhaustive.py:86-98`, `test_correction_factors.py:19-29` | `check()` helpers with bare `except Exception:` and the nonsense comment "# Handle typo in AssertionError -> AssertionError"; hand-rolled `isclose` | correct alongside D-18 |
| D-26 | Info | git history / PR bodies | Commit "Update README.md" (`3bf27c9`) actually edits `web/standards/README.md`, and its entire diff is em-dash→colon substitution — a visible, mislabeled AI-prose-laundering pass that directly undercuts the current AI-usage disclosure (C-7). PR #3's "452 tests" total doesn't survive contact with the measured counts. History is immutable; the remedy is an accurate disclosure, not a rewrite. | NEEDS AUTHOR (disclosure) |

**Emoji note:** documentation files contain zero emoji; the tells here are structural
(counts, walls, rules) and residual (the de-branding pass of D-11/D-26), not decorative.

---

## Pass E — Repository hygiene and packaging

**E-1. Blocker (packaging). A non-editable install is broken.** The engine resolves its
physics data as `<module_dir>/../../web/standards/icnirp_2013.json` (`engine.py:34-37`) —
outside the package. No `[tool.setuptools.package-data]`, no `MANIFEST.in`. `pip install .`
(non-editable) or any built wheel produces a package whose first call raises
FileNotFoundError. Only the documented `-e` path works. Fix: move/copy the standards into
`src/laser_mpe/data/` as package data loaded via `importlib.resources`, keep `web/standards/`
as the web-served copy, and add a CI check that the two stay byte-identical.

**E-2. Major. Version is quadruplicated and the engine disagrees.** `3.0.0` in
`pyproject.toml:7`, `__init__.py:103`, `package.json:3`, `CITATION.cff:6` — and
`web/engine.js:117` says `_ENGINE_VERSION = "2.7.0"`, which is what the exported trace
JSON stamps into audit artifacts. Fix: pyproject as the single source (`__version__` via
`importlib.metadata`), align the JS constant, and add a CI consistency grep for the rest.

**E-3. Major. The committed build artifact is simultaneously required and disowned, and
nothing prevents drift.** `web/index.html` is committed (the "open it locally" promise
depends on it) *and* listed in `.gitignore` under "Build artifacts … do not commit". The
build is not reproducible (no lockfile — `package-lock.json` is ignored; CI `npm install`;
floating `^` ranges; measured: today's rebuild differs in the Ajv bundle purely from an
esbuild version bump), and `build.py:311-334` silently falls back to a structurally
different `text/babel` + CDN-Babel page with exit 0 if Babel is missing. CI's build job
greps 9 markers but never diffs the rebuilt page against the committed one — committed-
bundle drift would pass silently. Fix: keep the committed artifact (it is the product),
but commit the lockfile, use `npm ci`, make the Babel fallback a hard error in CI, and
add the rebuild-and-diff gate.

**E-4. Major (supply chain). Zero SRI on five third-party scripts.** The shipped page
loads React, ReactDOM, PropTypes, Recharts (unpkg) and echarts (jsdelivr) with no
`integrity=`/`crossorigin` attributes — full-privilege script execution trusted to two
CDNs, in a safety tool. `web/compute-sri.js` exists but its hashes were never applied,
and its script list is stale (hashes a Plotly build the page no longer loads; omits
prop-types and echarts). Fix: build.py emits pinned URLs with SRI hashes (computable from
the npm-registry tarballs — verified reachable); delete or repair the stale tool.

**E-5. Major. "Self-contained / no install" claims are false offline.** Verified: with
CDNs unreachable the page renders nothing but "Failed to load: React, ReactDOM,
PropTypes, Recharts, echarts." Meanwhile the build inlines Ajv *specifically* so schema
validation "must not silently degrade when the network is unreachable" (`build.py:415-419`)
— the safety-rationale is applied to the validator but not to the framework that renders
the numbers. Fix wording ("requires internet access on first load; libraries are pinned
+ SRI"), or vendor the five libraries the way Ajv already is (larger change — decision
recorded in FIX_PLAN as an option, default = fix wording only).

**E-6. Minor. `.gitignore` inconsistencies.** Contains `web/index.html` ("do not
commit") while the file is committed (resolve with E-3's decision);
`examples/mpe_comparison.py` writes `skin_mpe_comparison.png` into the CWD and nothing
ignores it; `package-lock.json` ignore reverses under E-3.

**E-7. Major. CI coverage holes and lint scope.** Not run by any job: `test_tracer.mjs`
(63), `test_tracer_stage2.mjs` (54), `verify_Tpoint_edge_cases.mjs` (18),
`test_conformance_js.mjs` (101), `verify_exhaustive.py` (254), and
`scripts/generate_validation_report.mjs`. The two most recent feature stages
(traceability, conformance) therefore have zero CI enforcement — while `README.md:184-189`
describes CI as comprehensive. Ruff runs on `src/ tests/` only; `examples/` has live
`E401`/`F401` hits it would catch. There is no JS/TS linting at all, yet
`playwright.config.ts:21` carries an `eslint-disable` comment for a linter that does not
exist. `npm test` runs 1 of 12 JS suites. Fix: wire the suites in, extend ruff to
`examples/`, either add a minimal JS lint or drop the stray directive, make `npm test`
aggregate.

**E-8. Major. The release-gating validation report can report PASS on a crashed suite.**
`scripts/generate_validation_report.mjs:147` computes `allPass = totalFailed === 0 &&
buildOk` — ignoring `ruffOk` and per-suite `ok`, so a suite that crashes before printing
its summary (0 run, 0 failed) still yields "VALIDATION: PASS"; `:128` writes `Date.now()`
into a duration field on the failure path; `:123` rebuilds `index.html` as a side effect
of "validation"; `:217-220` asserts cross-language verification "over all 7 formula
types" that B-2 shows is not what the corpus does. It is also run by nothing. Fix logic
+ wire into CI (or delete the script; keeping a false PASS generator is the worst option).

**E-9. Major. Mutable global standard state.** `engine._std` is a module global;
`load_standard` swaps it process-wide; the conformance module calls it at pytest
*collection* time; nothing restores it. Any consumer (or test-ordering change) that loads
ANSI silently changes every subsequent ICNIRP result in the process. Fix (scoped):
conformance becomes a real test with setup/teardown restore; document the global-state
contract in API.md; a context-manager API is a recommendation, not a repair.

**E-10. Minor (privacy — note only).** Git history exposes one person under three
identities including a personal Gmail next to two institutional addresses; the docs
themselves are clean of emails/paths/keys. History is immutable and rewriting is not
proposed; the authors should simply be aware. (The third-party names in `paper.md:77`
placeholders are covered in C-7 and must go before submission.)

**E-11. Minor. Examples import style.** Three of four examples `sys.path`-hack into
`src/` while `basic_usage.py` requires the installed package; two examples import
functions they never call; `mpe_comparison.py` `plt.show()`s (blocking) after saving into
the CWD. Fix: one consistent style (installed package), drop unused imports, save under
`examples/outputs/`, gate `show()` on TTY or drop it.

**E-12. Nit. `web/package.json`** has no `name`/`version`/`license`, lists Ajv (a runtime
dependency of the shipped bundle) under `devDependencies`, and pins no `engines`.

**E-13. Major (docs). The LSP subsystem is invisible.** ~3,580 lines — the size of the
physics engine — mentioned once in the README (inside the e2e paragraph), never in
`web/README.md`; the schema's `$id` points at `cbort-ncbib.github.io/...` (dead URL, and
inconsistent with the `itgall` URLs elsewhere). Fix: a short honest section in the two
READMEs + one canonical repo URL everywhere (with 0.2's owner fix).

---

## Severity roll-up

| Pass | Blocker | Major | Minor | Nit/Info |
|---|---|---|---|---|
| Phase 0 gate | 1 (development history) | — | — | — |
| A (numerics) | 3 (A-3, A-4, A-5) | 10 | 2 | 2 |
| B (cross-impl) | — | 5 | 2 | 1 |
| C (JOSS) | 3 (C-10, C-12, + gate restated) | 4 | 2 | — |
| D (machine text) | — | 8 | 13 | 3 |
| E (hygiene) | 1 (E-1) | 7 | 4 | 1 |
| **Total** | **8** | **34** | **23** | **7** |

A-1 (Blocker) and A-2 (Minor) were withdrawn after checking ICNIRP 2013 Table 5 directly
(see the correction note in Pass A); the code was correct. A-3 has since been fixed. The two
findings that dominate what remains: the development-history gate (0.1), which no code change
can fix, and the surviving safety-direction defects (A-4 fail-open lookup, A-5 JS aperture).
`FIX_PLAN.md` orders the work.
