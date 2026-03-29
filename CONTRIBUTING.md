# Contributing to Laser MPE Calculator (Skin)

Thank you for your interest in contributing. This project computes safety-critical laser exposure values, so contributions must be held to a high standard of accuracy and traceability.

## How to Contribute

### Reporting Issues

If you find a discrepancy between the calculator output and the ICNIRP standard, please open an issue with:

1. The specific wavelength, exposure duration, and standard edition you are referencing.
2. The expected MPE value (with the table/section reference from the standard).
3. The value the calculator produces.

### Proposing Changes

1. Fork the repository and create a branch from `main`.
2. Make your changes.
3. Add or update tests to cover your changes.
4. Run all four test suites and confirm they pass:
   ```bash
   python tests/test_skin_mpe.py
   python tests/test_skin_parameters.py
   python tests/test_correction_factors.py
   python tests/verify_exhaustive.py
   ```
5. Submit a pull request with a clear description of what was changed and why.

### Standards Traceability

Every numerical value in this codebase must be traceable to a specific table, section, or equation in the ICNIRP 2013 guidelines. When adding or modifying values:

- Include the standard edition, table number, and row in comments.
- Use the annotation convention: `[ICNIRP-2013]`, `[UNVERIFIED]`.
- Add corresponding test cases that hand-compute the expected value from the standard's formula.

### Code Style

- Follow PEP 8.
- Use NumPy-style docstrings.
- All functions that return MPE values should return radiant exposure in J/cm².
- Boundary conventions: `t₁ ≤ t < t₂` (left-inclusive, right-exclusive).

## Code of Conduct

Please be respectful and constructive in all interactions. We are committed to providing a welcoming and inclusive environment for everyone.
