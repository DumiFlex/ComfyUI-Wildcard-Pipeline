export default {
  branches: ["main"],
  plugins: [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    [
      "@semantic-release/changelog",
      { changelogFile: "CHANGELOG.md" },
    ],
    [
      "@semantic-release/exec",
      {
        prepareCmd:
          "node -e \"const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json'));p.version='${nextRelease.version}';fs.writeFileSync('package.json',JSON.stringify(p,null,2)+'\\n');const t=fs.readFileSync('pyproject.toml','utf8').replace(/^version = \\\".+?\\\"/m,'version = \\\"${nextRelease.version}\\\"');fs.writeFileSync('pyproject.toml',t);\"",
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
    "@semantic-release/github",
  ],
};
