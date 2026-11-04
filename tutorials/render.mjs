#!/usr/bin/env node
/**
 * Turns a recorded tutorial take into the finished video.
 *
 *   node tutorials/render.mjs <attempt folder> [--out <folder>] [--name <file name>] [--ffmpeg <path>]
 *
 * The attempt folder is the take's folder in Watchwright's data folder
 * (runs/<run>/<test>/attempt-N, with video-p1.webm and files/cues.json). It writes:
 *
 * - <name>.mp4: H.264 + AAC, 30 fps, the page load cut off, fast-forward parts sped up, the voice
 *   lines (voice/cache/<id>.wav from voice/speak.py) at their cues, chapters inside the file;
 * - <name>.srt: the narration as subtitles (YouTube, Discord and players take it);
 * - <name>.chapters.txt: the chapter list for a YouTube description (from the test's steps).
 *
 * The voice is lined up through the sync mark the take shows at its start (a magenta square in the
 * top-right corner, tutorial.ts › begin). Needs a full ffmpeg (libx264, aac) on PATH or --ffmpeg;
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
const attempt = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
if (!attempt) {
  console.error("usage: node tutorials/render.mjs <attempt folder> [--out <folder>] [--name <file>]");
  process.exit(1);
}
const FFMPEG = opt("ffmpeg", "ffmpeg");
const FPS = 30;

const result = JSON.parse(readFileSync(path.join(attempt, "result.json"), "utf8"));
const take = JSON.parse(readFileSync(path.join(attempt, "files", "cues.json"), "utf8"));
const video = ["video-p1.webm", "video.webm"].map((f) => path.join(attempt, f)).find((f) => existsSync(f));
if (!video) throw new Error(`No video in ${attempt}. Was the take recorded with video on?`);
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const name = opt("name", `${result.test.id}-${slug(result.test.title)}`);
const out = path.resolve(opt("out", path.join(HERE, "out")));
mkdirSync(out, { recursive: true });

// ---- line the take's clock up with the video ------------------------------------------------------

/** The first time (s) the sync mark shows in the top-right corner. */
function findMark() {
  const r = spawnSync(
    FFMPEG,
    ["-hide_banner", "-t", "60", "-i", video, "-vf", "crop=8:8:iw-12:4,scale=1:1,showinfo", "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 1 << 26 },
  );
  if (r.status !== 0) throw new Error(`ffmpeg couldn't read the video: ${String(r.stderr).slice(-400)}`);
  const times = [...String(r.stderr).matchAll(/pts_time:\s*([\d.]+)/g)].map((m) => Number(m[1]));
  const px = r.stdout;
  for (let i = 0; i < times.length; i++) {
    const [red, green, blue] = [px[i * 3], px[i * 3 + 1], px[i * 3 + 2]];
    if (red > 200 && green < 90 && blue > 200) return times[i];
  }
  return null;
}

const mark = findMark();
if (mark == null) console.warn("No sync mark found; assuming the video starts with the take's clock.");
/** Video seconds for a take time in ms. */
const offset = mark == null ? 0 : mark - take.mark / 1000;
const vt = (ms) => ms / 1000 + offset;

const start = vt(take.start);
const end = vt(take.ended);
// The parts to keep, with their speed: the fast-forward ranges sped up, the rest as recorded.
const parts = [];
let at = start;
for (const f of [...(take.fast ?? [])].sort((a, b) => a.from - b.from)) {
  const a = Math.max(vt(f.from), at);
  const b = Math.min(vt(f.to), end);
  if (b - a < 1) continue;
  if (a > at) parts.push({ a: at, b: a, speed: 1 });
  parts.push({ a, b, speed: f.speed });
  at = b;
}
if (end > at) parts.push({ a: at, b: end, speed: 1 });

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

// ---- the ffmpeg graph -----------------------------------------------------------------------------

const inputs = ["-i", video];
const graph = [];
parts.forEach((p, i) => {
  graph.push(`[0:v]trim=start=${p.a.toFixed(3)}:end=${p.b.toFixed(3)},setpts=(PTS-STARTPTS)/${p.speed}[v${i}]`);
});
graph.push(`${parts.map((_, i) => `[v${i}]`).join("")}concat=n=${parts.length}:v=1:a=0,fps=${FPS},format=yuv420p[vout]`);
voiced.forEach((c, i) => {
  inputs.push("-i", path.join(HERE, "voice", "cache", `${c.id}.wav`));
  const delay = Math.round(ft(vt(c.at)) * 1000);
  graph.push(`[${i + 1}:a]aresample=48000,adelay=${delay}|${delay}[a${i}]`);
});
// Silence the length of the video under the voice, so the audio track covers it all.
graph.push(`anullsrc=r=48000:cl=stereo,atrim=0:${total.toFixed(3)}[bed]`);
graph.push(`[bed]${voiced.map((_, i) => `[a${i}]`).join("")}amix=inputs=${voiced.length + 1}:normalize=0:duration=first,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`);

const mp4 = path.join(out, `${name}.mp4`);
const args = [
  "-hide_banner", "-y",
  ...inputs,
  "-i", metaFile,
  "-filter_complex", graph.join(";"),
  "-map", "[vout]", "-map", "[aout]",
  "-map_metadata", String(voiced.length + 1), "-map_chapters", String(voiced.length + 1),
  "-c:v", "libx264", "-preset", "slow", "-crf", "18",
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
