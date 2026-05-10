# WP Context Injector

Lifts arbitrary ComfyUI outputs into named `$variable` bindings on the
PipelineContext. Sits as a sibling of `WP Context` — its rows come from
graph wires instead of a library picker.

## Usage

1. Add the node from `wildcard-pipeline → WP Context Injector`.
2. Wire any node output (STRING / INT / FLOAT / BOOLEAN / *) onto the
   trailing **+ new input** socket. A new row appears in the widget.
3. Type a binding name (e.g. `seed_phrase`). Names must match
   `^[a-zA-Z][a-zA-Z0-9_]*$` and may not start with `_`.
4. Use the binding in any downstream WP combine template, wildcard ref,
   or assembler.

## Per-row controls

- **Enabled checkbox** (left edge) — when off, the binding skips ctx
  write that run.
- **Internal flag** (`pi-globe` button) — when active, binding still
  writes to ctx but the assembler chip strip hides it.
- **Trash button** (`pi-trash`) — removes the row + severs the wire.

## Disconnected rows

If a wire is severed, the row persists with a dashed warn border + `no
link` badge. The conflict scanner emits an
`injector_input_disconnected` warning. Reconnect a wire or trash the
row to clear.

## Differences from WP Context

- No library tracking — injector rows aren't saved to / loaded from the
  module library.
- No drift detection — there's no "library version" to drift from.
- No SPA editor — bindings are graph-only.

## Limits

Currently capped at **10 input sockets** per injector node. V3
Autogrow preallocates the slot list at schema time, so all 10 sockets
show even when unconnected. If you need more, chain a second injector
node downstream (each one passes its `context` output forward).

## Notes

Non-primitive values (CONDITIONING / LATENT / IMAGE tensors) get
stringified via Python `str()` at write time. The result is
predictable but visually noisy (e.g. `<Tensor [1,3,512,512]>`); typical
use is to filter inputs to actual primitives.
