/**
 * The text of each shared file as of the last time this browser was in sync
 * with a room ("base"), kept in IndexedDB per relay and room. Rejoining merges
 * three ways against it, so work done while not live is never overwritten by
 * the room's older copy. Losing it is harmless: rejoining then falls back to
 * taking the room's version, as a first join does.
 */
import { openDB, type IDBPDatabase } from 'idb';

export type Base = Record<string, string>;

let db: Promise<IDBPDatabase> | null = null;
const open = () => (db ??= openDB('gitlatex-collab', 1, { upgrade: (d) => void d.createObjectStore('base') }));

export const baseKey = (host: string, room: string) => `${host.toLowerCase()}/${room}`;

export async function loadBase(key: string): Promise<Base | null> {
  try {
    return ((await (await open()).get('base', key)) as Base | undefined) ?? null;
  } catch {
    return null;
  }
}

export async function saveBase(key: string, files: Base) {
  try {
    await (await open()).put('base', files, key);
  } catch {
    /* private window or storage full: rejoining falls back to the room's version */
  }
}

export async function clearBase(key: string) {
  try {
    await (await open()).delete('base', key);
  } catch {
    /* nothing to clear */
  }
}
