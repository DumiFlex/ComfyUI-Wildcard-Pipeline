"""log_once: a repeating console message prints once, then at DEBUG."""
from __future__ import annotations

import logging

import pytest

from engine import log_once as lo


@pytest.fixture(autouse=True)
def _fresh():
    lo.reset()
    yield
    lo.reset()


def test_second_time_drops_to_debug(caplog):
    log = logging.getLogger("wp-test-log-once")
    caplog.set_level(logging.DEBUG, logger="wp-test-log-once")
    assert lo.log_once(log, logging.WARNING, "k", "hello %s", "there")
    assert not lo.log_once(log, logging.WARNING, "k", "hello %s", "there")
    assert [r.levelno for r in caplog.records] == [logging.WARNING, logging.DEBUG]
    assert caplog.records[1].getMessage() == "hello there"


def test_traceback_only_the_first_time(caplog):
    log = logging.getLogger("wp-test-log-once")
    caplog.set_level(logging.DEBUG, logger="wp-test-log-once")
    for _ in range(3):
        try:
            raise ValueError("boom")
        except ValueError:
            lo.log_once(log, logging.ERROR, ("e", "boom"), "failed", exc_info=True)
    assert [r.exc_info is not None and r.exc_info[0] is ValueError
            for r in caplog.records] == [True, False, False]


def test_forget_lets_it_print_again(caplog):
    log = logging.getLogger("wp-test-log-once")
    caplog.set_level(logging.INFO, logger="wp-test-log-once")
    lo.log_once(log, logging.INFO, "k", "a")
    lo.forget("k")
    lo.log_once(log, logging.INFO, "k", "a")
    assert len(caplog.records) == 2


def test_keys_are_capped():
    log = logging.getLogger("wp-test-log-once")
    for i in range(lo._MAX_KEYS + 10):
        lo.log_once(log, logging.DEBUG, i, "x")
    assert len(lo._seen) == lo._MAX_KEYS
