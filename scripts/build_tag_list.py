#!/usr/bin/env python3
"""Build the booru tag list the optional value autocomplete reads.

Output is the four-column shape `wp_api/_tag_index.py` parses:

    name,category,post_count,"alias,alias"

Run by `.github/workflows/tag-list.yml`, not at install time. The result ships
as a release asset — never in the repository (it regenerates, and a 6 MB file
per refresh would bloat history forever) and never in the package (a usable
list dwarfs the whole gzipped JS budget).

WHY A POST-COUNT FLOOR AND NOT A PAGE COUNT
-------------------------------------------
`search[order]=count` sorts strictly descending ACROSS pages, verified against
the live API on 2026-08-06:

    page    1: first 8,244,950   last 55,918
    page  100: first        68   last     67
    page  800: first         1   last      1

So a popular tag cannot hide on a later page, and stopping once counts fall
below the floor provably loses nothing — it is an early exit, not a filter.
Walking all 1000 allowed pages spends ~900 requests and a quarter of an hour
collecting single-post tags nobody will ever autocomplete.

For reference, ComfyUI-Custom-Scripts ships ~100k tags, which lands around a
floor of 68.
"""
from __future__ import annotations

import argparse
import csv
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict

BASE = "https://danbooru.donmai.us"
# MUST stay in bare `product/version` form. Danbooru sits behind a bot filter
# that 403s anything else, measured 2026-08-06:
#
#     wildcard-pipeline-taglist/1.0                      -> 200
#     wp-tag-list/1.0                                    -> 200
#     ComfyUI-Wildcard-Pipeline                          -> 403  (no version)
#     ComfyUI-Wildcard-Pipeline/1.0                      -> 403
#     wp-tag-list/1.0 (+https://github.com/DumiFlex/...) -> 403  (URL present)
#
# So do NOT "improve" this by adding a contact URL or a longer description.
# That is the normal courtesy for a scraper and it is exactly what gets this
# blocked; the version suffix is what makes it acceptable.
USER_AGENT = "wildcard-pipeline-taglist/1.0"
PAGE_LIMIT = 1000
# The API refuses page > 1000 outright (HTTP 410, "You cannot go beyond page
# 1000"), so this is the ceiling whatever the floor says.
MAX_PAGE = 1000


def fetch(path: str, params: dict[str, str], *, retries: int = 4) -> list[dict]:
    """GET a JSON array, retrying on transient failures.

    The original script this replaces aborted on the first non-200, which for
    a 100-request run means one blip discards everything collected so far.
    """
    url = f"{BASE}{path}?{urllib.parse.urlencode(params)}"
    delay = 2.0
    for attempt in range(retries):
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=60) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            # 410 is the deep-pagination refusal: retrying cannot help.
            if err.code == 410:
                return []
            if err.code not in (429, 500, 502, 503, 504) or attempt == retries - 1:
                raise
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            if attempt == retries - 1:
                raise
        print(f"  retry in {delay:.0f}s ...", flush=True)
        time.sleep(delay)
        delay *= 2
    return []


def fetch_tags(min_count: int, pause: float) -> list[dict]:
    """Tags ordered by post count, stopping once they fall below `min_count`."""
    out: list[dict] = []
    for page in range(1, MAX_PAGE + 1):
        rows = fetch("/tags.json", {
            "limit": str(PAGE_LIMIT),
            "search[hide_empty]": "yes",
            "search[is_deprecated]": "no",
            "search[order]": "count",
            "page": str(page),
        })
        if not rows:
            print(f"  page {page}: empty, stopping", flush=True)
            break
        kept = [r for r in rows if r.get("post_count", 0) >= min_count]
        out.extend(kept)
        print(
            f"  page {page:>4}: +{len(kept):>4} "
            f"(lowest {rows[-1].get('post_count', 0):,})  total {len(out):,}",
            flush=True,
        )
        if len(kept) < len(rows):
            # Descending order means everything after this point is below the
            # floor too. Nothing worth having is left.
            print(f"  reached the floor of {min_count} posts", flush=True)
            break
        time.sleep(pause)
    return out


def fetch_aliases(pause: float, max_pages: int) -> dict[str, list[str]]:
    """`canonical -> [alias, ...]`, from the separate aliases endpoint.

    `tags.json` carries no aliases, and they are what let someone type `hires`
    and land on `highres` — the single most valuable thing in the file after
    the names themselves.
    """
    mapping: dict[str, list[str]] = defaultdict(list)
    for page in range(1, max_pages + 1):
        rows = fetch("/tag_aliases.json", {
            "limit": str(PAGE_LIMIT),
            "search[status]": "active",
            "page": str(page),
        })
        if not rows:
            break
        for row in rows:
            antecedent = row.get("antecedent_name")
            consequent = row.get("consequent_name")
            if isinstance(antecedent, str) and isinstance(consequent, str):
                mapping[consequent].append(antecedent)
        print(f"  aliases page {page:>3}: {len(mapping):,} tags covered", flush=True)
        time.sleep(pause)
    return mapping


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument(
        "--min-count", type=int, default=20,
        help="stop once tags drop below this many posts (default: 20)",
    )
    ap.add_argument("--out", default="wildcard-pipeline-tags.csv")
    ap.add_argument(
        "--pause", type=float, default=1.0,
        help="seconds between requests (default: 1.0)",
    )
    ap.add_argument(
        "--alias-pages", type=int, default=60,
        help="pages of aliases to fetch (default: 60)",
    )
    ap.add_argument("--no-aliases", action="store_true")
    args = ap.parse_args()

    print(f"Fetching tags with at least {args.min_count} posts ...", flush=True)
    tags = fetch_tags(args.min_count, args.pause)
    if not tags:
        print("No tags fetched — refusing to write an empty list.", file=sys.stderr)
        return 1

    aliases: dict[str, list[str]] = {}
    if not args.no_aliases:
        print("Fetching aliases ...", flush=True)
        aliases = fetch_aliases(args.pause, args.alias_pages)

    with open(args.out, "w", newline="", encoding="utf-8") as fh:
        writer = csv.writer(fh)
        for tag in tags:
            name = tag.get("name")
            if not isinstance(name, str) or not name:
                continue
            writer.writerow([
                name,
                tag.get("category", 0),
                tag.get("post_count", 0),
                ",".join(aliases.get(name, [])),
            ])

    print(
        f"\nWrote {len(tags):,} tags to {args.out} "
        f"({sum(len(v) for v in aliases.values()):,} aliases)",
        flush=True,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
