"""4-segment nested-ref regex + tokenizer meta (SP1).

`@{uuid [#name] [:expr] [!null]}` — fixed segment order, `!` excluded
from the name/expr captures so the null marker stays unambiguous.
"""
from engine.syntax.tokenize import _REF_RE, tokenize_text
from engine.syntax.types import TokenKind


def _seg(s):
    m = _REF_RE.fullmatch(s)
    assert m, s
    return m.group(1), m.group(2), m.group(3), m.group(4)  # uuid, name, expr, null


def test_ref_segments():
    assert _seg("@{aabbccdd}") == ("aabbccdd", None, None, None)
    assert _seg("@{aabbccdd#mood}") == ("aabbccdd", "mood", None, None)
    assert _seg("@{aabbccdd:warm or cold}") == ("aabbccdd", None, "warm or cold", None)
    assert _seg("@{aabbccdd:warm or cold!null}") == (
        "aabbccdd", None, "warm or cold", "null",
    )
    assert _seg("@{aabbccdd!null}") == ("aabbccdd", None, None, "null")
    assert _seg("@{aabbccdd#mood:(red or pink) and not cold!null}") == (
        "aabbccdd", "mood", "(red or pink) and not cold", "null",
    )


def _ref_meta(s):
    toks = [t for t in tokenize_text(s) if t.kind == TokenKind.REF]
    assert len(toks) == 1, s
    return toks[0].meta


def test_ref_meta_filter_expr_and_exclude_null():
    assert _ref_meta("@{aabbccdd}") == {"uuid": "aabbccdd"}
    assert _ref_meta("@{aabbccdd:warm or cold}") == {
        "uuid": "aabbccdd", "filter_expr": "warm or cold",
    }
    assert _ref_meta("@{aabbccdd:warm!null}") == {
        "uuid": "aabbccdd", "filter_expr": "warm", "exclude_null": True,
    }
    assert _ref_meta("@{aabbccdd!null}") == {"uuid": "aabbccdd", "exclude_null": True}
    assert _ref_meta("@{aabbccdd#mood:warm}") == {
        "uuid": "aabbccdd", "name": "mood", "filter_expr": "warm",
    }


def test_empty_expr_is_no_filter():
    # `@{uuid:}` — colon present but empty expr ⇒ no filter_expr in meta.
    assert _ref_meta("@{aabbccdd:}") == {"uuid": "aabbccdd"}
