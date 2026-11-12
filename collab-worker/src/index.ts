/**
 * GitLaTeX live collaboration relay.
 *
 * One Durable Object per room holds the shared Yjs document of a project and
 * relays edits and cursors between everyone connected to it. It never sees
 * the Git repository: each collaborator saves, commits and compiles on their
 * own machine.
 *
 *   wss://<worker>/parties/collab/<room>?token=…   Yjs sync + awareness
 *   GET https://<worker>/parties/collab/<room>?token=…   { files, peers }
 *
 * The document has one root map, `files`: path → Y.Text.
 */
import { routePartykitRequest } from 'partyserver';
import { YServer } from 'y-partyserver';
import * as Y from 'yjs';

export interface Env {
  Collab: DurableObjectNamespace<Collab>;
  /** Shared secret every collaborator enters in GitLaTeX (`wrangler secret put ROOM_TOKEN`). */
  ROOM_TOKEN: string;
}

/** Durable Object storage values are capped, so the document is stored in chunks. */
const CHUNK = 512 * 1024;

export class Collab extends YServer<Env> {
  static options = { hibernate: true };
  static callbackOptions = { debounceWait: 2000, debounceMaxWait: 10000 };

  async onLoad() {
    const count = await this.ctx.storage.get<number>('doc:chunks');
    if (!count) return;
    const keys = Array.from({ length: count }, (_, i) => `doc:${i}`);
    const parts = await this.ctx.storage.get<Uint8Array>(keys);
    const total = keys.reduce((n, k) => n + (parts.get(k)?.length ?? 0), 0);
    const update = new Uint8Array(total);
    let at = 0;
    for (const k of keys) {
      const part = parts.get(k);
      if (!part) return; // incomplete write: start empty rather than corrupt
      update.set(part, at);
      at += part.length;
    }
    Y.applyUpdate(this.document, update);
  }

  async onSave() {
    const update = Y.encodeStateAsUpdate(this.document);
    const entries: Record<string, Uint8Array | number> = {};
    let count = 0;
    for (let at = 0; at < update.length; at += CHUNK) entries[`doc:${count++}`] = update.slice(at, at + CHUNK);
    entries['doc:chunks'] = count;
    const old = (await this.ctx.storage.get<number>('doc:chunks')) ?? 0;
    await this.ctx.storage.put(entries);
    if (old > count) await this.ctx.storage.delete(Array.from({ length: old - count }, (_, i) => `doc:${count + i}`));
  }

  /** Plain HTTP: what is in the room (handy for checking a deployment). */
  async onRequest(): Promise<Response> {
    const files = [...this.document.getMap<Y.Text>('files').entries()].map(([path, text]) => ({ path, length: text.length }));
    const peers = [...this.document.awareness.getStates().values()]
      .map((s) => (s as { user?: { name?: string } }).user?.name)
      .filter(Boolean);
    return Response.json({ room: this.name, files: files.sort((a, b) => a.path.localeCompare(b.path)), peers });
  }

}

function authorised(req: Request, env: Env) {
  const token = new URL(req.url).searchParams.get('token') ?? '';
  if (!env.ROOM_TOKEN) return false;
  // Length-independent comparison.
  const a = new TextEncoder().encode(token);
  const b = new TextEncoder().encode(env.ROOM_TOKEN);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

const deny = () => new Response('Unauthorized', { status: 401 });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const res = await routePartykitRequest(req, env as unknown as Record<string, unknown>, {
      cors: true,
      onBeforeConnect: (r) => (authorised(r, env) ? undefined : deny()),
      onBeforeRequest: (r) => (authorised(r, env) ? undefined : deny()),
    });
    return res ?? new Response('GitLaTeX collaboration relay', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
