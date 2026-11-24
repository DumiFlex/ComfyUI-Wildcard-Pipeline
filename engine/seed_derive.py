"""Per-iteration seed derivation for WP_ContextLoop.

`derive_loop_seeds` produces the N base seeds emitted by ContextLoop.
`effective_chain_seed` is what the WP_Context wrapper stamps as
`__wp_node_seed__` for each iteration — locked-seed precedence happens
LATER inside per-module handlers, which is why locked modules ignore
the loop automatically (they never read __wp_node_seed__).

Pure Python — zero ComfyUI imports.
"""

import hashlib

MAX_SAFE_SEED = (1 << 50) - 1
"""1_125_899_906_842_623 — matches ComfyUI's frontend randomize cap
(Math.random() * 1125899906842624) so emitted seeds stay copy-pasteable +
visually consistent with stock seed nodes. KSampler accepts up to 64-bit,
but anything past 2^50 falls outside the canvas's typical seed shape and
is unsightly."""


def derive_loop_seeds(base: int, count: int, strategy: str) -> list[int]:
    """Produce `count` base seeds from `base` using the given strategy.

    Every emitted seed is masked to ``MAX_SAFE_SEED`` (50 bits) so the
    values stay within ComfyUI's frontend randomize range — see the
    module docstring for the rationale.
    """
    if count <= 1:
        return [base & MAX_SAFE_SEED]
    if strategy == "sequential":
        return [(base + i) & MAX_SAFE_SEED for i in range(count)]
    if strategy == "prime_stride":
        return [(base + i * 1000003) & MAX_SAFE_SEED for i in range(count)]
    if strategy == "hash_index":
        out: list[int] = []
        for i in range(count):
            digest = hashlib.sha256(f"{base}:{i}".encode()).digest()
            out.append(int.from_bytes(digest[:8], "big") & MAX_SAFE_SEED)
        return out
    raise ValueError(f"unknown loop seed strategy: {strategy!r}")


def apply_seed_locks(derived: list[int], locks: dict[int, int]) -> list[int]:
    """Overlay per-index locked seeds on a derived series.

    `locks` maps a 0-based iteration index to a pinned seed. Locked
    indices replace the derived value (masked to MAX_SAFE_SEED);
    out-of-range indices are ignored. Pure — no ComfyUI imports.
    """
    return [
        (locks[i] & MAX_SAFE_SEED) if i in locks else seed
        for i, seed in enumerate(derived)
    ]


def effective_chain_seed(
    *,
    widget_seed: int,
    seed_override: int | None,
    loop_index: int,
) -> int:
    """Compute the chain seed for THIS iteration before module handlers run.

    Precedence:
      1. ``seed_override`` (from ContextLoop) replaces ``widget_seed`` as
         base when present.
      2. Otherwise ``widget_seed`` is the base.
      3. ``loop_index`` is mixed via XOR with a stable hash ONLY when there is
         no override (to vary a constant ``widget_seed`` per iteration). An
         override is already per-iteration (the ContextLoop derived series) so
         it is used as-is. ``loop_index=0`` → no-op.

    Locked-module precedence lives in the per-module handlers, NOT here.
    Locked modules read ``instance.locked_seed`` directly and ignore the
    chain seed — so loop iteration cannot affect them.

    Returns a non-negative seed masked to ``MAX_SAFE_SEED`` (50 bits) —
    matches the visual shape of ComfyUI's frontend-randomised seeds.
    """
    base = seed_override if seed_override is not None else widget_seed
    # An override IS the loop's already-per-iteration derived seed → use it
    # verbatim. The loop_index XOR exists only to vary a CONSTANT widget seed
    # (the override-OFF path); re-mixing an override that already differs per
    # iteration is a double-shift that made the actual seed diverge from the
    # derived series the preview + per-iteration seed-modal locks show.
    if loop_index == 0 or seed_override is not None:
        return base & MAX_SAFE_SEED
    digest = hashlib.sha256(f"loop:{loop_index}".encode()).digest()
    shift = int.from_bytes(digest[:8], "big")
    return (base ^ shift) & MAX_SAFE_SEED


#: Cross-node internal from WP_ContextLoop, set on every frame whether or not
#: the Loop overrides Context seeds: ``{"seed": this frame, "frame0": frame 0}``
#: of its derived series. A Context set to "Seed from: Loop" reads it.
LOOP_SEED_KEY = "__wp_loop_seed__"
#: Cross-node internal from WP_Seeds (mirrors ``engine.seeds.ROWS_KEY``).
ROWS_KEY = "__wp_seed_rows__"
SEED_FROM_AUTO = "auto"
SEED_FROM_LOOP = "loop"
SEED_FROM_OWN = "own"
SEED_FROM_ROW = "row:"


def _row_key(name: str) -> str:
    return " ".join(str(name).split()).casefold()


def _seed_pair(entry: object) -> tuple[int, int] | None:
    if not isinstance(entry, dict):
        return None
    seed, frame0 = entry.get("seed"), entry.get("frame0")
    if isinstance(seed, bool) or isinstance(frame0, bool):
        return None
    if not isinstance(seed, int) or not isinstance(frame0, int):
        return None
    return seed & MAX_SAFE_SEED, frame0 & MAX_SAFE_SEED


def resolve_context_seed(
    *,
    widget_seed: int,
    seed_from: str | None,
    internals: dict,
) -> tuple[int, int, str]:
    """The (chain seed, hold seed, source) a WP_Context runs with.

    ``seed_from`` is the Context's own choice, so a wired seed never wins by
    itself (it is only where "own" gets its value):

    * ``auto`` (or missing): today's rule. The Loop's per-frame seed when the
      Loop overrides Context seeds, else the node's own seed shifted per frame.
    * ``loop``: the Loop's per-frame seed, override or not.
    * ``own``: the node's own seed (widget or wire), even when the Loop
      overrides, shifted per frame like ``auto`` without an override.
    * ``row:<name>``: that WP Seeds row's seed for this frame.

    A choice whose source isn't upstream falls back to ``auto``; ``source``
    then says ``"auto"`` so the caller can warn. The hold seed is frame 0's
    seed of the same source.
    """
    loop_index = int(internals.get("__wp_loop_index__", 0) or 0)
    choice = (seed_from or SEED_FROM_AUTO).strip()

    def own() -> tuple[int, int]:
        return (
            effective_chain_seed(
                widget_seed=int(widget_seed), seed_override=None, loop_index=loop_index,
            ),
            effective_chain_seed(widget_seed=int(widget_seed), seed_override=None, loop_index=0),
        )

    if choice.startswith(SEED_FROM_ROW):
        rows = internals.get(ROWS_KEY)
        row_key = _row_key(choice[len(SEED_FROM_ROW):])
        pair = _seed_pair(rows.get(row_key)) if isinstance(rows, dict) else None
        if pair is not None:
            return pair[0], pair[1], choice
    elif choice == SEED_FROM_LOOP:
        pair = _seed_pair(internals.get(LOOP_SEED_KEY))
        if pair is not None:
            return pair[0], pair[1], SEED_FROM_LOOP
    elif choice == SEED_FROM_OWN:
        chain, hold = own()
        return chain, hold, SEED_FROM_OWN

    # auto: the pre-existing behaviour.
    chain = effective_chain_seed(
        widget_seed=int(widget_seed),
        seed_override=internals.get("__wp_seed_override__"),
        loop_index=loop_index,
    )
    loop_seeds = internals.get("__wp_loop_seeds__")
    if isinstance(loop_seeds, list) and loop_seeds:
        hold = int(loop_seeds[0])
    else:
        hold = own()[1]
    return chain, hold, SEED_FROM_AUTO


def seed_root(seed_source: str, internals: dict) -> str:
    """What a Context's chain seed was made from, for WP Debug: ``loop`` (the
    Loop's per-frame seed: Seed from Loop, or auto while the Loop overrides
    Context seeds), ``row:<name>`` (a WP Seeds row) or ``own`` (its own seed
    widget or wire)."""
    if seed_source.startswith(SEED_FROM_ROW):
        return seed_source
    if seed_source == SEED_FROM_LOOP:
        return SEED_FROM_LOOP
    if seed_source == SEED_FROM_AUTO and internals.get("__wp_seed_override__") is not None:
        return SEED_FROM_LOOP
    return SEED_FROM_OWN
