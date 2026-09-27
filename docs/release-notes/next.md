### Fixes

- **Faster startup.** Opening ComfyUI used to download 43 of the extension's files before the canvas finished loading, even with no Wildcard Pipeline node on it. It now downloads 2 (166 KB → 92 KB gzipped). The toast stack, the Display playground, the template editor and the subgraph conflict badge now load the first time you use them.
