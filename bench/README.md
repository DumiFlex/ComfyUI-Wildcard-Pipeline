# AI bench

The AI assistant's bench as a [Watchwright](https://github.com/DumiFlex/watchwright) test pack. Its tests are the bench page's tests, copied into `meta.json` with the same titles, prompts and attempts per model. It clicks through each one in a browser the way a person would, against a running ComfyUI with the AI assistant set up. For every attempt it keeps:

- shots of the answer, and the answer's text;
- every AI call from the debug log (`collectors/ai-debug/debug-NN-*.md` and `.json`);
- times, flags and the step log.

You score the attempts on Watchwright's review page.

## Run it

1. Start ComfyUI with this extension and set up the model you want to test under **Settings › AI assistant**.
2. Start Watchwright (`watchwright serve`), open it, and add this folder under **Packs › Add pack**.
3. Press **New run** and pick the pack. The pack's settings are:

   | Setting | What it does |
   |---|---|
   | `model` | The model you set up (`q9`, `q35`, `q27`, `haiku`, `sonnet`, `opus`, `fable`). It picks each test's attempts from the bench page's recommendation. It doesn't change the model. |
   | `reset` | Backs up the database, empties the library and imports `bench-library.json` before the first test. Use it for a run that should match earlier runs. |
   | `web` | Includes the optional web tests (N1 to N5). They need web search set up. |

   Pick tests by section or tag. A test that uses an item an earlier test saves brings that test along (K2 needs K1's Adventurer line).

Before the first test, the setup:

- checks that the assistant is on and saves the model's name with the run;
- turns **Let the assistant delete items** and **Apply small changes automatically** off;
- tests the connection twice, so loading the model doesn't land in the first test's time.

The site address is `http://127.0.0.1:8189/wp/`. A run waits while another run against the same site is going. The browser is Firefox with a dark page, 1600 × 960. On a machine without Playwright's Firefox, set `WP_BENCH_BROWSER=chromium` before starting Watchwright.

## What the results mean

Most tests make, describe or edit an item with an editor's AI panel, or send one chat message. A few run inside another test and show up as its children:

- W4 refines W3's answer;
- W21 goes on with W20's chat;
- C12 goes on with C1's chat;
- P3 to P5 change P2's plan;
- P12 presses **Fix all with AI** in the first pack whose check shows problems.

Changes a later test needs are saved only on a test's last attempt.

A finding flag fails the attempt, because the app or the model did something wrong:

| Flag | Meaning |
|---|---|
| `model-loop` | The model wrote nothing new for 10 minutes. |
| `deleted-while-off` | The chat deleted something while deleting was off. |
| `build-blocked` | The pack builder wouldn't build. |
| `not-installed` | Install didn't finish. |
| `fix-changed-nothing` | **Fix all with AI** left the same findings. |
| `problem-fix-did-nothing` | A problem's **Fix** left the problem there. |

A robot flag breaks the attempt, meaning the bench couldn't do a step and the result says nothing about the model. **Redo broken** runs those attempts again.

| Flag | Meaning |
|---|---|
| `not-saved` | A new item didn't save. |
| `no-card` | The chat turn ended without a card to apply. |

`research-skipped`, `dismissed-findings` and `forced-click` are notes only.

Tests tagged `changes-library` delete or change items for good. Each attempt of one starts with a database backup. The backup is kept, and named in the attempt's notes, only when the attempt didn't pass.

## Reference images

W7, C10, P10 and Z20 to Z22 attach an image. See [images/README.md](images/README.md).

## Change it

- `pack.ts`: the pack's settings, setup, flags, rubric and collectors.
- `bench.ts`: the helpers the tests use. Examples: `h.panel`, `h.chat`, `h.aiIdle`, `h.applyCard`.
- `shapes.ts`: the shapes most tests share. Examples: `make`, `describe`, `edit`, `chat`, `organize`, `pack`.
- `tests/`: one file per section, in the bench page's order.
- `meta.json`: a copy of the bench page's tests. Keep it in step with the bench page.

Watchwright reloads the pack when a file changes, even in the middle of a run.

To try the clicks without ComfyUI or a model, run the manager on a fake model:

```bash
python bench/dev/serve.py
```

It serves the manager at `http://127.0.0.1:8189/wp/` on a fresh library, with a fake OpenAI-style model that answers every JSON step with a made-up value of the requested shape. Run the bench with `reset` on. The answers are nonsense, but every step runs, so a broken attempt points at a click that no longer works.
