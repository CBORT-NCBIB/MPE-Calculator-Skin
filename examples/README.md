# Examples

This directory contains example Python scripts demonstrating common uses of the `laser_mpe` package. Each script can be run directly after installation.

## Running the examples

```bash
cd examples
python basic_usage.py
python repetitive_pulse_analysis.py
python photoacoustic_scenarios.py
python mpe_comparison.py
```

## Scripts

**`basic_usage.py`** — Core usage patterns: single-pulse MPE for common wavelengths, repetitive-pulse MPE at varying PRF, a practical safety check comparing actual fluence against the MPE, and T_max lookup for each wavelength band.

**`repetitive_pulse_analysis.py`** — Detailed repetitive-pulse analysis: per-pulse MPE vs. PRF showing the Rule 1 / Rule 2 crossover, SNR optimization across exposure times (finding the optimal PRF), and maximum safe pulse energy calculations for common photoacoustic system configurations.

**`mpe_comparison.py`** — Generates comparison plots of skin MPE vs. wavelength and vs. exposure duration. Outputs a PNG figure (`skin_mpe_comparison.png`) in addition to the tabulated values printed to the console.

**`photoacoustic_scenarios.py`** — Evaluates four real-world photoacoustic imaging configurations (OR-PAM, AR-PAM, PACT with Nd:YAG, and PACT with OPO) against skin MPE limits, computing the safety ratio for each.

## Expected outputs

The `outputs/` subdirectory contains the expected console output from each script. After running a script, you can compare your output against these reference files to verify your installation is working correctly:

```
outputs/
├── basic_usage_output.txt
├── mpe_comparison_output.txt
├── photoacoustic_scenarios_output.txt
└── repetitive_pulse_analysis_output.txt
```

If your output differs from the reference files, check that you have the correct version of the package installed and that the standard data file (`web/standards/icnirp_2013.json`) has not been modified.
