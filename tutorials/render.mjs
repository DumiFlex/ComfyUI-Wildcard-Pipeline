#!/usr/bin/env node
/**
 * Turns a recorded tutorial take into the finished video.
 *
 *   node tutorials/render.mjs <attempt folder> [--out <folder>] [--name <file name>] [--ffmpeg <path>] [--fps 60] [--loudness -19] [--no-clean] [--no-squeeze] [--silent-max 12]
 *
 * The attempt folder is the take's folder in Watchwright's data folder
 * (runs/<run>/<test>/attempt-N, with video-p1.webm and files/cues.json). It writes:
 *
 * - <name>.mp4: H.264 + AAC, 60 fps (the pack records at 60; --fps 30 for smaller files), the page load cut off, fast-forward parts sped up, the voice
 *   lines (voice/cache/<id>.wav from voice/speak.py) at their cues, chapters inside the file;
 * - <name>.srt: the narration as subtitles (YouTube, Discord and players take it);
 * - <name>.chapters.txt: the chapter list for a YouTube description (from the test's steps).
 *
 * The voice is lined up through the sync marks the take flashes (a magenta square in the top-right
 * corner at the start, with each line and after each sped-up part, tutorial.ts); they are painted out. Needs a full ffmpeg (libx264, aac) on PATH or --ffmpeg;
 * Playwright's own ffmpeg can't do this.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
};
const FLAGS = new Set(["--no-clean", "--no-squeeze"]); // options that take no value
const attempt = argv.find((a, i) => !a.startsWith("--") && !(argv[i - 1]?.startsWith("--") && !FLAGS.has(argv[i - 1])));
if (!attempt) {
  console.error("usage: node tutorials/render.mjs <attempt folder> [--out <folder>] [--name <file>]");
  process.exit(1);
}
const FFMPEG = opt("ffmpeg", "ffmpeg");
const FPS = Number(opt("fps", "60"));

const result = JSON.parse(readFileSync(path.join(attempt, "result.json"), "utf8"));
const take = JSON.parse(readFileSync(path.join(attempt, "files", "cues.json"), "utf8"));
// Watchwright encodes a high-quality take after it ends: from its raw capture (video.capture.mkv;
// earlier 0.16 builds also left a video.finishing marker), which is removed once video.webm is done.
if (["video.finishing", "video.capture.mkv"].some((f) => existsSync(path.join(attempt, f)))) {
  console.error(`Watchwright is still encoding this take's video (the attempt page says "Finishing this video…"). Try again when it's done.`);
  process.exit(1);
}
const video = ["video-p1.webm", "video.webm"].map((f) => path.join(attempt, f)).find((f) => existsSync(f));
if (!video) throw new Error(`No video in ${attempt}. Was the take recorded with video on, or is Watchwright still finishing it?`);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const name = opt("name", `${result.test.id}-${slug(result.test.title)}`);
const out = path.resolve(opt("out", path.join(HERE, "out")));
mkdirSync(out, { recursive: true });

// ---- line the take's clock up with the video ------------------------------------------------------

/** Every time (s) the sync mark comes up in the top-right corner, and when it goes off. */
function findMarks() {
  const r = spawnSync(
    FFMPEG,
    ["-hide_banner", "-i", video, "-vf", "crop=8:8:iw-12:4,scale=1:1,showinfo", "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 1 << 28 },
  );
  if (r.status !== 0) throw new Error(`ffmpeg couldn't read the video: ${String(r.stderr).slice(-400)}`);
  const times = [...String(r.stderr).matchAll(/pts_time:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  const px = r.stdout;
  const found = [];
  // When each mark goes off again: the first unlit frame after a lit run. A busy page writes no
  // new frame for a while, so a mark can stay on screen well past its 0.8 s; painting it out up
  // to its off time keeps it out of the finished video.
  const offs = [];
  let on = false;
  for (let i = 0; i < times.length; i++) {
    const [red, green, blue] = [px[i * 3], px[i * 3 + 1], px[i * 3 + 2]];
    const lit = red > 200 && green < 90 && blue > 200;
    if (lit && !on) found.push(times[i]);
    if (!lit && on) offs.push(times[i]);
    on = lit;
  }
  if (offs.length < found.length) offs.push((times[times.length - 1] ?? 0) + 0.1);
  return { found, offs };
}

const { found, offs } = findMarks();
if (!found.length) console.warn("No sync mark found; assuming the video starts with the take's clock.");
// Pair each mark the take flashed with the one seen in the video, nearest to where it should be. The
// recorder's clock drifts from the page's under load, so the voice is lined up between pairs.
const pairs = [];
{
  let offset = found.length ? found[0] - (take.marks?.[0] ?? take.mark) / 1000 : 0;
  let next = 0;
  for (const ms of take.marks ?? [take.mark]) {
    const want = ms / 1000 + offset;
    let best = -1;
    for (let i = next; i < found.length && found[i] < want + 3; i++) {
      if (Math.abs(found[i] - want) < 3 && (best < 0 || Math.abs(found[i] - want) < Math.abs(found[best] - want))) best = i;
    }
    if (best < 0) continue;
    pairs.push([ms / 1000, found[best]]);
    offset = found[best] - ms / 1000;
    next = best + 1;
  }
}
if (take.marks && pairs.length < take.marks.length) console.warn(`${take.marks.length - pairs.length} of ${take.marks.length} sync mark(s) not found in the video.`);
const drift = pairs.length > 1 ? pairs[pairs.length - 1][1] - pairs[0][1] - (pairs[pairs.length - 1][0] - pairs[0][0]) : 0;
if (pairs.length > 1) console.log(`sync: ${pairs.length} mark(s), the video's clock is ${drift.toFixed(2)} s off the take's by the end`);
/** Video seconds for a take time in ms. */
function vt(ms) {
  const s = ms / 1000;
  if (!pairs.length) return s;
  if (s <= pairs[0][0]) return s + pairs[0][1] - pairs[0][0];
  for (let i = 1; i < pairs.length; i++) {
    const [s0, v0] = pairs[i - 1];
    const [s1, v1] = pairs[i];
    if (s <= s1) return v0 + ((s - s0) * (v1 - v0)) / (s1 - s0);
  }
  const [sl, vl] = pairs[pairs.length - 1];
  return s + vl - sl;
}

// A take that opens a page first starts after that load, not on the page the last take left.
const opening = (take.fast ?? []).find((f) => f.speed === 0 && f.from - take.start < 3000 && f.to > take.start);
const start = vt(opening ? opening.to : take.start);
const end = vt(take.ended);
// The parts to keep, with their speed: the fast-forward ranges sped up, the rest as recorded.
const parts = [];
let at = start;
// A sped-up part starts only once every caption shown at its start has ended, or the caption (drawn
// in the page) would flash past. Takes recorded since fastForward waits for the voice never overlap.
const cueEnd = (ms) => Math.max(ms, ...(take.cues ?? []).filter((c) => c.at <= ms && c.at + c.ms + 500 > ms).map((c) => c.at + c.ms + 500));
for (const f of [...(take.fast ?? [])].sort((a, b) => a.from - b.from)) {
  const a = Math.max(vt(cueEnd(f.from)), at);
  const b = Math.min(vt(f.to), end);
  if (b - a < 1) continue;
  if (a > at) parts.push({ a: at, b: a, speed: 1 });
  // Speed 0 cuts the part out (a page load): nothing is pushed, so ft() maps it to the cut point.
  if (f.speed > 0) parts.push({ a, b, speed: f.speed });
  at = b;
}
if (end > at) parts.push({ a: at, b: end, speed: 1 });

// Long silences play faster: a stretch of the take with no voice line (a build the earlier videos
// taught, a model loading) that would sit silent on screen for over SILENT_MAX seconds keeps
// HOLD seconds at each end at normal speed and plays the middle so it lasts about SQUEEZE seconds
// (2-8x). Parts the take already sped up or cut are left as they are. --no-squeeze turns it off.
const SILENT_MAX = Number(opt("silent-max", "12"));
const HOLD = 2.5;
const SQUEEZE = 4;
const HAND_MAX = 2;
const HAND_GAP = 5;
// When the hand acted, in video seconds (cues.json `acts`, from the Tutor).
const acts = (take.acts ?? []).map((ms) => vt(ms));
if (!argv.includes("--no-squeeze")) {
  // Voice-free stretches, in video seconds.
  const said = [...(take.cues ?? [])].sort((x, y) => x.at - y.at).map((c) => [vt(c.at), vt(c.at + c.ms + 400)]);
  const quiet = [];
  let from = start;
  for (const [a, b] of said) {
    if (a > from) quiet.push([from, a]);
    from = Math.max(from, b);
  }
  if (end > from) quiet.push([from, end]);
  const out = [];
  let squeezed = 0;
  for (const p of parts) {
    if (p.speed !== 1) { out.push(p); continue; }
    let cur = p.a;
    for (const [qa, qb] of quiet) {
      // Before the first line nothing has been shown yet: keep a moment of the page, cut the rest.
      const lead = qa === start;
      const a = Math.max(qa, p.a) + (lead ? 1.5 : HOLD);
      const b = Math.min(qb, p.b) - (lead ? 0.5 : HOLD);
      if (b < a + 2 || (!lead && b - a + 2 * HOLD <= SILENT_MAX) || (lead && b - a < 3)) continue;
      if (a > cur) out.push({ a: cur, b: a, speed: 1 });
      // A cut pushes nothing, as for a speed-0 fast-forward.
      // A stretch where the hand works (clicks, drags, types) plays at most HAND_MAX: faster, the
      // hand looks rushed and the viewer can't follow it. Takes from before `acts` squeeze as before.
      // One click (Run, then a wait) isn't hand work to follow: it takes two or more, at least one
      // every HAND_GAP seconds on average (a few Run clicks across a long wait are still a wait).
      const n = acts.filter((x) => x >= a && x <= b).length;
      const busy = n >= 2 && n * HAND_GAP >= b - a;
      if (!lead) out.push({ a, b, speed: Math.min(busy ? HAND_MAX : 8, Math.max(2, (b - a) / SQUEEZE)) });
      squeezed++;
      cur = b;
    }
    if (p.b > cur) out.push({ a: cur, b: p.b, speed: 1 });
  }
  parts.splice(0, parts.length, ...out);
  if (squeezed) console.log(`squeezed ${squeezed} silent stretch(es) over ${SILENT_MAX} s`);
}

/** Final-video seconds for a video time. */
function ft(t) {
  let acc = 0;
  for (const p of parts) {
    if (t <= p.a) return acc;
    if (t < p.b) return acc + (t - p.a) / p.speed;
    acc += (p.b - p.a) / p.speed;
  }
  return acc;
}
const total = ft(end);

// ---- voice, subtitles, chapters -------------------------------------------------------------------

const voiced = take.cues.filter((c) => existsSync(path.join(HERE, "voice", "cache", `${c.id}.wav`)));
if (voiced.length < take.cues.length) console.warn(`${take.cues.length - voiced.length} line(s) have no voice file; run voice/speak.py.`);

const stamp = (s, sep = ",") => {
  const ms = Math.max(0, Math.round(s * 1000));
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)}${sep}${p(ms % 1000, 3)}`;
};
const srt = take.cues
  .map((c, i) => {
    const a = ft(vt(c.at));
    const next = take.cues[i + 1];
    const b = Math.min(ft(vt(c.at + c.ms + 300)), next ? ft(vt(next.at)) - 0.05 : total);
    return `${i + 1}\n${stamp(a)} --> ${stamp(b)}\n${c.text}\n`;
  })
  .join("\n");
writeFileSync(path.join(out, `${name}.srt`), srt);

const t0 = take.t0;
const chapters = (result.steps ?? [])
  .filter((s) => s.depth === 0)
  .map((s) => ({ title: s.title, at: Math.max(0, ft(vt(Date.parse(s.startedAt) - t0))) }));
if (chapters.length) chapters[0].at = 0;
const ytStamp = (s) => {
  const v = Math.floor(s);
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}`;
};
writeFileSync(path.join(out, `${name}.chapters.txt`), chapters.map((c) => `${ytStamp(c.at)} ${c.title}`).join("\n") + "\n");
const meta = [";FFMETADATA1", `title=${result.test.title}`];
chapters.forEach((c, i) => {
  const b = chapters[i + 1]?.at ?? total;
  meta.push("[CHAPTER]", "TIMEBASE=1/1000", `START=${Math.round(c.at * 1000)}`, `END=${Math.round(b * 1000)}`, `title=${c.title}`);
});
const metaFile = path.join(out, `${name}.ffmeta`);
writeFileSync(metaFile, meta.join("\n") + "\n");

// Watchwright's own videos (0.16+) are full range (0-255, BT.601, from JPEG frames). A plain
// format=yuv420p squeezes nothing and players read the MP4 as limited range, so blacks crush
// (#171717 came out #080808). Convert to limited range BT.709 with zscale (exact); an ffmpeg without
// zimg converts the range only and tags the file BT.601 (swscale's matrix change tints greys green).
const probe = spawnSync(FFMPEG.replace(/ffmpeg(\.exe)?$/, "ffprobe$1"), ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=color_range,color_space", "-of", "default=nw=1", video], { encoding: "utf8" });
const full = /color_range=pc/.test(probe.stdout ?? "");
const src709 = /color_space=bt709/.test(probe.stdout ?? "");
const zimg = /\bzscale\b/.test(spawnSync(FFMPEG, ["-hide_banner", "-filters"], { encoding: "utf8" }).stdout ?? "");
const range = full ? "full" : "limited";
const TO_TV = zimg
  ? `zscale=rangein=${range}:range=limited:matrixin=${src709 ? "709" : "470bg"}:matrix=709,format=yuv420p`
  : `scale=in_range=${range}:out_range=limited,format=yuv420p`;
const space = zimg || src709 ? ["bt709", "bt709", "bt709"] : ["smpte170m", "smpte170m", "smpte170m"];

// ---- the ffmpeg graph -----------------------------------------------------------------------------

const inputs = ["-i", video];
const graph = [];
// Paint the sync marks out with the pixels just below them: the two rows under the 20 px corner,
// stretched over it. One fixed colour left a visible square wherever the corner wasn't that colour
// (the manager, another palette) or when the encoder's range made it a shade off.
const paint = found.map((t, i) => `between(t,${(t - 0.1).toFixed(3)},${(Math.max(t + 0.7, (offs[i] ?? t + 0.7) + 0.1)).toFixed(3)})`).join("+");
// The recorder writes a frame only when the page changes (gaps of seconds), and `trim` ends a part at
// its last frame, so make it constant frame rate first or every still stretch at a cut drops out.
if (paint) {
  graph.push(`[0:v]fps=${FPS},split=2[base][src]`);
  graph.push(`[src]crop=20:2:iw-20:20,scale=20:20:flags=neighbor:in_range=${range}:out_range=${range}[patch]`);
  graph.push(`[base][patch]overlay=W-20:0:enable='${paint}',split=${parts.length}${parts.map((_, i) => `[s${i}]`).join("")}`);
} else {
  graph.push(`[0:v]fps=${FPS},split=${parts.length}${parts.map((_, i) => `[s${i}]`).join("")}`);
}
parts.forEach((p, i) => {
  graph.push(`[s${i}]trim=start=${p.a.toFixed(3)}:end=${p.b.toFixed(3)},setpts=(PTS-STARTPTS)/${p.speed}[v${i}]`);
});
graph.push(`${parts.map((_, i) => `[v${i}]`).join("")}concat=n=${parts.length}:v=1:a=0,fps=${FPS},${TO_TV}[vout]`);
// Each line is cleaned before it's placed: Qwen3-TTS takes carry a fizz on every word (about
// 5-12 kHz) and audible breaths in the pauses. Rumble cut, light denoise, a gate that turns the
// pauses down by 20 dB (ducks rather than mutes, so word endings aren't chopped), and a de-esser.
// --no-clean renders the lines as they are.
const CLEAN = argv.includes("--no-clean")
  ? ""
  : "highpass=f=70,afftdn=nr=10:nf=-50,agate=threshold=0.01:ratio=2:range=0.1:attack=5:release=120,deesser=i=0.4:m=0.5:f=0.5:s=o,";
voiced.forEach((c, i) => {
  inputs.push("-i", path.join(HERE, "voice", "cache", `${c.id}.wav`));
  const delay = Math.round(ft(vt(c.at)) * 1000);
  graph.push(`[${i + 1}:a]${CLEAN}aresample=48000,adelay=${delay}|${delay}[a${i}]`);
});
// Silence the length of the video under the voice, so the audio track covers it all.
graph.push(`anullsrc=r=48000:cl=stereo,atrim=0:${total.toFixed(3)}[bed]`);
// Loudness: -19 LUFS (--loudness). -16 sat a few dB over most tutorials, since a voice-only track
// has no quiet music to average it down, and YouTube only turns loud videos down, never quiet ones up.
// loudnorm upsamples to 192 kHz to find true peaks, so the track is brought back to 48 kHz.
const LUFS = Number(opt("loudness", "-19"));
graph.push(`[bed]${voiced.map((_, i) => `[a${i}]`).join("")}amix=inputs=${voiced.length + 1}:normalize=0:duration=first,loudnorm=I=${LUFS}:TP=-1.5:LRA=11,aresample=48000[aout]`);

const mp4 = path.join(out, `${name}.mp4`);
const args = [
  "-hide_banner", "-y",
  ...inputs,
  "-i", metaFile,
  "-filter_complex", graph.join(";"),
  "-map", "[vout]", "-map", "[aout]",
  "-map_metadata", String(voiced.length + 1), "-map_chapters", String(voiced.length + 1),
  "-c:v", "libx264", "-preset", "slow", "-crf", "18",
  "-color_range", "tv", "-colorspace", space[0], "-color_primaries", space[1], "-color_trc", space[2],
  "-c:a", "aac", "-b:a", "160k",
  "-movflags", "+faststart",
  mp4,
];
console.log(`rendering ${name}: ${total.toFixed(1)} s, ${voiced.length} voice line(s), ${parts.length} part(s), ${chapters.length} chapter(s)`);
const r = spawnSync(FFMPEG, args, { stdio: ["ignore", "inherit", "pipe"] });
if (r.status !== 0) {
  console.error(String(r.stderr).slice(-2000));
  process.exit(1);
}
console.log(`wrote ${mp4}`);
