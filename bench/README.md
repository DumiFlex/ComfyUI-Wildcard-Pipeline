# AI bench

For a quick pass or fail check of every AI flow, see the [AI smoke pack](smoke/README.md) instead.

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
   | `reset` | Loads the bench library (`bench-library.json`) before the first test. Use it for a run that should match earlier runs. The first time it imports the file; after that it restores a pinned copy, as long as the file hasn't changed. |
   | `putBack` | On by default. Puts your library and AI settings back when the run ends (see [Putting your library back](#putting-your-library-back)). |
   | `web` | Includes the optional web tests (N1 to N5). They need web search set up. |

   Pick tests by section or tag. A test that uses an item an earlier test saves brings that test along (K2 needs K1's Adventurer line).

Before the first test, the setup:

- checks that the assistant is on and saves the model's name and the extension's version with the run;
- backs up your library, pinned, and loads the bench library when `reset` is on;
- turns **Let the assistant delete items** and **Apply small changes automatically** off (the delete tests turn deleting on for their own turn);
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
| `not-installed` | Install didn't finish, or stayed greyed out after the build. |
| `fix-changed-nothing` | **Fix all with AI** left the same findings. |
| `problem-fix-did-nothing` | A problem's **Fix** left the problem there, after up to three presses. One flag per problem, with the number of presses. |
| `unusable-answer` | An editor panel's answer had nothing to apply. The bench saved a stand-in so the tests that use the item still run (T1 saves a stand-in Bench Flux for T2 and T6). |

A robot flag breaks the attempt, meaning the bench couldn't do a step and the result says nothing about the model. **Redo broken** runs those attempts again.

| Flag | Meaning |
|---|---|
| `not-saved` | A new item didn't save. |
| `no-card` | The chat turn ended without a card to apply. |

`research-skipped`, `dismissed-findings`, `forced-click`, `fake-answer` and `fix-is-plan-change` are notes only. `fix-is-plan-change` lists build problems on items the code writes from the plan: their row offers **Change the plan** instead of **Fix**, so the bench doesn't press anything there. On the fake model (below) a turn or panel with nothing to apply flags `fake-answer` instead of `no-card` or `not-saved`, since the fake's made-up answers rarely make a card.

Tests tagged `changes-library` delete or change items for good. Each attempt of one starts with a database backup. The backup is kept (pinned) and named in the attempt's notes only when the attempt didn't pass.

Attempts keep a video only when they fail or break.

## The dashboard

The pack's **Dashboard** tab shows the runs, filtered by `model`: pass rate and findings, a model leaderboard (pass rate, the three rubric scores, AI seconds, findings), AI time against quality, pass rate and quality per section, the pack builder's plan, build and fix times, and lists of what to look at (unreviewed attempts, the lowest quality, the slowest AI, failures, flaky tests). The score tiles stay empty until attempts are reviewed.

## Putting your library back

The bench changes the library, so the pack puts yours back. All three packs here (the bench, the [smoke pack](smoke/README.md) and the [library safety pack](library/README.md)) do it the same way, through the app's backups, restored live with no restart (`lifecycle.ts`):

- **A new run** pins your unpinned backups for the run, so the run's own backups can't push them out (Backups to keep counts them), backs up your library (pinned, noted "Watchwright: your library before run …") and saves your AI settings.
- **When the run ends** your AI settings and your library come back, and the pins come off. A run that was **stopped** keeps its library as a pinned backup first, so a resume gets it back.
- **While a run is paused**, press **Put my library back** on the pack's **Tasks** tab to use the app with your own library. When the run goes on, it gets its library back, and your library as it was then is the one put back at the end.

The tasks on the pack page:

| Task | What it does |
|---|---|
| Put my library back | Restores the library from before the latest run. A run that is mid-way keeps its library for when it goes on. |
| Load the bench library | Backs your library up, then loads the bench library. **Put my library back** undoes it. |
| Back up now | A pinned, noted backup of the library as it is. |
| Library report | What is in the library, whose library is live, the backups (and which the pack made) and the AI settings. |
| Put the AI settings back | Deleting, auto-apply and the tool format as before the latest run. |
| Clean up the bench's backups | Deletes the backups the pack made and unpins what it pinned. It refuses while a run is mid-way or a run's library is live. |

With `putBack` off, the run's library stays when it ends (the AI settings still come back).

## Reference images

W7, C10, P10 and Z20 to Z22 attach an image. See [images/README.md](images/README.md).

## Change it

- `pack.ts`: the pack's settings, setup, flags and rubric.
- `shared.ts`: the collectors and the library reset, shared with the smoke pack.
- `lifecycle.ts`: setup, teardown and the tasks that put your library and AI settings back, shared by all three packs.
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

The fake model also takes a script of exact answers, which the smoke pack uses. See the docstring of `bench/dev/serve.py`.
