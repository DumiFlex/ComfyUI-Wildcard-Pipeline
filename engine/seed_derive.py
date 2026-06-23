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
      3. ``loop_index`` is mixed via XOR with a stable hash. ``loop_index=0``
         → no-op (backwards-compat for chains without ContextLoop).

    Locked-module precedence lives in the per-module handlers, NOT here.
    Locked modules read ``instance.locked_seed`` directly and ignore the
    chain seed — so loop iteration cannot affect them.

    Returns a non-negative seed masked to ``MAX_SAFE_SEED`` (50 bits) —
    matches the visual shape of ComfyUI's frontend-randomised seeds.
    """
    base = seed_override if seed_override is not None else widget_seed
    if loop_index == 0:
        return base & MAX_SAFE_SEED
    digest = hashlib.sha256(f"loop:{loop_index}".encode()).digest()
    shift = int.from_bytes(digest[:8], "big")
    return (base ^ shift) & MAX_SAFE_SEED
