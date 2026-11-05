# Security policy

## Supported versions

Only the latest release on `main` gets security fixes. Update through ComfyUI
Manager or `git pull` before reporting.

## Reporting a vulnerability

Please report privately, not in a public issue:

1. Open the repository's **Security** tab and press **Report a vulnerability**
   ([direct link](https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline/security/advisories/new)).
2. Say what an attacker can do, the version or commit you tested, and the steps
   to reproduce it.

You should hear back within a week. Once a fix is released, the advisory is
published with credit to you unless you'd rather stay anonymous.

## What counts

Wildcard Pipeline runs inside ComfyUI and inherits its trust model: anyone who
can reach the ComfyUI server can run workflows and call its routes. Reports are
most useful when they cross a line this project draws on top of that:

- The **AI API key** leaving `ai.json` or the environment (no route should
  return it), or a caller choosing the address a model or web request goes to.
- The AI assistant's **web tools** (search, page reading, Danbooru lookup)
  running without the user's allow, or page reading reaching an address on the
  user's own network.
- A **community pack** or imported file that runs code, writes outside the
  library, or lands in the library without passing validation.
- The **Community tab** frame reaching the ComfyUI page, or community tokens
  appearing in ComfyUI's storage.
- Script injection through module names, options, docs or chat replies.

[docs/network-access.md](docs/network-access.md) lists every outbound request
and how each one is locked down.

Out of scope: running ComfyUI with `--listen` on an untrusted network (ComfyUI
itself has no authentication), and anything that needs the attacker to already
have a shell on the machine.
