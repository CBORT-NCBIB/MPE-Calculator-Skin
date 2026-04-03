# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.0.0] - 2026-04-02

### Added

#### Beam Safety Evaluation
- **Beam safety evaluation** section in the MPE Calculator tab (collapsible, default: collapsed). Given a beam diameter, computes the limiting aperture, evaluation regime, evaluation area, and maximum permissible pulse energy per the loaded standard's aperture rules.
- **Three evaluation regimes** implemented: actual radiant exposure (d < threshold), aperture-averaged (threshold ≤ d < aperture), and beam-fills (d ≥ aperture). Regime thresholds and aperture diameters read from the JSON standard file — not hardcoded.
- **Multi-wavelength evaluation**: users select which wavelengths to evaluate via checkboxes. Results displayed in a table with one row per selected wavelength, showing aperture, regime, evaluation area, fluence, and max energy side by side.
- **Safety comparison**: optional pulse energy or direct fluence input triggers a pass/fail verdict with ratio and margin for each wavelength.
- **Beam diameter convention warning** reads from the standard's JSON metadata (beam_diameter_definition, beam_diameter_reference), with prominent 1/e vs 1/e² conversion guidance.
- **Dedicated Calculate button** for beam evaluation, independent of the main Calculate button. Beam-specific inputs (diameter, pulse energy, fluence) use a separate dirty state.
- `getAperture()` and `beamEval()` functions added to both `engine.js` and `calculator.jsx`, with input validation (d ≤ 0, NaN, Infinity → `"invalid"` regime).

#### Input Unit Selectors
- **Wavelength**: nm / µm dropdown on each laser card, with automatic value conversion on unit switch.
- **Pulse duration**: s / ms / µs / ns / ps dropdown on each laser card.
- **Repetition rate**: Hz / kHz / MHz dropdown (when repetitive pulse mode is enabled).
- **Exposure time**: s / ms / µs / ns / ps dropdown (when repetitive pulse mode is enabled).
- **Beam diameter**: mm / µm / cm / m dropdown with auto-conversion.
- **Pulse energy**: J / mJ / µJ / nJ dropdown.
- **Direct fluence**: mJ/cm² / J/cm² / J/m² / mJ/m² dropdown.
- Default pulse duration changed from `1e-8` (scientific notation in seconds) to `10` ns — more intuitive for typical users.

#### Table Unit Selectors
- All table columns with physical units now have **interactive dropdown selectors in the header** (not static text). Users can switch units and all cell values update immediately.
- **Summary table**: Duration, Fluence H, and Irradiance E headers each contain a unit selector.
- **Beam evaluation table**: Duration, Eval Area, Fluence H, and Max Energy headers each contain a unit selector.
- **PA tab table**: Exposure Time header contains a unit selector.
- Header dropdown style matches the input dropdown visual language (bordered box) so users can clearly identify them as interactive.

#### Photoacoustic SNR Optimizer Improvements
- **Multi-band fluence chart** (Figure 2a equivalent): shows all seven ICNIRP wavelength bands simultaneously with crossover markers.
- **Exposure time input** for the PA tab fluence chart (previously hardcoded to T = 1 s).
- Optimal PRF summary table now includes **N at optimal** column.

#### Build System
- **`web/build.py`**: generates `index.html` from `calculator.jsx` + JSON standard file. Strips ESM imports, renames Tooltip → RTooltip, strips `export default`, inlines standard data. Requires only Python 3.

#### Standard-Independence
- JSON standard file gained: `small_beam_threshold_mm`, `small_beam_note`, `small_beam_reference`, `beam_diameter_definition`, `beam_diameter_reference`, `aperture_reference`.
- All beam evaluation regime thresholds, convention warnings, and reference citations read from the JSON — zero hardcoded standard-specific values in user-facing UI text.

### Changed
- **Theme colors**: light mode changed from pure white (#fafafa) to cool gray (#f0f2f5); dark mode changed from near-black (#18181b) to charcoal (#28282e). Both maintain the colorblind-safe Wong palette.
- **SI unit capitalization**: removed `textTransform: "uppercase"` from all table header styles. Previously rendered "mJ/cm²" as "MJ/CM²" — a safety-relevant misrepresentation where milli (10⁻³) appeared as mega (10⁶).
- **C_A notation**: all user-facing instances changed from `C_A` to `Cₐ` (Unicode subscript). HTML export uses `C<sub>A</sub>`.
- **Units in headers only**: all table cell values are now bare numbers. Units appear exclusively in column headers. Applies to summary table, beam evaluation table, PA tab table, and HTML export report.
- Beam safety evaluation defaults to collapsed.
- PA tab chart button labels clarified.

### Fixed
- `index.html` rebuilt from `calculator.jsx` via `build.py` (was stale since v2.0.0).
- Loading screen background color updated to match new light theme.
- HTML export table: removed unit suffixes from cell values, added units to column headers, fixed C_A → C<sub>A</sub>.
- `web/README.md` updated with development workflow and feature list.

## [0.2.0] - 2026-03-31

### Added
- **Data-driven architecture:** All standard-specific values now live in a single JSON file (`web/standards/icnirp_2013.json`). The calculation engine reads coefficients, band boundaries, correction factors, and supplementary parameters from this file at runtime. Switching standards requires changing only the JSON — no code modifications needed.
- **Generic engine API:** New primary functions `skin_mpe()`, `ca()`, `band_name()`, `rep_pulse()`, `load_standard()`, `get_standard()`, and `validate_standard()` that are standard-agnostic.
- **Photoacoustic SNR Optimizer tab** in the web calculator, implementing the analytical framework from Francis et al. (2026), Equations 5–12. Includes optimal repetition rate table, per-pulse fluence vs. PRF plot, and relative SNR vs. PRF plot.
- **Per-wavelength unit dropdown menus** for fluence (mJ/cm², J/cm², J/m², mJ/m²) and irradiance (W/cm², mW/cm², W/m²) on each wavelength card, in the summary table, and in the export report.
- **Plot unit selector** that controls the Y-axis, tooltip values, and CSV export column headers across both MPE plots.
- **Scientific notation** with Unicode superscript formatting (×10ⁿ) for large and small values, replacing JavaScript's `toExponential()`. Log-scale Y-axis ticks display as 10ⁿ.
- **Y-axis labels** on all four plots (two MPE tab, two PA tab).
- **X-axis label** "Wavelength (nm)" on the wavelength plot.
- **Supplementary parameters** (T_max, limiting apertures, large-area correction, UV de-rating) moved from hardcoded Python values into the JSON standard file's `supplementary` section. `skin_parameters.py` now reads all values from the loaded standard.
- **Schema validation** in both Python (`validate_standard()`) and JavaScript (`_validateStandard()`) that runs on load and catches malformed data files.
- **Example outputs** in `examples/outputs/` so users can cross-check results after installation.
- `examples/README.md` documenting all example scripts and their expected outputs.
- `web/standards/README.md` with complete JSON schema documentation including all formula types, band modes, and supplementary parameters.

### Changed
- Renamed `icnirp_skin.py` to `legacy.py`. The ICNIRP-named functions (`H_skin_ICNIRP_MPE`, etc.) are preserved for backward compatibility but now delegate to the generic engine.
- `__init__.py` now exports the generic API as the primary interface, with legacy functions in a clearly-marked section.
- `repetitive_pulse.py` imports from `engine.py` instead of the legacy module.
- `correction_factors.py` delegates to `engine.ca()`.
- README reorganized: separate installation sections for users, contributors, and web-only usage; explicit statement that `laser_mpe` is a Python library; pointer to `docs/API.md`.
- Summary table column headers changed to "Fluence (H)" and "Irradiance (E)" with per-wavelength units.
- "Per-Pulse MPE" is now a section header above the fluence and irradiance values, not a value label.
- Number of Pulses column shows "1" for single-pulse (not "—").
- Standards Compliance table in README uses generic descriptions instead of ICNIRP-specific table numbers.
- README plot image cropped to show only MPE vs. Duration (removed cluttered wavelength overview).

### Fixed
- Mobile crash on PA tab scroll: tooltip formatters now guard against `undefined` values from Recharts touch events.
- Export report string concatenation for standard name.
- Header badge JSX syntax (missing `>` after style prop).
- All documentation updated: test counts (329, not 330), C_A formula in API.md, removed false "Shareable URLs" and "PDF export" claims from web/README.md.
- Version numbers synchronized across `pyproject.toml`, `__init__.py`, and `CITATION.cff`.
- Removed stray `skin_mpe_comparison.png` from repository root.
- Removed committed `__pycache__/` and `.egg-info/` directories.
- Removed dead code: unused `numerator` variable, `fluLabel()` function, `BANDS` array.

## [0.1.0] - 2025

### Added
- Skin MPE for all wavelength bands (180 nm to 1000 µm).
- UV band (180–400 nm) with dual-limit logic (thermal and photochemical).
- C_A correction factor for 400–1400 nm (Table 3).
- Repetitive-pulse skin MPE with Rules 1 and 2.
- T_max recommended exposure durations.
- Limiting apertures for skin.
- Large area exposure correction for λ > 1.4 µm.
- UV successive-day de-rating for 280–400 nm.
- Unit conversions (J/cm², mJ/cm², W/cm², mW/cm², pulse energy, average power).
- Test suite with automated checks.
- Interactive web calculator with multi-wavelength comparison and dual-rule display.
