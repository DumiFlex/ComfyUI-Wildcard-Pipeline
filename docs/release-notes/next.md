### Features

- **Derivation branches can combine tests with AND / OR.** Click **+ Condition** under a test to add another, and click the connector to switch between AND (all must match) and OR (any may match). **+ Group** nests a boxed list with the opposite connector, so a branch can read "night AND (rain OR fog)". On the canvas, a grouped branch shows the whole expression and gets one value override per test. Shared derivations that use this are stamped schema 7, so older versions refuse them and ask for an update instead of failing mid-run.

- **Placeholders for modules you haven't built yet.** Type `@` and a name nothing in the library has, and the last row of the list offers **Placeholder @name**. It inserts a red chip under that name, which you later click to point at the real module. No more hand-typing `@{…#name}`.
- **Broken references are marked where they are.** A field holding a red chip gets a red outline, and its row gets marked too: a wildcard option (in the library editor and on the canvas) or a derivation branch and its rule. Before, only the list view's warning triangle said something was wrong.

### Fixes

- **The Context node warns about broken refs in a derivation's canvas overrides.** A ref typed into a value override on the canvas was never checked, so pointing it at a deleted module (or leaving a placeholder there) showed no warning on the node.
- **Reopening a derivation no longer changes its presence checks.** The editor rewrote every "exists", "does not exist", "is set" and "is unset" condition to "equals" when you opened a saved derivation, so saving it again changed what it did.
- **"Exists → is empty" conditions run.** The editor offered it, but the engine rejected the op and the whole derivation failed. The engine now supports `is_empty` and `is_not_empty`.
