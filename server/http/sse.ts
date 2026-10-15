// Transmissão em tempo real (Server-Sent Events) em GET /api/stream.
// Eventos nomeados: snapshot | feed | notice (o `data` é o JSON do protocolo em shared/types.ts).
// Snapshots saem com throttle (~200 ms); feed e avisos vão em lote logo depois do snapshot.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { OfficeSnapshot } from '../../shared/types';
import type { Office } from '../model/office';
import { isLoopbackHost } from './guard';

/** Cliente lento demais (buffer acumulado acima disto) é desconectado; o EventSource reconecta. */
const MAX_BUFFERED = 8 * 1024 * 1024;

export interface BufferedEvent {
  id: number;
  event: string;
  data: unknown;
  frame: string;
}

export class Hub {
  private clients = new Set<ServerResponse>();
  /** Clientes que abriram a página por um Host local (os únicos que podem responder pedidos de permissão). */
  private local = new WeakSet<ServerResponse>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private pinger: ReturnType<typeof setInterval> | null = null;
  private lastFlush = 0;
  private unsubscribe: (() => void) | null = null;
  private snapshotCbs = new Set<(snap: OfficeSnapshot) => void>();
  private readonly throttleMs: number;
  private readonly pingMs: number;
  /** Sequenciador global de eventos SSE e buffer circular recente para reconexões resilientes (Last-Event-ID). */
  private eventSeq = 0;
  private readonly maxBufferedEvents = 100;
  private recentEvents: BufferedEvent[] = [];
  /** Quem pode responder pelo escritório; padrão: Host local. A porta remota (http/remote.ts) troca a regra. */
  private readonly canAnswer: (req: IncomingMessage) => boolean;

  constructor(
    private readonly office: Office,
    opts: { throttleMs?: number; pingMs?: number; canAnswer?: (req: IncomingMessage) => boolean } = {},
  ) {
    this.throttleMs = opts.throttleMs ?? 200;
    this.pingMs = opts.pingMs ?? 15_000;
    this.canAnswer = opts.canAnswer ?? ((req) => isLoopbackHost(req.headers.host));
  }

  start(): void {
    this.unsubscribe = this.office.onChange(() => this.schedule());
    this.pinger = setInterval(() => this.writeAll(': ping\n\n'), this.pingMs);
    this.pinger.unref?.();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer) clearTimeout(this.timer);
    if (this.pinger) clearInterval(this.pinger);
    this.timer = null;
    this.pinger = null;
    for (const c of this.clients) c.end();
    this.clients.clear();
  }

  get size(): number {
    return this.clients.size;
  }

  get currentSeq(): number {
    return this.eventSeq;
  }

  /** Avisado a cada snapshot novo transmitido (ex.: o gravador da linha do tempo). */
  onSnapshot(cb: (snap: OfficeSnapshot) => void): () => void {
    this.snapshotCbs.add(cb);
    return () => void this.snapshotCbs.delete(cb);
  }

  /** Páginas conectadas por um Host local (localhost/127.x): quem pode responder pelo escritório. */
  get localSize(): number {
    let n = 0;
    for (const c of this.clients) if (this.local.has(c) && !c.destroyed && !c.writableEnded) n++;
    return n;
  }

  /** Conecta um cliente: snapshot completo + últimos 50 itens do feed, ou replay dos eventos pendentes via Last-Event-ID. */
  attach(req: IncomingMessage, res: ServerResponse): void {
    req.socket.setTimeout(0);
    req.socket.setNoDelay(true);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');

    const lastHeader = req.headers['last-event-id'];
    const lastId = typeof lastHeader === 'string' && /^\d+$/.test(lastHeader.trim()) ? parseInt(lastHeader.trim(), 10) : NaN;
    const canReplay = !isNaN(lastId) && this.recentEvents.length > 0 && this.recentEvents[0].id <= lastId + 1 && lastId <= this.eventSeq;

    if (canReplay) {
      // Reenvia apenas os eventos perdidos durante a reconexão
      const missed = this.recentEvents.filter((e) => e.id > lastId);
      for (const ev of missed) {
        res.write(ev.frame);
      }
    } else {
      // Conexão inicial ou buffer extrapolou: snapshot completo fresco + últimos 50 itens do feed
      const snapshot = this.current();
      const snapId = ++this.eventSeq;
      const feedId = ++this.eventSeq;
      const snapFrame = frame('snapshot', snapshot, snapId);
      const feedFrame = frame('feed', this.office.recentFeed(50), feedId);

      this.recentEvents.push({ id: snapId, event: 'snapshot', data: snapshot, frame: snapFrame });
      this.recentEvents.push({ id: feedId, event: 'feed', data: this.office.recentFeed(50), frame: feedFrame });
      if (this.recentEvents.length > this.maxBufferedEvents) {
        this.recentEvents.splice(0, this.recentEvents.length - this.maxBufferedEvents);
      }

      res.write(snapFrame);
      res.write(feedFrame);
    }

    this.clients.add(res);
    if (this.canAnswer(req)) this.local.add(res);
    const drop = () => this.clients.delete(res);
    req.on('close', drop);
    res.on('close', drop);
    res.on('error', drop);
  }

  /** Fecha a revisão agora e transmite o que houver. Devolve o snapshot atual. */
  flush(): OfficeSnapshot {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.lastFlush = Date.now();
    const r = this.office.commit();
    if (r.changed) {
      if (this.clients.size > 0) {
        this.emitEvent('snapshot', r.snapshot);
      }
      for (const cb of this.snapshotCbs) {
        try {
          cb(r.snapshot);
        } catch {
          // quem escuta não atrapalha a transmissão
        }
      }
    }
    if (this.clients.size > 0) {
      if (r.feed.length) this.emitEvent('feed', r.feed);
      for (const n of r.notices) this.emitEvent('notice', n);
    }
    return r.snapshot;
  }

  /** Snapshot atual (depois de transmitir o que estiver pendente), com `serverTime` de agora. */
  current(): OfficeSnapshot {
    return { ...this.flush(), serverTime: Date.now() };
  }

  private emitEvent(event: string, data: unknown): void {
    const id = ++this.eventSeq;
    const raw = frame(event, data, id);
    this.recentEvents.push({ id, event, data, frame: raw });
    if (this.recentEvents.length > this.maxBufferedEvents) {
      this.recentEvents.shift();
    }
    this.writeAll(raw);
  }

  private schedule(): void {
    if (this.timer) return;
    const wait = Math.max(0, this.lastFlush + this.throttleMs - Date.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, wait);
    this.timer.unref?.();
  }

  private writeAll(chunk: string): void {
    for (const c of this.clients) {
      if (c.destroyed || c.writableEnded) {
        this.clients.delete(c);
        continue;
      }
      if (c.writableLength > MAX_BUFFERED) {
        this.clients.delete(c);
        c.destroy();
        continue;
      }
      c.write(chunk);
    }
  }
}

export function frame(event: string, data: unknown, id?: number | string): string {
  const idLine = id !== undefined ? `id: ${id}\n` : '';
  return `${idLine}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}
