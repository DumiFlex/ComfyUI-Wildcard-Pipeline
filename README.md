# Wildcard Pipeline
A powerful custom node pack for ComfyUI that implements weighted wildcards, chained pipelines, and context passing through a robust execution engine.

[![ComfyUI Registry](https://img.shields.io/badge/ComfyUI-Registry-blue)](https://registry.comfy.org/publishers/dumiflex)
[![CI](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/actions/workflows/ci.yml/badge.svg)](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/release/python-3100/)

The Wildcard Pipeline extension brings a systematic approach to prompt engineering in ComfyUI. It allows you to build complex, modular prompt generation workflows using a dedicated execution engine that supports weighted sampling, conditional logic, and cross-node state management.

## Features
* **Weighted Sampling**: Use standard probability distributions for wildcard selection.
* **Modular Design**: Construct pipelines using 5 distinct module types for maximum flexibility.
* **Chained Context**: Seamlessly pass variables and state between nodes using the `PIPELINE_CONTEXT` type.
* **Vue-Powered UI**: Interactive DOM widgets rendered directly inside ComfyUI nodes for an industrial feel.
* **Resource Manager**: A standalone SPA at `/wp/` for managing wildcards, constraints, and pipelines.
* **Advanced Constraints**: Modify sampling weights dynamically based on active variables (e.g., exclude "sunny" if "night" is selected).
* **Variable Resolution**: Clean `$var` syntax with support for literal escaping using `$$`.

## Installation

### ComfyUI Manager (Recommended)
1. Open the ComfyUI Manager in your browser.
2. Search for **Wildcard Pipeline** by **dumiflex**.
3. Click **Install** and restart ComfyUI.

### Manual Installation
1. Navigate to your ComfyUI `custom_nodes` directory.
2. Clone the repository:
   ```bash
   git clone https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline
   ```
3. Install the Python dependencies:
   ```bash
   pip install -e .
   ```
4. Build the frontend assets (requires Node.js and pnpm):
   ```bash
   pnpm install
   pnpm run build
   ```
5. Restart ComfyUI.

## Nodes

### WildcardPipeline (WP_WildcardPipeline)
The core execution node that processes your pipeline configuration. It serves as the entry point for your wildcard logic.
* **Inputs**:
  * `pipeline_context` (Optional): An existing context to build upon.
  * `seed`: For reproducible random sampling.
  * `module_config`: A JSON array of modules configured via the interactive Vue widget.
* **Outputs**:
  * `PIPELINE_CONTEXT`: The resulting state containing all resolved variables.

### PromptAssembler (WP_PromptAssembler)
A terminal node that converts the abstract pipeline state into a final string for use in CLIP Text Encode or other nodes.
* **Inputs**:
  * `PIPELINE_CONTEXT`: The context containing your variables.
  * `template`: A string with `$variable` placeholders.
* **Outputs**:
  * `prompt`: The fully resolved string.
* **Notes**: Use `$$` to escape a literal dollar sign. Variables prefixed with `__` are internal and skipped during resolution.

### ContextInject (WP_ContextInject)
Injects external string values from standard ComfyUI nodes into the pipeline context.
* **Inputs**:
  * `pipeline_context` (Optional): The context to inject into.
  * `input_1`, `input_2`, `input_3`: Optional string slots for connecting other nodes.
  * `inject_config`: A JSON mapping that links slot names to variable names (e.g., `{"input_1": "subject"}`).
* **Outputs**:
  * `PIPELINE_CONTEXT`: The updated context with injected variables.

## Module Types

| Module | Purpose | Key Fields |
|--------|---------|------------|
| **wildcard** | Random weighted selection from defined options | `source`, `capture_as`, `options` |
| **fixed** | Constant value assignment to a variable | `value`, `capture_as` |
| **combine** | Template interpolation of existing variables | `template`, `capture_as` |
| **constrain** | Applies constraint rules to modify sampling weights | `source`, `rules` |
| **condition** | Sets values based on current variable state | `variable`, `capture_as`, `if_equals`, `value`, `fallback` |

## Data Formats

### Wildcard
Wildcards are JSON files defining options with optional weights and tags.
```json
{
  "name": "location",
  "version": "1.0",
  "options": [
    { "value": "misty forest", "weight": 80, "tags": ["nature", "dark"] },
    { "value": "urban rooftop", "weight": 50, "tags": ["urban"] }
  ]
}
```

### Constraint
Constraints allow you to define relationships between variables, such as biasing or excluding certain values.
```json
{
  "name": "lighting-weather",
  "rules": [
    { 
      "target": "weather", 
      "when_variable": "lighting", 
      "when_value": "moonlight", 
      "rule_type": "exclusion", 
      "values": ["sunny haze"] 
    },
    { 
      "target": "weather", 
      "when_variable": "lighting", 
      "when_value": "golden hour", 
      "rule_type": "weight_bias", 
      "values": ["warm haze"], 
      "multiplier": 2.0 
    }
  ]
}
```

### Pipeline
Pipelines sequence multiple modules into a reusable workflow.
```json
{
  "name": "Environment Pipeline",
  "version": "1.0",
  "modules": [
    { "type": "wildcard", "source": "location", "capture_as": "$location" },
    { "type": "wildcard", "source": "lighting", "capture_as": "$lighting" },
    { "type": "constrain", "source": "lighting-weather" },
    { "type": "combine", "template": "$location, $lighting", "capture_as": "$environment" }
  ]
}
```

## Manager SPA
The extension includes a dedicated management interface available at `/wp/` when ComfyUI is running. This application provides a full-featured dashboard for:
* **Wildcards**: Create and edit weighted option lists.
* **Constraints**: Define complex interaction rules between variables.
* **Pipelines**: Architect and test reusable prompt generation chains.

## Development

The project maintains a strict separation between the core logic (`engine/`) and the ComfyUI wrapper (`nodes/`).

### Commands
* `pytest`: Run the engine test suite (118+ tests).
* `pnpm run dev`: Extension development with hot-reload.
* `pnpm run build:extension`: Compile the ComfyUI extension artifact.
* `pnpm run build:manager`: Compile the standalone Manager SPA.
* `pnpm run build`: Build both extension and manager.
* `pnpm run typecheck`: Run TypeScript static analysis.

## Contributing
Contributions to improve the engine, nodes, or frontend are welcome. Please refer to [CONTRIBUTING.md](CONTRIBUTING.md) for detailed setup instructions, testing requirements, and our commit message conventions.

## License
MIT — see [LICENSE](LICENSE) for details.
