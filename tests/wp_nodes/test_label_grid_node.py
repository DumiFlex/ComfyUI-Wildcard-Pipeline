"""WP_LabelGrid — schema, widget parsing and (with torch) a full run."""

from __future__ import annotations

import json
import sys
import types

import pytest

from wp_nodes import label_grid_node as node_mod
from wp_nodes.label_grid_node import WPLabelGrid


def test_schema():
    schema = WPLabelGrid.define_schema()
    assert schema.node_id == "WP_LabelGrid"
    assert schema.category == "wildcard-pipeline"
    assert schema.is_input_list is True
    assert schema.is_output_node is True
    assert [o.is_output_list for o in schema.outputs] == [True, False]
    assert [i.name for i in schema.inputs] == [
        "images",
        "labels",
        "label_text",
        "title",
        "row_headers",
        "column_headers",
        "wp_label_grid",
    ]


def test_wired_text():
    assert node_mod._wired_text(None, "\n") is None
    assert node_mod._wired_text(["a", "b"], "\n") == "a\nb"
    assert node_mod._wired_text("x", " ") == "x"


def test_first():
    assert node_mod._first([5]) == 5
    assert node_mod._first([], 1) == 1
    assert node_mod._first(None, 2) == 2
    assert node_mod._first(7) == 7


class FakeTensor:
    """Just enough of a torch tensor for the node's conversions."""

    def __init__(self, arr):
        self.arr = arr
        self.shape = arr.shape

    def __getitem__(self, idx):
        return FakeTensor(self.arr[idx])

    def cpu(self):
        return self

    def numpy(self):
        return self.arr


@pytest.fixture
def fake_torch(monkeypatch):
    np = pytest.importorskip("numpy")
    try:
        import torch  # noqa: F401
    except ImportError:
        fake = types.SimpleNamespace(
            from_numpy=FakeTensor,
            zeros=lambda shape: FakeTensor(np.zeros(shape, dtype=np.float32)),
        )
        monkeypatch.setitem(sys.modules, "torch", fake)
        return lambda arr: FakeTensor(arr)
    import torch

    return torch.from_numpy


def cfg(**kw):
    return [json.dumps(kw)]


def test_run_labels_and_grid(fake_torch):
    import numpy as np

    rng = np.random.default_rng(1)
    frames = [fake_torch(rng.random((2, 64, 96, 3), dtype=np.float32)) for _ in range(2)]
    out = WPLabelGrid.execute(
        images=frames,
        labels=["#1 · a\n#1 · b", "#2 · a\n#2 · b"],
        wp_label_grid=cfg(position="top", rows_from="part:1", columns_from="part:2"),
    )
    labelled, grid = out.values
    assert len(labelled) == 2
    assert labelled[0].shape[0] == 2 and labelled[0].shape[1] > 64
    assert labelled[0].shape[2] == 96
    assert grid.shape[0] == 1 and grid.shape[3] == 3
    run = out.ui["wp_label_grid"][0]
    assert run["items"] == 2 and run["batch_sizes"] == [2, 2] and run["count"] == 4
    assert run["labelled"] is True
    assert run["parts"][1] == {"values": ["a", "b"], "count": 2}
    assert run["auto"] == "rows"
    assert run["grid"] == [int(grid.shape[2]), int(grid.shape[1])]


def test_run_without_labels_or_grid(fake_torch):
    import numpy as np

    frames = [fake_torch(np.zeros((1, 32, 32, 3), dtype=np.float32))]
    out = WPLabelGrid.execute(images=frames, wp_label_grid=cfg(label="", grid=False))
    labelled, grid = out.values
    assert labelled[0].shape == (1, 32, 32, 3)
    assert grid.shape == (1, 64, 64, 3)
    run = out.ui["wp_label_grid"][0]
    assert run["labelled"] is False and run["grid"] is None and run["parts"] == []


def test_run_template_without_labels_input_or_config(fake_torch):
    import numpy as np

    frames = [fake_torch(np.zeros((3, 40, 40, 3), dtype=np.float32))]
    out = WPLabelGrid.execute(images=frames, wp_label_grid=cfg(label="#{index}", position="bottom"))
    labelled, grid = out.values
    assert labelled[0].shape[1] > 40
    assert grid.shape[0] == 1
    # no config at all (a node added before the widget loaded): defaults
    out = WPLabelGrid.execute(images=frames)
    assert out.values[0][0].shape == (3, 40, 40, 3)


def test_wired_title_and_headers_beat_the_panel(fake_torch, monkeypatch):
    import numpy as np

    seen = {}
    real = node_mod.g.build_grid

    def spy(cells, style, spec):
        seen["spec"] = spec
        return real(cells, style, spec)

    monkeypatch.setattr(node_mod.g, "build_grid", spy)
    frames = [fake_torch(np.zeros((2, 32, 32, 3), dtype=np.float32)) for _ in range(2)]
    WPLabelGrid.execute(
        images=frames,
        title=["From a node"],
        row_headers=["first", "second"],
        wp_label_grid=cfg(title="typed", arrange="rows", rows_from="none"),
    )
    spec = seen["spec"]
    assert spec.title == "From a node"
    assert spec.row_headers == ["first", "second"]
    assert spec.column_headers == []


def test_wired_label_text_per_item_last_repeats(fake_torch, monkeypatch):
    import numpy as np

    drawn = []
    real = node_mod.g.label_batch

    def spy(images, texts, style):
        drawn.append(list(texts))
        return real(images, texts, style)

    monkeypatch.setattr(node_mod.g, "label_batch", spy)
    frames = [fake_torch(np.zeros((2, 32, 32, 3), dtype=np.float32)) for _ in range(3)]
    WPLabelGrid.execute(
        images=frames,
        labels=["red"],
        label_text=["A {label} {image}", "B"],
        wp_label_grid=cfg(label="typed", grid=False),
    )
    assert drawn == [["A red 1", "A red 2"], ["B", "B"], ["B", "B"]]
