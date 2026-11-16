### Fixes

- **WP Model Info, WP Toggles and the Context Injector run again.** 2.22.1 made them stop the run with "'NodeOutput' object has no attribute 'values'". They work as before now, held picks in a Context Loop included.
- **The sidebar's Feedback & support row now is the same kind of row as the links above it.** 2.22.1 evened out its size in Chrome, but it was still a different control, so it could look off in other browsers (Firefox). It now matches Documentation and View Source exactly, open or collapsed.
