"""The chat's library-management tools: categories, tags and deleting.

Mixed into `chat.Library`. Like every change tool they only build a
proposal card; the browser applies it through the user's normal endpoints.
Deleting is behind Settings › AI assistant › "Let the assistant delete
items" (`Library.allow_delete`), and Undo on a delete card creates the
items again at the same ids. See `/pr-drafts/ai-permissions-phase8.md`.
"""
from __future__ import annotations

import copy
import json
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

#: Items one bulk update may touch.
MAX_BULK = 100
#: Category icons: PrimeIcons ids without "pi-", the ones the Categories
#: page offers (`src/manager/components/icon-catalog.ts`; a test keeps the
#: two the same).
CATEGORY_ICONS = (
    "user", "users", "heart", "star", "eye", "face-smile", "crown", "id-card", "palette",
    "pencil", "sliders-h", "camera", "image", "sparkles", "sun", "moon", "home", "building",
    "map", "map-marker", "globe", "compass", "car", "cloud", "box", "folder", "book", "tag",
    "tags", "list", "sitemap", "objects-column", "bolt", "flag", "bell", "shield", "lock",
    "wrench", "filter", "info-circle",
)
#: Color words a model may use instead of a hex code.
COLOR_WORDS = {
    "red": "#ef4444", "orange": "#f97316", "amber": "#f59e0b", "yellow": "#eab308",
    "lime": "#84cc16", "green": "#22c55e", "teal": "#14b8a6", "cyan": "#06b6d4",
    "sky": "#0ea5e9", "blue": "#3b82f6", "indigo": "#6366f1", "violet": "#8b5cf6",
    "purple": "#a855f7", "pink": "#ec4899", "rose": "#f43f5e", "gray": "#6b7280",
    "grey": "#6b7280", "brown": "#92400e", "white": "#e5e7eb", "black": "#111827",
}

DELETE_OFF = ("deleting is turned off: the user allows it in Settings › AI assistant › "
              "Permissions. Tell them; don't try another way")


def _chips(rows: list[dict[str, Any]]) -> str:
    return ", ".join(f"[[{r['id']}#{str(r.get('name') or '').strip()}]]" for r in rows[:8])


def _short(text: Any, n: int) -> str:
    s = text.strip() if isinstance(text, str) else ""
    return s if len(s) <= n else s[: n - 1] + "…"


def _color(raw: Any) -> str | None:
    """A category color as the Categories page stores it (#rrggbb), from a
    hex code or a color word; None when there is none, ValueError when it
    isn't one."""
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None
    text = _short(raw, 20).lower()
    if text in COLOR_WORDS:
        return COLOR_WORDS[text]
    hexes = text.lstrip("#")
    if len(hexes) == 3 and all(c in "0123456789abcdef" for c in hexes):
        hexes = "".join(c * 2 for c in hexes)
    if len(hexes) == 6 and all(c in "0123456789abcdef" for c in hexes):
        return "#" + hexes
    raise ValueError(f"{text!r} isn't a color: give #rrggbb or one of "
                     + ", ".join(sorted(COLOR_WORDS)))


def _icon(raw: Any) -> str | None:
    if raw is None or (isinstance(raw, str) and not raw.strip()):
        return None
    name = _short(raw, 30).lower().removeprefix("pi pi-").removeprefix("pi-")
    if name not in CATEGORY_ICONS:
        raise ValueError(f"no category icon {name!r}; icons: {', '.join(CATEGORY_ICONS)}")
    return name


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
        #: Colors and icons to set: on a new category by name, on one that
        #: exists by id with what it had (for Undo).
        styles: list[dict[str, Any]] = []

        def style(target: dict[str, Any], x: dict[str, Any],
                  had: dict[str, Any] | None = None) -> None:
            color, icon = _color(x.get("color")), _icon(x.get("icon"))
            if had is not None:
                color = color if color and color != had.get("color") else None
                icon = icon if icon and icon != had.get("icon") else None
            if color or icon:
                styles.append({**target, **({"color": color} if color else {}),
                               **({"icon": icon} if icon else {}),
                               **({"before": {"color": had.get("color"), "icon": had.get("icon")}}
                                  if had is not None else {})})

        for raw in args.get("create") if isinstance(args.get("create"), list) else []:
            x = raw if isinstance(raw, dict) else {"name": raw}
            name = _short(x.get("name"), 40).strip(" .")
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
            style({"name": name}, x)
        renames: list[dict[str, Any]] = []
        for x in args.get("rename") if isinstance(args.get("rename"), list) else []:
            if not isinstance(x, dict):
                continue
            cat = self._category_by_name(x.get("from"))
            to = _short(x.get("to"), 40).strip(" .")
            if cat is None:
                notes.append(f"no category {_short(x.get('from'), 40)!r}")
                continue
            style({"id": cat["id"], "name": cat["name"]}, x, cat)
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
        if not creates and not renames and not styles:
            raise ValueError("that changes nothing" + (f" ({'; '.join(notes)})" if notes else ""))
        looks = {st["name"].lower(): st for st in styles}

        def look(name: str) -> str:
            st = looks.get(name.lower())
            if not st:
                return ""
            bits = [b for b in (st.get("color"), st.get("icon") and f"icon {st['icon']}") if b]
            return f" ({', '.join(bits)})"
        preview = [f"New category: {n}{look(n)}" for n in creates]
        preview += [f"Rename {r['from']} → {r['to']}" for r in renames]
        preview += [f"{st['name']}: {look(st['name'])[2:-1]}" for st in styles if "id" in st]
        bits = []
        if creates:
            bits.append(f"{len(creates)} new")
        if renames:
            bits.append(f"{len(renames)} renamed")
        restyled = sum(1 for st in styles if "id" in st)
        if restyled:
            bits.append(f"{restyled} restyled")
        out = {
            "title": "Create categories" if not renames and not restyled else "Edit categories",
            "summary": ", ".join(bits),
            "preview": preview,
            "warnings": notes[:5],
            "op": {"op": "categories", "kind": "categories", "create": creates,
                   "rename": renames, **({"styles": styles} if styles else {})},
        }
        if not renames and not restyled:
            out["risk"] = "low"
        return out

    # ── duplicates ───────────────────────────────────────────────────────

    def find_duplicates(self, args: dict[str, Any]) -> str:
        """Items that share a name (same kind), and items whose content is the
        same under different names, each set marked identical or not."""
        want = str(args.get("type") or "").strip().lower().replace(" ", "_")
        rows = [r for _k, r in self._saved_rows()
                if not want or self._kind(r) == want]  # type: ignore[attr-defined]

        def body(r: dict[str, Any]) -> str:
            core = {k: r.get(k) for k in ("payload", "children", "template_string")
                    if r.get(k) is not None}
            return json.dumps(core, sort_keys=True, default=str)

        by_name: dict[tuple[str, str], list[dict[str, Any]]] = {}
        by_body: dict[tuple[str, str], list[dict[str, Any]]] = {}
        for r in rows:
            kind = self._kind(r)  # type: ignore[attr-defined]
            name = " ".join(str(r.get("name") or "").lower().split())
            by_name.setdefault((kind, name), []).append(r)
            by_body.setdefault((kind, body(r)), []).append(r)
        lines: list[str] = []
        named_ids: set[frozenset[str]] = set()
        for (kind, _n), group in by_name.items():
            if len(group) < 2:
                continue
            named_ids.add(frozenset(r["id"] for r in group))
            same = len({body(r) for r in group}) == 1
            chips = _chips(group)
            what = "identical content" if same else "content differs"
            lines.append(f"- same name, {kind}, {what}: {chips}")
        for (kind, _b), group in by_body.items():
            ids = frozenset(r["id"] for r in group)
            if len(group) < 2 or ids in named_ids:
                continue
            chips = _chips(group)
            lines.append(f"- same content, different names, {kind}: {chips}")
        if not lines:
            return "no duplicates" + (f" among {want}s" if want else "")
        total = len(lines)
        head = f"{total} set{'s' if total != 1 else ''} of duplicates"
        tail = "\n- … more (give a type to narrow it)" if total > 30 else ""
        return (head + " (read them before merging; delete_items removes the extras, and "
                "constraints or bundles pointing at a removed one need repointing):\n"
                + "\n".join(lines[:30]) + tail)

    # ── many items at once ───────────────────────────────────────────────

    def update_many(self, args: dict[str, Any]) -> dict[str, Any]:
        """One card that moves many items into a category (or out of one),
        adds or removes library tags on them, or sets their rating."""
        raw = args.get("ids") if isinstance(args.get("ids"), list) else []
        if not raw:
            raise ValueError("give ids: the items to change")
        if len(raw) > MAX_BULK:
            raise ValueError(f"at most {MAX_BULK} items per call; split it")
        category = args.get("category")
        cid: str | None = None
        new_cat = ""
        clear = isinstance(category, str) and category.strip().lower() in ("", "none")
        if isinstance(category, str) and not clear:
            cid, new_cat = self._category(category)  # type: ignore[attr-defined]
        adds = [t for t in (_short(t, ai_describe.MAX_TAG_LEN).lstrip("#").lower()
                            for t in args.get("tags_add") or [] if isinstance(t, str)) if t]
        rms = {t.lstrip("#").lower() for t in args.get("tags_remove") or []
               if isinstance(t, str)}
        rating = args.get("rating") if args.get("rating") in ("safe", "nsfw") else None
        if category is None and not adds and not rms and not rating:
            raise ValueError("say what to change: category, tags_add, tags_remove or rating")
        items: list[dict[str, Any]] = []
        missing: list[str] = []
        seen: set[str] = set()
        for value in raw:
            row = self._find(value)  # type: ignore[attr-defined]
            if row is None or row.get("_proposed"):
                missing.append(_short(value, 30))
                continue
            if row["id"] in seen:
                continue
            seen.add(row["id"])
            kind = ("bundle" if row["id"] in self.bundles else
                    "template" if row["id"] in self.templates else "module")
            body: dict[str, Any] = {}
            tags = [t for t in row.get("tags") or [] if isinstance(t, str)]
            if adds or rms:
                now = [t for t in tags if t.lower() not in rms]
                now += [a for a in adds if a not in {t.lower() for t in now}]
                if now != tags:
                    body["tags"] = now
            if category is not None and (clear or cid or new_cat):
                if (None if clear else cid) != row.get("category_id") or new_cat:
                    body["category_id"] = None if clear else cid
            if rating and kind != "template" and rating != (row.get("content_rating") or "safe"):
                body["content_rating"] = rating
            if not body:
                continue
            items.append({"kind": kind, "id": row["id"], "name": row.get("name") or row["id"],
                          "body": body,
                          # Goes into the category the card creates first.
                          **({"to_new": True} if new_cat and "category_id" in body else {}),
                          "before": {k: (row.get(k) if k != "content_rating"
                                         else row.get(k) or "safe") for k in body}})
        if not items:
            raise ValueError("that changes nothing" + (
                f" (not found: {', '.join(missing[:8])})" if missing else ""))
        what = []
        if category is not None:
            what.append("no category" if clear else f"category {category.strip()}"
                        + (" (new)" if new_cat else ""))
        if adds:
            what.append(" ".join(f"+#{a}" for a in adds))
        if rms:
            what.append(" ".join(f"−#{t}" for t in sorted(rms)))
        if rating:
            what.append(f"rating {rating}")
        n = len(items)
        return {
            "title": f"Change {n} item{'s' if n != 1 else ''}: {'; '.join(what)}",
            "summary": f"{n} item{'s' if n != 1 else ''}",
            "preview": [str(it["name"]) for it in items[:40]]
            + ([f"… and {n - 40} more"] if n > 40 else []),
            "warnings": [f"Not found: {', '.join(missing[:8])}"] if missing else [],
            "op": {"op": "bulk", "kind": "bulk", "items": items, "new_category": new_cat},
        }

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
                raise ValueError(f"{row.get('name')} is only a proposal card; it isn't in the "
                                 "library, so there is nothing to delete. Tell the user to "
                                 "dismiss that card instead")
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
