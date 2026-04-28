---
title: 'Maximum Permissible Exposure Tool for Laser Safety Evaluation'
tags:
  - Python
  - JavaScript
  - Maximum Permissible Exposure
  - Laser Safety
authors:
  - name: Isaac T. Gallegos
    orcid: 0009-0007-9290-6289
    equal-contrib: true
    affiliation: "1"
  - name: Ryan McAuley
    orcid:
    equal-contrib:
    affiliation: "1"
  - name: Brett E. Bouma
    orcid: 0009-0007-9290-6289
    equal-contrib: true
    affiliation: "1, 2"
  - name: David Veysset
    orcid: 0009-0007-9290-6289
    equal-contrib: true
    affiliation: "1"
affiliations:
 - name: Wellman Center for Photomedicine, Harvard Medical School, Massachusetts General Hospital, Boston, MA 02114, USA
   index: 1
 - name: Institute for Medical Engineering and Science, Massachusetts Institute of Technology, Cambridge, MA 02139, USA
   index: 2
date: 13 April 2026
bibliography: paper.bib
---

# Summary

The of use laser-based systems has significantly grown over the last decade in a wide range of fields including telecommunications, machining and device fabrication, and biomedical imaging. Characterizing laser exposure to the human body is therefore key to ensuring safe utilization of these tools. The American National Standards Institute (ANSI), International Electrotechnical Commission (IEC), and International Commission on Non-Ionizing Radiation (ICNIRP) define these safety limits, or Maximum Permissible Exposure (MPE), for laser irradiation. MPE-Calculator was designed to be used by engineers, researchers, and students requiring guidelines for optical irradiation exposure to the skin.


Key features include (1) the combination of efficient calculations, (2) a web-based interface, (3) an easy-to-follow Python package, (4) laser scanning protocols, and (5) the capability for users to easily switch safety standards. These characteristic elements make MPE-Calculator an exciting tool informing safe laser exposure and further enable optical design for researchers and engineers alike.


# Statement of need

The IEC, ANSI, and ICNIRP standards are exhaustive but challenging to interpret and implement given their complexity, demonstrating a need for a user-friendly, intuitive tool that automates MPE calculations.


MPE calculations are further complicated by complex scan patterns, repeated beam exposures, and multi-wavelength irradiation, necessitating a platform that takes these factors into consideration. Differences between use cases for an MPE calculator also demonstrates a need for a tool that enables both general and application-specific MPE computations. Some of the most common applications of MPE calculators include biomedical optics, such as Optical Coherence Tomography (OCT) and Photoacoustic imaging (PAI). A tool that enables tailoring to the conventions in OCT and PAI, such as established terminology and use cases provides an appeal for those in biomedical imaging. In terms of PAI, there is a need for a tool that supports characterization of the tradeoff between laser energy, image signal-to-noise ratio (SNR), and  safety constraints.

# State of the field

Several existing MPE tools exist such as one by the Laser Institute of America (LIA) - a web-based laser safety hazard analysis system and a desktop platform. KenTek also has developed the EASY-HAZ Laser Hazard Analysis software, designed to evaluate laser environments and report laser safety recommendations. The software is intended for use by students, laser professionals and Laser Safety Officers in education, industry, research, and medical environments. Although potentially useful, the LIA laser safety tool free version limits users to analysis at only one wavelength and the full suite requires a monthly or annual subscription which, for many individual users or labs, can be costly. Both the LIA and KenTek MPE web-based and desktop tools do not include laser safety evaluation for scanning beams, making these platforms difficult to use for realistic optical imaging or system design.

In terms of optical design, no software currently takes into account laser scan patterns, which is a significant downside given that MPE characterization of scanned beams is essential to robust optical safety determination. Further, no existing software provides a convenient way to optimize SNR in Photoacoustic imaging, making this feature of our tool particularly unique.

# Software design

MPE-Calculator is a stand alone Python package and web interface for laser safety exposure evaluation. Python enables flexibility and ease-of-use for the library package, HTML powers the web-interface, and JavaScript efficiently drives the web engine. The API for MPE-Calculator was designed to provide a user-friendly interface for efficient implementations of laser safety calculations such as for computing the MPE for an arbitrary wavelength and exposure duration, performing unit conversions, and loading different safety standards.

MPE-Calculator was designed from the ground up to be a robust, independent tool using Python and NumPy as dependencies. The software can be installed and used as a Python library or through the web interactive tool as a standalone file. MPE-Calculator does not rely on a hard-coded standard, but rather grants users the flexibility to switch between ANSI, IEC, and ICNIRP specifications. This modular design maximizes ease of use and accessibility while providing multiple ways users can utilize the software.

Our design philosophy is based on two core principles: (1) to provide a user-friendly interface while also giving users the option to use the software in the form of a Python library, (2) use JavaScript for the computational engine, HTML for user interface elements, and Python for the library, and (3) to design the entire platform to be safety standard agnostic for generalizability. To enable users to switch or upload safety standards, the web engine calculator is designed to reference a default or user uploaded JSON file containing the complete set of table values and exceptions for the standard. This means that no code changes are needed to switch standards and no purchases, beyond the standard itself, are required by the user.

In addition to the web tool, our desktop application also enables users to download and locally run the software on their personal machine. The low-level programming of the desktop application is based on C++, wrapped in JavaScript allowing for highly efficient MPE calculations. Both the web interface and the desktop application allow users to upload arbitrary scan patterns - a novel feature that gives users significant flexibility.

# Example usage

## Basic usage

## Scanning protocols

# Research impact statement

MPE-Calculator emerged from a research need in Biomedical Imaging to characterize MPE safety limits to the skin while (1) removing the cost barrier and time consuming and tedious process of reading through the IEC, ANSI, or ICNIRP standards and (2) enabling MPE computations for complex scan geometries. MPE-Calculator started out as a simple web-based interface and Python library and has evolved into a much more robust platform for MPE calculations and optical design. 

In research contexts, the software supports rigorous MPE characterization and enables users to perform comparisons between different configurations of wavelengths, pulse durations, pulse repetition frequency, scanning patterns, and beam diameters which are essential for reproducible and peer-reviewed studies. 

MPE-Calculator incorporates the work from [enter PA paper citation] directly and has also been utilized and referenced in a number of scientific publications [reference Ryan's example publication] and has also been used by several research labs around the world such as [research group in Spain Judith sent it to].

While contributions from the broader community are still in their early stages, we anticipate adoption from the broader optics community, especially those in Biomedical Optics such as labs at Harvard Medical School.

# AI usage disclosure

Generative AI tools, specifically Claude code, was used in the development of this software's code via code refactoring and generation under the careful guidance and supervision of the authors. The authors have thoroughly reviewed, edited, and validated the software's accuracy and performance. No core algorithmic logic or novel research methodology was generated by AI. No generative AI tools were used in the writing of this manuscript, or in the preparation of supporting materials.

# Acknowledgements

We acknowledge contributions from the Bouma group at Harvard Medical School and the Wellman Center for Photomedicine over the course of this project.

# References
