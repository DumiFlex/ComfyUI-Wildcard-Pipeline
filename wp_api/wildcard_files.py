"""/wp/api/import/wildcard-files — convert Dynamic Prompts / PPP / Impact
Pack wildcard files into an import payload.

The route only converts: it writes nothing. The manager feeds the returned
payload through the normal import picker, conflict modal and
``/wp/api/import/commit``, so collisions, undo and broken-ref checks work
exactly as they do for a JSON export.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import zipfile
from pathlib import Path

from aiohttp import BodyPartReader, web

from engine.wildcard_files import (
    MAX_FILE_BYTES,
    MAX_FILES,
    MAX_TOTAL_BYTES,
    SourceFile,
    convert_files,
    is_wildcard_file,
    read_zip,
)
from wp_api._helpers import db_session, json_error, json_ok

# --- Wildcard folders of other extensions --------------------------------

#: (id, label, custom node folder name (lowercase), sub folders)
_NODE_FOLDERS: tuple[tuple[str, str, str, tuple[str, ...]], ...] = (
    ("impact", "Impact Pack", "comfyui-impact-pack", ("wildcards", "custom_wildcards")),
    ("dynamicprompts", "Dynamic Prompts", "comfyui-dynamicprompts", ("wildcards",)),
    ("easy-use", "Easy-Use", "comfyui-easy-use", ("wildcards",)),
    ("ppp", "Prompt PostProcessor", "comfyui-prompt-postprocessor", ("wildcards",)),
    ("lora-manager", "LoRA Manager", "comfyui-lora-manager", ("wildcards",)),
)


def _custom_nodes_dirs() -> list[Path]:
    try:
        import folder_paths  # type: ignore[import-not-found]

        dirs = [Path(p) for p in folder_paths.get_folder_paths("custom_nodes")]
    except Exception:  # noqa: BLE001 - outside ComfyUI (tests)
        dirs = []
    # This extension lives in custom_nodes/, so its parent is one too.
    here = Path(__file__).resolve().parent.parent.parent
    if here not in dirs:
        dirs.append(here)
    return [d for d in dirs if d.is_dir()]


def _lora_manager_dirs() -> list[Path]:
    """LoRA Manager keeps its wildcards in its settings folder."""
    out: list[Path] = []
    env = os.environ.get("LORA_MANAGER_SETTINGS_DIR")
    if env:
        out.append(Path(env).expanduser())
    home = Path.home()
    if sys.platform == "win32":
        for var in ("LOCALAPPDATA", "APPDATA"):
            base = os.environ.get(var)
            if base:
                out.append(Path(base) / "ComfyUI-LoRA-Manager")
    elif sys.platform == "darwin":
        out.append(home / "Library" / "Application Support" / "ComfyUI-LoRA-Manager")
    else:
        xdg = os.environ.get("XDG_CONFIG_HOME")
        base = Path(xdg) if xdg else home / ".config"
        out.append(base / "ComfyUI-LoRA-Manager")
    return [p / "wildcards" for p in out]


def wildcard_folders(
    custom_nodes: list[Path] | None = None, extra: list[tuple[str, str, Path]] | None = None,
) -> list[dict]:
    """Wildcard folders of other extensions found on this machine, with
    how many wildcard files each holds. Only these folders can be read by
    :func:`convert_wildcard_files` (``meta.folder``), never an arbitrary
    path."""
    found: list[tuple[str, str, Path]] = []
    for cn in custom_nodes if custom_nodes is not None else _custom_nodes_dirs():
        try:
            entries = {p.name.lower(): p for p in cn.iterdir() if p.is_dir()}
        except OSError:
            continue
        for fid, label, folder, subs in _NODE_FOLDERS:
            node = entries.get(folder)
            if node is None:
                continue
            for sub in subs:
                path = node / sub
                if path.is_dir():
                    found.append((f"{fid}:{sub}", f"{label} ({sub})", path))
    if custom_nodes is None:
        for path in _lora_manager_dirs():
            if path.is_dir():
                found.append(("lora-manager:settings", "LoRA Manager", path))
        try:
            import folder_paths  # type: ignore[import-not-found]

            for i, p in enumerate(folder_paths.get_folder_paths("wildcards")):
                if Path(p).is_dir():
                    found.append((f"models:wildcards:{i}", "models/wildcards", Path(p)))
        except Exception:  # noqa: BLE001 - not registered / outside ComfyUI
            pass
    found.extend(extra or [])
    out: list[dict] = []
    seen: set[str] = set()
    for fid, label, path in found:
        real = str(path.resolve())
        if real in seen:
            continue
        seen.add(real)
        count = sum(1 for _ in _walk_wildcards(path, limit=MAX_FILES))
        out.append({"id": fid, "label": label, "path": str(path), "files": count})
    return out


def _walk_wildcards(root: Path, limit: int):
    n = 0
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames[:] = [d for d in dirnames if not d.startswith(".")]
        for name in sorted(filenames):
            path = Path(dirpath) / name
            # A symlinked file could point anywhere: only real files.
            if is_wildcard_file(name) and not path.is_symlink():
                yield path
                n += 1
                if n >= limit:
                    return


def read_folder(root: Path) -> list[SourceFile]:
    """Every wildcard file under ``root`` (no symlinked folders), within
    the upload limits."""
    files: list[SourceFile] = []
    total = 0
    for path in _walk_wildcards(root, limit=MAX_FILES):
        try:
            size = path.stat().st_size
        except OSError:
            continue
        if size > MAX_FILE_BYTES:
            continue
        total += size
        if total > MAX_TOTAL_BYTES:
            raise ValueError("the folder is too large to import at once")
        rel = path.relative_to(root).as_posix()
        files.append(SourceFile(rel, path.read_bytes()))
    return files


async def list_wildcard_folders(request: web.Request) -> web.Response:
    """GET /wp/api/import/wildcard-folders → ``{"folders": [{id, label,
    path, files}]}``."""
    loop = asyncio.get_running_loop()
    folders = await loop.run_in_executor(None, wildcard_folders)
    return json_ok({"folders": folders})


def _library_wildcards(request: web.Request) -> dict[str, str]:
    with db_session(request) as conn:
        rows = conn.execute(
            "SELECT id, name FROM modules WHERE type = 'wildcard';",
        ).fetchall()
    return {row[1]: row[0] for row in rows}


def _library_module_ids(request: web.Request) -> set[str]:
    with db_session(request) as conn:
        rows = conn.execute("SELECT id FROM modules;").fetchall()
    return {row[0] for row in rows}


async def convert_wildcard_files(request: web.Request) -> web.Response:
    """POST /wp/api/import/wildcard-files (multipart).

    Parts, in any order:

    * ``meta`` — JSON ``{"paths": [str, ...], "pack_tag"?: str,
      "category"?: str, "exclude"?: [str, ...], "bundles"?: bool,
      "bundle_mode"?: "stacks" | "entries" | "none",
      "pack_name"?: str, "merge"?: bool, "keep_separate"?: [str, ...],
      "dialect"?: "auto" | "dynamicprompts" | "ppp" | "impact" | "umi" |
      "mixed", "axis_names"?: {wildcard: {old: new}}, "fold_copies"?: bool,
      "folder"?: str}``.
      ``bundles: false`` skips the bundles. ``paths[i]`` is the
      relative path of the i-th ``file`` part (browsers drop folders from
      a multipart filename). ``folder`` (an id from
      ``GET /wp/api/import/wildcard-folders``) reads that folder on this
      machine instead of uploaded files.
    * ``file`` — one per uploaded file: ``.txt``, ``.yaml``, ``.yml``,
      ``.json`` or ``.zip``.

    Response: ``{"payload": <8-bucket envelope>, "report": {...}}``.
    """
    if not request.content_type.startswith("multipart/"):
        return json_error("expected a multipart upload", status=400)
    meta: dict = {}
    blobs: list[tuple[str, bytes]] = []
    total = 0
    try:
        reader = await request.multipart()
        async for part in reader:
            if not isinstance(part, BodyPartReader):
                continue
            if part.name == "meta":
                meta = json.loads(await part.text())
                continue
            if part.name != "file":
                continue
            data = bytearray()
            while chunk := await part.read_chunk():
                data.extend(chunk)
                total += len(chunk)
                if total > MAX_TOTAL_BYTES:
                    return json_error("the upload is too large to import at once", status=400)
            blobs.append((part.filename or "", bytes(data)))
            if len(blobs) > MAX_FILES:
                return json_error(f"too many files (limit {MAX_FILES})", status=400)
    except (ValueError, json.JSONDecodeError) as exc:
        return json_error(f"could not read the upload: {exc}", status=400)
    if not isinstance(meta, dict):
        return json_error("meta must be a JSON object", status=400)

    paths = meta.get("paths")
    if not isinstance(paths, list):
        paths = []
    exclude = {p for p in meta.get("exclude") or [] if isinstance(p, str)}
    pack_tag = _got if isinstance(_got := meta.get("pack_tag"), str) else None
    category = _got if isinstance(_got := meta.get("category"), str) else None
    make_bundles = meta.get("bundles") is not False
    pack_name = _got if isinstance(_got := meta.get("pack_name"), str) else None
    merge = meta.get("merge") is not False
    keep_separate = {p for p in meta.get("keep_separate") or [] if isinstance(p, str)}
    dialect = _got if isinstance(_got := meta.get("dialect"), str) else None
    bundle_mode = _got if isinstance(_got := meta.get("bundle_mode"), str) else None
    fold_copies = meta.get("fold_copies") is not False
    axis_names: dict[str, dict[str, str]] = {}
    raw_axes = meta.get("axis_names")
    if isinstance(raw_axes, dict):
        for wname, renames in raw_axes.items():
            if isinstance(wname, str) and isinstance(renames, dict):
                axis_names[wname] = {
                    str(k): str(v) for k, v in renames.items()
                    if isinstance(k, str) and isinstance(v, str)
                }

    files: list[SourceFile] = []
    folder_id = meta.get("folder")
    if isinstance(folder_id, str) and folder_id:
        loop = asyncio.get_running_loop()
        known = {f["id"]: f for f in await loop.run_in_executor(None, wildcard_folders)}
        if folder_id not in known:
            return json_error("unknown wildcard folder", status=400)
        try:
            files = await loop.run_in_executor(
                None, read_folder, Path(known[folder_id]["path"]),
            )
        except (OSError, ValueError) as exc:
            return json_error(str(exc), status=400)
    for i, (filename, data) in enumerate(blobs):
        path = paths[i] if i < len(paths) and isinstance(paths[i], str) else filename
        if path.lower().endswith(".zip"):
            try:
                files.extend(read_zip(data))
            except (zipfile.BadZipFile, ValueError) as exc:
                return json_error(f"{path}: {exc}", status=400)
            continue
        if not is_wildcard_file(path):
            continue
        if len(data) > MAX_FILE_BYTES:
            return json_error(f"{path} is too large", status=400)
        files.append(SourceFile(path, data))

    if not files:
        return json_error(
            "no wildcard files found (.txt, .yaml, .yml, .json or a .zip of them)",
            status=400,
        )

    library = _library_wildcards(request)
    library_ids = _library_module_ids(request)
    loop = asyncio.get_running_loop()
    result = await loop.run_in_executor(None, lambda: convert_files(
        files,
        library_wildcards=library,
        pack_tag=(pack_tag or "").strip() or None,
        category_name=(category or "").strip() or None,
        exclude=exclude,
        make_bundles=make_bundles,
        pack_name=(pack_name or pack_tag or "").strip() or None,
        merge=merge,
        keep_separate=keep_separate,
        library_ids=library_ids,
        dialect=dialect,
        axis_names=axis_names,
        bundle_mode=bundle_mode,
        fold_copies=fold_copies,
    ))
    return json_ok(result)


def register(router: web.UrlDispatcher) -> None:
    router.add_get("/wp/api/import/wildcard-folders", list_wildcard_folders)
    router.add_post("/wp/api/import/wildcard-files", convert_wildcard_files)
