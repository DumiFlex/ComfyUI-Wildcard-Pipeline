"""Speaks every narration line of the tutorials with a local text-to-speech model.

    python tutorials/voice/speak.py [--voice af_heart] [--speed 1.0] [--only T01]

Reads each `t.say("caption")` / `t.say("caption", "spoken")` line from tutorials/tests/*.ts
and speaks the spoken text (else the caption through `spoken_text`), writes one WAV per line into
voice/cache/<id>.wav (the id is tutorial.ts's lineId: the first 12 hex of the line's SHA-1) and
voice/lines.json, which tells the recording how long each line takes, so the hands wait for the
voice. Lines already spoken with the same voice and speed are kept.

The model is Kokoro-82M (Apache-2.0) through kokoro-onnx, which runs on the CPU at a few times
real time. Its two files (~350 MB) download into voice/models/ on the first run.

Needs: pip install kokoro-onnx soundfile
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
TESTS = HERE.parent / "tests"
CACHE = HERE / "cache"
MODELS = HERE / "models"
LINES = HERE / "lines.json"
RELEASE = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/"
FILES = ("kokoro-v1.0.onnx", "voices-v1.0.bin")

# t.say("caption") or t.say("caption", "spoken"), each "…", '…' or `…` with no ${} inside.
_STR = r"""(?P<q{n}>["'`])(?P<{name}>(?:\\.|(?!(?P=q{n})).)*)(?P=q{n})"""
SAY = re.compile(
    r"\.say\(\s*"
    + _STR.format(n=1, name="text")
    + r"(?:\s*,\s*"
    + _STR.format(n=2, name="spoken")
    + r")?\s*,?\s*\)",
    re.S,
)


def line_id(text: str) -> str:
    return hashlib.sha1(text.strip().encode("utf-8")).hexdigest()[:12]


def unescape(text: str) -> str:
    return re.sub(r"\\(.)", lambda m: {"n": "\n", "t": "\t"}.get(m.group(1), m.group(1)), text)


def lines_in(files: list[Path]) -> dict[str, str]:
    """Each caption, with what the voice reads for it (its own spoken text, else the rules)."""
    out: dict[str, str] = {}
    for f in files:
        for m in SAY.finditer(f.read_text(encoding="utf-8")):
            text = unescape(m.group("text"))
            spoken = unescape(m.group("spoken")) if m.group("spoken") is not None else None
            if "${" in text or (spoken and "${" in spoken):
                print(f"skipped a line with ${{}} in {f.name}: {text[:60]}", file=sys.stderr)
                continue
            if text not in out:
                out[text] = spoken if spoken is not None else spoken_text(text)
    return out


def ensure_models() -> None:
    MODELS.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        target = MODELS / name
        if target.exists() and target.stat().st_size > 0:
            continue
        print(f"downloading {name} …")
        part = target.with_suffix(target.suffix + ".part")
        urllib.request.urlretrieve(RELEASE + name, part)
        part.replace(target)


def spoken_text(text: str) -> str:
    """What the voice reads: `$hero_line` as "hero line", "WP" as letters, "LoRA" as one word."""

    def var(m: re.Match[str]) -> str:
        return (m.group(1) + m.group(2).replace(".", " dot ")).replace("_", " ").lower()

    # A file name says its dot: "library.json" as "library dot json".
    t = re.sub(r"\b(\w+)\.(json|txt|png|csv|yaml|zip|md)\b", r"\1 dot \2", text)
    t = re.sub(r"\$(\w+)((?:\.\w+)*)", var, t)
    t = re.sub(r"\bWP\b", "W P", t)
    # Spelled the way it's said: "LoRA" letter by letter sounds wrong, "lora" reads as one word.
    t = re.sub(r"\bLoRA(s?)\b", r"lora\1", t)
    t = re.sub(r"\bComfyUI\b", "Comfy U I", t)
    # A version as people say it: "2.22" as "two twenty-two", not "two point two two".
    t = re.sub(r"\b(\d+)\.(\d{2})\b", r"\1 \2", t)
    # Names the model spells out wrong.
    t = re.sub(r"\bdpmpp\b", "D P M P P", t)
    t = re.sub(r"\b(\d)m\b", r"\1 M", t)
    t = re.sub(r"\bSearXNG\b", "searx N G", t)
    return t


# Kokoro reads a very short line ("Save it.", "Run.") as if more were coming: its pitch rises at
# the end. Spoken after a lead-in sentence it ends like a statement, so short lines are spoken
# that way and the lead-in is cut off at the pause between the two sentences.
SHORT_WORDS = 5
# Bump when how lines are spoken changes, so every line is spoken again.
METHOD = 2
LEAD = "That's it for this part."


def _after_lead(samples, rate: int):
    """The part after the longest pause past the lead-in, or None when no clear pause is found."""
    import numpy as np

    step = int(rate * 0.01)
    env = np.array(
        [np.abs(samples[i : i + step]).max() for i in range(0, len(samples) - step, step)]
    )
    quiet = env < 0.01
    best = (0, 0)
    i = 30  # the lead-in itself lasts well over 0.3 s
    while i < len(quiet):
        if not quiet[i]:
            i += 1
            continue
        j = i
        while j < len(quiet) and quiet[j]:
            j += 1
        if j - i > best[1] - best[0] and j < len(quiet) - 10:
            best = (i, j)
        i = j
    if best[1] - best[0] < 8:  # under 80 ms: not the sentence break
        return None
    start = max(best[1] * step - int(rate * 0.03), 0)
    lead_in = np.zeros(int(rate * 0.05), dtype=samples.dtype)
    return np.concatenate([lead_in, samples[start:]])


def synth(kokoro, spoken: str, voice: str, speed: float):
    """Speaks one line; a short one after a lead-in that is then cut off."""
    if len(spoken.split()) <= SHORT_WORDS:
        samples, rate = kokoro.create(f"{LEAD} {spoken}", voice=voice, speed=speed, lang="en-us")
        cut = _after_lead(samples, rate)
        if cut is not None and len(cut) > rate * 0.25:
            return cut, rate
    return kokoro.create(spoken, voice=voice, speed=speed, lang="en-us")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument(
        "--voice",
        default="af_heart",
        help="a Kokoro voice (af_heart, af_bella, am_michael, bf_emma …)",
    )
    ap.add_argument("--speed", type=float, default=1.0)
    ap.add_argument(
        "--only", default="", help="test file prefixes, comma separated (T01 matches 01-*.ts)"
    )
    ap.add_argument("--force", action="store_true", help="speak every line again")
    args = ap.parse_args()

    files = sorted(TESTS.glob("*.ts"))
    if args.only:
        wanted = [w.strip().lstrip("Tt") for w in args.only.split(",") if w.strip()]
        files = [f for f in files if any(f.name.startswith(w) for w in wanted)]
    texts = lines_in(files)
    if not texts:
        print("no lines found")
        return 1

    try:
        import soundfile as sf
        from kokoro_onnx import Kokoro
    except ImportError:
        print("needs: pip install kokoro-onnx soundfile", file=sys.stderr)
        return 1

    ensure_models()
    kokoro = Kokoro(str(MODELS / FILES[0]), str(MODELS / FILES[1]))
    CACHE.mkdir(parents=True, exist_ok=True)
    known: dict[str, dict] = json.loads(LINES.read_text(encoding="utf-8")) if LINES.exists() else {}

    made = 0
    for text, spoken in texts.items():
        lid = line_id(text)
        wav = CACHE / f"{lid}.wav"
        old = known.get(lid)
        same = (
            old
            and old.get("voice") == args.voice
            and old.get("speed") == args.speed
            # A line spoken before its spoken text changed (a new rule, a new override) is redone.
            and old.get("spoken") == spoken
            and old.get("method") == METHOD
        )
        if same and wav.exists() and not args.force:
            continue
        samples, rate = synth(kokoro, spoken, args.voice, args.speed)
        sf.write(wav, samples, rate)
        known[lid] = {
            "text": text,
            "spoken": spoken,
            "method": METHOD,
            "ms": round(len(samples) / rate * 1000),
            "voice": args.voice,
            "speed": args.speed,
        }
        made += 1
        print(f"{lid}  {known[lid]['ms']:>5} ms  {text}")

    LINES.write_text(
        json.dumps(known, indent=1, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"{made} line(s) spoken, {len(texts)} in the tests, lines.json has {len(known)}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
