// Copies the shared component kit (DumiFlex/wp-kit) into src/kit/.
//
//   node scripts/kit-pull.mjs v0.1.0   # pull a tag (or a branch / commit)
//   node scripts/kit-pull.mjs --check  # CI: fail when src/kit/ was edited by hand
//
// The kit lives in its own repo so the extension and the community site use
// the same pieces. src/kit/ is a copy of that repo's src/ at one commit;
// src/kit/kit.lock.json records the ref, the commit and a hash of every file.
// Change a kit piece in wp-kit, release it, then pull the new tag here.
//
// WP_KIT_REPO overrides the repo URL (a local path works too).

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Under Vitest import.meta.url is a /@fs/ URL; resolve from the file path.
const SELF = fileURLToPath(import.meta.url).replace(/^\/@fs/, "");
export const ROOT = resolve(dirname(SELF), "..");
export const KIT_DIR = join(ROOT, "src", "kit");
export const LOCK = "kit.lock.json";
const REPO = process.env.WP_KIT_REPO || "https://github.com/DumiFlex/wp-kit.git";

/** sha256 of every file under `dir` except the lock, keyed by `/` paths, sorted. */
export function hashTree(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else {
        const rel = relative(dir, p).split(sep).join("/");
        if (rel === LOCK) continue;
        // Hash with LF endings so a Windows checkout (autocrlf) matches.
        const text = readFileSync(p);
        const body = /\.(svg|css|ts|vue|mjs|js|json|md)$/.test(rel) ? Buffer.from(text.toString("utf8").replace(/\r\n/g, "\n")) : text;
        out[rel] = createHash("sha256").update(body).digest("hex");
      }
    }
  };
  walk(dir);
  return out;
}

/** Lines naming every file that was added, removed or changed since the pull. */
export function diffLock(locked, current) {
  const lines = [];
  for (const [f, h] of Object.entries(locked)) {
    if (!(f in current)) lines.push(`missing: ${f}`);
    else if (current[f] !== h) lines.push(`edited:  ${f}`);
  }
  for (const f of Object.keys(current)) if (!(f in locked)) lines.push(`added:   ${f}`);
  return lines;
}

function check() {
  const lockPath = join(KIT_DIR, LOCK);
  if (!existsSync(lockPath)) {
    console.error(`src/kit/${LOCK} is missing. Run: node scripts/kit-pull.mjs <tag>`);
    return 1;
  }
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const lines = diffLock(lock.files, hashTree(KIT_DIR));
  if (lines.length) {
    console.error(
      `src/kit/ no longer matches wp-kit ${lock.ref} (${lock.sha.slice(0, 7)}):\n  ${lines.join("\n  ")}\n` +
        "Kit pieces are changed in DumiFlex/wp-kit, then pulled here with node scripts/kit-pull.mjs <tag>.",
    );
    return 1;
  }
  console.info(`src/kit/ matches wp-kit ${lock.ref} (${lock.sha.slice(0, 7)}).`);
  return 0;
}

function pull(ref) {
  const tmp = mkdtempSync(join(tmpdir(), "wp-kit-"));
  try {
    const git = (...args) => execFileSync("git", args, { cwd: tmp, encoding: "utf8" }).trim();
    git("init", "-q");
    git("fetch", "-q", "--depth", "1", REPO, ref);
    git("-c", "advice.detachedHead=false", "checkout", "-q", "FETCH_HEAD");
    const sha = git("rev-parse", "HEAD");
    rmSync(KIT_DIR, { recursive: true, force: true });
    cpSync(join(tmp, "src"), KIT_DIR, { recursive: true });
    const lock = { repo: "DumiFlex/wp-kit", ref, sha, files: hashTree(KIT_DIR) };
    writeFileSync(join(KIT_DIR, LOCK), JSON.stringify(lock, null, 2) + "\n");
    console.info(`Pulled wp-kit ${ref} (${sha.slice(0, 7)}): ${Object.keys(lock.files).length} files in src/kit/.`);
    return 0;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: node scripts/kit-pull.mjs <tag|branch|commit> | --check");
    process.exit(2);
  }
  process.exit(arg === "--check" ? check() : pull(arg));
}
