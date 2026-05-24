"""Payload validation coverage for every module kind.

Pins the contract that the API enforces ``handler.validate_payload`` at
every write boundary — POST /wp/api/modules, PUT /wp/api/modules/<id>,
POST /wp/api/modules/import-from-workflow, and the bundle endpoints when
a ``children[]`` array is part of the body.

The shape used per kind is intentionally minimal-but-valid for the
"happy path" and intentionally malformed in one specific way for each
rejection test so failure messages stay diagnostic.
"""
from __future__ import annotations

import pytest

pytestmark = pytest.mark.asyncio


# ─── Helpers ──────────────────────────────────────────────────────────


VALID_PAYLOADS: dict[str, dict] = {
    "wildcard": {
        "options": [{"id": "o1", "value": "red", "weight": 1}],
        "var_binding": "color",
        "sub_categories": [],
    },
    "fixed_values": {
        "values": [{"id": "v1", "name": "mood", "value": "calm"}],
    },
    "combine": {
        "template": "the $color sky",
        "output_var": "phrase",
        "input_vars": ["color"],
    },
    "constraint": {
        "source_wildcard_id": "src00001",
        "target_wildcard_id": "tgt00001",
        "matrix": {},
        "exceptions": [],
    },
    "derivation": {
        "rules": [
            {
                "id": "r1",
                "branches": [
                    {
                        "condition": {"var": "mood", "op": "equals", "value": "calm"},
                        "action": {"target_var": "sky", "mode": "replace", "value": "blue"},
                    }
                ],
            }
        ],
    },
}


async def _create(client, type_id: str, payload: dict, name: str = "qa"):
    return await client.post("/wp/api/modules", json={
        "type": type_id, "name": name, "payload": payload,
    })


# ─── POST happy path per kind ─────────────────────────────────────────


@pytest.mark.parametrize("type_id", list(VALID_PAYLOADS.keys()))
async def test_post_accepts_valid_payload_for_each_kind(wp_client, type_id):
    resp = await _create(wp_client, type_id, VALID_PAYLOADS[type_id], name=f"qa_{type_id}")
    assert resp.status == 201, await resp.text()


# ─── POST rejects bad payloads ────────────────────────────────────────


@pytest.mark.parametrize("type_id, broken_payload", [
    # wildcard
    ("wildcard", {"options": "not-an-array"}),
    ("wildcard", {"options": [{"id": "o1", "value": 42, "weight": 1}]}),  # value not str
    ("wildcard", {"options": [{"id": "o1", "value": "x", "weight": -3}]}),  # negative weight
    ("wildcard", {"options": [{"id": "o1", "value": "x", "weight": "heavy"}]}),  # weight not number
    ("wildcard", {"options": [], "var_binding": "0_bad_ident"}),  # bad identifier
    # New post-2026-05 hardening — see QA report
    # empty binding
    ("wildcard", {
        "options": [{"id": "o1", "value": "x", "weight": 1}],
        "var_binding": "",
    }),
    # dunder reserved
    ("wildcard", {
        "options": [{"id": "o1", "value": "x", "weight": 1}],
        "var_binding": "__dunder",
    }),
    # too long
    ("wildcard", {
        "options": [{"id": "o1", "value": "x", "weight": 1}],
        "var_binding": "a" * 500,
    }),
    # duplicate option ids
    ("wildcard", {
        "options": [
            {"id": "o1", "value": "x", "weight": 1},
            {"id": "o1", "value": "y", "weight": 1},
        ],
        "var_binding": "dupopt",
    }),
    # fixed_values
    ("fixed_values", {"values": "not-an-array"}),
    ("fixed_values", {"values": [{"id": "v1", "name": "1_bad_ident", "value": "x"}]}),
    ("fixed_values", {"values": [{"id": "v1", "name": "mood", "value": 99}]}),  # value not str
    # dunder reserved
    ("fixed_values", {"values": [{"id": "v1", "name": "__internal", "value": "x"}]}),
    # name too long
    ("fixed_values", {"values": [{"id": "v1", "name": "a" * 200, "value": "x"}]}),
    ("fixed_values", {"values": [  # duplicate row names
        {"id": "v1", "name": "mood", "value": "calm"},
        {"id": "v2", "name": "mood", "value": "wild"},
    ]}),
    # combine
    ("combine", {"template": "hello"}),  # missing output_var
    ("combine", {"template": "hi", "output_var": "0bad"}),  # bad identifier
    ("combine", {"template": 42, "output_var": "phrase"}),  # template not str
    ("combine", {"template": "", "output_var": "phrase"}),  # empty template
    ("combine", {"template": "hi", "output_var": "__internal"}),  # dunder reserved
    ("combine", {"template": "hi", "output_var": "a" * 200}),  # output_var too long
    # constraint
    (
        "constraint",
        {"source_wildcard_id": "", "target_wildcard_id": "t", "matrix": {}, "exceptions": []},
    ),
    (
        "constraint",
        {
            "source_wildcard_id": "s",
            "target_wildcard_id": "t",
            "matrix": "not-an-object",
            "exceptions": [],
        },
    ),
    # derivation
    ("derivation", {"rules": "not-a-list"}),
    ("derivation", {"rules": [{"id": "r1", "branches": []}]}),  # empty branches
    ("derivation", {"rules": [{
        "id": "r1",
        "branches": [{
            "condition": {"var": "x", "op": "not_real_op", "value": ""},
            "action": {"target_var": "y", "mode": "replace", "value": ""},
        }],
    }]}),  # invalid op
    ("derivation", {"rules": [  # duplicate rule ids
        {"id": "r1", "branches": [{
            "condition": {"var": "x", "op": "equals", "value": "a"},
            "action": {"target_var": "y", "mode": "replace", "value": "1"},
        }]},
        {"id": "r1", "branches": [{
            "condition": {"var": "x", "op": "equals", "value": "b"},
            "action": {"target_var": "y", "mode": "replace", "value": "2"},
        }]},
    ]}),
])
async def test_post_rejects_malformed_payload(wp_client, type_id, broken_payload):
    resp = await _create(wp_client, type_id, broken_payload, name=f"qa_bad_{type_id}")
    assert resp.status == 400, await resp.text()


# ─── Canonical PUT uses the same validator ────────────────────────────


async def test_put_modules_id_rejects_cross_type_pollution(wp_client):
    # Create a wildcard, then try to PUT a combine-shaped payload to it.
    create = await _create(wp_client, "wildcard", VALID_PAYLOADS["wildcard"])
    assert create.status == 201
    mid = (await create.json())["id"]

    bad = await wp_client.put(f"/wp/api/modules/{mid}", json={
        "payload": {"template": "hi $world", "output_var": "phrase"},
    })
    assert bad.status == 400, await bad.text()


async def test_put_full_update_rejects_invalid_payload(wp_client):
    create = await _create(wp_client, "wildcard", VALID_PAYLOADS["wildcard"])
    mid = (await create.json())["id"]

    bad = await wp_client.put(f"/wp/api/modules/{mid}", json={
        "name": "qa", "payload": {"options": "not-an-array"},
    })
    assert bad.status == 400, await bad.text()


# ─── import-from-workflow ─────────────────────────────────────────────


async def test_import_from_workflow_rejects_bad_payload(wp_client):
    resp = await wp_client.post("/wp/api/modules/import-from-workflow", json={
        "id": "deadbef0",
        "type": "wildcard",
        "name": "qa_import_bad",
        "payload": {"options": 42},
    })
    assert resp.status == 400, await resp.text()


# ─── Bundle children — side door closed ───────────────────────────────


async def test_bundle_create_rejects_invalid_child_payload(wp_client):
    resp = await wp_client.post("/wp/api/bundles", json={
        "name": "qa_bundle_bad",
        "children": [
            {"id": "aabbcc11", "type": "wildcard", "payload": {"options": "nope"}},
        ],
    })
    assert resp.status == 400, await resp.text()


async def test_bundle_update_rejects_invalid_child_payload(wp_client):
    # Create a valid bundle, then PUT bad children.
    ok = await wp_client.post("/wp/api/bundles", json={"name": "qa_bundle_ok"})
    bid = (await ok.json())["id"]

    bad = await wp_client.put(f"/wp/api/bundles/{bid}", json={
        "children": [
            {"id": "aabbcc11", "type": "fixed_values", "payload": {"values": "nope"}},
        ],
    })
    assert bad.status == 400, await bad.text()


# ─── Constraint exception source_id hydration ─────────────────────────
#
# Regression: old library rows store exceptions with only source_id /
# target_id (no source/source_value string). Engine validator rejects
# because runtime needs the value string as override-lookup key. Server
# must hydrate the missing string from the referenced wildcard's
# options before validation — otherwise saving an unmodified row that
# loaded with id-only exceptions returns
# "constraint payload.exceptions[0].source must be a non-empty string".


async def test_constraint_post_hydrates_source_target_from_option_ids(wp_client):
    # Create two wildcards that the constraint can reference.
    src = await _create(wp_client, "wildcard", {
        "options": [{"id": "opt_4", "value": "buzz cut", "weight": 1}],
        "var_binding": "hair", "sub_categories": [],
    }, name="qa_hydrate_src")
    assert src.status == 201, await src.text()
    src_id = (await src.json())["id"]

    tgt = await _create(wp_client, "wildcard", {
        "options": [{"id": "opt_0", "value": "serene", "weight": 1}],
        "var_binding": "mood", "sub_categories": [],
    }, name="qa_hydrate_tgt")
    assert tgt.status == 201, await tgt.text()
    tgt_id = (await tgt.json())["id"]

    # Constraint payload mirrors the user-reported broken shape: only
    # source_id / target_id, no source string.
    resp = await _create(wp_client, "constraint", {
        "source_wildcard_id": src_id,
        "target_wildcard_id": tgt_id,
        "matrix": {},
        "exceptions": [{
            "source_id": "opt_4", "target_id": "opt_0",
            "mode": "reduce", "factor": 0.3,
        }],
    }, name="qa_hydrate_constraint")
    assert resp.status == 201, await resp.text()
    row = await resp.json()
    excs = row["payload"]["exceptions"]
    assert excs[0]["source_value"] == "buzz cut"
    assert excs[0]["target_value"] == "serene"
    assert excs[0]["source_id"] == "opt_4"
    assert excs[0]["target_id"] == "opt_0"


async def test_constraint_put_hydrates_source_target_from_option_ids(wp_client):
    src = await _create(wp_client, "wildcard", {
        "options": [{"id": "opt_4", "value": "buzz cut", "weight": 1}],
        "var_binding": "hair", "sub_categories": [],
    }, name="qa_hydrate_put_src")
    src_id = (await src.json())["id"]
    tgt = await _create(wp_client, "wildcard", {
        "options": [{"id": "opt_0", "value": "serene", "weight": 1}],
        "var_binding": "mood", "sub_categories": [],
    }, name="qa_hydrate_put_tgt")
    tgt_id = (await tgt.json())["id"]
    # Seed a constraint with a valid payload, then PUT an id-only one.
    create = await _create(wp_client, "constraint", {
        "source_wildcard_id": src_id, "target_wildcard_id": tgt_id,
        "matrix": {}, "exceptions": [],
    }, name="qa_hydrate_put")
    cid = (await create.json())["id"]
    put = await wp_client.put(f"/wp/api/modules/{cid}", json={
        "payload": {
            "source_wildcard_id": src_id,
            "target_wildcard_id": tgt_id,
            "matrix": {},
            "exceptions": [{
                "source_id": "opt_4", "target_id": "opt_0",
                "mode": "boost", "factor": 1.5,
            }],
        },
    })
    assert put.status == 200, await put.text()
    row = await put.json()
    excs = row["payload"]["exceptions"]
    assert excs[0]["source_value"] == "buzz cut"
    assert excs[0]["target_value"] == "serene"


async def test_constraint_hydrate_leaves_existing_source_alone(wp_client):
    # If both source and source_id are present, hydration must not
    # clobber the explicit string (the caller may have intentionally
    # picked a different historical value).
    src = await _create(wp_client, "wildcard", {
        "options": [{"id": "opt_4", "value": "buzz cut", "weight": 1}],
        "var_binding": "hair", "sub_categories": [],
    }, name="qa_hydrate_noclobber_src")
    src_id = (await src.json())["id"]
    tgt = await _create(wp_client, "wildcard", {
        "options": [{"id": "opt_0", "value": "serene", "weight": 1}],
        "var_binding": "mood", "sub_categories": [],
    }, name="qa_hydrate_noclobber_tgt")
    tgt_id = (await tgt.json())["id"]
    resp = await _create(wp_client, "constraint", {
        "source_wildcard_id": src_id,
        "target_wildcard_id": tgt_id,
        "matrix": {},
        "exceptions": [{
            "source": "explicit", "target": "values",
            "source_id": "opt_4", "target_id": "opt_0",
            "mode": "boost", "factor": 1.2,
        }],
    }, name="qa_hydrate_noclobber")
    assert resp.status == 201, await resp.text()
    row = await resp.json()
    exc = row["payload"]["exceptions"][0]
    assert exc["source"] == "explicit"
    assert exc["target"] == "values"
    assert "source_value" not in exc


async def test_constraint_hydrate_skips_unknown_option_id(wp_client):
    # If source_id points at an option that no longer exists, hydration
    # can't help — engine validator still rejects with its original
    # error. Confirms we don't silently swallow malformed payloads.
    src = await _create(wp_client, "wildcard", {
        "options": [{"id": "opt_4", "value": "buzz cut", "weight": 1}],
        "var_binding": "hair", "sub_categories": [],
    }, name="qa_hydrate_miss_src")
    src_id = (await src.json())["id"]
    tgt = await _create(wp_client, "wildcard", {
        "options": [{"id": "opt_0", "value": "serene", "weight": 1}],
        "var_binding": "mood", "sub_categories": [],
    }, name="qa_hydrate_miss_tgt")
    tgt_id = (await tgt.json())["id"]
    resp = await _create(wp_client, "constraint", {
        "source_wildcard_id": src_id, "target_wildcard_id": tgt_id,
        "matrix": {},
        "exceptions": [{
            "source_id": "opt_99", "target_id": "opt_0",
            "mode": "boost", "factor": 1.2,
        }],
    }, name="qa_hydrate_miss")
    assert resp.status == 400, await resp.text()
