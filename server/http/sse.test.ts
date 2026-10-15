import { describe, expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { EventEmitter } from 'node:events';
import { Hub, frame } from './sse';
import { Office } from '../model/office';
import { NameStore } from '../model/names';

function createMockReqRes(headers: Record<string, string> = {}) {
  const req = new EventEmitter() as unknown as IncomingMessage & EventEmitter;
  req.headers = headers;
  req.socket = { setTimeout: vi.fn(), setNoDelay: vi.fn() } as unknown as IncomingMessage['socket'];

  const written: string[] = [];
  const res = new EventEmitter() as unknown as ServerResponse & EventEmitter;
  res.writeHead = vi.fn();
  res.write = vi.fn((chunk: string) => {
    written.push(chunk);
    return true;
  });
  res.end = vi.fn();
  Object.defineProperty(res, 'destroyed', { value: false, writable: true });
  Object.defineProperty(res, 'writableEnded', { value: false, writable: true });
  Object.defineProperty(res, 'writableLength', { value: 0, writable: true });

  return { req, res, written };
}

function makeOffice(): Office {
  return new Office({
    names: new NameStore(null),
    version: 't',
    startedAt: 0,
    accounts: () => [],
    sources: () => [],
    accountName: () => undefined,
  });
}

describe('Hub SSE: Reconexão e Last-Event-ID', () => {
  it('frame gera formato SSE padrão com id opcional', () => {
    expect(frame('ping', { ok: true })).toBe('event: ping\ndata: {"ok":true}\n\n');
    expect(frame('ping', { ok: true }, 42)).toBe('id: 42\nevent: ping\ndata: {"ok":true}\n\n');
  });

  it('attach inicial envia retry, snapshot e feed com IDs sequenciais', () => {
    const office = makeOffice();
    const hub = new Hub(office);

    const { req, res, written } = createMockReqRes();
    hub.attach(req, res);

    expect(written[0]).toBe('retry: 2000\n\n');
    expect(written[1]).toMatch(/^id: 1\nevent: snapshot\ndata: /);
    expect(written[2]).toMatch(/^id: 2\nevent: feed\ndata: /);
    expect(hub.currentSeq).toBe(2);
    expect(hub.size).toBe(1);

    hub.stop();
  });

  it('reconexão com Last-Event-ID recente retransmite apenas eventos perdidos', () => {
    const office = makeOffice();
    const hub = new Hub(office);

    // Cliente 1 conecta: consome id 1 (snapshot) e 2 (feed)
    const client1 = createMockReqRes();
    hub.attach(client1.req, client1.res);
    expect(hub.currentSeq).toBe(2);

    // Servidor emite um aviso no feed: o commit gera snapshot (3) e notice (4)
    office.addNotice({ id: 'n1', level: 'info', text: 'alerta de teste', at: Date.now() });
    hub.flush();
    expect(hub.currentSeq).toBe(4);

    // Cliente 2 reconecta avisando que o último evento visto foi o 2
    const client2 = createMockReqRes({ 'last-event-id': '2' });
    hub.attach(client2.req, client2.res);

    // Deve enviar retry + eventos 3 e 4 do buffer (sem retransmitir histórico antigo de feed)
    expect(client2.written[0]).toBe('retry: 2000\n\n');
    expect(client2.written).toHaveLength(3);
    expect(client2.written[1]).toMatch(/^id: 3\nevent: snapshot\ndata: /);
    expect(client2.written[2]).toMatch(/^id: 4\nevent: notice\ndata: /);

    hub.stop();
  });

  it('reconexão com Last-Event-ID inexistente/expirado reenvia snapshot fresco completo', () => {
    const office = makeOffice();
    const hub = new Hub(office);

    const client = createMockReqRes({ 'last-event-id': '9999' });
    hub.attach(client.req, client.res);

    expect(client.written[0]).toBe('retry: 2000\n\n');
    expect(client.written[1]).toMatch(/^id: \d+\nevent: snapshot\ndata: /);
    expect(client.written[2]).toMatch(/^id: \d+\nevent: feed\ndata: /);

    hub.stop();
  });
});
