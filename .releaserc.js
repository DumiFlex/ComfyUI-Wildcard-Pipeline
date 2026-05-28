/**
 * semantic-release config.
 *
 * Two non-default behaviours that matter for release-notes readability:
 *
 *   1. Use the `conventionalcommits` preset (not the default `angular`).
 *      Lets us configure per-type rendering via `presetConfig.types`.
 *
 *   2. Hide every type that isn't a user-facing change. `feat`, `fix`,
 *      `perf`, `refactor` render in the GitHub release notes;
 *      `chore`, `docs`, `style`, `test`, `build`, `ci`, `revert` are
 *      marked `hidden: true` so they don't clutter the changelog
 *      (commits still count for version bumps via the commit-analyzer
 *      `releaseRules` below).
 *
 * Without these the angular preset rendered EVERY conventional commit
 * since the last tag — 1000+ entries for v1.8.0. With the filter the
 * notes shrink to just the meaningful changes (typically <50 entries
 * per release).
 */
export default {
  branches: ["main"],
  plugins: [
    [
      "@semantic-release/commit-analyzer",
      {
        preset: "conventionalcommits",
        releaseRules: [
          { type: "feat", release: "minor" },
          { type: "fix", release: "patch" },
          { type: "perf", release: "patch" },
          { type: "refactor", release: "patch" },
          { type: "revert", release: "patch" },
          // `docs(readme)` is user-facing — bump patch so the new
          // install instructions / quick-start trigger a release.
          // Other docs scopes (in-app help, internal design docs)
          // don't move the needle.
          { type: "docs", scope: "readme", release: "patch" },
          { type: "docs", release: false },
          { type: "style", release: false },
          { type: "test", release: false },
          { type: "build", release: false },
          { type: "ci", release: false },
          { type: "chore", release: false },
        ],
      },
    ],
    [
      "@semantic-release/release-notes-generator",
      {
        preset: "conventionalcommits",
        presetConfig: {
          // Section labels rendered in the GitHub release body +
          // CHANGELOG.md. The emoji prefixes scan well on the GitHub
          // release page where each section becomes a collapsible
          // heading.
          types: [
            { type: "feat",     section: "✨ Features" },
            { type: "fix",      section: "🐛 Bug Fixes" },
            { type: "perf",     section: "⚡ Performance" },
            { type: "refactor", section: "♻️ Refactoring" },
            { type: "revert",   section: "⏪ Reverts" },
            { type: "docs",     hidden: true },
            { type: "style",    hidden: true },
            { type: "test",     hidden: true },
            { type: "build",    hidden: true },
            { type: "ci",       hidden: true },
            { type: "chore",    hidden: true },
          ],
        },
      },
    ],
    [
      "@semantic-release/changelog",
      { changelogFile: "CHANGELOG.md" },
    ],
    [
      "@semantic-release/exec",
      {
        // 1. Stamp version into package.json + pyproject.toml.
        // 2. Pack the deployable file set into a zip so the
        //    @semantic-release/github plugin can attach it to the
        //    release. Zip is built AFTER versioning so the file lands
        //    with the right version in its name.
        prepareCmd:
          "node -e \"const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json'));p.version='${nextRelease.version}';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\\n');const t=fs.readFileSync('pyproject.toml','utf8').replace(/^version = \\\".+?\\\"/m,'version = \\\"${nextRelease.version}\\\"');fs.writeFileSync('pyproject.toml',t);\" && node scripts/pack-release.mjs ${nextRelease.version}",
      },
    ],
    [
      "@semantic-release/git",
      {
        assets: ["CHANGELOG.md", "package.json", "pyproject.toml"],
        message:
          "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}",
      },
    ],
    [
      "@semantic-release/github",
      {
        // Attach the deployable zip + its sha256 to the GitHub release
        // page so manual installers can grab a single artifact instead
        // of cloning the whole repo at a specific tag.
        assets: [
          {
            path: "dist/ComfyUI-Wildcard-Pipeline-v*.zip",
            label: "ComfyUI-Wildcard-Pipeline-v${nextRelease.version}.zip",
          },
        ],
      },
    ],
  ],
};
