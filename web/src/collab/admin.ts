/**
 * The relay's owner API: create rooms (each with its own token), list them,
 * issue a new token, delete them. Authenticated with the relay's ADMIN_TOKEN.
 */
import { splitHost, type CollabAdmin } from './config';

export interface RoomRecord {
  room: string;
  token: string;
  createdAt: string;
}

async function call<T>(admin: CollabAdmin, method: 'GET' | 'POST' | 'DELETE', path: string): Promise<T> {
  const { host, secure } = splitHost(admin.host);
  let res: Response;
  try {
    res = await fetch(`${secure ? 'https' : 'http'}://${host}/admin/${path}`, { method, headers: { Authorization: `Bearer ${admin.token}` } });
  } catch {
    throw new Error(`Could not reach ${host}. Check the address.`);
  }
  const body = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (res.status === 401) throw new Error('The admin token is wrong.');
  if (res.status === 404 && !body) throw new Error(`${host} is not a GitLaTeX relay, or it is out of date.`);
  if (!res.ok || !body) throw new Error(body?.error ?? `The relay answered ${res.status}.`);
  return body;
}

export const listRooms = async (admin: CollabAdmin) => (await call<{ rooms: RoomRecord[] }>(admin, 'GET', 'rooms')).rooms;

/** The room, created with a fresh token if it does not exist yet. */
export const ensureRoom = (admin: CollabAdmin, room: string) => call<RoomRecord & { created: boolean }>(admin, 'POST', `rooms/${encodeURIComponent(room)}`);

/** A new token for the room; everyone connected is disconnected until they use it. */
export const rotateRoomToken = (admin: CollabAdmin, room: string) => call<RoomRecord>(admin, 'POST', `rooms/${encodeURIComponent(room)}/token`);

export const deleteRoom = (admin: CollabAdmin, room: string) => call<{ deleted: string }>(admin, 'DELETE', `rooms/${encodeURIComponent(room)}`);
