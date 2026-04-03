# Contributing to Wildcard Pipeline

Welcome, and thanks for your interest in contributing! This project aims to bring a modular, engine-driven approach to prompt engineering in ComfyUI. Whether you're fixing a bug, adding a new module type, or improving the frontend manager, your help is appreciated.

## Development Setup

To get started with development, follow these steps to set up your environment:

1.  **Clone the repository** into your ComfyUI `custom_nodes/` directory:
    ```bash
    git clone https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline
    ```
2.  **Install Python dependencies** in editable mode:
    ```bash
    pip install -e .
    ```
3.  **Install frontend dependencies** (requires Node.js 20 and pnpm 10):
    ```bash
    pnpm install
    ```
4.  **Build the project**:
    ```bash
    pnpm run build
    ```

## Running Tests

We prioritize reliability through extensive testing. The project uses `pytest` for Python logic and `pnpm` for frontend verification.

*   **Python tests**: Run `pytest` to execute the full suite. This project maintains a strict separation where the `engine/` directory is pure Python with zero ComfyUI imports. This allows tests to run standalone without a ComfyUI installation.
*   **Frontend typecheck**: Run `pnpm run typecheck` to perform static analysis on the TypeScript codebase.
*   **Frontend dev mode**: Run `pnpm run dev` to start the Vite development server with hot-reload for the extension.

## Project Structure

A brief overview of the project layout:

*   `engine/`: The core execution engine. Pure Python logic for variable resolution, weighted sampling, and constraint application.
*   `nodes/`: ComfyUI V3 node wrappers that interface with the engine.
*   `api/`: The `aiohttp` REST API and the server logic for the Manager SPA.
*   `src/`: Vue 3 frontend source code for both the in-node widgets and the standalone Manager SPA.
*   `tests/`: The `pytest` suite covering engine logic, API routes, and file storage.

## Commit Conventions

This project follows the [Conventional Commits](https://www.conventionalcommits.org/) specification. This allows [semantic-release](https://github.com/semantic-release/semantic-release) to automatically manage versioning and changelogs.

Use the following prefixes for your commit messages:

*   `feat:`: A new feature. Triggers a minor version bump.
*   `fix:`: A bug fix. Triggers a patch version bump.
*   `refactor:`: A code change that neither fixes a bug nor adds a feature. Triggers a patch version bump.
*   `style:`: Changes that don't affect the meaning of the code (white-space, formatting, etc.). Triggers a patch version bump.
*   `docs:`: Documentation only changes. Note: `docs(README):` triggers a patch release, while plain `docs:` does not.
*   `chore:`, `test:`, `ci:`: Maintenance tasks, adding tests, or CI configuration changes. These do not trigger a release.

Example: `feat: add export module type for variable prefixing`

## Pull Request Process

1.  Fork the repository and create a feature branch from `main`.
2.  Implement your changes while adhering to the coding style and commit conventions.
3.  Verify your changes by running `pytest` and `pnpm run typecheck`.
4.  Submit a Pull Request with a descriptive title in the conventional commit format.
5.  Link any related issues in the PR description to provide context.

## Reporting Bugs

If you find a bug, please use the [bug report template](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/issues/new?template=bug_report.yml) on our GitHub Issues page. Provide as much detail as possible, including steps to reproduce the issue and your environment details.
