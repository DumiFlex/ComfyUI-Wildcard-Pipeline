A bug-fix release for the in-app updater and name validation.

- **Fixed an updater downgrade.** On 2.10.0, clicking **Update Now** could install an *older* version — it asked ComfyUI Manager for "latest" against a stale cache. The updater now installs the exact new version and refuses to ever move backwards.
- **The update badge appears right away** after **Check now** — no page refresh needed.
- **Cleaner release notes** in the update dialog (proper formatting instead of raw `<details>` tags).
- **Names are validated as you rename them.** Renaming a sub-category or a variable now enforces the same rules as creating one, so invalid names (spaces, reserved characters) are caught immediately instead of failing later on save.
