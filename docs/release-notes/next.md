### Fixes

- **Library file exports now record the schema version their content needs.** Exporting from the library always wrote schema version 2 into the file, even when it held range multi-picks like `{1-3$$…}`, constraints with a narrowed reach, or wildcards with an **accepts** tag axis. An older extension would then import the file and silently misread or drop those features. Exports now say 3, 4 or 5 when they use those features, so an older extension refuses the file and asks you to update. Files without them still export as version 2.
