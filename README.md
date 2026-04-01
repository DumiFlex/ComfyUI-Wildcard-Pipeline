# Wildcard Pipeline
A powerful custom node pack for ComfyUI that implements weighted wildcards, chained pipelines, and context passing through a robust execution engine.

[![ComfyUI Registry](https://img.shields.io/badge/ComfyUI-Registry-blue)](https://registry.comfy.org/publishers/dumiflex)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/release/python-3100/)

## Features
* Weighted wildcard sampling using standard probability distributions.
* 6 distinct module types for flexible pipeline construction.
* Chained pipelines that pass state between nodes.
* Seamless context passing using the PIPELINE_CONTEXT custom type.
* Advanced Vue-based DOM widgets rendered directly inside ComfyUI nodes.
* Dedicated Manager SPA hosted at /wp for comprehensive resource management.
* Sophisticated constraint system to modify weights based on active variables.
* Dynamic variable resolution with $var syntax and literal escaping.

## Installation

### ComfyUI Manager (Recommended)
1. Open the ComfyUI Manager in your browser.
2. Search for "Wildcard Pipeline" by dumiflex.
3. Click Install and restart ComfyUI.

### Manual Installation
1. Navigate to your ComfyUI custom_nodes directory.
2. Clone the repository:
   ```bash
   git clone https://github.com/DumiFlex/comfyui-wildcard-pipeline
   ```
3. Install the Python dependencies (if any are listed in pyproject.toml):
   ```bash
   pip install -e .
   ```
4. Build the frontend assets:
   ```bash
   pnpm install
   pnpm run build
   ```
5. Restart ComfyUI.

## Nodes

### WildcardPipeline (WP_WildcardPipeline)
The core execution node that processes your pipeline configuration. It takes a module_config (JSON provided via the Vue DOM widget) and an optional data_dir path. It initializes the execution engine, runs all defined modules in sequence, and outputs a PIPELINE_CONTEXT object containing the resolved state.

### PromptAssembler (WP_PromptAssembler)
A terminal node that converts the pipeline context into a final prompt string. It accepts a PIPELINE_CONTEXT and a template string. It replaces all occurrences of $variable with their captured values from the context. Use $$ to escape a literal dollar sign. Keys prefixed with __ (double underscore) are automatically skipped during resolution to maintain clean outputs.

## Module Types

| Module | Purpose | Key Fields |
|--------|---------|------------|
| wildcard | Random weighted selection from defined options | source, capture_as, options[]{value,weight,tags} |
| fixed | Constant value assignment | value, capture_as |
| combine | Template interpolation of existing variables | template, capture_as |
| constrain | Applies constraint rules to modify sampling weights | target, source/rules |
| condition | Sets values based on current variable state | variable, if_equals/unless_equals, value, fallback, capture_as |
| export | Exports specific variables with optional prefixing | variables[], prefix |

## Data Formats

### Wildcard
Stored in `data/wildcards/examples/`.
```json
{
  "name": "location",
  "version": "1.0",
  "options": [
    { "value": "misty forest", "weight": 80, "tags": ["nature", "dark"] },
    { "value": "urban rooftop", "weight": 50, "tags": ["urban"] },
    { "value": "desert canyon", "weight": 30, "tags": ["nature"] }
  ]
}
```

### Constraint
Stored in `data/constraints/examples/`.
```json
{
  "name": "lighting-weather",
  "rules": [
    { "when_value": "moonlight", "rule_type": "exclusion", "values": ["sunny haze"] },
    { "when_value": "golden hour", "rule_type": "weight_bias", "values": ["warm haze"], "multiplier": 2.0 }
  ]
}
```

### Pipeline
Stored in `data/pipelines/examples/`.
```json
{
  "name": "Environment Pipeline",
  "version": "1.0",
  "modules": [
    { "type": "wildcard", "source": "location.json", "capture_as": "$location" },
    { "type": "wildcard", "source": "lighting.json", "capture_as": "$lighting" },
    { "type": "combine", "template": "$location, $lighting", "capture_as": "$environment" }
  ]
}
```

## Manager SPA
When ComfyUI is running, a management interface is available at `/wp/`. This single page application allows for full CRUD operations on wildcards, constraints, and pipelines directly from your browser. You can organize your resources through the following routes:
* `/wp/wildcards` — Manage weighted option lists.
* `/wp/constraints` — Define rules for weight modification.
* `/wp/pipelines` — Sequence modules into reusable chains.

## Development
Use the following commands to work on the project:

* `pytest` — Run the engine tests (no ComfyUI installation required).
* `pnpm run dev` — Start the frontend extension in watch mode.
* `pnpm run build:extension` — Build the ComfyUI extension artifact (js/main.js).
* `pnpm run build:manager` — Build the Manager SPA (web_dist/).
* `pnpm run build` — Build both the extension and the manager.
* `pnpm run typecheck` — Run TypeScript type checking across the frontend.

## Architecture
The project is structured to maintain strict separation of concerns. The `engine/` directory contains pure Python code with zero ComfyUI imports, allowing for standalone testing and reliability. The `nodes/` directory wraps this engine using the ComfyUI V3 API. The `api/` directory handles aiohttp CRUD endpoints and serves the Manager SPA. The `src/` directory contains the Vue 3 and PrimeVue frontend, split into interactive node widgets and the standalone manager interface.

## License
MIT
