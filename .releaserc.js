export default {
  branches: ["main"],
  tagFormat: "v${version}",
  plugins: [
    ["@semantic-release/commit-analyzer", {
      preset: "angular",
      releaseRules: [
        { type: "docs", scope: "README", release: "patch" },
        { type: "refactor", release: "patch" },
        { type: "style", release: "patch" },
      ],
    }],
    ["@semantic-release/release-notes-generator", { preset: "angular" }],
    ["@semantic-release/changelog", { changelogFile: "CHANGELOG.md" }],
    ["@semantic-release/npm", { npmPublish: false }],
    ["@semantic-release/exec", { prepareCmd: "sed -i 's/^version = \\\".*\\\"/version = \\\"${nextRelease.version}\\\"/' pyproject.toml" }],
    ["@semantic-release/git", { assets: ["CHANGELOG.md", "package.json", "pyproject.toml"], message: "chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}" }],
    ["@semantic-release/github", { successComment: false, assets: [{ path: "ComfyUI-Wildcard-Pipeline.zip", label: "ComfyUI-Wildcard-Pipeline.zip" }] }],
  ],
};
