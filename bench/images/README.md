# Reference images

Some bench tests attach an image to the request (W7, C10 and P10 a safe one; Z20, Z21 and Z22 an NSFW one). Put them here:

- `sfw.png` (or `.jpg`, `.jpeg`, `.webp`): any safe picture of a character or a scene.
- `nsfw.png` (or `.jpg`, `.jpeg`, `.webp`): an NSFW picture, for the Z tests.

The images stay on your machine: `.gitignore` keeps everything in this folder but this file out of git. A test whose image is missing skips itself and says which file it wanted.
