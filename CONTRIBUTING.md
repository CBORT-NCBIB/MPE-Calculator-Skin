# Contributing to Laser MPE Calculator (Skin)

Thank you for your interest in contributing. This project computes safety-critical laser exposure values, so contributions must be held to a high standard of accuracy and traceability.

## How to Contribute

### Reporting Issues

If you find a discrepancy between the calculator output and the expected standard values, please open an issue with:

1. The specific wavelength, exposure duration, and standard edition you are referencing.
2. The expected MPE value (with the table/section reference from the standard).
3. The value the calculator produces.

### Seeking Support

For questions about installing or using the software, please open a GitHub issue
on the [repository](https://github.com/CBORT-NCBIB/MPE-Calculator-Skin/issues).

### Proposing Changes

1. Fork the repository and create a branch from `main`.
2. Make your changes.
3. Add or update tests to cover your changes.
4. Run the test suites and confirm they pass. Use `pytest` (running the test
   files directly can mask import errors by exiting 0):
   ```bash
   pip install -e ".[test]"
   pytest tests/ -v                      # Python
   node tests/test_engine_js.mjs         # JavaScript engine
   ```
   If you change the web calculator, also run `npm install` in `web/` and the
   Node and end-to-end suites (see `docs/e2e-testing.md`).
5. Submit a pull request with a clear description of what was changed and why.

### Standards Traceability

Every numerical value in this codebase must be traceable to a specific table, section, or equation in the loaded standard. When adding or modifying values:

- Include the standard edition, table number, and row in comments.
- Use the annotation convention: `[STANDARD-REF]`, `[UNVERIFIED]`.
- Add corresponding test cases that hand-compute the expected value from the standard's formula.

### Code Style

- Follow PEP 8.
- Use NumPy-style docstrings.
- All functions that return MPE values should return radiant exposure in J/cm².
- Boundary conventions: half-open intervals (`t₁ ≤ t < t₂`, `λ₁ ≤ λ < λ₂`), with the upper edge of the outermost wavelength band treated as inclusive.

## Code of Conduct

This project is governed by the [Code of Conduct](CODE_OF_CONDUCT.md). By
participating, you are expected to uphold it; please report unacceptable behavior
through the contact listed there.
