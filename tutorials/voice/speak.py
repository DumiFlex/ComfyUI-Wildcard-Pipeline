"""Speaks every narration line of the tutorials with a local text-to-speech model.

    python tutorials/voice/speak.py [--engine qwen3|kokoro] [--voice af_heart] [--only T01]

Reads each `t.say("caption")` / `t.say("caption", "spoken")` line from tutorials/tests/*.ts
and speaks the spoken text (else the caption through `spoken_text`), writes one WAV per line into
voice/cache/<id>.wav (the id is tutorial.ts's lineId: the first 12 hex of the line's SHA-1) and
voice/lines.json, which tells the recording how long each line takes, so the hands wait for the
voice. Lines already spoken with the same engine, voice and speed are kept.

Two engines:

- qwen3 (the narrator): Qwen3-TTS 1.7B Base (Apache-2.0) on a CUDA GPU, cloning a reference
  that Kokoro speaks once (voice/ref/<voice>.wav, REF_TEXT). It sounds the most human but now and
  then drifts on one line (runs on, mumbles, stops early), so every take is checked by its length
  (and by its words when faster-whisper is installed) and spoken again with another seed; a line
  that fails every try is spoken by Kokoro and listed at the end. About 3-4x slower than real
  time without flash-attn (~1 hour for every line). Needs: pip install qwen-tts soundfile
  kokoro-onnx, plus a CUDA build of torch. The model (~4.5 GB) downloads from Hugging Face.
- kokoro: Kokoro-82M (Apache-2.0) through kokoro-onnx, on the CPU at a few times real time.
  Its two files (~350 MB) download into voice/models/ on the first run.
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
REFS = HERE / "ref"
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
        src = f.read_text(encoding="utf-8")
        # A say() whose text isn't written out ("t.say(ok ? 'a' : 'b')") is never voiced: shout.
        for m in re.finditer(r"\.say\(\s*(?![\s\"'`])", src):
            row = src.count("\n", 0, m.start()) + 1
            print(f"NOT VOICED: {f.name}:{row} says a line that isn't written out",
                  file=sys.stderr)
        for m in SAY.finditer(src):
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


# ---- Qwen3-TTS ---------------------------------------------------------------------------------

QWEN_MODEL = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
# What Kokoro says for the reference the Qwen3 voice is cloned from (~8 s with af_heart).
REF_TEXT = (
    "Wildcard Pipeline builds prompts from lists you make yourself. "
    "Each run rolls new picks, and the rules keep them making sense together."
)
TRIES = 4
# Speaking rate of the narrator, words per second, for the length check (af_heart clone: ~2.6).
WPS = 2.6
QUIET = 0.01


def trim(samples, rate: int):
    """The take without the silence before and after it (50 ms kept each side)."""
    import numpy as np

    loud = np.flatnonzero(np.abs(samples) > QUIET)
    if loud.size == 0:
        return samples[:0]
    pad = int(rate * 0.05)
    return samples[max(loud[0] - pad, 0) : loud[-1] + pad]


def longest_gap(samples, rate: int) -> float:
    """The longest quiet stretch inside the take, in seconds."""
    import numpy as np

    step = int(rate * 0.01)
    if len(samples) < step * 2:
        return 0.0
    env = np.abs(samples[: len(samples) // step * step]).reshape(-1, step).max(axis=1)
    best = run = 0
    for q in env < QUIET:
        run = run + 1 if q else 0
        best = max(best, run)
    return best * 0.01


def take_problem(seconds: float, gap: float, spoken: str) -> str | None:
    """Why a take sounds drifted, from its length alone, or None when it looks right."""
    words = max(len(re.findall(r"[\w']+", spoken)), 1)
    expected = words / WPS
    if seconds < 0.3:
        return "empty"
    if seconds > max(expected * 1.9, expected + 2.5):
        return f"too long ({seconds:.1f} s for ~{expected:.1f} s)"
    if words >= 4 and seconds < expected * 0.45:
        return f"too short ({seconds:.1f} s for ~{expected:.1f} s)"
    if gap > 1.2:
        return f"a {gap:.1f} s gap"
    return None


_NUMBER_WORDS = set(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen "
    "fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy eighty "
    "ninety hundred thousand million point".split()
)


def _words(text: str) -> list[str]:
    # Whisper writes numbers as digits ("832 by 1216" for "eight thirty two by twelve sixteen"),
    # so numbers are left out on both sides rather than matched.
    return [
        w
        for w in re.findall(r"[a-z']+|\d+", text.lower().replace("-", " "))
        if not w.isdigit() and w not in _NUMBER_WORDS
    ]


def word_match(heard: str, spoken: str) -> float:
    """How much of the spoken text the transcript holds (0..1), letters run together."""
    want = "".join(_words(spoken))
    got = "".join(_words(heard))
    if not want:
        return 1.0
    from difflib import SequenceMatcher

    return SequenceMatcher(None, want, got, autojunk=False).ratio()


class Qwen3:
    def __init__(self, ref_wav: Path, ref_text: str) -> None:
        import torch
        from qwen_tts import Qwen3TTSModel

        if not torch.cuda.is_available():
            raise RuntimeError("Qwen3-TTS needs a CUDA GPU (use --engine kokoro on the CPU)")
        self.torch = torch
        self.model = Qwen3TTSModel.from_pretrained(
            QWEN_MODEL, device_map="cuda:0", dtype=torch.bfloat16
        )
        self.prompt = self.model.create_voice_clone_prompt(
            ref_audio=str(ref_wav), ref_text=ref_text
        )
        self.whisper = None
        try:
            import numpy as np
            from faster_whisper import WhisperModel
        except ImportError:  # optional: the length check alone still catches most drift
            print("faster-whisper not installed: checking takes by length only")
            return
        # The GPU build needs CUDA 12's cuBLAS, which a CUDA 13 torch doesn't ship, and the model
        # only loads its libraries on the first transcribe: try one there, else run on the CPU.
        for device, compute in (("cuda", "float16"), ("cpu", "int8")):
            try:
                model = WhisperModel("small.en", device=device, compute_type=compute)
                list(model.transcribe(np.zeros(16000, dtype=np.float32), language="en")[0])
            except Exception as err:
                print(f"faster-whisper on {device} failed ({err})")
                continue
            self.whisper = model
            print(f"checking takes by their words too (faster-whisper on {device})")
            return
        print("checking takes by length only")

    def heard(self, samples, rate: int) -> str | None:
        if self.whisper is None:
            return None
        import numpy as np

        audio = samples.astype(np.float32)
        if rate != 16000:
            idx = np.arange(0, len(audio), rate / 16000)
            audio = np.interp(idx, np.arange(len(audio)), audio).astype(np.float32)
        segments, _ = self.whisper.transcribe(audio, language="en", beam_size=1)
        return " ".join(s.text for s in segments)

    def once(self, spoken: str, seed: int):
        import numpy as np

        self.torch.manual_seed(seed)
        words = max(len(spoken.split()), 1)
        # 12 codec frames a second: room for twice the expected length, so a run-on stops early.
        cap = int(12 * max(words / WPS * 2.2, 4.0)) + 24
        try:
            wavs, rate = self.model.generate_voice_clone(
                text=spoken,
                language="English",
                voice_clone_prompt=self.prompt,
                max_new_tokens=cap,
            )
        except TypeError:
            wavs, rate = self.model.generate_voice_clone(
                text=spoken, language="English", voice_clone_prompt=self.prompt
            )
        return np.asarray(wavs[0], dtype=np.float32), rate

    def speak(self, spoken: str, lid: str):
        """The first take that passes the checks, else (None, reason) after TRIES takes."""
        best = None
        reason = ""
        for n in range(TRIES):
            samples, rate = self.once(spoken, seed=int(lid[:8], 16) + n)
            samples = trim(samples, rate)
            seconds = len(samples) / rate
            problem = take_problem(seconds, longest_gap(samples, rate), spoken)
            if problem is None:
                heard = self.heard(samples, rate)
                score = 1.0 if heard is None else word_match(heard, spoken)
                if score >= 0.8:
                    return (samples, rate), n + 1, None
                problem = f"words off ({score:.2f}): {heard!r}"
                # Right length but a word or two off: keep the closest in case none pass.
                if best is None or score > best[0]:
                    best = (score, (samples, rate))
            reason = problem
            print(f"  take {n + 1}: {problem}")
        if best is not None:
            return best[1], TRIES, f"kept the closest take ({reason})"
        return None, TRIES, reason


def ensure_ref(kokoro, voice: str) -> Path:
    """The reference the Qwen3 voice clones: Kokoro speaking REF_TEXT, made once."""
    import soundfile as sf

    REFS.mkdir(parents=True, exist_ok=True)
    wav = REFS / f"{voice}.wav"
    if not wav.exists():
        samples, rate = kokoro.create(REF_TEXT, voice=voice, speed=1.0, lang="en-us")
        sf.write(wav, samples, rate)
    return wav


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument(
        "--engine",
        choices=("qwen3", "kokoro"),
        default="qwen3",
        help="qwen3 (the narrator, CUDA GPU) or kokoro (CPU)",
    )
    ap.add_argument(
        "--voice",
        default="af_heart",
        help="a Kokoro voice (af_heart, af_bella, am_michael, bf_emma …); qwen3 clones it",
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
    qwen = None
    if args.engine == "qwen3":
        try:
            qwen = Qwen3(ensure_ref(kokoro, args.voice), REF_TEXT)
        except ImportError:
            print("needs: pip install qwen-tts (and a CUDA build of torch)", file=sys.stderr)
            return 1
    voice = f"qwen3:{args.voice}" if qwen else args.voice
    CACHE.mkdir(parents=True, exist_ok=True)
    known: dict[str, dict] = json.loads(LINES.read_text(encoding="utf-8")) if LINES.exists() else {}

    made = 0
    fell_back: list[str] = []
    for text, spoken in texts.items():
        lid = line_id(text)
        wav = CACHE / f"{lid}.wav"
        old = known.get(lid)
        same = (
            old
            and old.get("voice") == voice
            and old.get("speed") == args.speed
            # A line spoken before its spoken text changed (a new rule, a new override) is redone.
            and old.get("spoken") == spoken
            and old.get("method") == METHOD
        )
        if same and wav.exists() and not args.force:
            continue
        note = ""
        if qwen is not None:
            take, tries, problem = qwen.speak(spoken, lid)
            if take is None:
                # Every take drifted: Kokoro speaks it, and the line is spoken again next run.
                samples, rate = synth(kokoro, spoken, args.voice, args.speed)
                fell_back.append(f"{lid}  {text}  ({problem})")
                note = "  [kokoro]"
            else:
                samples, rate = take
                if problem:
                    fell_back.append(f"{lid}  {text}  ({problem})")
                if tries > 1:
                    note = f"  [take {tries}]"
        else:
            samples, rate = synth(kokoro, spoken, args.voice, args.speed)
        sf.write(wav, samples, rate)
        known[lid] = {
            "text": text,
            "spoken": spoken,
            "method": METHOD,
            "ms": round(len(samples) / rate * 1000),
            # A Kokoro stand-in keeps a voice that never matches, so the next run tries Qwen again.
            "voice": voice if note != "  [kokoro]" else f"{args.voice} (stand-in)",
            "speed": args.speed,
        }
        made += 1
        print(f"{lid}  {known[lid]['ms']:>5} ms  {text}{note}")

    LINES.write_text(
        json.dumps(known, indent=1, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"{made} line(s) spoken, {len(texts)} in the tests, lines.json has {len(known)}.")
    if fell_back:
        print(f"\n{len(fell_back)} line(s) to listen to (Kokoro stand-in or closest take):")
        print("\n".join(fell_back))
    return 0


if __name__ == "__main__":
    sys.exit(main())
