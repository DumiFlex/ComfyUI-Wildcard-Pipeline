"""Tests for wildcard source resolution."""

import json
import os
import tempfile
from pathlib import Path

from nodes.sources import resolve_sources


class TestResolveSources:
    def _make_wildcard_file(self, tmpdir: Path, name: str, options: list) -> Path:
        filepath = tmpdir / name
        filepath.write_text(
            json.dumps({"name": name, "version": "1.0", "options": options})
        )
        return filepath

    def test_source_replaced_with_inline_options(self, tmp_path):
        self._make_wildcard_file(
            tmp_path,
            "location.json",
            [
                {"value": "forest", "weight": 80},
                {"value": "desert", "weight": 20},
            ],
        )
        modules = [
            {"type": "wildcard", "source": "location.json", "capture_as": "$loc"}
        ]
        result = resolve_sources(modules, data_dir=tmp_path)

        assert len(result) == 1
        assert "source" not in result[0]
        assert len(result[0]["options"]) == 2
        assert result[0]["options"][0]["value"] == "forest"

    def test_source_without_json_extension(self, tmp_path):
        self._make_wildcard_file(
            tmp_path, "location.json", [{"value": "a", "weight": 1}]
        )
        modules = [{"type": "wildcard", "source": "location", "capture_as": "$loc"}]
        result = resolve_sources(modules, data_dir=tmp_path)

        assert "source" not in result[0]
        assert len(result[0]["options"]) == 1

    def test_searches_examples_subdirectory(self, tmp_path):
        examples = tmp_path / "examples"
        examples.mkdir()
        self._make_wildcard_file(
            examples, "lighting.json", [{"value": "golden", "weight": 90}]
        )

        modules = [
            {"type": "wildcard", "source": "lighting.json", "capture_as": "$light"}
        ]
        result = resolve_sources(modules, data_dir=tmp_path)

        assert result[0]["options"][0]["value"] == "golden"

    def test_missing_source_passes_through_unchanged(self, tmp_path):
        modules = [
            {"type": "wildcard", "source": "nonexistent.json", "capture_as": "$x"}
        ]
        result = resolve_sources(modules, data_dir=tmp_path)

        assert result[0] is modules[0]

    def test_non_wildcard_modules_pass_through(self, tmp_path):
        modules = [
            {"type": "fixed", "value": "hello", "capture_as": "$greet"},
            {"type": "combine", "template": "$a $b", "capture_as": "$c"},
        ]
        result = resolve_sources(modules, data_dir=tmp_path)

        assert result == modules

    def test_inline_options_not_affected(self, tmp_path):
        modules = [
            {
                "type": "wildcard",
                "options": [{"value": "already inline", "weight": 1}],
                "capture_as": "$x",
            }
        ]
        result = resolve_sources(modules, data_dir=tmp_path)

        assert result[0]["options"][0]["value"] == "already inline"

    def test_original_modules_not_mutated(self, tmp_path):
        self._make_wildcard_file(tmp_path, "loc.json", [{"value": "a", "weight": 1}])
        original = {"type": "wildcard", "source": "loc.json", "capture_as": "$x"}
        modules = [original]
        resolve_sources(modules, data_dir=tmp_path)

        assert "source" in original

    def test_invalid_json_passes_through(self, tmp_path):
        bad_file = tmp_path / "bad.json"
        bad_file.write_text("not valid json{{{")
        modules = [{"type": "wildcard", "source": "bad.json", "capture_as": "$x"}]
        result = resolve_sources(modules, data_dir=tmp_path)

        assert result[0] is modules[0]

    def test_preserves_other_module_keys(self, tmp_path):
        self._make_wildcard_file(tmp_path, "loc.json", [{"value": "a", "weight": 1}])
        modules = [
            {
                "type": "wildcard",
                "source": "loc.json",
                "capture_as": "$x",
                "custom_key": "preserved",
            }
        ]
        result = resolve_sources(modules, data_dir=tmp_path)

        assert result[0]["custom_key"] == "preserved"
        assert result[0]["capture_as"] == "$x"

    def test_mixed_modules_resolved_correctly(self, tmp_path):
        self._make_wildcard_file(
            tmp_path, "loc.json", [{"value": "forest", "weight": 80}]
        )
        modules = [
            {"type": "wildcard", "source": "loc.json", "capture_as": "$loc"},
            {"type": "fixed", "value": "warm", "capture_as": "$tone"},
            {"type": "combine", "template": "$loc, $tone", "capture_as": "$scene"},
        ]
        result = resolve_sources(modules, data_dir=tmp_path)

        assert len(result) == 3
        assert "source" not in result[0]
        assert result[0]["options"][0]["value"] == "forest"
        assert result[1] == modules[1]
        assert result[2] == modules[2]


class TestResolveConstraintSources:
    def _make_constraint_file(self, tmpdir: Path, name: str, rules: list) -> Path:
        filepath = tmpdir / name
        filepath.write_text(json.dumps({"name": name, "rules": rules}))
        return filepath

    def test_constraint_source_replaced_with_inline_rules(self, tmp_path):
        self._make_constraint_file(
            tmp_path,
            "lighting_weather.json",
            [
                {
                    "when_value": "moonlight",
                    "rule_type": "exclusion",
                    "values": ["sunny"],
                }
            ],
        )
        modules = [
            {
                "type": "constrain",
                "source": "lighting_weather.json",
                "target": "$lighting",
                "capture_as": "$weather",
            }
        ]
        result = resolve_sources(modules, constraints_dir=tmp_path)
        assert len(result) == 1
        assert "source" not in result[0]
        assert len(result[0]["rules"]) == 1
        assert result[0]["rules"][0]["rule_type"] == "exclusion"

    def test_constraint_source_without_json_extension(self, tmp_path):
        self._make_constraint_file(
            tmp_path,
            "rules.json",
            [{"when_value": "x", "rule_type": "exclusion", "values": []}],
        )
        modules = [{"type": "constrain", "source": "rules", "target": "$x"}]
        result = resolve_sources(modules, constraints_dir=tmp_path)
        assert "source" not in result[0]
        assert len(result[0]["rules"]) == 1

    def test_constraint_searches_examples_subdirectory(self, tmp_path):
        examples = tmp_path / "examples"
        examples.mkdir()
        self._make_constraint_file(
            examples,
            "test.json",
            [
                {
                    "when_value": "a",
                    "rule_type": "weight_bias",
                    "values": ["b"],
                    "multiplier": 2.0,
                }
            ],
        )
        modules = [{"type": "constrain", "source": "test.json", "target": "$a"}]
        result = resolve_sources(modules, constraints_dir=tmp_path)
        assert result[0]["rules"][0]["multiplier"] == 2.0

    def test_constraint_missing_source_passes_through(self, tmp_path):
        modules = [{"type": "constrain", "source": "missing.json", "target": "$x"}]
        result = resolve_sources(modules, constraints_dir=tmp_path)
        assert result[0] is modules[0]

    def test_constraint_without_source_passes_through(self, tmp_path):
        modules = [
            {
                "type": "constrain",
                "target": "$x",
                "rules": [{"when_value": "y", "rule_type": "exclusion", "values": []}],
            }
        ]
        result = resolve_sources(modules, constraints_dir=tmp_path)
        assert result[0] is modules[0]

    def test_mixed_wildcard_and_constraint_sources(self, tmp_path):
        wc_dir = tmp_path / "wildcards"
        wc_dir.mkdir()
        cs_dir = tmp_path / "constraints"
        cs_dir.mkdir()

        (wc_dir / "loc.json").write_text(
            json.dumps({"name": "loc", "options": [{"value": "forest", "weight": 1}]})
        )
        (cs_dir / "rules.json").write_text(
            json.dumps(
                {
                    "name": "rules",
                    "rules": [
                        {"when_value": "a", "rule_type": "exclusion", "values": []}
                    ],
                }
            )
        )

        modules = [
            {"type": "wildcard", "source": "loc.json", "capture_as": "$loc"},
            {"type": "constrain", "source": "rules.json", "target": "$loc"},
            {"type": "fixed", "value": "ok", "capture_as": "$x"},
        ]
        result = resolve_sources(modules, data_dir=wc_dir, constraints_dir=cs_dir)
        assert len(result) == 3
        assert "source" not in result[0]
        assert result[0]["options"][0]["value"] == "forest"
        assert "source" not in result[1]
        assert len(result[1]["rules"]) == 1
        assert result[2] is modules[2]
