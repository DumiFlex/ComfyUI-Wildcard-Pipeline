"""WP_LabelGrid — draw labels on images and lay them out in a labelled grid.

Takes one image, a batch, a list, or a list of batches (``is_input_list``, so a
Context Loop's frames arrive in ONE call), with optional labels — the Image
Filter's ``labels`` output fits straight in. Gives back the labelled images in
the shape they came in, plus one grid image, and shows the result on the node.
The drawing lives in ``engine/label_grid.py``; this module converts tensors,
reads the one JSON config widget and tells the widget the run's shape.
"""

from __future__ import annotations

import os
import uuid
from typing import Any

from comfy_api.latest import io  # pyright: ignore[reportMissingImports]

from engine import label_grid as g
from wp_nodes.types import LabelGridWidgetInput


def _first(values: Any, default: Any = None) -> Any:
    """A widget's value under ``is_input_list`` (ComfyUI wraps it in a list)."""
    if isinstance(values, list):
        return values[0] if values else default
    return default if values is None else values


def _wired_text(values: Any, sep: str) -> str | None:
    """A wired text input under ``is_input_list``: None when unwired, else
    every entry joined (a list output's entries become header lines)."""
    if values is None:
        return None
    items = values if isinstance(values, list) else [values]
    return sep.join(str(v) for v in items if v is not None)


def _to_pil(batch: Any) -> list[Any]:
    import numpy as np
    from PIL import Image

    out = []
    for i in range(int(batch.shape[0])):
        arr = np.clip(255.0 * batch[i].cpu().numpy(), 0, 255).astype(np.uint8)
        if arr.ndim == 3 and arr.shape[2] == 1:
            arr = arr[:, :, 0]
        img = Image.fromarray(arr)
        out.append(img.convert("RGB") if img.mode != "RGB" else img)
    return out


def _to_tensor(images: list[Any]) -> Any:
    import numpy as np
    import torch

    arrs = [np.asarray(img.convert("RGB"), dtype=np.float32) / 255.0 for img in images]
    return torch.from_numpy(np.stack(arrs))


def _save_previews(images: list[Any]) -> list[dict[str, str]]:
    """Write the result to ComfyUI's temp folder so the node shows it (the
    same refs a Preview Image node sends)."""
    import folder_paths  # type: ignore[import-not-found]

    out_dir = folder_paths.get_temp_directory()
    os.makedirs(out_dir, exist_ok=True)
    stem = f"wp_label_grid_{uuid.uuid4().hex[:10]}"
    refs = []
    for i, img in enumerate(images):
        name = f"{stem}_{i:03d}.png"
        img.save(os.path.join(out_dir, name), compress_level=1)
        refs.append({"filename": name, "subfolder": "", "type": "temp"})
    return refs


#: Previews shown on the node at most (a 200-frame loop shouldn't write 200 PNGs).
_MAX_PREVIEWS = 64


class WPLabelGrid(io.ComfyNode):
    """Label images and lay them out in a grid."""

    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="WP_LabelGrid",
            display_name="WP Label & Grid",
            category="wildcard-pipeline",
            description=(
                "Draws labels on images and lays them out in a labelled grid. "
                "Takes one image, a batch, a list or a list of batches; labels "
                "are optional (the Image Filter's labels output fits straight in)."
            ),
            inputs=[
                io.Image.Input(
                    "images",
                    tooltip="One image, a batch, a list, or a list of batches (a Context Loop).",
                ),
                io.String.Input(
                    "labels",
                    optional=True,
                    force_input=True,
                    tooltip=(
                        "One entry per image or batch, one line per image of the batch "
                        "(one line covers the whole batch). The Image Filter's labels "
                        "output fits here."
                    ),
                ),
                io.String.Input(
                    "label_text",
                    optional=True,
                    force_input=True,
                    tooltip=(
                        "Wire text here to set what each image shows from another node "
                        "(the tokens {label}, {index}, … still work). A list gives one "
                        "text per item; the last one covers any item past it."
                    ),
                ),
                io.String.Input(
                    "title",
                    optional=True,
                    force_input=True,
                    tooltip="Wire text here to set the grid title from another node.",
                ),
                io.String.Input(
                    "row_headers",
                    optional=True,
                    force_input=True,
                    tooltip=(
                        "Row headers from another node, one per line (or one per list "
                        "entry). Wiring it sets Rows to typed headers."
                    ),
                ),
                io.String.Input(
                    "column_headers",
                    optional=True,
                    force_input=True,
                    tooltip=(
                        "Column headers from another node, one per line (or one per list "
                        "entry). Wiring it sets Columns to typed headers."
                    ),
                ),
                # Label text, style and grid settings all live in one DOM widget
                # (src/components/label-grid/LabelGridWidget.vue).
                LabelGridWidgetInput.Input(
                    "wp_label_grid",
                    socketless=True,
                    default="",
                    optional=True,
                ),
            ],
            outputs=[
                io.Image.Output("images", is_output_list=True),
                io.Image.Output("grid"),
            ],
            is_input_list=True,
            is_output_node=True,
        )

    @classmethod
    def execute(
        cls,
        images,
        labels=None,
        label_text=None,
        title=None,
        row_headers=None,
        column_headers=None,
        wp_label_grid=None,
    ):
        cfg = g.parse_config(_first(wp_label_grid, ""))
        # A wired text input beats what is typed in the panel.
        wired_title = _wired_text(title, " ")
        if wired_title is not None:
            cfg["title"] = wired_title
        for key, values in (("row_headers", row_headers), ("column_headers", column_headers)):
            wired = _wired_text(values, "\n")
            if wired is not None:
                cfg[key] = wired
                cfg["rows_from" if key == "row_headers" else "columns_from"] = "typed"
        style = g.Style(
            position=cfg["position"],
            align=cfg["align"],
            font=cfg["font"],
            font_size=cfg["font_size"],
            text_color=cfg["text_color"],
            label_color=cfg["label_color"],
            background=cfg["background"],
            header_color=cfg["header_color"],
            gap=cfg["gap"],
            margin=cfg["margin"],
            cell_width=cfg["cell_width"],
        )
        batches = [b for b in (images or []) if b is not None]
        pil = [_to_pil(b) for b in batches]
        sizes = [len(p) for p in pil]
        incoming = g.item_labels(labels, sizes)
        count = sum(sizes)

        # A wired label text beats the panel's: one per item, the last repeats.
        wired_text = [
            "" if v is None else str(v)
            for v in (label_text if isinstance(label_text, list) else [label_text])
        ] if label_text is not None else []

        texts: list[list[str]] = []
        index = 0
        for fi, item in enumerate(incoming):
            template = wired_text[min(fi, len(wired_text) - 1)] if wired_text else cfg["label"]
            row = []
            for ii, raw in enumerate(item):
                row.append(g.apply_template(template, raw, fi, ii, index, count))
                index += 1
            texts.append(row)

        labelled = [g.label_batch(p, t, style) for p, t in zip(pil, texts, strict=True)]
        out_images = [_to_tensor(batch) for batch in labelled]

        grid_tensor = None
        grid_size: list[int] | None = None
        preview = [img for batch in labelled for img in batch]
        if cfg["grid"] and count:
            rows_from = cfg["rows_from"]
            cols_from = cfg["columns_from"]
            spec = g.GridSpec(
                arrange=cfg["arrange"],
                columns=cfg["columns"],
                title=cfg["title"],
                column_headers=g.typed_headers(cfg["column_headers"])
                if cols_from == "typed"
                else [],
                row_headers=g.typed_headers(cfg["row_headers"]) if rows_from == "typed" else [],
                column_part=g.header_part(cols_from),
                row_part=g.header_part(rows_from),
            )
            cells = [
                g.Cell(img, texts[fi][ii], fi, ii)
                for fi, batch in enumerate(pil)
                for ii, img in enumerate(batch)
            ]
            grid = g.build_grid(cells, style, spec)
            grid_size = [grid.width, grid.height]
            grid_tensor = _to_tensor([grid])
            preview = [grid]
        if grid_tensor is None:
            import torch

            grid_tensor = torch.zeros((1, 64, 64, 3))

        flat = [text for item in texts for text in item]
        run = {
            "items": len(sizes),
            "batch_sizes": sizes[:256],
            "count": count,
            "labelled": any(lab for item in incoming for lab in item),
            "parts": g.part_examples(flat),
            "auto": g.auto_arrange(sizes),
            "grid": grid_size,
        }
        ui: dict[str, Any] = {"wp_label_grid": [run]}
        try:
            ui["images"] = _save_previews(preview[:_MAX_PREVIEWS])
        except ImportError:  # outside ComfyUI (tests): no temp folder, no preview
            pass
        return io.NodeOutput(out_images, grid_tensor, ui=ui)
