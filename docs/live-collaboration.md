# Live collaboration

GitLaTeX can let a few people (3–5 is the sweet spot) edit the same project in
real time, with shared cursors like Overleaf, while everyone keeps their own
folder and their own Git.

It is **optional and off by default for every project**. Nothing changes for
projects you don't share.

```
 GitLaTeX (Ada) ──WebSocket──▶ Cloudflare Worker ─▶ Durable Object "thesis" ◀──WebSocket── GitLaTeX (Bob)
   saves, commits, compiles                          (shared text, cursors,                 saves, commits, compiles
   on Ada's machine                                   who is online)                        on Bob's machine
```

Cloudflare only relays the text. Each person's GitLaTeX writes the shared text
to their own disk, and compiling, committing and pushing to GitHub happen
locally, exactly as before.

---

## Setting it up

There are two roles:

- **The owner** deploys the relay once and picks an **admin token** that only
  they know. For each project they want to share, they create a **room**; the
  relay generates that room's own token, and the owner sends co-authors an
  **invite**.
- **Co-authors** paste the invite into their copy of the project. They never
  see the admin token, and an invite only opens the project it was made for.

Everyone appears under their **git `user.name`**, the same name their commits
and review comments use.

### 1. Deploy the relay (the owner, once, in the browser)

The relay is a small Cloudflare Worker that lives in its own repository,
[gitlatex-collab](https://github.com/abdussamiakanda/gitlatex-collab). You
need a Cloudflare account (the free plan is enough) and a GitHub account, but
nothing to install and no terminal. The same steps are in GitLaTeX under
**Live collaboration → Host** and **Settings → Collaboration**, with a button
that generates the admin token for you.

1. **Connect GitHub to Cloudflare first.** In the
   [Cloudflare dashboard](https://dash.cloudflare.com/?to=/:account/workers-and-pages/create),
   go to **Workers & Pages → Create application → Connect to Git**, click
   **+ Add account**, and **Install & Authorize** the *Cloudflare Workers and
   Pages* GitHub app. Once your GitHub account is listed, you can leave that
   page.
2. **Generate an admin token**: a long random string that only you know. In
   GitLaTeX, **Generate admin token** makes one and copies it; a password
   manager works too.
3. **Click Deploy to Cloudflare**, paste the token as **ADMIN_TOKEN**, and click
   **Create and deploy**. Cloudflare copies the relay into your GitHub account
   and builds it, which takes a minute or two.

   [![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/abdussamiakanda/gitlatex-collab)

4. **Turn on the workers.dev address.** When the deploy has finished, open
   **Workers & Pages**, select the Worker (`gitlatex-collab` unless you renamed
   it), go to **Settings → Domains & Routes**, and enable **workers.dev**. The
   address it shows, e.g. `https://gitlatex-collab.<your-subdomain>.workers.dev`,
   is your relay.

To change the admin token later: the Worker's **Settings → Variables and
Secrets**.

### 2. Host a project (the owner)

1. Open the project and click **Live collaboration** (the people icon) in the
   left sidebar, then **Host**.
2. Enter the relay address (the workers.dev address from step 1) and your
   admin token, and click **Connect**. They are remembered in this browser for
   every project; you can also sign in or out under **Settings →
   Collaboration**.
3. The room name defaults to the project's name (lower-case, with anything
   other than letters, digits, `.`, `_` and `-` turned into `-`). Click
   **Create room & go live**.
4. Copy the **invite** from the panel and send it to your co-authors.

The panel shows this project's room; **Settings → Collaboration** lists
every room on your relay. For each one you can copy its invite again,
**issue a new token** (everyone in the room is disconnected and the old invite
stops working), or **delete** it (its shared text is removed from the relay;
everyone's files stay on disk).

### 3. Join (co-authors)

1. Open your copy of the project, usually cloned from the same GitHub
   repository.
2. Click **Live collaboration** in the left sidebar → **Join**, paste the
   invite, and click **Join**.

From then on the project reconnects automatically whenever it's opened. While
others are online, their avatars show in the top bar; the **Live
collaboration** panel shows who is editing which file, the invite (to bring in
someone else), your cursor colour, and **Stop sharing this project**. You can
also change your cursor colour under **Settings → Collaboration**.

### Trying it locally

To run the relay on your own machine instead (needs Node.js 22+):

```bash
git clone https://github.com/abdussamiakanda/gitlatex-collab.git
cd gitlatex-collab
npm install
echo "ADMIN_TOKEN=dev-admin" > .dev.vars
npx wrangler dev                         # serves on localhost:8787
```

Use `localhost:8787` as the relay address in GitLaTeX.

---

## How it behaves

| | |
| --- | --- |
| **Per project** | Each project is shared on its own. Opening another project disconnects; reopening the shared one reconnects. The setting is stored in your browser and follows the project if you rename it. |
| **What is shared** | The text files of the project: `.tex`, `.bib`, `.sty`, etc. Edits, new files, renames and deletions reach everyone. |
| **What is not shared** | Binary files (images, PDFs), TeX build output (`.aux`, `.log`, …), and Git itself. Share images through Git as usual. |
| **Cursors** | Everyone's cursor and selection show in their colour with their git `user.name`. Without a `user.name` you appear as "Anonymous". |
| **Offline** | If the connection drops, keep typing. Edits are merged when it comes back. After a few failed attempts a warning appears; GitLaTeX keeps retrying. |
| **Saving** | Each person's GitLaTeX writes the shared text to their own folder, just like normal editing. |
| **Stopping** | **Stop sharing this project** (or closing the project) only disconnects. Your files keep the room's latest text; nothing goes back to an earlier version. |
| **Comments** | Review comments are not relayed. They live in `.gitlatex/comments/` and are shared through Git, as without live collaboration. |

### Rules to agree on

1. **The first time you join a room on a machine, the room wins.** If your
   copy of a file differs from the room's, yours is replaced by the room's
   version. Files only you have are added to the room. **Commit first** if you
   want to keep your local version.
2. **When you rejoin, your work is merged in.** GitLaTeX remembers each file's
   text as of the last time you were in the room (in this browser). On
   rejoining, it compares that with your copy and the room's, the way Git
   merges: what only you changed goes into the room, what only others changed
   comes to you, and changes to different lines are both kept. **Where you and
   the room changed the same lines (or neighbouring lines), the room's version
   is kept**, and a message names those files. Files you deleted while away
   are deleted from the room unless someone edited them meanwhile, and files
   others deleted are deleted from your copy unless you edited them.
3. **Let one person pull during a session.** A pull changes files on that
   person's disk, and those changes then reach everyone through the room. The
   others' files will show as modified until they pull too, and then they're
   clean again.
4. **Commit from anywhere.** Everyone's files are identical, so anyone can
   commit and push. Agree on who does, or commit often.
5. **Keep the admin token to yourself.** Co-authors only need invites. If an
   invite leaks, issue a new token for that room and send the new invite to
   the people who should keep editing.

To start a room fresh, delete it and host the project again.

---

## Cost

The relay runs on Cloudflare Workers and Durable Objects. On the **free plan**
you can never be charged. A small group (3–5 people) should stay well within
its daily limits.

### Prices

Figures from Cloudflare's docs as of October 2026. Check the
[Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/)
and [Workers](https://developers.cloudflare.com/workers/platform/pricing/)
pricing pages for current numbers.

| | Free | Paid ($5/month Workers plan) |
| --- | --- | --- |
| Worker requests | 100,000 / day | 10 million / month, then $0.30 per million |
| Worker CPU time | 10 ms per request | 30 million ms / month, then $0.02 per million ms |
| Durable Object requests | 100,000 / day | 1 million / month, then $0.15 per million |
| Durable Object duration (time it is awake) | 13,000 GB-s / day | 400,000 GB-s / month, then $12.50 per million GB-s |
| Storage rows read | 5 million / day | 25 billion / month included |
| Storage rows written | 100,000 / day | 50 million / month, then $1.00 per million |
| Stored data | 5 GB total | 5 GB-month, then $0.20 per GB-month |

Three details matter for this setup:

- **Messages are discounted 20:1.** Each keystroke is a WebSocket message sent
  to the Durable Object, but 20 incoming messages count as 1 billed request.
  Messages the Durable Object sends out are not billed.
- **The Worker is only used at connect time.** A Worker request is counted when
  someone connects or reconnects, for the JSON status endpoint, and for the
  owner's room management. Each connection also asks the registry Durable
  Object for the room's token, which is one more Durable Object request.
  Everything after that goes to the room's Durable Object.
- **Idle rooms don't use duration.** The relay enables hibernation, and
  Cloudflare doesn't bill duration while a room hibernates. `y-partyserver`
  stops its server-side timer so the room can actually hibernate.

### Rough estimate: 5 people writing 4 hours a day

These are estimates, not measurements.

| Usage | Approx. per day | Free limit | Share of limit |
| --- | --- | --- | --- |
| Edit and cursor messages: about 144,000, billed at 20:1 | ~7,200 requests | 100,000 | ~7% |
| Presence heartbeats (each client every ~15 s while connected) | ~500 requests | — | small |
| Worker requests (connects and reconnects), and the token check each one makes | a few dozen | 100,000 | ~0% |
| Room saves: at most one every 2–10 s while typing, about 2–5 rows each | ~10,000 rows | 100,000 | ~10% |
| Duration, worst case of a room awake all day | ≤ 10,800 GB-s | 13,000 | under the limit |

You would need roughly 10× this usage to reach a limit. The most likely way is
many rooms kept open around the clock, which uses up the duration allowance.

### What happens when a free limit runs out

Cloudflare's rule is that "further operations of that type will fail with an
error", until the limits reset at **00:00 UTC**.

| Limit reached | Effect |
| --- | --- |
| Worker requests | New connections get Cloudflare error 1027. Live editing in GitLaTeX stops. |
| Durable Object requests or duration | The room stops answering. The Live collaboration panel shows "Offline, retrying", and after three failed attempts a warning appears. |
| Rows written | Live editing keeps working, but the room stops saving to storage. If the room restarts before the reset, it comes back empty. The next client to connect re-uploads the full document, so nothing is lost. |

You don't lose work in any of these cases, because each person's GitLaTeX
keeps writing to their own disk. While offline:

- Keep typing; you can still save, commit and push.
- Edits made offline are merged when the connection comes back after the reset.
- If two people edit the same files while disconnected, their changes are
  combined automatically when they reconnect, so expect some cleanup if both
  rewrote the same paragraph.

### On the paid plan

The $5/month plan has no daily cutoff: you pay for usage beyond the monthly
allowance. A group of 5 would fit inside the allowance, so the bill would stay
at $5. There is no hard spending cap that we know of, so rely on Cloudflare's
usage notifications. Stay on the free plan if you never want a bill.

---

## The API

The relay speaks the standard [Yjs](https://yjs.dev) protocols, so any Yjs
client can join a room. There are two kinds of token: the owner's **admin
token** (`ADMIN_TOKEN`), which manages rooms and opens any of them, and each
room's own **room token**, which opens only that room. Anything else gets
`401 Unauthorized`.

Rooms (`token` = the room's token, or the admin token):

| Request | What it does |
| --- | --- |
| `wss://<host>/parties/collab/<room>?token=…` | WebSocket for Yjs sync and awareness. |
| `GET https://<host>/parties/collab/<room>?token=…` | JSON summary: `{ room, files: [{ path, length }], peers: [name] }`. Handy for checking a deployment. |

Owner (`Authorization: Bearer <ADMIN_TOKEN>`):

| Request | What it does |
| --- | --- |
| `GET /admin/rooms` | `{ rooms: [{ room, token, createdAt }] }` |
| `POST /admin/rooms/<room>` | Creates the room with a fresh token, or returns the existing one (`created` says which). |
| `POST /admin/rooms/<room>/token` | Gives the room a new token and disconnects everyone in it. |
| `DELETE /admin/rooms/<room>` | Deletes the room, its token and its shared text, and disconnects everyone. |

**Invites** are `gitlatex-invite:` followed by base64url JSON
`{ "h": host, "r": room, "t": room token }`.

**Document shape:** one root map, `files`, from project-relative path to
`Y.Text`.

**Awareness (presence):** each client publishes
`user: { name, color }` and `cursor: { path, anchor, head }`, where `anchor`
and `head` are Yjs relative positions in that file's `Y.Text`.

Example client:

```ts
import * as Y from 'yjs';
import YProvider from 'y-partyserver/provider';

const doc = new Y.Doc();
const provider = new YProvider('gitlatex-collab.you.workers.dev', 'thesis', doc, {
  party: 'collab',
  params: { token: 'your-token' },
});
provider.on('sync', (synced: boolean) => {
  if (synced) console.log(doc.getMap<Y.Text>('files').get('main.tex')?.toString());
});
```

---

## How it's built

### Relay: [gitlatex-collab](https://github.com/abdussamiakanda/gitlatex-collab)

The relay is a separate repository, so the GitLaTeX package doesn't ship it.

| File | What it does |
| --- | --- |
| `src/index.ts` | The Worker. Serves the owner's `/admin` API, checks a room's token against the `Registry` Durable Object (which holds the rooms and their tokens), then routes each room to its own Durable Object (`Collab`, built on `y-partyserver`). That object holds the room's Yjs document, relays updates and presence, saves the document to Durable Object storage a couple of seconds after edits (in chunks, so large projects fit), and loads it again after a restart. Idle connections hibernate. |
| `wrangler.toml` | The Worker and its two SQLite-backed Durable Object classes. |
| `.dev.vars.example`, `package.json` (`cloudflare.bindings`) | Make the Deploy button ask for `ADMIN_TOKEN`, with a description. |

### Editor: `web/src/collab/`

| File | What it does |
| --- | --- |
| `config.ts` | Per-project settings (on/off, server, room, room token), your cursor colour, the owner's admin login, and invite encoding, all in `localStorage`. |
| `admin.ts` | The owner's calls to the relay: list, create, re-token and delete rooms. |
| `session.ts` | One live session for the open project. On joining, it merges the file sets and takes the room's text. After that it mirrors local changes into the room and the room's changes into the Workspace, and so onto disk. It also tracks who is online. |
| `binding.ts` | Two-way binding between a Monaco model and a `Y.Text`. Remote edits are applied as one batch so your cursor stays put. It also draws other people's cursors and selections. |
| `merge.ts` | The rejoin merge: a line-based three-way merge (`node-diff3`) where the room wins overlapping changes, and `applyText`, which writes a new text into a `Y.Text` as the smallest edits (`fast-diff`) so concurrent edits elsewhere survive. |
| `base.ts` | Each room's text as of the last time this browser was in sync with it, in IndexedDB. Updated while connected and in sync, and when you stop sharing; cleared when the owner deletes the room. |

Small hooks into existing code:

- `editor/models.ts` (`watchModels`): tells the session when an editor model is opened or closed, so open files are bound live.
- `state/actions.ts`:
  - `joinCollab`, `leaveCollab`, and for the owner `hostCollab`, `rotateCollabRoom` and `deleteCollabRoom`.
  - `gitIdentity`: your git `user.name` (from `/review/me`, the same identity review comments use).
  - Connects when a project opens and disconnects when it closes.
  - Moves the setting when a project is renamed and removes it when the project is deleted.
- `state/store.ts`: `collab` state (status, room, you, peers) and the `collab` sidebar view.
- `components/CollabPanel.tsx` (the sidebar panel: Join, Host, your rooms, who is online), `components/TopBar.tsx` (`OnlinePeers`, shown only while others are online), `components/Sidebar.tsx`, and a command palette entry.
- `index.css`: styles for remote carets and their name labels.

---

## Tests

- **Unit tests:** `web/tests/unit/collab-config.test.ts` covers room names,
  server address parsing, per-project settings, and invites;
  `web/tests/unit/collab-merge.test.ts` covers the rejoin merge.
- **End to end:** `web/tests/e2e/collab.mjs` runs two separate GitLaTeX servers
  with separate folders on disk through one room:

  ```bash
  # in a clone of gitlatex-collab, after npm install:
  echo ADMIN_TOKEN=test-admin > .dev.vars && npx wrangler dev --port 8787
  gitlatex --no-browser --port 5101 --repos /tmp/gl-a
  gitlatex --no-browser --port 5102 --repos /tmp/gl-b
  cd web && npm run e2e:collab -- http://127.0.0.1:5101 /tmp/gl-a http://127.0.0.1:5102 /tmp/gl-b localhost:8787 test-admin
  ```

  The `gitlatex` servers serve the built UI, so run `npm run build` in `web/`
  first. The test makes each project a git repository whose `user.name` is Ada or
  Bob. It checks that:
  - projects are unshared until asked;
  - the owner can create a room and get an invite, and appears under her git name;
  - an invite with a wrong token is refused, and the real one joins;
  - the room wins on join;
  - files only one side has are merged;
  - typing reaches the other editor;
  - simultaneous typing converges to the same text on both disks;
  - cursors are visible;
  - file creation and deletion travel;
  - another project opens unshared;
  - the shared project reconnects when reopened;
  - stopping sharing works, and the files keep the room's text;
  - rejoining after both sides edited keeps both edits, and the room wins the
    line both changed.

---

## Limits

- Made for small groups. Every edit to a room goes through one Durable Object,
  which is plenty for a handful of people typing.
- Undo (`Cmd/Ctrl+Z`) is Monaco's own and can behave oddly right after someone
  else edited nearby.
- Review comments (`.gitlatex/comments/`) are shared through Git, not live.
