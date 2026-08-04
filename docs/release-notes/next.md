A security fix for the database location setting. Update when you can.

> **Already on 2.13.0?** This is the same release. 2.13.0 reached GitHub but not the
> ComfyUI Registry, so it never arrived for anyone installing through ComfyUI Manager.
> 2.13.1 is that same build under a version number the registry will accept — nothing
> in it differs.

### Highlights

- **The "move the database" setting could be abused to touch other files.** Changing the database location schedules a file copy or move that runs the next time ComfyUI starts. The two paths were only checked for being absolute, not for being database locations — so a request sent to your ComfyUI port could have scheduled a copy or move between any two files on the machine, including reading a file by copying it somewhere this plugin serves over HTTP. ComfyUI's API has no authentication, so anything that can reach the port could do this. Both paths are now restricted to the three locations the database is actually allowed to live in. Moving your database between those locations works exactly as before.

- **What's new now shows the releases you skipped.** The page only ever showed the newest release, so updating across two versions meant the middle one's notes were simply gone — 2.12.0 was current for about an hour before this release replaced it. The last few releases are now listed underneath, collapsed, each with its own notes. **All releases** also goes to the releases index now instead of to the single release it was labelled against.

<!-- /modal -->

### Upgrade notes

Nothing to do beyond updating. No settings change, and any database move you had queued still runs normally.

If you expose ComfyUI beyond your own machine, this one is worth taking promptly — the affected setting is reachable without a login on every install of 2.11.0 and 2.12.0.

<!--
HOW TO WRITE THIS FILE

Order, and nothing else:

  Headline                  one sentence, what this release is about
  ### Highlights            4-5 max
  <!- /modal ->             the update dialog stops rendering here
  <details> Also in this…   grouped one-liners, collapsed
  ### Upgrade notes         only when the reader must act; delete otherwise
                            — keep this OUTSIDE the <details>, it needs seeing

This file IS the release body — the compare link is appended automatically and
the per-commit list is deliberately not included. It is consumed at release
time and cleared afterwards, so anything left here ships.

RULES

1. Highlights are capped at 4-5. The cap is the mechanism: it is what keeps a
   6-commit release and an 80-commit release roughly the same height. If a
   sixth feels essential, something else was not a highlight.

2. A highlight passes one of three tests:
     - new capability — you can do something you could not before
     - wall removed   — something that blocked you now works
     - surprising     — behaviour changed in a way you should not meet alone
   Polish, truncation, layout and invisible perf fail all three.

3. Commit count is NOT a test. The categories icon picker was two commits and a
   real feature; `ui` was nine commits and almost entirely polish.

4. The tail is grouped by area, one line each, no bold-lead paragraphs. Group
   names are free-form — use whatever the release actually contains. It sits in
   a <details> so a long release does not double the page; put the count in the
   summary so the reader knows what they are opening. That number is written by
   hand here and can drift — the update dialog computes its own from the same
   bullets, so if the two disagree, this one is wrong. Note also that collapsed
   text is not reliably reachable by browser find-in-page, which is the cost.

5. Write what changed for the user, not what changed in the code. Name the
   symptom, not the fix: "the field went blank" beats "guarded a null deref".

6. Perf belongs in the tail WITH its numbers, so the people it affects
   recognise themselves. "Performance improvements" tells nobody anything.

7. Security fixes say what an attacker could have done, in plain language, and
   whether the reader must act. Never ship one as "hardening" or "internal
   improvements" — someone deciding whether to update tonight needs the facts,
   and vagueness reads as a cover-up once the diff is public anyway.
-->
