"""Per-iteration seed derivation for WP_ContextLoop.

`derive_loop_seeds` produces the N base seeds emitted by ContextLoop.
`effective_chain_seed` is what the WP_Context wrapper stamps as
`__wp_node_seed__` for each iteration — locked-seed precedence happens
LATER inside per-module handlers, which is why locked modules ignore
the loop automatically (they never read __wp_node_seed__).

Pure Python — zero ComfyUI imports.
"""

import hashlib


def derive_loop_seeds(base: int, count: int, strategy: str) -> list[int]:
    """Produce `count` base seeds from `base` using the given strategy."""
    if count <= 1:
        return [base]
    if strategy == "sequential":
        return [base + i for i in range(count)]
    if strategy == "prime_stride":
        return [base + i * 1000003 for i in range(count)]
    if strategy == "hash_index":
        out: list[int] = []
        for i in range(count):
            digest = hashlib.sha256(f"{base}:{i}".encode()).digest()
            out.append(int.from_bytes(digest[:8], "big"))
        return out
    raise ValueError(f"unknown loop seed strategy: {strategy!r}")
