import { beforeEach, describe, expect, it } from 'vitest';
import { decodeInvite, encodeInvite, moveCollabConfig, readCollabConfig, roomName, sameHost, splitHost, writeCollabConfig } from '../../src/collab/config';

describe('collab config', () => {
  beforeEach(() => localStorage.clear());

  it('makes URL-safe room names', () => {
    expect(roomName('  My Thesis (v2) ')).toBe('my-thesis-v2');
    expect(roomName('a/b\\c')).toBe('a-b-c');
    expect(roomName('ok_name-1.2')).toBe('ok_name-1.2');
  });

  it('splits a pasted server address into host and protocol', () => {
    expect(splitHost('https://gitlatex-collab.me.workers.dev/')).toEqual({ host: 'gitlatex-collab.me.workers.dev', secure: true });
    expect(splitHost('gitlatex-collab.me.workers.dev')).toEqual({ host: 'gitlatex-collab.me.workers.dev', secure: true });
    expect(splitHost('localhost:8787')).toEqual({ host: 'localhost:8787', secure: false });
    expect(splitHost('http://192.168.1.5:8787')).toEqual({ host: '192.168.1.5:8787', secure: false });
  });

  it('is off per project by default and remembers the last server', () => {
    expect(readCollabConfig('thesis')).toMatchObject({ enabled: false, host: '', room: 'thesis' });
    writeCollabConfig('thesis', { enabled: true, host: 'relay.example', room: 'thesis', token: 't' });
    expect(readCollabConfig('thesis').enabled).toBe(true);
    // Another project is not shared; the server is prefilled, but tokens are per room.
    expect(readCollabConfig('notes')).toMatchObject({ enabled: false, host: 'relay.example', token: '', room: 'notes' });
  });

  it('follows a project rename and forgets a deleted one', () => {
    writeCollabConfig('old', { enabled: true, host: 'h', room: 'r', token: 't' });
    moveCollabConfig('old', 'new');
    expect(readCollabConfig('new')).toMatchObject({ enabled: true, room: 'r' });
    expect(readCollabConfig('old').enabled).toBe(false);
    moveCollabConfig('new', null);
    expect(readCollabConfig('new').enabled).toBe(false);
  });

  it('packs server, room and token into one invite and back', () => {
    const invite = { host: 'https://gitlatex-collab.me.workers.dev/', room: 'thesis', token: 'rw0VbzNpSS1z-X-O31Qt49EVO06DFjYp' };
    const code = encodeInvite(invite);
    expect(code).toMatch(/^gitlatex-invite:[A-Za-z0-9_-]+$/);
    const back = decodeInvite(code)!;
    expect(back).toMatchObject({ room: 'thesis', token: invite.token });
    expect(splitHost(back.host)).toEqual({ host: 'gitlatex-collab.me.workers.dev', secure: true });
    // Pasted with stray spaces and line breaks (chat apps wrap long strings).
    expect(decodeInvite(`  ${code.slice(0, 20)}
${code.slice(20)} `)).toEqual(back);
  });

  it('keeps a plain-http local relay plain in the invite', () => {
    const back = decodeInvite(encodeInvite({ host: 'http://192.168.1.5:8787', room: 'r', token: 't' }))!;
    expect(splitHost(back.host)).toEqual({ host: '192.168.1.5:8787', secure: false });
    expect(splitHost(decodeInvite(encodeInvite({ host: 'localhost:8787', room: 'r', token: 't' }))!.host).secure).toBe(false);
  });

  it('rejects anything that is not an invite', () => {
    expect(decodeInvite('')).toBeNull();
    expect(decodeInvite('hello')).toBeNull();
    expect(decodeInvite('gitlatex-invite:%%%')).toBeNull();
    expect(decodeInvite('gitlatex-invite:' + btoa('{"h":"x"}'))).toBeNull();
  });

  it('compares relay addresses however they were typed', () => {
    expect(sameHost('https://Relay.example.com/', 'relay.example.com')).toBe(true);
    expect(sameHost('relay.example.com', 'other.example.com')).toBe(false);
  });
});
