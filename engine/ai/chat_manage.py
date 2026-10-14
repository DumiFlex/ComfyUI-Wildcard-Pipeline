"""The chat's library-management tools: categories, tags and deleting.

Mixed into `chat.Library`. Like every change tool they only build a
proposal card; the browser applies it through the user's normal endpoints.
Deleting is behind Settings › AI assistant › "Let the assistant delete
items" (`Library.allow_delete`), and Undo on a delete card creates the
items again at the same ids. See `/pr-drafts/ai-permissions-phase8.md`.
"""
from __future__ import annotations

import copy
from typing import Any

from engine.ai import describe as ai_describe

#: Per delete card.
MAX_DELETE_ITEMS = 10
MAX_DELETE_CATEGORIES = 10
MAX_DELETE_TAGS = 20
#: Creates or renames per card.
MAX_RENAMES = 20
#: Items one tag rename may touch.
MAX_TAG_ITEMS = 200

DELETE_OFF = ("deleting is turned off: the user allows it in Settings › AI assistant › "
              "Permissions. Tell them; don't try another way")


def _short(text: Any, n: int) -> str:
    s = text.strip() if isinstance(text, str) else ""
    return s if len(s) <= n else s[: n - 1] + "…"


class ManageTools:
    """Needs `modules`, `bundles`, `templates`, `category_rows`, `get`,
    `_find`, `_used_by`, `_kind`, `not_found` and `tags` from Library."""

    modules: dict[str, dict[str, Any]]
    bundles: dict[str, dict[str, Any]]
    templates: dict[str, dict[str, Any]]
    category_rows: dict[str, dict[str, Any]]
    tags: list[str]
    allow_delete: bool

    def _rows(self) -> list[tuple[str, dict[str, Any]]]:
        return [*(("module", r) for r in self.modules.values()),
                *(("bundle", r) for r in self.bundles.values()),
                *(("template", r) for r in self.templates.values())]

    def _saved_rows(self) -> list[tuple[str, dict[str, Any]]]:
        return [(k, r) for k, r in self._rows() if not r.get("_proposed")]

    def _category_by_name(self, raw: Any) -> dict[str, Any] | None:
        low = _short(raw, 60).lower()
        if not low:
            return None
        for c in self.category_rows.values():
            if c["id"] == low or str(c.get("name") or "").lower() == low:
                return c
        return None

    def _tag(self, raw: Any) -> str | None:
        """The library tag `raw` names, as stored (tags are lower case)."""
        key = _short(raw, ai_describe.MAX_TAG_LEN + 1).lstrip("#").lower()
        for t in self.tags:
            if t.lower() == key:
                return t
        return None

    def _tag_members(self, tag: str) -> list[dict[str, Any]]:
        return [{"kind": k, "id": r["id"], "tags": list(r.get("tags") or [])}
                for k, r in self._saved_rows() if tag in (r.get("tags") or [])]

    # ── categories ───────────────────────────────────────────────────────

    def edit_categories(self, args: dict[str, Any]) -> dict[str, Any]:
        creates: list[str] = []
        notes: list[str] = []
        seen: set[str] = set()
        for raw in args.get("create") if isinstance(args.get("create"), list) else []:
            name = _short(raw, 40).strip(" .")
            if not name or name.lower() in seen:
                continue
            seen.add(name.lower())
            if self._category_by_name(name):
                notes.append(f"{name} exists already")
                continue
            if not any(ch.isalnum() for ch in name):
                notes.append(f"{name!r} needs a letter or digit")
                continue
            creates.append(name)
        renames: list[dict[str, Any]] = []
        for x in args.get("rename") if isinstance(args.get("rename"), list) else []:
            if not isinstance(x, dict):
                continue
            cat = self._category_by_name(x.get("from"))
            to = _short(x.get("to"), 40).strip(" .")
            if cat is None:
                notes.append(f"no category {_short(x.get('from'), 40)!r}")
                continue
            if not to or to == cat["name"]:
                continue
            other = self._category_by_name(to)
            if other is not None and other["id"] != cat["id"]:
                notes.append(f"a category named {to} exists; move its items with update_info "
                             f"instead")
                continue
            renames.append({"id": cat["id"], "from": cat["name"], "to": to})
        if len(creates) + len(renames) > MAX_RENAMES:
            raise ValueError(f"at most {MAX_RENAMES} creates and renames per call; split it")
        if not creates and not renames:
            raise ValueError("that changes nothing" + (f" ({'; '.join(notes)})" if notes else ""))
        preview = [f"New category: {n}" for n in creates]
        preview += [f"Rename {r['from']} → {r['to']}" for r in renames]
        bits = []
        if creates:
            bits.append(f"{len(creates)} new")
        if renames:
            bits.append(f"{len(renames)} renamed")
        out = {
            "title": "Create categories" if not renames else "Edit categories",
            "summary": ", ".join(bits),
            "preview": preview,
            "warnings": notes[:5],
            "op": {"op": "categories", "kind": "categories", "create": creates,
                   "rename": renames},
        }
        if not renames:
            out["risk"] = "low"
        return out

    # ── tags ─────────────────────────────────────────────────────────────

    def edit_tags(self, args: dict[str, Any]) -> dict[str, Any]:
        renames: list[dict[str, Any]] = []
        notes: list[str] = []
        touched = 0
        done: set[str] = set()
        for x in args.get("rename") if isinstance(args.get("rename"), list) else []:
            if not isinstance(x, dict):
                continue
            tag = self._tag(x.get("from"))
            to = _short(x.get("to"), ai_describe.MAX_TAG_LEN).lstrip("#").strip().lower()
            if tag is None:
                notes.append(f"no library tag #{_short(x.get('from'), 30).lstrip('#')}")
                continue
            if not to or to == tag or tag in done:
                continue
            done.add(tag)
            members = self._tag_members(tag)
            touched += len(members)
            renames.append({"from": tag, "to": to, "merge": self._tag(to) is not None,
                            "members": members})
        if len(renames) > MAX_RENAMES:
            raise ValueError(f"at most {MAX_RENAMES} renames per call; split it")
        if touched > MAX_TAG_ITEMS:
            raise ValueError(f"that touches {touched} items; at most {MAX_TAG_ITEMS} per call, "
                             "split it")
        if not renames:
            raise ValueError("that changes nothing" + (f" ({'; '.join(notes)})" if notes else ""))
        preview = [f"#{r['from']} → #{r['to']}" + (" (merge)" if r["merge"] else "")
                   + f", {len(r['members'])} item{'s' if len(r['members']) != 1 else ''}"
                   for r in renames]
        return {
            "title": ("Rename and merge tags" if any(r["merge"] for r in renames)
                      else "Rename tags"),
            "summary": f"{touched} item{'s' if touched != 1 else ''}",
            "preview": preview,
            "warnings": notes[:5],
            "op": {"op": "tags", "kind": "tags", "rename": renames},
        }

    # ── delete ───────────────────────────────────────────────────────────

    def delete_items(self, args: dict[str, Any]) -> dict[str, Any]:
        if not self.allow_delete:
            raise ValueError(DELETE_OFF)

        def _list(key: str) -> list[Any]:
            v = args.get(key)
            return v if isinstance(v, list) else []

        raw_items, raw_cats, raw_tags = _list("items"), _list("categories"), _list("tags")
        if len(raw_items) > MAX_DELETE_ITEMS:
            raise ValueError(f"delete at most {MAX_DELETE_ITEMS} items per call; split it")
        if len(raw_cats) > MAX_DELETE_CATEGORIES:
            raise ValueError(f"delete at most {MAX_DELETE_CATEGORIES} categories per call")
        if len(raw_tags) > MAX_DELETE_TAGS:
            raise ValueError(f"delete at most {MAX_DELETE_TAGS} tags per call")
        items: list[dict[str, Any]] = []
        preview: list[str] = []
        warnings: list[str] = []
        gone: set[str] = set()
        for raw in raw_items:
            row = self._find(raw)  # type: ignore[attr-defined]
            if row is None:
                raise ValueError(self.not_found(raw))  # type: ignore[attr-defined]
            if row.get("_proposed"):
                raise ValueError(f"{row.get('name')} is only proposed in this answer; it isn't "
                                 "in the library, so there is nothing to delete")
            if row["id"] in gone:
                continue
            gone.add(row["id"])
            kind = ("bundle" if row["id"] in self.bundles else
                    "template" if row["id"] in self.templates else "module")
            stored = {k: v for k, v in copy.deepcopy(row).items() if not k.startswith("_")}
            items.append({"kind": kind, "type": self._kind(row),  # type: ignore[attr-defined]
                          "id": row["id"], "name": row.get("name"), "row": stored})
            preview.append(f"Delete {self._kind(row).replace('_', ' ')} "  # type: ignore
                           f"{row.get('name')}")
            if kind == "module":
                users = self._used_by(row["id"])  # type: ignore[attr-defined]
                if users:
                    warnings.append(f"{row.get('name')} is used by " + ", ".join(users[:5])
                                    + (" and more" if len(users) > 5 else ""))
        cats: list[dict[str, Any]] = []
        for raw in raw_cats:
            cat = self._category_by_name(raw)
            if cat is None:
                raise ValueError(f"no category {_short(raw, 40)!r}")
            if any(c["id"] == cat["id"] for c in cats):
                continue
            members = [{"kind": k, "id": r["id"]} for k, r in self._saved_rows()
                       if r.get("category_id") == cat["id"] and r["id"] not in gone]
            cats.append({**{k: cat.get(k) for k in ("id", "name", "color", "icon",
                                                     "sort_order")}, "members": members})
            preview.append(f"Delete category {cat['name']}")
            if members:
                warnings.append(f"{len(members)} item{'s' if len(members) != 1 else ''} "
                                f"lose{'' if len(members) != 1 else 's'} the category "
                                f"{cat['name']}")
        tags: list[dict[str, Any]] = []
        for raw in raw_tags:
            tag = self._tag(raw)
            if tag is None:
                raise ValueError(f"no library tag #{_short(raw, 30).lstrip('#')}")
            if any(t["tag"] == tag for t in tags):
                continue
            members = [m for m in self._tag_members(tag) if m["id"] not in gone]
            tags.append({"tag": tag, "members": members})
            preview.append(f"Delete tag #{tag} from {len(members)} "
                           f"item{'s' if len(members) != 1 else ''}")
        if not items and not cats and not tags:
            raise ValueError("name the items, categories or tags to delete")
        count = len(items) + len(cats) + len(tags)
        return {
            "title": (f"Delete {items[0]['name']}" if count == 1 and items
                      else f"Delete {count} things"),
            "summary": ", ".join(b for b in (
                f"{len(items)} item{'s' if len(items) != 1 else ''}" if items else "",
                f"{len(cats)} categor{'ies' if len(cats) != 1 else 'y'}" if cats else "",
                f"{len(tags)} tag{'s' if len(tags) != 1 else ''}" if tags else "") if b),
            "preview": preview,
            "warnings": warnings[:8],
            "op": {"op": "delete", "kind": "delete", "items": items, "categories": cats,
                   "tags": tags},
        }
