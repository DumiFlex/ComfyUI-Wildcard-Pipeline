"""One trivial test to verify pytest discovery + conftest shim work."""

from __future__ import annotations


def test_pytest_runs():
    assert 1 + 1 == 2
