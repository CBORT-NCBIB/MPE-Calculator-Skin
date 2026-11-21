---
title: 'Maximum Permissible Exposure Tool for Laser Safety Evaluation'
tags:
  - Python
  - JavaScript
  - laser safety
  - maximum permissible exposure
  - ICNIRP
  - biomedical optics
  - photoacoustic imaging
  - optical coherence tomography
authors:
  - name: Isaac Gallegos
    orcid: 0009-0007-9290-6289
    corresponding: true
    affiliation: 1
  - name: Nicholas Borges
    affiliation: 1
  - name: Ryan McAuley
    affiliation: 1
  - name: Brett E. Bouma
    affiliation: "1, 2"
  - name: David Veysset
    corresponding: true
    affiliation: 1
affiliations:
  - name: Wellman Center for Photomedicine, Harvard Medical School, Massachusetts General Hospital, Boston, MA 02114, USA
    index: 1
    ror: 002pd6e78
  - name: Institute for Medical Engineering and Science, Massachusetts Institute of Technology, Cambridge, MA 02139, USA
    index: 2
    ror: 042nb2s44
date: 20 November 2026
bibliography: paper.bib
---

# Summary

Laser-based systems are now ubiquitously used in a wide range of fields including manufacturing, metrology, remote sensing, telecommunications, entertainment, and medicine. In many situations, the human body may be exposed to laser radiation, which can cause photochemical and photothermal damage to tissue, owing to laser optical properties such as high collimation, high peak or average power, non-visible wavelengths, and short pulse durations [@ANSIZ136_2022; @ICNIRP2013]. The skin and the eye are particularly at risk, making safety assessment essential before use. In medical applications, moreover, lasers can be intentionally directed at tissue for treatment or imaging, further underscoring the need for rigorous safety assessment.
The American National Standards Institute (ANSI), International Electrotechnical Commission (IEC), and International Commission on Non-Ionizing Radiation Protection (ICNIRP) set Maximum Permissible Exposure (MPE) safety limits. The calculation of these limits for many applications, however, is notoriously challenging. We present here a software simulation tool to calculate MPE for diverse scenarios to aid engineers, researchers, students, and safety professionals who wish to follow skin safety guidelines while exploring new laser applications and optical technologies. By automating exposure assessments, the tool aids laser safety officers (LSOs) in compliance, risk assessment, and the implementation of safety protocols [@ICNIRP2013; @ANSIZ136_2022].

Key features include (1) a web-based interface, (2) an easy-to-follow, validated Python package, (3) safety limit determination for laser scanning protocols, (4) the capability for users to switch safety standards easily, and (5) a tool for signal-to-noise ratio (SNR) optimization in Photoacoustic Imaging (PAI). These features make our MPE calculator an accessible tool that informs safe laser exposure and facilitates optical design for researchers and engineers.

# Statement of need

The IEC, ANSI, and ICNIRP publish comprehensive safety standards that cover both accidental and intentional instrumental exposure of the body to laser irradiation. Each standard, such as the ANSI Z136.1-2022 for accidental exposure to the skin and eye, provides specific guidelines for LSOs and laser users to assess risks and facilitate their protection. For laser exposure to the skin, there are only standards for accidental exposure; thus, for any MPE or scanning-beam calculations, the accidental exposure standard is used.

Most standards are challenging to interpret and implement due to their complexity, underscoring the need for a user-friendly and intuitive tool to automate MPE calculations. Additionally, MPE calculations rapidly become complicated when applied to complex beam-scanning patterns for imaging applications, repeated beam exposures, and multi-wavelength irradiation, highlighting the need for a platform that accounts for these factors. This MPE calculator was designed with a focus on the specific use cases of biomedical imaging applications, such as optical coherence tomography (OCT) and photoacoustic imaging (PAI). OCT is an imaging modality based on forming images from backscattered light in optical interferometry. OCT enables depth-resolved, cross-sectional, volumetric imaging. PAI is an imaging modality based on the optical excitation of molecules, which expand and emit ultrasonic waves that detectors measure and map to an image. In PAI, the signal scales with pulse fluence because the generated pressure wave results from thermoelastic expansion, which is proportional to the optical excitation energy per unit area. Thus, users have an incentive to push the laser energy as high as the MPE allows, a trend also observed in OCT [@Upputuri2019nir2; @Wang2012pat]. A tool that quantifies the SNR–fluence–safety trade-off lets users find this operating point directly rather than conservatively approaching the limit [@SNRoptimize; @Beard2011pai; @Drexler2015oct].

# State of the field

Several existing MPE calculators include the Laser Institute of America (LIA) web-based laser safety hazard analysis system and desktop platform. Kentek has also developed the EASY-HAZ laser hazard analysis software, designed to evaluate laser environments and report laser safety recommendations. LIA offers a free version of its laser safety tool, but with limitations such as the simulation of only one wavelength (532 nm) that severely restrict its utility. The full LIA suite requires a monthly or annual subscription, which can be prohibitively expensive for most users [@LIA2023tools; @Kentek2023easyhaz]. Neither the LIA nor the Kentek MPE web-based and desktop tools include laser safety evaluation for scanning beams, making these platforms difficult to use for common optical imaging scenarios or system design applications [@WOLFER2019100898; @Fox2023pulseoverlap; @Sanders:84; @osti_5782268]. Additionally, no existing software provides a convenient way to optimize SNR in photoacoustic imaging, making this feature of our tool particularly unique.

# Software design

Our MPE calculator is a standalone Python package and web interface for evaluating laser safety exposure. Python provides transparency, flexibility and ease of use for the library package; HTML powers the web interface and JavaScript efficiently drives the web engine. The software can be installed and used as a Python library or as a standalone web-interactive tool. Our goal was to provide a user-friendly interface to efficiently implement laser safety calculations, including computing the MPE for arbitrary wavelengths and exposure durations, performing unit conversions, and loading different safety standards. This modular design maximizes ease of use and accessibility while providing multiple ways for users to use the software. Figure \ref{fig:software-design} displays the design structure of the MPE calculator.

![A depiction of our software's design structure including inputs, computational engines, outputs, and traceability features.\label{fig:software-design}](Figures/SoftwareDesign.jpeg){width="100%"}

To enable users to switch or upload safety standards, the web engine calculator is designed to reference a default or user-uploaded JSON file containing the complete set of table values and exceptions for the standard. The ICNIRP 2013 standards are publicly available and thus are provided in the GitHub repository. Users who have purchased another standard can edit the JSON file to align with their respective standard.

A unique feature of the web interface is that it allows users to upload their own custom scan patterns as a JSON file. This enables users to specify both the geometry and the velocity of the scan at every location. This feature provides endless flexibility for designing realistic, arbitrary, beam paths, opening the door to limitless design optimization for users.

# Testing and Validation

We validated the calculator, as described below, at three levels: hand calculations against the published ICNIRP standard tables, cross-language numerical agreement between the JavaScript and Python implementations, and independent external checks. Nonetheless, we emphasize that our tool is intended to assist with exploring various optical illumination and imaging scenarios only; users must assume all responsibility for final safety determinations prior to conducting any applications *in vivo*.

## Verification Against the Standard

An exhaustive verification script recomputes every expected MPE value directly from the ICNIRP 2013 coefficients [ICNIRP Tables 3, 5, and 7, @Gallegos2026MPECalcSkin] and compares against the engine output. This covers all six wavelength bands, the $C_A$ correction factor, UV dual-limit evaluation, the discrete photochemical lookup, and the repetitive-pulse rules. Boundary-value tests target the ten wavelength transitions between adjacent bands and the duration-region boundaries within each band, where off-by-one errors in interval matching would produce incorrect results.

For the scanning framework, we cross-validated the separable Gaussian-sum computation against a brute-force segment superposition on identical geometries. The per-point $T_\text{point}$ timing model was verified by hand for linear, raster, bidirectional, and CW scan patterns, including corner and edge points where the distinction between $T_\text{point}$ and $T_\text{total}$ is largest.

## Cross-Language Conformance

The JavaScript and Python engines are independent implementations reading the same JSON-encoded standard. Shared test cases spanning every wavelength band, formula type, correction-factor region, and repetitive-pulse regime confirm numerical agreement to a relative tolerance of $10^{-9}$.

## External Validation

We compared the calculator against Kentek's EASY-HAZ software across a range of wavelengths and exposure durations.

## Computation Traceability

Each computation can produce a trace document that records the full derivation chain, including the utilized standard (identified by its SHA-256 hash), the wavelength band and region, the formula and coefficients that were applied, and the numerical result at each step. The trace embeds a verbatim copy of every matched table entry from the loaded standard, making it self-contained and independent of the standard edition used. An export function generates a Hazard Evaluation Worksheet suitable for institutional laser safety review.

# Example Usage

In this section, we demonstrate that the path of a scanned beam is essential in determining whether a given exposure exceeds or falls within safety limits. We demonstrate this with two cases that differ only in the scan direction (ie, wavelength, beam diameter, average power, scan velocity, line spacing, and scan area are all held constant).

## Setup

Both cases share the parameters shown in table \ref{tab:scan-params}, evaluated with the ICNIRP 2013 guidelines for skin exposure:

: Scan parameters for the two-case demonstration. Both cases use identical beam and scan-area parameters; only the scan direction differs. \label{tab:scan-params}

+:-------------------+------------:+:----------------+-------------------------------:+
| Wavelength         | 2000 nm     | Scan velocity   | 4000 mm/s                      |
+--------------------+-------------+-----------------+--------------------------------+
| Beam dia. ($1/e$)  | 25 $\mu$m   | Jump velocity   | 20 000 mm/s                    |
+--------------------+-------------+-----------------+--------------------------------+
| Average power      | 65 mW       | Scan area       | 10 $\times$ 1 mm (fast × slow) |
+--------------------+-------------+-----------------+--------------------------------+
| Laser mode         | CW          | Number of lines | 100                            |
+--------------------+-------------+-----------------+--------------------------------+
| Line spacing       | 10 $\mu$m   | Blanking        | On                             |
+--------------------+-------------+-----------------+--------------------------------+

These parameters are characteristic of a commonly used thulium fiber laser dermatological and surgical application scenario in the 2-$\mu$m spectral band [@Li:15; @SNRoptimize]. The line spacing of 10 $\mu$m is smaller than the beam diameter (25 $\mu$m), so adjacent scan lines overlap, and the cumulative fluence from multiple lines contributes to the exposure at any given point.

## Results

**Case A: Unidirectional raster.** All 100 scan lines traverse the 10 mm width in the same direction (left to right). After each line, the beam performs a blanked flyback (right to left at the jump velocity) and advances one line spacing before scanning the next line.

![Web tool output for Case A (unidirectional raster). The safety verdict is PASS with a margin of $+7.8\%$. The worst-case point is located near the left edge of the scan.\label{fig:case-a}](Figures/CaseA.png){width="100%"}

**Case B: Bidirectional raster.** Consecutive scan lines alternate direction: odd-numbered lines scan left to right, even-numbered lines scan right to left. Between lines, the beam advances one line spacing via a blanked perpendicular jump.

![Web tool output for Case B (bidirectional raster). The safety verdict is FAIL with a margin of $-6.6\%$. The worst-case point is near the right edge of the scan, where consecutive lines reverse direction.\label{fig:case-b}](Figures/CaseB.png){width="100%"}

## Interpretation

Both cases exhibit identical Rule 1 ratios (0.733) and peak fluence values (0.162 J/cm$^{2}$). The safety assessment is governed exclusively by Rule 2, which compares the cumulative fluence at each point to MPE($T_\mathrm{point}$). Here, MPE($T_\mathrm{point}$) refers to the ICNIRP skin maximum permissible exposure evaluated over the per-point exposure window $T_\mathrm{point}$, defined as the interval between the first and last energy deposition at that location.

In the unidirectional raster configuration (Case A), consecutive line visits at any given point are separated by a complete flyback traversal. For points near the left edge, the beam arrives at the start of each line, resulting in an inter-line interval equal to the sum of the line scan time and the flyback time. This configuration produces $T_\mathrm{point} \approx 9$ ms at the worst-case location. In contrast, at the bidirectional turn-around (Case B), the end of one scan line and the beginning of the next both occur at the same edge of the scan field. The beam completes line $n$ (scanning left to right), executes a brief perpendicular jump of one line spacing at the jump velocity ([$\sim$]{}0.5 $\mu$s), and immediately initiates line $n{+}1$ (scanning right to left). This sequence compresses the inter-line timing at the turn-around edge, reducing $T_\mathrm{point}$ to approximately 5 ms.

A wavelength of 2000 nm is within the FIR 1800--2600 nm band specified by ICNIRP 2013 (Table 7), where the skin MPE remains nearly constant at approximately 0.1 J/cm$^{2}$ for exposure durations in the microsecond-to-millisecond range, before increasing for longer exposures. This plateau in the MPE curve indicates that the reduced $T_\mathrm{point}$ at the bidirectional turnaround does not result in a proportional increase in permissible exposure. Instead, the cumulative fluence is compared to a slightly lower MPE value for 5 ms (0.149 J/cm$^{2}$) than for 9 ms (0.172 J/cm$^{2}$) in the unidirectional case, causing the bidirectional Rule 2 ratio to exceed 1.0.

# Research impact statement

The initial research need for the MPE calculator tool stemmed in part from the desire to create a tool that also enables optical design for photoacoustic imaging. The paper by K. J. Francis et al. establishes a framework for SNR optimization and guides researchers and engineers in designing photoacoustic systems [@SNRoptimize]. The MPE calculator also emerged from a research need in biomedical imaging to characterize the safety limits of MPE to the skin while (1) removing the cost barrier of using the IEC, ANSI, or ICNIRP tools and (2) enabling MPE computations for complex scan geometries. The MPE calculator started as a simple web-based interface and Python library and evolved into a more robust platform for MPE calculations and optical design.

In research contexts, the software supports rigorous MPE characterization and enables users to compare configurations of wavelengths, pulse durations, pulse repetition frequency, scanning patterns, and beam diameters, all of which are essential for reproducible peer-reviewed studies.

We envision that this tool could be used to maximize the efficiency of imaging protocols in the biomedical field and could be extended to MPE evaluation for the eye. Further, our software could be used to explore beam scanning patterns, such as the commonly used multi-meridian scan, on the eye.

# Future capabilities

Several extensions would broaden the tool's utility for laser safety evaluation. In terms of hazard-control, the calculator could compute the optical density required for protective eyewear and the power-handling requirements for laser barriers and curtains, routine but essential calculations for any laser safety officer, and a primary reason commercial packages such as EASY-HAZ are widely adopted. Incorporating these features would make the tool a more complete replacement for existing commercial software.

A second direction concerns eye exposure in ophthalmic imaging. Current commercial tools, including those from LIA and Kentek, do not account for the ANSI Z80 ophthalmic-instrument classification when evaluating OCT systems. Determining whether an instrument falls under Group 1 (no photochemical or thermal hazard) or Group 2, and computing the corresponding exposure limits, would make the calculator uniquely useful for the ophthalmic imaging community. Combined with the extension to eye MPE described above, this would enable safety evaluation of scanned-beam ophthalmic systems—such as multi-meridian corneal scans—for which no existing tool exists.

# AI usage disclosure

Generative and agentic artificial intelligence tools, specifically Claude Code, were used to develop parts of this software's code through refactoring and generation under the careful guidance and supervision of the authors [@ClaudeCode]. The authors have thoroughly reviewed, edited, and validated the software's accuracy and performance. AI generated no core algorithmic logic nor novel research methodology. Generative AI tools were not used in the writing of this manuscript nor in the preparation of supporting materials.

# Safety Disclaimer

A Massachusetts General Hospital (MGH) affiliated LSO evaluated the tool using common operational laser configurations and confirmed its consistency with manual calculations based on the ICNIRP guideline tables. The scenarios spanned research, industrial, and clinical environments, including a Q-switched Nd:YAG marking system, Ti:sapphire femtosecond pulses, a laser-diode fiber-communication source, and a CO$_2$ laser skin-resurfacing system.

However, this software is provided for research and educational purposes only. It is not a certified safety instrument and has not been endorsed or approved by any standards organization, including ICNIRP, ANSI, IEC, or any regulatory body. The output does not constitute professional safety advice and must not be used as the sole basis for any safety determination. All output should be independently verified against the full text of the applicable standard by a qualified Laser Safety Officer (LSO). By using this software, you assume all risk associated with the use of its output.

# Funding

This work was supported in part by the National Institutes of Health (P41EB015903).

# Acknowledgments

The authors thank Sebastián Ruiz-Lopera for fruitful discussions.

# Disclosures

B.E.B. has a financial interest in Soléron Imaging, LLC, a seller of unique optical imaging instruments and components; his interests were reviewed and are managed by Massachusetts General Hospital and Mass General Brigham in accordance with their conflict of interest policies.

# Data availability

The code is publicly available at [@Gallegos2026MPECalcSkin].

# References
