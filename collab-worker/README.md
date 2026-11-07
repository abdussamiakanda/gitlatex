# GitLaTeX collaboration relay

An optional, tiny server that lets a few people edit the same GitLaTeX project
in real time. It runs on Cloudflare (Workers + Durable Objects, free plan is
plenty for a handful of co-authors).

It only relays text. Every collaborator runs GitLaTeX on their own machine,
which writes the shared text to their own folder; compiling, committing and
pushing stay local.

```
 GitLaTeX (Ada) ──WebSocket──▶ Worker ─▶ Durable Object "thesis" ◀──WebSocket── GitLaTeX (Bob)
   saves, commits, compiles      (Yjs document: path → text,           saves, commits, compiles
   on Ada's machine               cursors, who is online)              on Bob's machine
```

## Deploy

You need a Cloudflare account and Node.js 22+.

```bash
cd collab-worker
npm install
npx wrangler login
npx wrangler secret put ROOM_TOKEN      # choose a long random string
npx wrangler deploy
```

`wrangler deploy` prints the address, e.g.
`https://gitlatex-collab.<you>.workers.dev`.

In GitLaTeX, open the project, click the **people** icon in the top bar, and
enter that address, a room name (everyone uses the same one), the token, and
your name. Send the room name and token to your co-authors.

## Run it locally

```bash
echo "ROOM_TOKEN=dev-secret" > .dev.vars
npx wrangler dev                         # ws://localhost:8787
```

Use `localhost:8787` as the server in GitLaTeX.

## API

All requests need `?token=<ROOM_TOKEN>`; anything else gets `401`.

| Request | What it does |
| --- | --- |
| `GET wss://<host>/parties/collab/<room>?token=…` | WebSocket speaking the [Yjs](https://yjs.dev) sync and awareness protocols. The document has one root map, `files`, from project-relative path to `Y.Text`. Awareness states carry `user: {name, color}` and `cursor: {path, anchor, head}` (Yjs relative positions). |
| `GET https://<host>/parties/collab/<room>?token=…` | JSON: `{ room, files: [{path, length}], peers: [name] }`, handy for checking a deployment. |

Any Yjs client can join a room, e.g. with `y-partyserver/provider`:

```ts
import * as Y from 'yjs';
import YProvider from 'y-partyserver/provider';

const doc = new Y.Doc();
const provider = new YProvider('gitlatex-collab.you.workers.dev', 'thesis', doc, {
  party: 'collab',
  params: { token: 'your-token' },
});
doc.getMap<Y.Text>('files').observeDeep(() => { /* … */ });
```

## How it behaves

- One Durable Object per room, so all edits to a room go through one place.
  Idle connections hibernate and cost nothing.
- The document is saved to the Durable Object's storage a couple of seconds
  after edits, so a room survives restarts and people can come and go.
- A room is created the first time someone joins it. To start a room over,
  use a new room name.
- There is one token per deployment: anyone who has it can join any room.
  Deploy a separate Worker (different `name` in `wrangler.toml`) for a group
  that should not see your rooms.
