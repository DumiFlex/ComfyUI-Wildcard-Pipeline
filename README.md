<p align="center">
  <img src="public/images/favicon.svg" width="120" alt="wildcard-pipeline logo" />
</p>

<h1 align="center">wildcard-pipeline</h1>

<p align="center"><em>Composable prompt context for ComfyUI.</em></p>

Modular procedural prompt generation for ComfyUI — wildcards, constraints, derivations, and context pipelines.

**Status:** early development (walking skeleton).

## Install

Clone into `ComfyUI/custom_nodes/`:

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline.git
```

No Python dependencies required beyond ComfyUI itself.

## Nodes (MVP)

- `WP_Context` — runs an ordered list of modules, emits a typed context.
- `WP_PromptAssembler` — fills `$var` placeholders in a template.
- `WP_Debug` — inspects the context at any point in the chain.

## Development

See [CONTRIBUTING.md](./.github/CONTRIBUTING.md).

## License

GPL-3.0-or-later. See [LICENSE](./LICENSE).
