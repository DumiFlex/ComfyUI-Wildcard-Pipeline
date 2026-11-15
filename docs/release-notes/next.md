### Fixes

- **Held picks stay the same on every frame when WP Toggles, the Context Injector or WP Model Info sit between the Context Loop and your Contexts.** These nodes passed frame 1's copy on without their own values, so a held module (the pin icon) worked out frame 1 without them: a held outfit or place that depends on a toggle, a trigger word or the model could print one thing on frame 1 and another on frames 2 and up. They now add their values to frame 1's copy too.
