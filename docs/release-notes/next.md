### Features

- **Derivation branches can combine tests with AND / OR.** Click **+ Condition** under a test to add another, and click the connector to switch between AND (all must match) and OR (any may match). **+ Group** nests a boxed list with the opposite connector, so a branch can read "night AND (rain OR fog)". On the canvas, a grouped branch shows the whole expression and gets one value override per test. Shared derivations that use this are stamped schema 7, so older versions refuse them and ask for an update instead of failing mid-run.

### Fixes

- **Reopening a derivation no longer changes its presence checks.** The editor rewrote every "exists", "does not exist", "is set" and "is unset" condition to "equals" when you opened a saved derivation, so saving it again changed what it did.
- **"Exists → is empty" conditions run.** The editor offered it, but the engine rejected the op and the whole derivation failed. The engine now supports `is_empty` and `is_not_empty`.
