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
  <a href="https://wp.dumiflex.dev"><img alt="Community" src="https://img.shields.io/badge/community-modules-8A63D2?logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDI0IDEwMjQiIGZpbGw9IndoaXRlIj48cGF0aCBkPSJtNTEyLDJjLTUzLjYsMC05OC40NywzOC4xNi0xMDguODQsODguNzMtNzUuMDcsMTkuMjktMTQzLjMyLDU4LjI2LTE5OC43NCwxMTMuNjgtNTUuNDIsNTUuNDItOTQuMzksMTIzLjY4LTExMy42OCwxOTguNzQtNTAuNTgsMTAuMzgtODguNzMsNTUuMjQtODguNzMsMTA4Ljg0czM4LjE2LDk4LjQ3LDg4LjczLDEwOC44NGMxMy42Miw1My4xNCwzNy4wMywxMDIuNjQsNjkuNzcsMTQ3LjQ3LDM3LjE0LDUwLjg2LDg1LjgzLDkzLjg2LDE0MC44MSwxMjQuMzMsNS41NCwzLjA4LDExLjU2LDQuNTQsMTcuNDgsNC41NCwxMi43LDAsMjUuMDItNi43MiwzMS42MS0xOC42MSw5LjY4LTE3LjQ0LDMuMzgtMzkuNDItMTQuMDctNDkuMDktODUuMzItNDcuMzItMTQ3LjIyLTEyNS43MS0xNzMuMzgtMjE4LjIxLDM2LjMtMTguMjksNjEuMjctNTUuOTIsNjEuMjctOTkuMjhzLTI0Ljk0LTgwLjk3LTYxLjIzLTk5LjI3YzM0LjIyLTExOS45NiwxMjkuNzktMjE1LjUyLDI0OS43NC0yNDkuNzQsMTguMywzNi4yOSw1NS45Miw2MS4yMyw5OS4yNyw2MS4yMyw2MS4yNywwLDExMS4xMS00OS44NCwxMTEuMTEtMTExLjExUzU3My4yNywyLDUxMiwyWk0xMTMuMTEsNDczLjExYzIxLjQ0LDAsMzguODksMTcuNDQsMzguODksMzguODksMCwyMC4xLTE1LjMyLDM2LjY5LTM0LjkxLDM4LjY5aC0uMDFjLS4xOC4wMi0uMzYuMDMtLjUzLjA0LTEuMTMuMS0yLjI4LjE2LTMuNDMuMTYtMjEuNDQsMC0zOC44OS0xNy40NC0zOC44OS0zOC44OXMxNy40NC0zOC44OSwzOC44OS0zOC44OVptMzk4Ljg5LTMyMS4xMWMtMjEuNDQsMC0zOC44OS0xNy40NC0zOC44OS0zOC44OXMxNy40NC0zOC44OSwzOC44OS0zOC44OSwzOC44OSwxNy40NCwzOC44OSwzOC44OS0xNy40NCwzOC44OS0zOC44OSwzOC44OVoiLz48cGF0aCBkPSJtOTMzLjI3LDQwMy4xNmMtMTMuNjItNTMuMTQtMzcuMDMtMTAyLjY0LTY5Ljc3LTE0Ny40Ny0zNy4xNC01MC44Ni04NS44My05My44Ni0xNDAuODEtMTI0LjMzLTE3LjQ0LTkuNjgtMzkuNDItMy4zOC00OS4wOSwxNC4wNy05LjY4LDE3LjQ0LTMuMzgsMzkuNDIsMTQuMDcsNDkuMDksODUuMzIsNDcuMzIsMTQ3LjIyLDEyNS43MSwxNzMuMzgsMjE4LjIxLTM2LjMsMTguMjktNjEuMjcsNTUuOTItNjEuMjcsOTkuMjhzMjQuOTQsODAuOTcsNjEuMjMsOTkuMjdjLTM0LjIyLDExOS45Ni0xMjkuNzksMjE1LjUyLTI0OS43NCwyNDkuNzQtMTguMy0zNi4yOS01NS45Mi02MS4yMy05OS4yNy02MS4yMy02MS4yNywwLTExMS4xMSw0OS44NC0xMTEuMTEsMTExLjExczQ5Ljg0LDExMS4xMSwxMTEuMTEsMTExLjExYzUzLjYsMCw5OC40Ny0zOC4xNiwxMDguODQtODguNzMsNzUuMDctMTkuMjksMTQzLjMyLTU4LjI2LDE5OC43NC0xMTMuNjgsNTUuNDItNTUuNDIsOTQuMzktMTIzLjY4LDExMy42OC0xOTguNzQsNTAuNTgtMTAuMzgsODguNzMtNTUuMjQsODguNzMtMTA4Ljg0cy0zOC4xNi05OC40Ny04OC43My0xMDguODRabS00MjEuMjcsNTQ2LjYyYy0yMS40NCwwLTM4Ljg5LTE3LjQ0LTM4Ljg5LTM4Ljg5czE3LjQ0LTM4Ljg5LDM4Ljg5LTM4Ljg5LDM4Ljg5LDE3LjQ0LDM4Ljg5LDM4Ljg5LTE3LjQ0LDM4Ljg5LTM4Ljg5LDM4Ljg5Wm0zOTguODktMzk4Ljg5Yy0yMS40NCwwLTM4Ljg5LTE3LjQ0LTM4Ljg5LTM4Ljg5LDAtMjAuMDMsMTUuMjItMzYuNTgsMzQuNzItMzguNjcuMzgtLjA0Ljc3LS4wOCwxLjE2LS4xMWguMDJjLjk5LS4wOCwxLjk5LS4xMSwyLjk5LS4xMSwyMS40NCwwLDM4Ljg5LDE3LjQ0LDM4Ljg5LDM4Ljg5cy0xNy40NCwzOC44OS0zOC44OSwzOC44OVoiLz48cGF0aCBkPSJtNzM1LjAyLDUxNy41NmMtMTUzLjgyLDMwLjg3LTE4Ni41OSw2My42NC0yMTcuNDYsMjE3LjQ2LTEuMjIsNi4wOC05LjksNi4wOC0xMS4xMiwwLTMwLjg3LTE1My44Mi02My42NC0xODYuNTktMjE3LjQ2LTIxNy40Ni02LjA4LTEuMjItNi4wOC05LjksMC0xMS4xMiwxNTMuODItMzAuODcsMTg2LjU5LTYzLjY0LDIxNy40Ni0yMTcuNDYsMS4yMi02LjA4LDkuOS02LjA4LDExLjEyLDAsMzAuODcsMTUzLjgyLDYzLjY0LDE4Ni41OSwyMTcuNDYsMjE3LjQ2LDYuMDgsMS4yMiw2LjA4LDkuOSwwLDExLjEyWiIvPjxwYXRoIGQ9Im00MzQuMDYsNjY1Ljg1Yy01MS4wOCwxMC4yNS02MS45NiwyMS4xMy03Mi4yMiw3Mi4yMi0uNDEsMi4wMi0zLjI5LDIuMDItMy42OSwwLTEwLjI1LTUxLjA4LTIxLjEzLTYxLjk2LTcyLjIyLTcyLjIyLTIuMDItLjQxLTIuMDItMy4yOSwwLTMuNjksNTEuMDgtMTAuMjUsNjEuOTYtMjEuMTMsNzIuMjItNzIuMjIuNDEtMi4wMiwzLjI5LTIuMDIsMy42OSwwLDEwLjI1LDUxLjA4LDIxLjEzLDYxLjk2LDcyLjIyLDcyLjIyLDIuMDIuNDEsMi4wMiwzLjI5LDAsMy42OVoiLz48cGF0aCBkPSJtNzM4LjA3LDM2MS44NGMtNTEuMDgsMTAuMjUtNjEuOTYsMjEuMTMtNzIuMjIsNzIuMjItLjQxLDIuMDItMy4yOSwyLjAyLTMuNjksMC0xMC4yNS01MS4wOC0yMS4xMy02MS45Ni03Mi4yMi03Mi4yMi0yLjAyLS40MS0yLjAyLTMuMjksMC0zLjY5LDUxLjA4LTEwLjI1LDYxLjk2LTIxLjEzLDcyLjIyLTcyLjIyLjQxLTIuMDIsMy4yOS0yLjAyLDMuNjksMCwxMC4yNSw1MS4wOCwyMS4xMyw2MS45Niw3Mi4yMiw3Mi4yMiwyLjAyLjQxLDIuMDIsMy4yOSwwLDMuNjlaIi8%2BPC9zdmc%2B"></a>
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
