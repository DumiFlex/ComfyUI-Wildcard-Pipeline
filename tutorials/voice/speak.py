"""Speaks every narration line of the tutorials with a local text-to-speech model.

    python tutorials/voice/speak.py [--voice af_heart] [--speed 1.0] [--only T01]

Reads each `t.say("...")` line from tutorials/tests/*.ts, writes one WAV per line into
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

# t.say("…") / t.say('…') / t.say(`…`) with no ${} inside: the line as written.
SAY = re.compile(r"""\.say\(\s*(?P<q>["'`])(?P<text>(?:\\.|(?!(?P=q)).)*)(?P=q)\s*\)""", re.S)


def line_id(text: str) -> str:
    return hashlib.sha1(text.strip().encode("utf-8")).hexdigest()[:12]


def unescape(text: str) -> str:
    return re.sub(r"\\(.)", lambda m: {"n": "\n", "t": "\t"}.get(m.group(1), m.group(1)), text)


def lines_in(files: list[Path]) -> list[str]:
    out: list[str] = []
    for f in files:
        for m in SAY.finditer(f.read_text(encoding="utf-8")):
            text = unescape(m.group("text"))
            if m.group("q") == "`" and "${" in text:
                print(f"skipped a line with ${{}} in {f.name}: {text[:60]}", file=sys.stderr)
                continue
            if text not in out:
                out.append(text)
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
    """What the voice reads: `$hero` reads as "hero", "WP" as letters."""
    t = re.sub(r"\$(\w+)((?:\.\w+)*)", lambda m: m.group(1) + m.group(2).replace(".", " dot ").lower(), text)
    t = re.sub(r"\bWP\b", "W P", t)
    return t


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
    for text in texts:
        lid = line_id(text)
        wav = CACHE / f"{lid}.wav"
        old = known.get(lid)
        same = old and old.get("voice") == args.voice and old.get("speed") == args.speed
        if same and wav.exists() and not args.force:
            continue
        samples, rate = kokoro.create(
            spoken_text(text), voice=args.voice, speed=args.speed, lang="en-us"
        )
        sf.write(wav, samples, rate)
        known[lid] = {
            "text": text,
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
