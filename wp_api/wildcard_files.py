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
import zipfile

from aiohttp import web

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


def _library_wildcards(request: web.Request) -> dict[str, str]:
    with db_session(request) as conn:
        rows = conn.execute(
            "SELECT id, name FROM modules WHERE type = 'wildcard';",
        ).fetchall()
    return {row[1]: row[0] for row in rows}


async def convert_wildcard_files(request: web.Request) -> web.Response:
    """POST /wp/api/import/wildcard-files (multipart).

    Parts, in any order:

    * ``meta`` — JSON ``{"paths": [str, ...], "pack_tag"?: str,
      "category"?: str, "exclude"?: [str, ...], "bundles"?: bool,
      "pack_name"?: str}``.
      ``bundles: false`` skips the pack / folder bundles. ``paths[i]`` is the
      relative path of the i-th ``file`` part (browsers drop folders from
      a multipart filename).
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
    pack_tag = meta.get("pack_tag") if isinstance(meta.get("pack_tag"), str) else None
    category = meta.get("category") if isinstance(meta.get("category"), str) else None
    make_bundles = meta.get("bundles") is not False
    pack_name = meta.get("pack_name") if isinstance(meta.get("pack_name"), str) else None
    merge = meta.get("merge") is not False
    keep_separate = {p for p in meta.get("keep_separate") or [] if isinstance(p, str)}

    files: list[SourceFile] = []
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
    ))
    return json_ok(result)


def register(router: web.UrlDispatcher) -> None:
    router.add_post("/wp/api/import/wildcard-files", convert_wildcard_files)
