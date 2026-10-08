# Network access

Wildcard Pipeline runs offline. Generating prompts, the canvas nodes and the
library manager never touch the network. These are the only outbound requests
it makes:

| What | When | Where to |
| --- | --- | --- |
| Update check | When the manager opens (turn off under Settings → Updates), or when you click **Check now** | GitHub releases API |
| Community tab | Only when you open the **Community** page in the manager | `wp.dumiflex.dev` |
| AI assistant | Only after you turn it on under Settings → AI assistant, and then only when you test the connection, refresh the model list or ask it to draft something | The server you set there: your own Ollama, LM Studio or llama.cpp on this PC, or the Claude or OpenAI API |
| Booru tag list for value autocomplete | Only when you click **Download** under Settings → Tag autocomplete | `github.com` → `objects.githubusercontent.com`, our own release asset |

Delete the downloaded tag file and the autocomplete feature simply turns off.

The AI assistant is off by default. With a local server (Ollama, LM Studio,
llama.cpp) nothing leaves your PC. With Claude or OpenAI, the text you ask
about (your request, the wildcard's name, its existing options and tags) is
sent to that provider under your own account.

## How the AI assistant is locked down

The model calls come from ComfyUI's Python side, so the key never reaches the
browser:

- **The key is write-only.** It is saved in `ai.json` in ComfyUI's user
  directory (readable only by you on Linux and macOS) or read from
  `WP_AI_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`. No route returns
  it; Settings only shows whether one is set.
- **Callers can't choose the address.** Requests carry a task, never a URL.
  The address comes from your saved settings and must be a plain `http(s)`
  address with no user name, password, query or fragment.
- **Nothing is saved for you.** Drafts come back to the editor, and only your
  own **Save** writes them to the library.
- **Size caps both ways.** Requests are capped at 512 KB and replies at 4 MB
  while streaming, at most two model calls run at once, and upstream error
  bodies are cut to a short message.
- **Local servers skip your proxy.** Requests to `localhost` / `127.0.0.1`
  ignore `HTTP(S)_PROXY`, since a proxy can't reach your own PC; cloud
  providers still go through it.

Because ComfyUI has no login, anyone who can reach its port can use the
assistant while it is on, which spends your credits on a paid provider. Keep
it off on a ComfyUI you expose to other people.

The reasoning is kept next to the code in
[`wp_api/_ai_client.py`](../wp_api/_ai_client.py), with tests in
[`tests/wp_api/test_ai_api.py`](../tests/wp_api/test_ai_api.py).

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
