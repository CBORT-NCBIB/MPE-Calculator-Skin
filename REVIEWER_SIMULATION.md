# Reviewer Simulation — MPE-Calculator-Skin

Phase 4 of the pre-submission review: a hostile re-read as if I were the assigned
JOSS reviewer seeing the repository for the first time, evaluated against the
branch `claude/mpe-calculator-joss-review-bhbig3` after the Phase-3 fixes
(HEAD `7e4b011`). It is a working document, not part of the submission.

Where an item would block, the issue I would file is written in the reviewer's
voice. Items already resolved by the Phase-3 fixes are marked ✅ with the commit
theme; items that remain the authors' to resolve are marked ⛔ or ⚠.

---

## 1. Clean-clone acceptance transcript

Fresh `git clone` of the branch into an empty directory, following `README.md`
verbatim in a clean Python 3.11 venv (Node 22):

```
For users:        pip install -e .            -> import laser_mpe OK (3.0.0);
                                                  skin_mpe(532,10e-9) = 0.02  ✔
For contributors: pip install -e ".[test]"
                  pytest tests/ -v            -> 137 passed                   ✔
                  node tests/test_engine_js.mjs -> 80 passed                  ✔
                  (cd web && npm install)
                  node tests/test_tracer.mjs  -> 63 passed                    ✔
                  node tests/conformance/test_conformance_js.mjs -> 101 passed ✔
                  python examples/basic_usage.py -> runs, output as documented ✔
Wheel:            python -m build; pip install the wheel in a clean venv;
                  run skin_mpe from an unrelated cwd -> 0.02                   ✔
```

Every command in the README now works from a clean clone. Two items a reviewer
would still note (both were **broken before** this review): the "For users"
install does not include `pytest`, so the README now tells the reader to install
the `[test]` extra before the Testing section; and the web calculator needs
network access on first load for its CDN libraries (now stated honestly in the
READMEs, no longer claimed "self-contained").

---

## 2. JOSS review checklist (as the assigned reviewer)

### General
- **Repository accessible / open** — ✅ public, MIT.
- **License (OSI, plain text file)** — ✅ `LICENSE` is verbatim MIT. ⚠ Copyright
  line reads `2025` (predates all commits) and names a single individual while
  the paper lists four authors — see Authorship.
- **Substantial scholarly effort** — ⛔ **BLOCK (screening gate).** This is the
  finding that dominates the review and no code change can address it. See the
  issue below.
- **Authorship** — ⛔ **BLOCK.** The author set is inconsistent across the repo:
  `paper.md` lists four authors (three sharing one ORCID, one with no ORCID),
  `README.md` lists five, `CITATION.cff` credits only the entity "OCT Research",
  and `LICENSE` names one person. Cannot verify who the authors are.

### Functionality
- **Installation** — ✅ works from the README (fixed: canonical clone URL;
  wheel now ships its data so a non-editable install works; `[test]` extra noted).
- **Functionality** — ✅ core MPE, repetitive-pulse, and scanning functions run;
  browser tool exercises three tabs.
- **Performance** (if claimed) — n/a.

### Documentation
- **Statement of need** — ✅ present in README and paper.
- **Installation instructions** — ✅ (see above).
- **Example usage** — ✅ README quick-start + four example scripts with committed
  outputs; ⛔ the *paper's* "Example usage" section is still two empty headings.
- **Functionality documentation** — ✅ `docs/API.md` now documents all exported
  Python functions (band_name/rep_pulse added) with corrected unit/attribution
  claims.
- **Automated tests** — ✅ 143 pytest + 85 engine + tracer/LSP/conformance suites
  run from a clean clone, and CI now runs all of them: the tracer, T_point-edge,
  and both conformance suites were wired into `ci.yml`, `examples/` is linted, and
  `verify_exhaustive.py` was renamed to `test_verify_exhaustive.py` so pytest
  collects its 254 checks. The build job now also fails on any index.html rebuild
  drift (lockfile-pinned toolchain).
- **Community guidelines** — ✅ CONTRIBUTING (contribute + report issues + seek
  support) and a real `CODE_OF_CONDUCT.md` were added; ⚠ the CoC reporting
  contact is still a `[NEEDS AUTHOR]` placeholder.

### Software paper (`paper/paper.md`)
- **Summary** — ⚠ present but opens with a word-order error and marketing tone.
- **Statement of need** — ✅ labelled.
- **State of the field** — ⛔ names competing tools (LIA, KenTek) and makes two
  absolute "no software exists" claims with **zero citations**.
- **Software design (2026 requirement)** — ⛔ contains claims the software does
  not support (a C++ desktop application; IEC standard support) and says "two
  core principles" then lists three.
- **Research impact (2026 requirement)** — ⛔ three unfilled placeholders,
  including a third party's first name; remaining text is aspirational, which the
  criteria explicitly disallow.
- **AI usage disclosure (2026 requirement)** — ⛔ present but **inaccurate**: it
  states no AI was used on supporting materials, which the repository's own
  history contradicts. A corrected skeleton is provided in `FIX_PLAN.md`.
- **References** — ⛔ `paper.bib` is empty; ICNIRP 2013 — the standard implemented —
  is cited nowhere in citable form; the "Francis et al. (2026)" framework has no
  resolvable reference.

### Issues I would file (reviewer voice)

> **[BLOCK] Substantial scholarly effort / development history.** The default
> branch is 59 commits concentrated in a 43-day window (2026-04-15 – 2026-05-28)
> by a single author, dormant since; the only earlier public history is three
> parentless snapshot tags, and there are no releases, issues, forks, or external
> contributors. Under the 2026 criteria this profile — a short, concentrated
> history with no demonstrated use — is a desk-rejection trigger. Please either
> (a) publish the fuller development history if it exists and let the software
> accrue demonstrated use over the six-month window, or (b) provide concrete
> evidence of external adoption. I'm flagging this to the editor before
> proceeding with the rest of the review.

> **[BLOCK] Paper is incomplete.** `paper.bib` is empty and the paper cites
> nothing; the Example-usage section is empty; the Research-impact section
> contains unfilled placeholders (one naming a third party); and the paper claims
> a C++ desktop application and IEC support that do not exist in the repository.
> Please complete the paper, cite ICNIRP 2013 (doi:10.1097/HP.0b013e3182983fd4)
> and the tools named in State of the field, and remove the unsupported claims.

> **[BLOCK] Authorship and AI disclosure.** The author list differs across
> paper/README/CITATION.cff/LICENSE and three authors share one ORCID; please
> reconcile to one authoritative list with correct per-author ORCIDs. The AI
> usage disclosure states no AI was used on supporting materials, which the
> commit history appears to contradict — please make it accurate.

> **[NON-BLOCKING] CI coverage.** ✅ Resolved after this pass: the tracer,
> T_point-edge, both conformance suites, and (renamed) `test_verify_exhaustive.py`
> are now run by CI, `examples/` is linted, and the build job fails on index.html
> rebuild drift against a committed lockfile. The remaining test-infra polish
> (converting the Python conformance runner to a parametrized pytest module with
> standard-state save/restore, and giving `verify_Tpoint.mjs` assertions) is
> cosmetic and tracked in `FIX_PLAN.md`.

---

## 3. Three questions an ICNIRP-literate laser safety officer would ask

**Q1. Your UV photochemical limit is stored as integer-nanometre steps starting
at 302 nm. ICNIRP 2013 Table 5 — are you sure the 30 J/m² region ends at 302 and
not 302.5?**
Yes. Table 5 (Health Phys 105(3):283) lists `180 ≤ λ < 302 → 30 J m⁻²` and
`302 ≤ λ < 303 → 40 J m⁻²`, i.e. integer-nm bins with the boundary at 302, and a
single `313 ≤ λ < 315 → 6.3 kJ m⁻²` bin. `web/standards/icnirp_2013.json` encodes
exactly this (`uv_discrete_steps` + the `180 ≤ λ < 302` constant). Verified against
the standard PDF; `tests/test_skin_mpe.py` and the conformance corpus pin the band
edges. (An earlier draft of this review wrongly proposed 302.5 nm from the older
actinic convention; checking the printed table refuted it — no value was changed.)

**Q2. For a long repetitive-pulse exposure (say a 100 s train), do you evaluate
Rule 2 only at the full exposure time, which would under-count the average power?**
No longer. Rule 2 is the average-power rule: `f·H ≤ MPE(T′)/T′` for every window
`T′` up to the total. Because `MPE(T′)/T′` is non-increasing within each analytic
piece and steps up only at a breakpoint (the t^0.25 → linear transition at 10 s),
the binding value is `g_min = min over T′ of MPE(T′)/T′`, evaluated at the
standard's breakpoints (as left limits) and at T. See
`engine._rule2_avg_irradiance_limit` / `web/engine.js:_rule2AvgIrradianceLimit`.
For T > 10 s this is up to ~2.24 % more conservative than the old endpoint
estimate; `tests/test_skin_mpe.py::TestRepetitivePulse::test_rule2_exact_subwindow_minimum`
pins the 10 s binding window, and both engines agree to < 2×10⁻¹⁶.

**Q3. If I load a custom or mistyped standard file, can the tool silently give me
a non-conservative number?**
The known silent-degradation path is closed. A `discrete` region whose lookup
table does not resolve previously fell back to the thermal-only UV limit (140×
too high at 302 nm); both validators now reject it, Python's `load_standard`
raises, and the JS engine fails closed (keeps the last valid standard). Invalid
scalar inputs to `ca()`/`band_name()` raise instead of returning a plausible
wrong value, and `large_area_MPE_skin` raises on a NaN area. The residual
honest caveat: `skin_mpe`/`skin_mpe_array` still return NaN for out-of-range
inputs by design (documented, and treated as "exceeds" by the pass/fail checks) —
appropriate for array plotting, not a silent wrong value. Remaining
lower-severity items (the scanning grid-cap anisotropy, the verdict-vs-exported-
trace divergence for custom scan paths) are documented in `AUDIT.md` (A-14,
A-20/21) and not yet fixed.

---

## 4. Verdict

**Major Revisions — and, on the development-history criterion alone, currently at
risk of desk rejection.**

The software itself is, after this review, in good and honest shape: it installs
and tests cleanly from a fresh clone, the safety-critical numerics are correct
and now pinned (UV band edges verified against Table 5, the 3×10⁴ s edge, the
exact Rule-2 minimum, fail-closed standard validation), the two engines agree to
floating-point precision over a dense grid, the packaging Blocker is fixed, and
the documentation no longer makes claims the code cannot back.

But three submission-blocking problems remain, and they are the authors' to
resolve, not the code's:

1. **Development history** (CANNOT FIX in code) — the public record is a short,
   single-author burst with no demonstrated use. This is the JOSS 2026 screening
   gate and it outranks everything else. The realistic paths are to build the
   public record over the coming months (sustained commits, a real release, at
   least one external user on the record) and submit after the six-month mark, or
   to demonstrate existing external adoption if it exists.
2. **The paper** is incomplete and contains unsupported claims (empty
   bibliography, empty usage section, placeholder impact text, a nonexistent C++
   app and IEC support).
3. **Authorship and the AI disclosure** must be reconciled and made accurate.

My recommendation to the editor: do not advance to full technical review until
the history gate is credibly addressed; the code quality, now solid, is not the
limiting factor. If and when the project resubmits with a real development record
and a complete paper, the implementation is close to acceptable and the
scanning-exposure model plus the cross-verified dual implementation are a genuine
contribution worth publishing.
