"""AI assistant settings (`ai.json`), kept apart from `settings.json`.

Why a separate file: `GET /wp/api/settings` returns `settings.json` whole, and
the API key must never be returned by any route. Keeping the key in its own
file (written with owner-only permissions where the OS allows) means no
code path that serves the general settings can leak it.

Location, highest priority first:

1. ``WP_AI_CONFIG_PATH`` env var (tests point it at tmp_path).
2. ``<ComfyUI user dir>/wildcard-pipeline/ai.json``, beside `settings.json`.
3. ``<plugin>/wp-ai.json`` when the user dir can't be detected.

The key can also come from the environment so it never touches disk:
``WP_AI_API_KEY`` for any provider, else ``ANTHROPIC_API_KEY`` /
``OPENAI_API_KEY`` for those two presets. An env key wins over a saved one.

The feature is OFF by default. Nothing in this package makes a request; this
is only the shape of what the user configured.
"""
from __future__ import annotations

import copy
import json
import os
import tempfile
import threading
import urllib.parse
from pathlib import Path
from typing import Any

CONFIG_FILENAME = "ai.json"
FALLBACK_FILENAME = "wp-ai.json"

UNLOAD_AFTER_MIN = 0
UNLOAD_AFTER_MAX = 3600

#: Wire format per preset. `ollama` uses Ollama's native API (it is the only
#: one that takes `keep_alive`, and its `format` accepts a JSON schema);
#: everything else OpenAI-compatible goes through `openai`.
PRESETS: dict[str, dict[str, Any]] = {
    "anthropic": {
        "label": "Claude", "api": "anthropic", "local": False, "needs_key": True,
        "base_url": "https://api.anthropic.com", "key_env": "ANTHROPIC_API_KEY",
    },
    "openai": {
        "label": "OpenAI", "api": "openai", "local": False, "needs_key": True,
        "base_url": "https://api.openai.com/v1", "key_env": "OPENAI_API_KEY",
    },
    "ollama": {
        "label": "Ollama", "api": "ollama", "local": True, "needs_key": False,
        "base_url": "http://127.0.0.1:11434", "key_env": None,
    },
    "lmstudio": {
        "label": "LM Studio", "api": "openai", "local": True, "needs_key": False,
        "base_url": "http://127.0.0.1:1234/v1", "key_env": None,
    },
    "llamacpp": {
        "label": "llama.cpp", "api": "openai", "local": True, "needs_key": False,
        "base_url": "http://127.0.0.1:8080/v1", "key_env": None,
    },
    "custom": {
        "label": "Other (OpenAI-compatible)", "api": "openai", "local": True,
        "needs_key": False, "base_url": "", "key_env": None,
    },
}

DEFAULTS: dict[str, Any] = {
    "enabled": False,
    "provider": "ollama",
    "base_url": "",
    "model": "",
    "unload_after_s": 60,
}

_lock = threading.Lock()


class ConfigError(ValueError):
    """A value the user tried to save was refused. Message is user-facing."""


def config_path() -> Path:
    override = os.environ.get("WP_AI_CONFIG_PATH")
    if override:
        return Path(override)
    from engine.db.connection import wp_data_dir

    data_dir = wp_data_dir()
    if data_dir is not None:
        return data_dir / CONFIG_FILENAME
    from engine.db.config import plugin_root

    return plugin_root() / FALLBACK_FILENAME


def check_base_url(url: str) -> str:
    """Return the cleaned URL or raise ConfigError.

    Only http(s), a host, and no credentials in the URL: a key belongs in the
    key field, where it is never echoed back, not in an address that is.
    """
    url = url.strip().rstrip("/")
    if not url:
        return ""
    parts = urllib.parse.urlsplit(url)
    if parts.scheme.lower() not in ("http", "https"):
        raise ConfigError("the server address must start with http:// or https://")
    if not parts.hostname:
        raise ConfigError("the server address has no host")
    if parts.username or parts.password:
        raise ConfigError("put the key in the API key field, not in the address")
    if parts.query or parts.fragment:
        raise ConfigError("the server address can't have a ?query or #fragment")
    return url


def _clamp_int(value: Any, lo: int, hi: int, default: int) -> int:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return default
    return max(lo, min(hi, int(value)))


def _normalize(raw: Any) -> dict[str, Any]:
    src = raw if isinstance(raw, dict) else {}
    provider = src.get("provider")
    if provider not in PRESETS:
        provider = DEFAULTS["provider"]
    base_url = src.get("base_url") if isinstance(src.get("base_url"), str) else ""
    try:
        base_url = check_base_url(base_url)
    except ConfigError:
        base_url = ""
    model = src.get("model") if isinstance(src.get("model"), str) else ""
    key = src.get("api_key") if isinstance(src.get("api_key"), str) else ""
    return {
        "enabled": src.get("enabled") is True,
        "provider": provider,
        "base_url": base_url,
        "model": model.strip()[:200],
        "unload_after_s": _clamp_int(
            src.get("unload_after_s"), UNLOAD_AFTER_MIN, UNLOAD_AFTER_MAX,
            DEFAULTS["unload_after_s"],
        ),
        "api_key": key.strip(),
    }


def _read() -> dict[str, Any]:
    try:
        raw = json.loads(config_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        raw = {}
    return _normalize(raw)


def _write(cfg: dict[str, Any]) -> None:
    path = config_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_str = tempfile.mkstemp(prefix=".wp-ai-", dir=str(path.parent))
    tmp = Path(tmp_str)
    try:
        # mkstemp already creates the file 0600 on POSIX; the chmod is for
        # clarity and for filesystems where the umask got in the way.
        try:
            os.chmod(tmp, 0o600)
        except OSError:
            pass
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(cfg, f, indent=2)
        os.replace(tmp, path)
    except OSError:
        tmp.unlink(missing_ok=True)
        raise


def _env_key(provider: str) -> str:
    key = os.environ.get("WP_AI_API_KEY", "").strip()
    if key:
        return key
    env = PRESETS[provider].get("key_env")
    return os.environ.get(env, "").strip() if env else ""


def load_effective() -> dict[str, Any]:
    """The config the client uses, key included. Never send this to a browser.

    `base_url` falls back to the preset's when the user left it empty.
    """
    with _lock:
        cfg = _read()
    preset = PRESETS[cfg["provider"]]
    out = copy.deepcopy(cfg)
    out["base_url"] = cfg["base_url"] or preset["base_url"]
    out["api_key"] = _env_key(cfg["provider"]) or cfg["api_key"]
    out["api"] = preset["api"]
    out["local"] = preset["local"]
    return out


def public_view() -> dict[str, Any]:
    """What the Settings page sees: everything except the key itself."""
    with _lock:
        cfg = _read()
    env_key = bool(_env_key(cfg["provider"]))
    view = {k: v for k, v in cfg.items() if k != "api_key"}
    view["key_set"] = env_key or bool(cfg["api_key"])
    view["key_from_env"] = env_key
    view["presets"] = {
        pid: {k: p[k] for k in ("label", "api", "local", "needs_key", "base_url")}
        for pid, p in PRESETS.items()
    }
    return view


def update(patch: dict[str, Any]) -> dict[str, Any]:
    """Apply a partial update and return the public view.

    `api_key`: a non-empty string replaces the saved key, `""` or `None`
    removes it, absent leaves it alone. It is write-only: no response
    carries it back.
    """
    if not isinstance(patch, dict):
        raise ConfigError("body must be an object")
    with _lock:
        cfg = _read()
        if "enabled" in patch:
            if not isinstance(patch["enabled"], bool):
                raise ConfigError("enabled must be true or false")
            cfg["enabled"] = patch["enabled"]
        if "provider" in patch:
            if patch["provider"] not in PRESETS:
                raise ConfigError(f"unknown provider {patch['provider']!r}")
            if patch["provider"] != cfg["provider"]:
                # A key for one company is never right for another.
                cfg["api_key"] = ""
                cfg["base_url"] = ""
                cfg["model"] = ""
            cfg["provider"] = patch["provider"]
        if "base_url" in patch:
            if not isinstance(patch["base_url"], str):
                raise ConfigError("base_url must be a string")
            cfg["base_url"] = check_base_url(patch["base_url"])
        if "model" in patch:
            if not isinstance(patch["model"], str):
                raise ConfigError("model must be a string")
            cfg["model"] = patch["model"].strip()[:200]
        if "unload_after_s" in patch:
            cfg["unload_after_s"] = _clamp_int(
                patch["unload_after_s"], UNLOAD_AFTER_MIN, UNLOAD_AFTER_MAX,
                cfg["unload_after_s"],
            )
        if "api_key" in patch:
            key = patch["api_key"]
            if key is None:
                key = ""
            if not isinstance(key, str):
                raise ConfigError("api_key must be a string")
            key = key.strip()
            if len(key) > 512:
                raise ConfigError("that key is too long")
            cfg["api_key"] = key
        _write(_normalize(cfg))
    return public_view()
