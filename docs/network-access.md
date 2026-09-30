# Network access

Wildcard Pipeline runs offline. Generating prompts, the canvas nodes and the
library manager never touch the network. These are the only outbound requests
it makes:

| What | When | Where to |
| --- | --- | --- |
| Update check | When the manager opens (turn off under Settings → Updates), or when you click **Check now** | GitHub releases API |
| Community tab | Only when you open the **Community** page in the manager | `wp.dumiflex.dev` |
| Booru tag list for value autocomplete | Only when you click **Download** under Settings → Tag autocomplete | `github.com` → `objects.githubusercontent.com`, our own release asset |

Delete the downloaded tag file and the autocomplete feature simply turns off.

## How the tag-list download is locked down

ComfyUI serves its API without authentication, so the download endpoint is
built with nothing a caller can steer:

- **The URL is a constant.** There is no URL parameter (the request body is
  ignored), so it cannot be pointed at your internal network or a cloud
  metadata address.
- **Redirects are checked at every hop** against a fixed host list, because
  GitHub serves release assets via a CDN. A redirect anywhere else is refused
  mid-chain.
- **The destination is computed server-side** from ComfyUI's user directory
  plus a fixed filename. No caller input reaches the path, and a symlink
  sitting at that path is refused rather than followed.
- **The response is size-capped while streaming**, so a hostile or corrupted
  reply cannot fill your disk. `Content-Length` is checked but never trusted
  alone.
- **One download at a time**, so the endpoint cannot be used to start many
  large fetches at once.
- **The file is parsed before it replaces anything.** A reply that is not a
  readable tag list leaves your existing one untouched, and the final move is
  atomic.

The reasoning is kept next to the code in
[`wp_api/_tag_download.py`](../wp_api/_tag_download.py), and each restriction
has a test in
[`tests/wp_api/test_tag_download.py`](../tests/wp_api/test_tag_download.py).
