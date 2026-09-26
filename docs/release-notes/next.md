### Fixes

- **What's new shows the release you are running.** After an update, the page could keep showing the notes of an older release for a few hours ("Release notes for v2.15.3 — you are running v2.17.0"), because it trusted a release check cached before the update. It now headlines the newest release it knows about, and a cached check older than your version is fetched again.
