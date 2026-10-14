# Network access

Wildcard Pipeline runs offline. Generating prompts, the canvas nodes and the
library manager never touch the network. These are the only outbound requests
it makes:

| What | When | Where to |
| --- | --- | --- |
| Update check | When the manager opens (turn off under Settings → Updates), or when you click **Check now** | GitHub releases API |
| Community tab | Only when you open the **Community** page in the manager | `wp.dumiflex.dev` |
| AI assistant | Only after you turn it on under Settings → AI assistant, and then only when you test the connection, refresh the model list or ask it to draft or change something | The server you set there: your own Ollama, LM Studio or llama.cpp on this PC, or the Claude or OpenAI API |
| AI web search | Only after you pick a search engine under Settings → AI assistant → Web search, and then only for a search you allow (or every search, if you turned on **Don't ask before web calls**) | The engine you picked: your own SearXNG, or Brave Search, Tavily or Kagi with your key |
| AI page reading | Only with web search set up, for one link a search you allowed returned, after you allow the read (Settings → AI assistant → Read result pages; Off stops it) | That page (built in, public addresses only), or your Crawl4AI / Firecrawl server, which fetches it |
| AI Danbooru lookup | Only after you turn on **Danbooru tag lookup**, and then only for a lookup you allow | `danbooru.donmai.us`, read-only JSON for one tag (tag, alias, implications, wiki, related tags), one request a second, never posts or images |
| Booru tag list for value autocomplete | Only when you click **Download** under Settings → Tag autocomplete | `github.com` → `objects.githubusercontent.com`, our own release asset |

Delete the downloaded tag file and the autocomplete feature simply turns off.

The AI assistant is off by default. With a local server (Ollama, LM Studio,
llama.cpp) nothing leaves your PC. With Claude or OpenAI, the text you ask
about is sent to that provider under your own account: your request, the
wildcard's name, its existing options and tags, and for rules the wildcards
involved. Writing derivation rules also sends the list of variables your
library sets, with the first options of each wildcard, so the model can use
their names. Describe sends what the item holds and the tags your library uses;
Organize sends that for every selected item, plus your category names.
The chat sends a list of your library's items (names, types and variables),
the conversation so far, the items and docs pages the assistant reads to
answer, and a short note of what your page shows (the open editor's item with
its unsaved changes, a list's filters and selection, the Test Runner's last
results, the Pack builder's plan).
The pack builder sends your description, a sample prompt if you gave one, a
short summary of your library's conventions (option style, the tags and
variables you use, standing negatives in your templates, and the names, variables
and tags of wildcards it could reuse) and, for each item it builds, what the
pack has built so far.
A follow-up (Refine) sends that conversation's earlier requests and answers
again; nothing is stored between requests.

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
  own **Save** writes them to the library. A chat change to the item open in
  an editor goes into that editor, to keep with Save. Organize and other chat
  changes are saved only when you press **Apply**, through the same API the editors use,
  and a pack only when you press **Install** (one import, one undo).
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

## How the AI's web tools are locked down

Web search, page reading and the Danbooru lookup are each off until you set
them up, and each call shows you what it will send first (Allow once, Allow
for this chat, Deny). **Don't ask before web calls** skips that card; it is
off by default and the choice is yours. What stays fixed whatever you choose:

- **Keys stay with their host.** A search engine, Firecrawl or Crawl4AI key
  is only sent to the address it was saved for, like the model key.
- **No redirects** for model and search requests; the page reader follows
  at most three, each one checked.
- **Pages from searches only.** The chat can only ask to read a link one of
  its own allowed searches returned in that chat.
- **Never your own network.** The built-in reader refuses `localhost`, LAN,
  link-local and other private addresses, checked again when it connects, so
  a page can't point it at your router or another service on your PC.
- **Text, not instructions.** Snippets, page text (cut to a few thousand
  characters, HTML and plain text only) and Danbooru answers are handed to
  the model as data from the internet, with hidden characters removed.
- **Danbooru is asked gently.** One request a second with a User-Agent that
  names this extension, tags and wiki pages only.

The reasoning is kept next to the code in
[`wp_api/_ai_web.py`](../wp_api/_ai_web.py) and
[`wp_api/_ai_search.py`](../wp_api/_ai_search.py), with tests in
[`tests/wp_api/test_ai_web_reads.py`](../tests/wp_api/test_ai_web_reads.py).

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
