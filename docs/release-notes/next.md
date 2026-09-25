### Fixes

- **Shared wildcards with accepts tag axes now say when your extension is too old for them.** A wildcard whose tag group is marked **accepts** is now published as schema version 5. Before, it went out as version 2, and an extension from before 2.14 installed it without complaint while quietly dropping the accepts setting, so `$outfit.SHOES` read empty and constraints lost the rolled tag. That older extension now refuses the pack and asks you to update. Wildcards without an accepts group publish exactly as before.

- **Updating a community item no longer re-runs the old tag conversion on it.** "Update" and "Install as new entry" labelled every download as the oldest schema version, so each install ran the version 1 to 2 upgrade again over content that was already current. Downloads now keep the version the community recorded for them, and so do dependencies fetched from a constraint's "download missing" action.
