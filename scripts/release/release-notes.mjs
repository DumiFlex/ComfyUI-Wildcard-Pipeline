#!/usr/bin/env node
/**
 * release-notes.mjs — the release steps release-please can't do for us.
 *
 * release-please (`.github/workflows/release.yml`) opens the release PR, bumps
 * package.json + pyproject.toml and tags the release. It only knows how to
 * write a commit-list changelog, so the curated notes in
 * docs/release-notes/next.md, the beta channel and the post-release cleanup
 * live here:
 *
 *   body <version> [currentTag]    print the release body (header + next.md + compare link)
 *   beta-version                   print the next x.y.z-beta.N for HEAD
 *   stamp <version>                write the version into package.json + pyproject.toml
 *   after-release <shipped> <body> on a dev checkout: drop the shipped notes from
 *                                  next.md (keeping anything added since), put the
 *                                  shipped body on top of CHANGELOG.md and print
 *                                  how many lines of next.md were kept
 *
 * Every git call reads the repo in the current directory.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const NOTES_FILE = "docs/release-notes/next.md";
const REPO_URL = "https://github.com/DumiFlex/ComfyUI-Wildcard-Pipeline";

const STABLE_TAG = /^v(\d+)\.(\d+)\.(\d+)$/;

/** The release body. Same header and footer the 2.x releases have used. */
export function renderBody({ version, currentTag, previousTag, highlights }) {
  const header =
    `## 🎉 Wildcard Pipeline ${version}\n\n` +
    `📖 [Docs (wiki)](${REPO_URL}/wiki) · ` +
    "💬 [Discord](https://discord.gg/BFYR9WQdVR) · " +
    `📦 [Install via ComfyUI Manager](${REPO_URL}/wiki/Quick-Start) · ` +
    `🐛 [Issues](${REPO_URL}/issues)\n\n`;
  const notes = highlights.trim() ? `${highlights.trim()}\n\n` : "";
  const footer = previousTag
    ? "\n---\n\n**Full changelog:** " +
      `[${previousTag}…${currentTag}](${REPO_URL}/compare/${previousTag}...${currentTag})\n`
    : "";
  return header + notes + footer;
}

function parseStable(tag) {
  const m = STABLE_TAG.exec(tag);
  return m ? m.slice(1).map(Number) : null;
}

function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** Highest stable `vX.Y.Z` tag below `version` (or overall when `version` is null). */
export function previousStableTag(tags, version) {
  const below = version ? version.split("-")[0].split(".").map(Number) : null;
  let best = null;
  for (const tag of tags) {
    const v = parseStable(tag);
    if (!v || (below && compareVersions(v, below) >= 0)) continue;
    if (!best || compareVersions(v, best.v) > 0) best = { tag, v };
  }
  return best?.tag ?? null;
}

/**
 * The bump the Conventional Commits since the last release ask for, with the
 * rules release-please-config.json uses: `!` or BREAKING CHANGE → major,
 * feat → minor, fix/perf/refactor/revert → patch, anything else → none.
 */
export function bumpFor(commits) {
  let bump = null;
  for (const { subject, body = "" } of commits) {
    const m = /^(\w+)(\([^)]*\))?(!)?:/.exec(subject);
    if (!m) continue;
    if (m[3] || /^BREAKING[ -]CHANGE:/m.test(body)) return "major";
    if (m[1] === "feat") bump = "minor";
    else if (["fix", "perf", "refactor", "revert"].includes(m[1]) && !bump) bump = "patch";
  }
  return bump;
}

/** Next `x.y.z-beta.N`: the bump on top of the last stable tag, N one past the highest beta of it. */
export function nextBetaVersion({ lastStable, commits, tags }) {
  const bump = bumpFor(commits);
  if (!bump) return null;
  const [major, minor, patch] = parseStable(lastStable) ?? [0, 0, 0];
  const next =
    bump === "major" ? `${major + 1}.0.0` : bump === "minor" ? `${major}.${minor + 1}.0` : `${major}.${minor}.${patch + 1}`;
  const prefix = `v${next}-beta.`;
  const taken = tags.filter((t) => t.startsWith(prefix)).map((t) => Number(t.slice(prefix.length)) || 0);
  return `${next}-beta.${taken.length ? Math.max(...taken) + 1 : 1}`;
}

/**
 * next.md on dev minus what just shipped. The lines the two files share
 * (longest common subsequence) are the shipped ones and go; lines written on
 * dev since the release stay, with the heading they sit under. Returns the
 * remaining text and how many lines were kept, so the workflow can leave the
 * cleanup PR open for a look when anything was.
 */
export function removeShipped(current, shipped) {
  const a = current.split("\n");
  const b = shipped.split("\n");
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const shippedLine = new Array(a.length).fill(false);
  for (let i = 0, j = 0; i < a.length && j < b.length; ) {
    if (a[i] === b[j]) {
      shippedLine[i++] = true;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) i++;
    else j++;
  }
  const isHeading = (line) => /^#{1,6} /.test(line);
  const out = [];
  let kept = 0;
  for (let i = 0; i < a.length; i++) {
    if (!shippedLine[i]) {
      out.push(a[i]);
      if (a[i].trim()) kept++;
    } else if (isHeading(a[i])) {
      // A shipped heading stays only when new lines sit under it.
      let k = i + 1;
      while (k < a.length && !isHeading(a[k]) && (shippedLine[k] || !a[k].trim())) k++;
      if (k < a.length && !isHeading(a[k])) out.push(a[i], "");
    }
  }
  const text = out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text: text ? `${text}\n` : "", kept };
}

/** The shipped body on top of CHANGELOG.md, in the same shape as the releases before it. */
export function prependChangelog(changelog, body) {
  return `${body.trimEnd()}\n\n${changelog.replace(/^\s+/, "")}`;
}

export function stampVersion(root, version) {
  const pkgPath = join(root, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
  pkg.version = version;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  const pyPath = join(root, "pyproject.toml");
  writeFileSync(pyPath, readFileSync(pyPath, "utf8").replace(/^version = ".+?"/m, `version = "${version}"`));
}

function git(...args) {
  const res = spawnSync("git", args, { encoding: "utf8" });
  if (res.status !== 0) throw new Error(`git ${args.join(" ")}: ${res.stderr}`);
  return res.stdout;
}

const tagList = () => git("tag", "--list", "v*").split("\n").filter(Boolean);

function readOr(path, fallback) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return fallback;
  }
}

function main([cmd, ...args]) {
  if (cmd === "body") {
    const [version, currentTag = `v${version}`] = args;
    const previousTag = previousStableTag(tagList(), version);
    process.stdout.write(renderBody({ version, currentTag, previousTag, highlights: readOr(NOTES_FILE, "") }));
  } else if (cmd === "beta-version") {
    const tags = tagList();
    const lastStable = previousStableTag(tags, null);
    const range = lastStable ? `${lastStable}..HEAD` : "HEAD";
    const commits = git("log", "--format=%s%x1f%b%x1e", range)
      .split("\x1e")
      .map((c) => c.trim())
      .filter(Boolean)
      .map((c) => {
        const [subject, body] = c.split("\x1f");
        return { subject, body };
      });
    const version = nextBetaVersion({ lastStable, commits, tags });
    if (!version) {
      console.error(`No feat, fix, perf, refactor or revert commit since ${lastStable}: nothing to release.`);
      process.exit(1);
    }
    process.stdout.write(version);
  } else if (cmd === "stamp") {
    stampVersion(process.cwd(), args[0]);
  } else if (cmd === "after-release") {
    const [shippedFile, bodyFile] = args;
    const { text, kept } = removeShipped(readOr(NOTES_FILE, ""), readFileSync(shippedFile, "utf8"));
    writeFileSync(NOTES_FILE, text);
    writeFileSync("CHANGELOG.md", prependChangelog(readOr("CHANGELOG.md", ""), readFileSync(bodyFile, "utf8")));
    process.stdout.write(String(kept));
  } else {
    console.error("usage: release-notes.mjs body|beta-version|stamp|after-release ...");
    process.exit(1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
