# Library safety pack

The library's safety net, clicked through the way a person would: backups with notes, pins, pruning, live restore and its Undo, and the Library health page. No AI. It's a [Watchwright](https://github.com/DumiFlex/watchwright) test pack like the [bench](../README.md), and every test checks itself: a failing test means the app did something wrong.

## Run it

On the fake server, with no ComfyUI:

```bash
python bench/dev/serve.py
```

or on a real ComfyUI with this extension. Add this folder in Watchwright under **Packs › Add pack** and press **New run**. A run takes under a minute.

| Setting | What it does |
|---|---|
| `reset` | Off by default. Loads the bench library (`../bench-library.json`) first, after backing your library up. |
| `putBack` | On by default. Puts the library back when the run ends ([Putting your library back](../README.md#putting-your-library-back)). |

Each test deletes the backups it made, unpins what it pinned, removes its marker wildcard and puts **Backups to keep** back. The pack's teardown restores your library on top of that. The site key is the bench's, so it never runs while a bench or smoke run changes the library.

## The tests

| Test | Checks |
|---|---|
| D1 | **Back up now** with a note: the toast says Backup saved and the new row shows the note. |
| D2 | The bookmark pins a backup (pressed, the pinned count goes up, never "Removed at next backup") and unpins it. |
| D3 | With **Backups to keep** at 2, three more backups remove the oldest unpinned one and never a pinned one. |
| D4 | **Restore** from Settings › Library with no restart: the toast says Backup restored, a "Before restore" backup is kept, and a wildcard only the backup had is on the Wildcards page, reached without a page load. |
| D5 | The restore toast's **Undo** puts back the library the restore replaced. |
| D6 | Restoring a backup that isn't there answers 404, a name with a path in it is refused, and the library stays as it was. |
| D7 | Library health shows a group for each kind of finding the scan returns. |

`check-failed` (finding) names the check that failed. The pack has the bench's tasks ([the list](../README.md#putting-your-library-back)). They work on a real ComfyUI as well as on the fake server.

## Change it

- `pack.ts`: the pack's settings, flags, dashboard and lifecycle.
- `library.ts`: the Backups panel helpers, the marker wildcard, and `libraryTest`, which cleans up after each test.
- `tests/01-backups.ts`: the tests.
