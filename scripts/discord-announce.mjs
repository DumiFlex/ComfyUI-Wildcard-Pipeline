#!/usr/bin/env node
/**
 * Post a release announcement to Discord.
 *
 * Derives the message from the release notes that already exist — there is
 * nothing extra to write. Run by `.github/workflows/discord-announce.yml` when
 * a release is published, and runnable by hand for the catch-up case.
 *
 * Usage:
 *   node scripts/discord-announce.mjs --version v2.12.0            # dry run
 *   node scripts/discord-announce.mjs --version v2.12.0 --post
 *   node scripts/discord-announce.mjs --since v2.10.2 --post       # catch-up
 *   node scripts/discord-announce.mjs --notes-file docs/release-notes/next.md \
 *     --version v2.12.0                                            # preview
 *
 * DRY RUN IS THE DEFAULT. `--post` is required to send anything, so previewing
 * an announcement can never accidentally publish one.
 *
 * Environment:
 *   DISCORD_WEBHOOK_URL   required with --post
 *   DISCORD_ROLE_ID       optional; pinged as <@&ID>
 *   DISCORD_USERNAME      optional; overrides the posting name
 *   DISCORD_AVATAR_URL    optional; overrides the posting avatar (raster only)
 *   GITHUB_TOKEN          optional; raises the API rate limit for --since
 */
import { readFileSync } from "node:fs";
import { buildPayload, buildRollupPayload } from "./lib/discord-notes.mjs";

const REPO = "DumiFlex/ComfyUI-Wildcard-Pipeline";

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith("--") ? next : true;
}

function ghHeaders() {
  const h = { Accept: "application/vnd.github+json", "User-Agent": "wp-discord-announce" };
  if (process.env.GITHUB_TOKEN) h.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return h;
}

async function fetchRelease(tag) {
  const url = tag
    ? `https://api.github.com/repos/${REPO}/releases/tags/${tag}`
    : `https://api.github.com/repos/${REPO}/releases/latest`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (!res.ok) throw new Error(`GitHub ${res.status} fetching ${tag ?? "latest"}`);
  return res.json();
}

/** Releases newer than `sinceTag`, newest first. Drafts and prereleases skipped. */
async function fetchReleasesSince(sinceTag) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases?per_page=100`, {
    headers: ghHeaders(),
  });
  if (!res.ok) throw new Error(`GitHub ${res.status} listing releases`);
  const all = (await res.json()).filter((r) => !r.draft && !r.prerelease);
  const idx = all.findIndex((r) => r.tag_name === sinceTag);
  if (idx === -1) throw new Error(`No release tagged ${sinceTag}`);
  return all.slice(0, idx);
}

async function main() {
  const post = arg("post", false) === true;
  const roleId = process.env.DISCORD_ROLE_ID || undefined;
  // Undefined falls through to the defaults in discord-notes.mjs — an empty
  // env var must not blank the identity and hand the post back to the
  // webhook's own name.
  const username = process.env.DISCORD_USERNAME || undefined;
  const avatarUrl = process.env.DISCORD_AVATAR_URL || undefined;
  const since = arg("since");
  const notesFile = arg("notes-file");
  let version = arg("version");

  let payload;

  if (typeof since === "string") {
    const releases = await fetchReleasesSince(since);
    if (!releases.length) {
      console.error(`Nothing published after ${since} — nothing to announce.`);
      process.exit(0);
    }
    payload = buildRollupPayload({
      releases: releases.map((r) => ({ version: r.tag_name, body: r.body ?? "" })),
      sinceVersion: since,
      releaseUrl: releases[0].html_url,
      roleId,
      username,
      avatarUrl,
    });
  } else if (typeof notesFile === "string") {
    // Local preview against unreleased notes. No network, so the compare link
    // is unknown and simply omitted.
    payload = buildPayload({
      version: version || "(unreleased)",
      body: readFileSync(notesFile, "utf8"),
      roleId,
      username,
      avatarUrl,
    });
  } else {
    const rel = await fetchRelease(typeof version === "string" ? version : undefined);
    version = rel.tag_name;
    payload = buildPayload({
      version,
      body: rel.body ?? "",
      releaseUrl: rel.html_url,
      roleId,
      username,
      avatarUrl,
    });
  }

  if (!post) {
    console.log("--- DRY RUN (pass --post to send) ---\n");
    // Identity is part of what a preview is for: it is the thing that was
    // wrong on the first real post, and it is invisible in the embed body.
    console.log(`posting as: ${payload.username}`);
    console.log(`avatar:     ${payload.avatar_url}`);
    console.log("");
    console.log(payload.embeds[0].title);
    console.log("-".repeat(60));
    console.log(payload.embeds[0].description);
    console.log("-".repeat(60));
    console.log(`${payload.embeds[0].description.length} / 4096 chars`);
    return;
  }

  const webhook = process.env.DISCORD_WEBHOOK_URL;
  if (!webhook) {
    console.error("DISCORD_WEBHOOK_URL is not set — refusing to post.");
    process.exit(1);
  }

  const res = await fetch(`${webhook}?wait=true`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.error(`Discord ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  console.log(`Announced ${payload.embeds[0].title}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
