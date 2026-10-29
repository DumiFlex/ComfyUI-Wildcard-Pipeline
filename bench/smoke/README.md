# AI smoke pack

Every AI entry point of the manager once, checked pass or fail, in a few minutes. It's a [Watchwright](https://github.com/DumiFlex/watchwright) test pack like the [bench](../README.md), but where the bench keeps answers for you to score, the smoke pack checks them itself: a failing test means the app did something wrong.

On the fake model (`bench/dev/serve.py`) the chat tests script the model's exact answer, so each one knows which card it should get and what Apply and Undo must do to the library. On a real model the scripted tests skip and the rest still run.

## Run it

On the fake model, with no ComfyUI:

```bash
python bench/dev/serve.py
```

Add this folder in Watchwright under **Packs › Add pack** and press **New run**. The defaults (`fake` on, `reset` on) fit the fake server. A run takes about 6 minutes.

On a real ComfyUI with a model set up under **Settings › AI assistant**, turn `fake` and `reset` off. `reset` refuses to run on anything but the fake server, because it empties the library.

| Setting | What it does |
|---|---|
| `fake` | The manager is `bench/dev/serve.py`. Off, the scripted tests skip. |
| `reset` | Imports `../bench-library.json` into an emptied library (after a backup) before the first test. Fake server only. |
| `format` | The chat's tool format: Auto, Native tool calls or JSON steps. Run the chat tests once with each. |

The site key is the bench's, so a smoke run and a bench run never change the library at the same time.

## The tests

| Test | Checks |
|---|---|
| A1 | Test connection says Connected, with JSON answers working. |
| C1 to C9 | Chat: a plain reply, a create card and an edit card (Apply, then Undo leaves the library exactly as before), deleting refused while it's off, a Delete card with deleting on, an `@` mention reaching the model, questions with Decide for me, `open`, and one unscripted question. |
| E1 to E14 | Every editor's AI panel: the wildcard panel in each mode, describe, fixed values, combine, derivation, constraint, template, bundle split and Organize. Each answers, offers its answer to apply, and applies it to the editor. Only E1 saves, and deletes what it made. |
| P1 | Pack builder: plan, build, install, then Undo leaves the library as it was. |
| G1, G2 | Safety guard: a pack request for minors is refused before any model call, and an option that names a minor in a sexual context is never offered. |

A finding flag fails the test:

| Flag | Meaning |
|---|---|
| `ai-error` | The AI showed an error. |
| `no-answer` | Nothing came back, or the panel had nothing to apply. |
| `no-card` | The chat turn ended without the card it should have. |
| `wrong-card` | The card doesn't show what the model asked for. |
| `apply-did-nothing` | Apply (or Install) didn't change the library. |
| `undo-left-changes` | Undo didn't bring the library back exactly. |
| `deleted-while-off` | The chat deleted something, or offered to, while deleting was off. |
| `guard-missed` | The safety guard let something through. |

`script-left-over` (info) means the app asked the model fewer times than the test expected.

## The fake model's script

`smoke.ts` wraps the fake's script API (`bench/dev/serve.py` has the details):

- `script(h, ...answers)` queues answers: `{ calls: [{ tool, args }] }` for a chat step that calls tools, `{ text }` for a reply, `{ json }` for the next request that asks for a JSON schema (an editor panel, the pack builder).
- `fakeLog(h)` lists the calls the manager made since the queue was cleared. The pack clears it before every test.

A panel answer must be valid for the item: wildcard edit modes name options by number (from 1), and a panel drops what doesn't fit the library, so a made-up answer often ends as "nothing to change".

## Change it

- `pack.ts`: settings, flags, setup and the hooks around each test.
- `smoke.ts`: the script helpers, library snapshots and `check`.
- `tests/`: one file per area. `smoke(id, meta, body)` declares a test; `scripted: true` skips it on a real model.

The tests use the bench's helpers (`../bench.ts`: `h.panel`, `h.chat`, `h.applyCard`, …) and its collectors (`../shared.ts`), so each attempt keeps the same AI debug log, console errors and failed requests.
