"""The packaged standard data must stay byte-identical to web/standards/.

The Python package ships the standard JSON as package data (src/laser_mpe/data/)
so that an installed wheel can find it; web/standards/ holds the copy the web
build inlines and that contributors edit. If the two drift, a released wheel
would compute against stale limits. This test (and the CI step) fail on drift.
"""
from pathlib import Path

import pytest

_REPO = Path(__file__).resolve().parents[1]
_PACKAGED = _REPO / "src" / "laser_mpe" / "data"
_WEB = _REPO / "web" / "standards"

_STANDARDS = ["icnirp_2013.json", "ansi_z136_2022.json"]


@pytest.mark.parametrize("name", _STANDARDS)
def test_packaged_standard_matches_web(name):
    packaged = (_PACKAGED / name).read_bytes()
    web = (_WEB / name).read_bytes()
    assert packaged == web, (
        f"{name}: src/laser_mpe/data/ and web/standards/ have drifted. "
        f"Re-sync them (they must be byte-identical)."
    )
