"""All version declarations across the repo must agree.

pyproject.toml is the source of truth for the Python package version;
package.json, web/package.json, web/package-lock.json, CITATION.cff, the JS
engine's _ENGINE_VERSION, and the __init__.py fallback must all match it. Uses
regex (no TOML dependency) so it runs on every supported Python.
"""
import re
from pathlib import Path

_REPO = Path(__file__).resolve().parents[1]


def _search(path, pattern):
    m = re.search(pattern, (_REPO / path).read_text(encoding="utf-8"))
    assert m, f"version not found in {path}"
    return m.group(1)


def test_all_version_strings_match():
    pyproject = _search("pyproject.toml", r'(?m)^version\s*=\s*"([^"]+)"')
    versions = {
        "pyproject.toml": pyproject,
        "package.json": _search("package.json", r'"version"\s*:\s*"([^"]+)"'),
        "web/package.json": _search("web/package.json", r'"version"\s*:\s*"([^"]+)"'),
        # npm ci fails outright if the lockfile disagrees with web/package.json.
        "web/package-lock.json": _search(
            "web/package-lock.json", r'"version"\s*:\s*"([^"]+)"'
        ),
        "CITATION.cff": _search("CITATION.cff", r'(?m)^version:\s*([0-9][^\s]*)'),
        "web/engine.js": _search("web/engine.js", r'_ENGINE_VERSION\s*=\s*"([^"]+)"'),
        "__init__.py fallback": _search(
            "src/laser_mpe/__init__.py", r'__version__\s*=\s*"([^"]+)"'
        ),
    }
    mismatched = {k: v for k, v in versions.items() if v != pyproject}
    assert not mismatched, f"version drift vs pyproject {pyproject}: {mismatched}"
