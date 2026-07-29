# Fix Plan — MPE-Calculator-Skin

Companion to `AUDIT.md` (finding IDs reference it). Per the review brief, execution starts
only after this plan is approved. Ground rules for execution: one logical change per commit;
full test suite green after every commit; any physical constant/formula change cites the
exact ICNIRP 2013 clause and lands with a test that fails before and passes after; error
direction always conservative; if an item grows beyond its risk note, stop and report
instead of improvising.

## Execution progress (updated during Phase 3; delivered as a git patch series)

- **Done** (one commit each, full suite green): #1 URLs, #2 README false/duplicate/truncation,
  #3 README claims, #4 API.md, #5 standards README, #6 web/README, #7 CONTRIBUTING + new
  CODE_OF_CONDUCT.md, #8 CHANGELOG reconcile, #9 delete stale tests/outputs, **#10 t=3e4
  inclusivity (Blocker A-3)**, **#12 validator fail-closed + discrete-lookup (Blocker A-4,
  140×)**, **#17 exact Rule-2 average-power minimum (A-10/A-11)**, #22 fabricated citations,
  #14 large_area gates + NaN (A-7).
- **Partial**: #13 raise-on-invalid — `ca()` and `band_name()` now raise on garbage (A-6,
  A-16, both engines); `skin_mpe`/`skin_mpe_array` keep the documented NaN-for-out-of-range
  contract by design (fail-safe + needed for array plotting), and `per_pulse_MPE`'s array
  PRF handling is unchanged (array plotting) — noted rather than forced to raise.
- **Withdrawn**: **#11** — ICNIRP Table 5 (author-supplied) confirms the UV data is correct;
  findings A-1/A-2 retracted (see AUDIT correction note).
- **Remaining** (not yet executed): #15 fallback-constant removal (A-8), #16 nm/µm guess
  removal (A-9), #18/#19/#20 scanning-engine internals (A-20/A-21/A-14/A-13), #21 report
  escaping + traceability matrix (D-21), and all of Group 3 (#23–#34: packaging/wheel data,
  version single-source, lockfile + rebuild-diff CI gate, SRI, wiring the un-run suites,
  corpus-from-Python, dead-code deletion, prose compression, validation-report logic,
  examples/web hygiene). Phase 4 (hostile re-read → REVIEWER_SIMULATION.md) also remains.

Approved decisions already binding on this plan: invalid input ⇒ **raise** (Python) /
fail-closed (JS boundary); `paper/` is **hands-off** (all paper work lives in NEEDS
AUTHOR); reports live on the review branch only.

Status legend: `pending` → `in-progress` → `done` / `blocked(N-x)` for author-gated items.

---

## Part 1 — Ordered fixes

### Group 1: truth in documentation and metadata (no behavior changes)

| # | Findings | Files | Change (one line) | Risk | Status |
|---|---|---|---|---|---|
| 1 | 0.2 | README.md, CITATION.cff, pyproject.toml, package.json | Replace all 7 `github.com/itgall/...` URLs with `github.com/CBORT-NCBIB/MPE-Calculator-Skin` | none | pending |
| 2 | D-1, D-2, D-3, D-4 | README.md | Delete the second "Web Calculator" section (false PDF-export/shareable-URL claims; fold the true theme fact into the first), delete the "Project Outline" checkbox roadmap, fix the trailing-comma bullet and the dangling `per_pulse_MPE` argument slot | none | pending |
| 3 | 0.3, C-9, A-13(claim), D-5, D-6 | README.md, docs/API.md | Truth pass: counts out of headings (commands stay); complete the CI description; describe the conformance corpus honestly and replace "20 boundary points" with the executed differential; rewrite "never cause unsafe underestimates" as the precise conditional statement; replace "100–400 kHz" with the real subsampling knobs; state the actual boundary conventions; relabel T_max as project guidance per the JSON's own note (README:52/58 + API.md:90); add the ICNIRP DOI (10.1097/HP.0b013e3182983fd4); note pytest lives in `[test]`; note matplotlib for `mpe_comparison`; repair/complete the package tree | none | pending |
| 4 | C-4, C-8 | docs/API.md | Add missing `band_name` + `rep_pulse` entries; fix the "legacy functions take micrometers" claim; unify Cₐ/C_A notation; document the module-global standard state (E-9) | none | pending |
| 5 | B-7 | web/standards/README.md | Eight formula types incl. `power_offset` (with `c`); document `ansi_z136_2022.json`, `uv_deep_steps`, `irradiance_primary`, `repetitive_pulse_skin`; fix the "reads at runtime" claim for the browser build; state bin-edge conventions explicitly | none | pending |
| 6 | B-2(doc), E-13 | web/README.md | Fix the verification-direction sentence; fix "requires only Python 3"; add a short LSP section; one canonical repo URL | none | pending |
| 7 | D-22, C-4 | CONTRIBUTING.md, CODE_OF_CONDUCT.md (new) | Test instructions → pytest + real suite list; add "seeking support" guidance (GitHub issues); real Contributor Covenant file with contact marked `[NEEDS AUTHOR: contact address]` | none | pending |
| 8 | D-20 | CHANGELOG.md | Reconcile honestly against `git log` **and the real tags** (v1.0.0/v2.0.0/v3.0.0 exist as off-main snapshot tags; entry names 0.1.0/0.2.0 disagree with them): align entry names to the tags, add a real Unreleased section from the ~20 undocumented commits (incl. the four T_point safety fixes), fix dead reference links and the bare "2025" date, state the history restart as fact; invent nothing | low | pending |
| 9 | D-19 | tests/outputs/ (delete), README.md:191 | Remove the stale committed outputs and the README pointer; document the regeneration command instead | none | pending |

### Group 2: safety-direction code fixes (each lands with a failing-first pinned test)

| # | Findings | Files | Change | Risk | Status |
|---|---|---|---|---|---|
| 10 | A-3 | src/laser_mpe/engine.py, web/engine.js, tests (py+js) | Make the top duration edge inclusive (t = 3×10⁴ s valid, matching the declared domain and the Table 7 duration column); pins: 29999.999/30000/30000.0001 and the `get_Tmax_skin(250)` → `skin_mpe` composition | low — NaN→value at one point | pending |
| 11 | A-1, A-2 | — | **WITHDRAWN.** Checked ICNIRP 2013 Table 5 directly (author-supplied PDF): the UV photochemical boundary is 302 nm (integer-nm bins) and `313 ≤ λ < 315` is a single 6.3 kJ/m² bin. `icnirp_2013.json` already encodes this exactly. No change; A-1/A-2 retracted in AUDIT. | none | withdrawn |
| 12 | A-4, A-12, B-4 | engine.py (`validate_standard`, `_eval_dual_limit`), engine.js (`_validateStandard`, `loadStandard`) | Validators resolve every `discrete` lookup, check region coverage/overlap/order per band, and check `power_offset` coefficients; JS load becomes fail-closed; NaN-from-lookup becomes an error, not an absent limit; tests load broken standards and expect load-time failure. Pre-check: the shipped ANSI file must pass the new validators — if it genuinely has gaps, surface them, do not special-case | medium | pending |
| 13 | A-5, A-6, A-16, A-19 | engine.py, skin_parameters.py, engine.js, docs/API.md, existing tests | Raise-on-invalid posture: `skin_mpe`/`ca`/`band_name`/`per_pulse_MPE`/conversions raise ValueError on NaN/negative/out-of-domain (documented breaking change); JS `getAperture` fails closed on unmatched wavelength; `bandName` returns null and callers surface it; migrate the tests that currently pin NaN returns | medium — public API contract change | pending |
| 14 | A-7 | skin_parameters.py, engine.py, tests | `large_area_MPE_skin` gains the wavelength/duration applicability gates (from the currently-dead gated twin) and input validation; NaN/inf raise | low | pending |
| 15 | A-8 | skin_parameters.py, engine.js, validators | Delete the six `.get()` physics defaults and the two JS hardcoded aperture fallbacks; validators require the `supplementary` blocks instead — the engine.js header claim becomes true | low (intended: incomplete standards now fail loudly) | pending |
| 16 | A-9 | skin_parameters.py, legacy.py, docs | Remove nm/µm auto-guessing from the primary API (require nm; raise otherwise); keep it only in `legacy.py`, documented; pins in (0, 10] | medium — breaking for µm callers | pending |
| 17 | A-10, A-11 | repetitive_pulse.py, engine.py, engine.js, tests | Rule 2 **EXACT** (per user Q2, N-2 signed off): per-pulse limit = `min over T′ ∈ C of MPE(T′)/(f·T′)`, `C = {T} ∪ {standard time-breakpoints ≤ T, evaluated as left-limits}`. This is the average-power reading (continuous N=f·T′), exact, data-driven from the JSON breakpoints — supersedes the ceil()+{T,10s} heuristic. PRF ≤ 0/NaN raises (Python) matching JS "Invalid"; N≤1 still Rule-1-only; pins at T=12/100/1000 s. Only changes T>10 s (Vis/NIR ≤2.24%, FIR ≤0.42%, FIR 1500–1800 unchanged) | medium — outputs shift conservative by ≤2.3 % | pending |
| 18 | A-20, A-21, A-22 | web/engine.js, tests | Grid-cap rescale made isotropic (+test at the cap); regime switch per segment (most conservative across segments) (+two-velocity test); T_point monotonicity test; margin-reporting note for TIE_TOL | medium — scanning internals | pending |
| 19 | A-14 | web/calculator.jsx (3 call sites) | Trace-panel re-evaluation receives the same `scan_params` the worker used — displayed verdict and exported trace become the same computation | medium — triplicated component edits | pending |
| 20 | A-13 | tests/test_engine_js.mjs | Tighten the "never underestimates" test from 0.95 to the enforced envelope (assert the returned peak ≥ both grid and analytical values; tolerance 1e-9) so the test can actually fail on an underestimate | low | pending |
| 21 | D-21 | web/calculator.jsx (`doExport`), docs/requirements_traceability.json | Escape `STD_NAME` in the report path (parity with `_generateTraceReport`); rewrite the traceability matrix to cite only evidence that exists | low | pending |
| 22 | D-13 | web/engine.js | Replace the two nonexistent-document citations with the actual inline justification (or delete the aside) | none | pending |

### Group 3: packaging, CI, and test infrastructure

| # | Findings | Files | Change | Risk | Status |
|---|---|---|---|---|---|
| 23 | E-1 | pyproject.toml, src/laser_mpe/ (data/), engine.py, CI | Standards JSON becomes package data (`importlib.resources`) with repo-layout fallback; `web/standards/` stays for the page; CI asserts the two copies are byte-identical | medium — loader path | pending |
| 24 | E-2 | pyproject.toml, __init__.py, engine.js, CI | Version single-sourced from pyproject (`importlib.metadata`); `_ENGINE_VERSION` aligned to 3.0.0 (it stamps exported audit traces); CI consistency check | low | pending |
| 25 | E-3, E-6 | web/package.json (+lockfile), .github/workflows/ci.yml, web/build.py, .gitignore | Commit `package-lock.json`; `npm ci` in CI; Babel-missing fallback becomes a hard error under CI; add rebuild-and-diff gate for `web/index.html`; resolve the ignore-vs-committed contradiction; ignore the example PNG; single `index.html` rebuild commit at the end of all web changes | medium | pending |
| 26 | E-4, E-5 | web/build.py, web/index.html, web/compute-sri.js (delete) | Emit SRI `integrity` + `crossorigin` for the five pinned CDN scripts (hashes from the npm tarballs, verified byte-identical to unpkg/jsdelivr for pinned versions); delete the stale never-applied SRI tool; fix the "self-contained" wording to "requires internet on first load" (vendoring is the alternative — see N-11) | low | pending |
| 27 | E-7, D-18, B-8 | .github/workflows/ci.yml, tests/ | Wire in: tracer suites (with their `web/ npm install` prerequisite), `verify_Tpoint_edge_cases`, both conformance suites, `verify_exhaustive` (via #29); ruff over `examples/`; drop the stray eslint-disable or add a minimal JS lint; make `npm test` aggregate | low | pending |
| 28 | B-2 | tests/conformance/ | Corpus regenerated **from the Python engine**; `tolerance \|\| 1e-9` bug fixed so exact-match cases are exact; corpus README/claims state the real direction; `power_offset` covered via an ANSI-file case or explicitly documented as uncovered | low (expected: zero value changes, per B-1) | pending |
| 29 | D-18, E-9 | tests/verify_exhaustive.py, tests/conformance/test_conformance_py.py, tests/verify_Tpoint.mjs | verify_exhaustive becomes pytest-collected; conformance becomes a real parametrized pytest module with standard-state save/restore; verify_Tpoint gains assertions (from its own documented expectations) or is renamed out of `verify_` | low | pending |
| 30 | D-10, D-12, D-17, D-25 | tests/*.py | Delete the duplicated emoji runners and `__main__` blocks; delete the confusion narration + discarded call; make the trivially-true checks real or remove them; fix the `check()` helpers (no bare except, no nonsense comment) | low | pending |
| 31 | D-23 | engine.py, engine.js, README.md:43, web/lsp/validate.js, web/lsp/factory.js (docs) | Delete dead code: engine.py:418-521 (after #14 folds the gated logic), `minSafeVelocity`/`maxPermissiblePower` dead exports (un-advertise in README; the live copies are in the worker strings — noted in AUDIT B-3), `MAX_SEGMENTS`; fix validate.js's stale Ajv comment and the wrong-draft `Ajv2020 \|\| Ajv` fallback; document factory.js as a dev/fixture tool | low | pending |
| 32 | D-14, D-15, D-16, D-24, D-8, D-7 | ci.yml, build.py, docs/API.md, src/laser_mpe/*, README.md | Comment/prose compression pass: audit-bookkeeping comments, build-essay docstrings, decorative rules, banner unification, `__init__` import ceremony, disclaimer trim (keep substance), deduplicate repeated claims | low — mechanical | pending |
| 33 | E-8 | scripts/generate_validation_report.mjs, ci.yml | Fix `allPass` (respect ruff + per-suite ok + nonzero totals), fix the `Date.now()` duration bug, stop mutating index.html as a side effect, wire into CI | low | pending |
| 34 | E-11, E-12 | examples/*.py, web/package.json | One import style (installed package); drop unused imports; PNG into `examples/outputs/` + no blocking `show()`; web/package.json gains name/version/license/engines and moves ajv to dependencies | low | pending |

Ordering constraints: #10–#17 before #28 (corpus regenerates once, after physics settles);
all web-touching items before #25's final rebuild commit; #14 before #31 (fold before
delete); #13's API.md updates land in the same commits as the behavior changes.

Verification per commit: `pytest tests/ -v` + `node tests/test_engine_js.mjs` + LSP
suites; web-touching commits also rebuild + bundle tests (e2e re-verified via CI on
push — sandbox cannot run it, AUDIT 0.2); physics-touching commits re-run the dense
differential harness and must show max-rel-discrepancy ≤ 2.9e-16 except where the change
itself is the delta (then the corpus updates in the same commit).

---

## Part 2 — NEEDS AUTHOR

Facts and decisions only the authors hold. (N-1 and N-2 are now RESOLVED — see below.)

- **N-1 — RESOLVED (no change).** Author supplied ICNIRP 2013 Table 5; it confirms the UV
  photochemical boundary is **302 nm** with integer-nm bins and a single `313 ≤ λ < 315` →
  6.3 kJ/m² bin. The JSON is already correct. Findings A-1/A-2 withdrawn; #11 withdrawn.
- **N-2 — RESOLVED (signed off).** Author chose the **exact** Rule-2 solution (Q2). #17
  now implements `min over T′ ∈ {T, standard breakpoints ≤ T (left-limits)} of
  MPE(T′)/(f·T′)` — the exact average-power minimum, superseding the ceil()+{T,10s}
  heuristic. Changes published numbers slightly in the conservative direction for T>10 s.
- **N-3.** The full "Francis et al. (2026)" citation (title, venue, DOI). Unlocks
  fixing README:48, CITATION.cff:17, CHANGELOG:71, web/README.md:36 — and the PA
  optimizer's verifiability (A-17).
- **N-4.** One authoritative author list. Today: paper (4, three sharing ORCID
  0009-0007-9290-6289, one empty), README (5 — includes Nicholas Borges), CITATION.cff
  (entity only), LICENSE (one person, year 2025). Needed: the list, each person's real
  ORCID, affiliations, and the intended copyright holder/year — then CITATION.cff and
  README are aligned in one commit.
- **N-5.** Real impact evidence, if any exists: the publication behind "[reference
  Ryan's example publication]", the lab behind "[research group in Spain…]", anything
  citable or linkable. This feeds both the paper's impact statement and the screening
  gate (AUDIT 0.1). If none exists yet, the honest statement is "none yet" — and the
  submission timing question in Part 3 becomes decisive.
- **N-6.** AI usage disclosure — the current one is contradicted by the repository
  (AUDIT C-7, D-26). Paste-ready skeleton; fill the brackets, delete what doesn't apply:

  ```markdown
  # AI usage disclosure

  Generative AI tools were used in this project as follows.

  - Tools: Claude Code (Anthropic) [MODEL/VERSION(S) USED, DATES]; [OTHER TOOLS, IF ANY].
  - Code: AI assistance was used for [code generation / refactoring / test scaffolding /
    build tooling — LIST WHAT ACTUALLY HAPPENED, PER COMPONENT: Python engine, JS engine,
    web UI, LSP subsystem, tests].
  - Documentation and supporting materials: AI assistance was used for [drafting/editing
    of README and docs — the repository history includes AI-assisted documentation
    editing, e.g. commit 3bf27c9; this sentence must cover it truthfully].
  - Manuscript: [state plainly whether any AI assistance touched paper.md; "none" is only
    writable if it is true].
  - Human role: The authors specified the requirements, made the core design decisions
    ([e.g.: adoption of ICNIRP 2013 as the encoded standard; the JSON data model; the
    dual Python/JS engine architecture; the scanning-fluence model and its conservatism
    policy; the Rule-2 evaluation semantics]), and reviewed, tested, and validated all
    AI-assisted output. The authors take full responsibility for the correctness of the
    software and this paper.
  ```

- **N-7.** A real contact address for the Code of Conduct reporting clause (#7 lands the
  file with a marked placeholder).
- **N-8.** GitHub repo settings this session cannot change: description, topics,
  homepage. Plus the release story: tags v1.0.0–v3.0.0 exist but point at parentless
  snapshot commits off `main`, and there are **zero GitHub Releases** and no archive DOI.
  After the fix pass: tag the honest next version on `main`, cut a Release, archive it
  (Zenodo) — required at JOSS acceptance, useful evidence at submission.
- **N-12.** Does the original day-by-day development history exist anywhere (a private
  repo, a pre-restart clone)? The public record shows only snapshot tags (Mar 28 –
  Apr 2) and a main line that begins mid-project on Apr 15 with no ancestor. Publishing
  the real history — or a README sentence explaining the restart — converts the
  disconnected-snapshot liability into ordinary provenance (AUDIT 0.1).
- **N-9.** Paper repairs (paper/ untouched by this review, per your decision — itemized
  from AUDIT C-7/C-12): fix the first-sentence grammar; delete the C++-desktop-app and
  IEC claims; "two core principles" vs three; fill or remove the empty Example-usage
  subsections; replace the three placeholders (the third-party names "Ryan"/"Judith"
  must not ship); rewrite the impact statement with N-5 facts or the honest "early
  stage" statement; populate `paper.bib` (ICNIRP 2013 with DOI 10.1097/HP.0b013e3182983fd4,
  the Francis reference from N-3, citations for LIA/KenTek claims or delete the pricing
  assertions and absolute negatives); wire `[@key]` citations into the text; replace the
  AI disclosure with N-6; reconcile the author block with N-4; delete the empty
  `paper/README.md` and `paper/Figures/` scaffolding or give them content.
- **N-10.** Intent of `https://octresearch.org/` as `url` in CITATION.cff /
  `author` in package.json — keep (lab site) or point at the repository?
- **N-11.** Offline posture (E-5): default per plan is truthful wording ("requires
  internet on first load; pinned + SRI after #26"). The alternative — vendoring
  React/Recharts/echarts into the page the way Ajv already is (~1.7 MB heavier page,
  genuinely self-contained) — is a product decision.

## Part 3 — CANNOT FIX

Structural facts no commit can change:

1. **Development history (AUDIT 0.1).** Three history-less snapshot tags (Mar 28 –
   Apr 2), then a 59-commit main line over 43 days with no ancestor connecting them, one
   contributor, zero external signals, zero Releases, dormant since May, repo public
   2026-03-23. The 2026 JOSS screening treats exactly this profile as a desk-rejection
   trigger. Options, honestly stated:
   - *Wait and build the record* (recommended): execute this plan as normal-cadence
     public commits over the coming weeks; tag + archive a release; get any real user
     (N-5) onto the public record; submit after the six-month-public mark (≥2026-09-23)
     with demonstrated use. Cost: months. Benefit: the gate finding flips to (b)/(a).
   - *Submit now anyway*: possible, with desk rejection the likely outcome per the
     criteria's own example; a rejection is also a record.
   - *Different venue*: a venue without JOSS's history gate (e.g. SoftwareX-class) is an
     option if timing dominates; that is an authors' strategic call, not a repair.
2. **Git history contents.** The three author identities, the mislabeled prose-cleanup
   commit (3bf27c9), and PR bodies citing a nonexistent `IMPLEMENTATION_SUMMARY.md` and
   a "452 tests" total are immutable history. The remedy is the accurate disclosure
   (N-6) and accurate current docs — not history rewriting, which this plan does not
   propose.
3. **External-community evidence** (issues, forks, users, citations) can only be earned;
   see N-5 and option 1 above.
