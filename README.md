<h1 align="center">
  <img src="public/images/favicon.svg" width="40" align="top" alt=""/>
  &nbsp;Wildcard Pipeline
</h1>

<p align="center">
  <em>Random prompts for ComfyUI that actually make sense together.</em>
</p>

<p align="center">
  <a href="https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/actions"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/DumiFlex/ComfyUI-Wildcard-Pipeline/ci.yml?branch=main&label=ci&logo=githubactions&logoColor=white"></a>
  <a href="https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/releases"><img alt="Release" src="https://img.shields.io/github/v/release/DumiFlex/ComfyUI-Wildcard-Pipeline?include_prereleases&logo=github&logoColor=white"></a>
  <a href="https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/DumiFlex/ComfyUI-Wildcard-Pipeline?logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Im0xNiAxNiAzLTggMyA4Yy0uODcuNjUtMS45MiAxLTMgMXMtMi4xMy0uMzUtMy0xWiIvPjxwYXRoIGQ9Im0yIDE2IDMtOCAzIDhjLS44Ny42NS0xLjkyIDEtMyAxcy0yLjEzLS4zNS0zLTFaIi8%2BPHBhdGggZD0iTTcgMjFoMTAiLz48cGF0aCBkPSJNMTIgM3YxOCIvPjxwYXRoIGQ9Ik0zIDdoMmMyIDAgNS0xIDctMiAyIDEgNSAyIDcgMmgyIi8%2BPC9zdmc%2B"></a>
  <a href="https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/wiki"><img alt="Wiki" src="https://img.shields.io/badge/docs-wiki-blue?logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiPjxwYXRoIGQ9Ik0xMiA3djE0Ii8%2BPHBhdGggZD0iTTMgMThhMSAxIDAgMCAxLTEtMVY0YTEgMSAwIDAgMSAxLTFoNWE0IDQgMCAwIDEgNCA0IDQgNCAwIDAgMSA0LTRoNWExIDEgMCAwIDEgMSAxdjEzYTEgMSAwIDAgMS0xIDFoLTZhMyAzIDAgMCAwLTMgMyAzIDMgMCAwIDAtMy0zeiIvPjwvc3ZnPg%3D%3D"></a>
  <a href="https://discord.gg/BFYR9WQdVR"><img alt="Discord" src="https://img.shields.io/badge/discord-join-5865F2?logo=discord&logoColor=white"></a>
  <a href="https://wp.dumiflex.dev"><img alt="Community" src="https://img.shields.io/badge/community-modules-8A63D2?logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDI0IDEwMjQiIGZpbGw9IndoaXRlIj48cGF0aCBkPSJtNTEyLDJjLTU0LDAtOTgsMzgtMTA5LDg5LTc1LDE5LTE0Myw1OC0xOTksMTE0LTU1LDU1LTk0LDEyNC0xMTQsMTk5LTUxLDEwLTg5LDU1LTg5LDEwOXMzOCw5OCw4OSwxMDljMTQsNTMsMzcsMTAzLDcwLDE0NywzNyw1MSw4Niw5NCwxNDEsMTI0LDYsMywxMiw1LDE3LDUsMTMsMCwyNS03LDMyLTE5LDEwLTE3LDMtMzktMTQtNDktODUtNDctMTQ3LTEyNi0xNzMtMjE4LDM2LTE4LDYxLTU2LDYxLTk5cy0yNS04MS02MS05OWMzNC0xMjAsMTMwLTIxNiwyNTAtMjUwLDE4LDM2LDU2LDYxLDk5LDYxLDYxLDAsMTExLTUwLDExMS0xMTFTNTczLDIsNTEyLDJaTTExMyw0NzNjMjEsMCwzOSwxNywzOSwzOSwwLDIwLTE1LDM3LTM1LDM5aDBjMDAwMC0xMC0xMC0yMC0zMC0yMSwwLTM5LTE3LTM5LTM5czE3LTM5LDM5LTM5Wm0zOTktMzIxYy0yMSwwLTM5LTE3LTM5LTM5czE3LTM5LDM5LTM5LDM5LDE3LDM5LDM5LTE3LDM5LTM5LDM5WiIvPjxwYXRoIGQ9Im05MzMsNDAzYy0xNC01My0zNy0xMDMtNzAtMTQ3LTM3LTUxLTg2LTk0LTE0MS0xMjQtMTctMTAtMzktMy00OSwxNC0xMCwxNy0zLDM5LDE0LDQ5LDg1LDQ3LDE0NywxMjYsMTczLDIxOC0zNiwxOC02MSw1Ni02MSw5OXMyNSw4MSw2MSw5OWMtMzQsMTIwLTEzMCwyMTYtMjUwLDI1MC0xOC0zNi01Ni02MS05OS02MS02MSwwLTExMSw1MC0xMTEsMTExczUwLDExMSwxMTEsMTExYzU0LDAsOTgtMzgsMTA5LTg5LDc1LTE5LDE0My01OCwxOTktMTE0LDU1LTU1LDk0LTEyNCwxMTQtMTk5LDUxLTEwLDg5LTU1LDg5LTEwOXMtMzgtOTgtODktMTA5Wm0tNDIxLDU0N2MtMjEsMC0zOS0xNy0zOS0zOXMxNy0zOSwzOS0zOSwzOSwxNywzOSwzOS0xNywzOS0zOSwzOVptMzk5LTM5OWMtMjEsMC0zOS0xNy0zOS0zOSwwLTIwLDE1LTM3LDM1LTM5MDAxMCwxMGgwYzEwLDIwLDMwLDIxLDAsMzksMTcsMzksMzlzLTE3LDM5LTM5LDM5WiIvPjxwYXRoIGQ9Im03MzUsNTE4Yy0xNTQsMzEtMTg3LDY0LTIxNywyMTctMSw2LTEwLDYtMTEsMC0zMS0xNTQtNjQtMTg3LTIxNy0yMTctNi0xLTYtMTAsMC0xMSwxNTQtMzEsMTg3LTY0LDIxNy0yMTcsMS02LDEwLTYsMTEsMCwzMSwxNTQsNjQsMTg3LDIxNywyMTcsNiwxLDYsMTAsMCwxMVoiLz48cGF0aCBkPSJtNDM0LDY2NmMtNTEsMTAtNjIsMjEtNzIsNzIwLDItMywyLTQsMC0xMC01MS0yMS02Mi03Mi03Mi0yMC0yLTMsMC00LDUxLTEwLDYyLTIxLDcyLTcyMC0yLDMtMiw0LDAsMTAsNTEsMjEsNjIsNzIsNzIsMjAsMiwzLDAsNFoiLz48cGF0aCBkPSJtNzM4LDM2MmMtNTEsMTAtNjIsMjEtNzIsNzIwLDItMywyLTQsMC0xMC01MS0yMS02Mi03Mi03Mi0yMC0yLTMsMC00LDUxLTEwLDYyLTIxLDcyLTcyMC0yLDMtMiw0LDAsMTAsNTEsMjEsNjIsNzIsNzIsMjAsMiwzLDAsNFoiLz48L3N2Zz4%3D"></a>
</p>

<p align="center">
  <img src="public/images/docs/flow-intro.svg" alt="Modules resolve inside WP Context, which emits named $variables that fill the WP Prompt Assembler template, which CLIP Encode turns into conditioning" />
</p>

Plain wildcards pick every part of a prompt on its own, so you get a snowy beach
at noon under the stars. Wildcard Pipeline builds the prompt step by step, and
each step can see what the earlier ones picked. If the weather comes out as rain,
the mood can lean gloomy and the lighting can follow. Every Generate gives you a
fresh prompt that still hangs together.

## Install

- **ComfyUI Manager (recommended):** search for **Wildcard Pipeline** by
  **dumiflex**, click **Install** and restart ComfyUI.
- **By hand:** download the zip from the
  [latest release](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/releases/latest),
  unzip it into `ComfyUI/custom_nodes/` and restart ComfyUI.

<details>
<summary>Installing from source</summary>

A git clone has no built frontend, so you need Node.js and pnpm:

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline
cd ComfyUI-Wildcard-Pipeline
pnpm install
pnpm build
```

</details>

## Quick start

1. Open the **Wildcard Pipeline** manager from the ComfyUI sidebar and create a
   wildcard called `subject` with three options: `a cat`, `a dog`, `a fox`.
2. On the canvas, chain **WP Context** → **WP Prompt Assembler** →
   **CLIP Text Encode**. Add your wildcard to the Context node and type
   `a photo of $subject` into the Assembler.
3. Queue a few times. Each run picks a new subject.

The [Quick Start wiki page](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/wiki/Quick-Start)
walks through a fuller example.

## How it works

You stack **modules** inside a **WP Context** node. Each module sets one or more
`$variables`, and the **WP Prompt Assembler** drops them into your template.

| Module | What it does |
|---|---|
| **Wildcard** | Picks one option from a weighted list. |
| **Fixed Values** | Sets variables to values you choose, like a style or quality tags. |
| **Combine** | Builds one variable out of others, e.g. `$style $subject`. |
| **Derivation** | If/else rules: "if `$weather` is rain AND `$time` is night, set `$lighting` to neon". Conditions can be grouped with AND / OR. |
| **Constraint** | Makes an earlier pick change the odds of a later one, or rule options out entirely. |
| **Bundle** | A saved group of modules you can drop in as one piece. |

Options can point at other modules with `@name`, so a wildcard can nest another
one. If the module you want doesn't exist yet, pick **Placeholder** from the `@`
list and connect it later.

### Nodes

| Node | What it does |
|---|---|
| **WP Context** | Holds your module stack and outputs the picked variables. Chain several together. |
| **WP Prompt Assembler** | Fills `$variables` in a template. Also supports inline `{a\|b\|c}` picks. |
| **WP Context Loop** + **WP Seed List** | Run the whole chain N times from one Generate, each with its own prompt and seed. |
| **WP Context Injector** | Turns any ComfyUI output (text, a number) into a `$variable`. |
| **WP Prompt Cleaner** | Tidies the final prompt: spacing, stray commas, duplicates, a blocklist. |
| **WP Debug** | Shows what happened during a run (see below). |
| **WP Var → Int / Float / Bool** | Use a variable to drive a number or switch, like image size or steps. |

Most nodes have a help page in ComfyUI's node info panel, and the
[wiki](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/wiki) covers
[nodes](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/wiki/Nodes),
[modules](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/wiki/Modules) and
[concepts](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/wiki/Concepts)
in depth.

## The manager

Open it from the ComfyUI sidebar. It's where your modules live between workflows.

<p align="center">
  <img src="public/images/docs/spa_manager.png" alt="Wildcard Pipeline manager dashboard with module counts, quick create buttons and recently opened items" />
</p>

- **Library:** create, edit and search your modules, bundles and prompt
  templates. The **Tags** page groups them into collections, and you can rename
  or merge a tag across the whole library.
- **Test Runner:** try a set of modules over many seeds without generating
  images. See how often each option comes up and which rules fired, save a
  baseline, and after an edit see exactly which outputs changed.
- **Community:** browse and install modules other people have shared on the
  [community site](https://wp.dumiflex.dev), and publish your own.
- **Import / Export:** move modules between machines as JSON files.
- **Documentation:** the full guide, built into the app.

## Checking a run

Connect **WP Debug** to a Context node and generate. It shows:

- **Variables:** every value, and which step set it.
- **Trace:** each step, and why it did what it did: which derivation rule fired,
  a wildcard's odds and what re-weighted them, where a nested pick came from.
- **Warnings:** anything that went wrong, linked to the step that caused it.
- **Raw:** the underlying data, for bug reports.

## Help and sharing

[Discord](https://discord.gg/BFYR9WQdVR) is the place for all of it: there are
channels for questions, bug reports, feature requests and showing what you made.
You can also report bugs on [GitHub Issues](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/issues).

Made something you like? Post your images and workflows on Discord, and publish
your modules on the [community site](https://wp.dumiflex.dev) so others can
install them from the manager's **Community** page.

## Privacy

Everything runs locally. The extension only goes online to check for updates
(you can turn this off in Settings), when you open the Community page, or when
you choose to download the optional tag list for autocomplete. Details are in
[docs/network-access.md](docs/network-access.md).

## Contributing

PRs are welcome. [CONTRIBUTING.md](.github/CONTRIBUTING.md) explains the dev setup.

## License

[GPL-3.0-or-later](LICENSE)
