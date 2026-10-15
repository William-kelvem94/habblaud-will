// Conversa persistente visível nos detalhes do agente, alimentada pelo transcript do servidor.
import type { AgentInfo, TerminalEntry, TerminalInit } from '../../../shared/types';
import { formatClock } from './format';
import { h, setHidden, setText } from './dom';
import { renderMarkdown } from './markdown';
import { sessionTerminalUrl, terminalUrl } from './terminal';
import type { UiComponent, UiContext } from './context';
import { access } from '../net/access';
import { tr } from '../../../shared/i18n';

const MAX_VISIBLE_ENTRIES = 120;
const MAX_BUFFERED_ENTRIES = 1_000;

function parse(raw: string): unknown {
  try { return JSON.parse(raw); } catch { return undefined; }
}

function entries(raw: unknown): TerminalEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((e): e is TerminalEntry => !!e && typeof e === 'object' && typeof (e as TerminalEntry).id === 'string' && ['user', 'assistant', 'thinking', 'tool', 'result', 'system'].includes((e as TerminalEntry).kind));
}

function initData(raw: string): TerminalInit | undefined {
  const data = parse(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data)) return;
  const d = data as Record<string, unknown>;
  return { agentId: typeof d.agentId === 'string' ? d.agentId : '', entries: entries(d.entries), truncated: d.truncated === true };
}

export class AgentConversation implements UiComponent {
  readonly el: HTMLElement;
  private readonly list: HTMLElement;
  private readonly status: HTMLElement;
  private readonly more: HTMLButtonElement;
  private source: EventSource | null = null;
  private agentId = '';
  private identity = '';
  private agentName = '';
  private streamUrl = '';
  private values = new Map<string, TerminalEntry>();
  private truncated = false;
  private loaded = false;
  private replayBlocked = false;

  constructor(private readonly ctx: UiContext, private readonly openFull: () => void) {
    this.list = h('div', { class: 'ui-agent-chat__list', attrs: { 'aria-live': 'polite', 'aria-relevant': 'additions text' } });
    this.status = h('p', { class: 'ui-agent-chat__status', role: 'status' });
    this.more = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Abrir conversa completa'), on: { click: () => this.openFull() } });
    this.el = h('section', { class: 'ui-sec ui-agent-chat' }, h('div', { class: 'ui-agent-chat__head' }, h('h3', { class: 'ui-sec__title', text: tr('Conversa') }), this.more), this.status, this.list);
    this.el.hidden = true;
  }

  setAgent(agent: AgentInfo | undefined): void {
    const id = agent?.id ?? '';
    const identity = agent ? `${agent.provider ?? 'claude'}:${agent.account}:${agent.sessionId}` : '';
    if (identity === this.identity) {
      if (agent) this.agentName = agent.name;
      if (this.ctx.store.replaying) {
        this.disconnect();
        this.replayBlocked = true;
        setText(this.status, tr('A conversa ao vivo fica indisponível durante o timelapse.'));
      } else if (this.replayBlocked && agent) {
        this.replayBlocked = false;
        this.agentId = '';
        this.setAgent(agent);
      }
      return;
    }
    this.disconnect();
    this.agentId = id;
    this.identity = identity;
    this.agentName = agent?.name ?? tr('Agente');
    this.streamUrl = agent?.kind === 'main' ? sessionTerminalUrl(agent.account, agent.sessionId) : id ? terminalUrl(id) : '';
    this.values.clear();
    this.truncated = false;
    this.loaded = false;
    this.replayBlocked = false;
    this.list.replaceChildren();
    if (!agent || this.ctx.store.replaying) {
      setText(this.status, agent ? tr('A conversa ao vivo fica indisponível durante o timelapse.') : '');
      this.el.hidden = !agent;
      return;
    }
    this.el.hidden = false;
    if (!this.ctx.store.snapshot?.meta.terminal || !access().terminal) {
      setText(this.status, tr('Abra o Habblaud no computador para ver a conversa completa.'));
      return;
    }
    setText(this.status, tr('Carregando a conversa salva…'));
    const es = new EventSource(this.streamUrl);
    this.source = es;
    es.addEventListener('init', (ev) => {
      if (this.source !== es) return;
      const data = initData((ev as MessageEvent).data);
      if (!data) return;
      this.values.clear();
      for (const entry of data.entries) this.values.set(entry.id, entry);
      this.truncated = data.truncated;
      this.loaded = true;
      this.render();
    });
    es.addEventListener('append', (ev) => {
      if (this.source !== es) return;
      const data = entries(parse((ev as MessageEvent).data));
      let changed = false;
      for (const entry of data) {
        if (!this.values.has(entry.id)) changed = true;
        this.values.set(entry.id, entry);
      }
      if (this.values.size > MAX_BUFFERED_ENTRIES) {
        this.values = new Map([...this.values.entries()].slice(-MAX_VISIBLE_ENTRIES * 4));
        this.truncated = true;
      }
      if (changed) this.render();
    });
    es.addEventListener('error', () => {
      if (this.source !== es || es.readyState !== EventSource.CLOSED) return;
      es.close();
      this.source = null;
      if (!this.loaded) setText(this.status, tr('Não consegui carregar a conversa. Use “Abrir terminal” para tentar de novo.'));
    });
  }

  render(): void {
    if (!this.agentId) return;
    const scroll = this.list.scrollTop;
    const following = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 48;
    const messages = [...this.values.values()].filter(
      (e): e is Extract<TerminalEntry, { kind: 'user' | 'assistant' }> => (e.kind === 'user' || e.kind === 'assistant') && !!e.text,
    ).slice(-MAX_VISIBLE_ENTRIES);
    const children = messages.map((entry) => {
      const user = entry.kind === 'user';
      const head = h('div', { class: 'ui-agent-chat__meta' }, h('strong', { text: user ? tr('William') : this.agentName }), h('time', { text: formatClock(entry.at, false) }));
      const body = h('div', { class: 'ui-agent-chat__text' });
      body.append(renderMarkdown(entry.text));
      const propose = user ? null : h('button', { class: 'ui-btn ui-btn--sm ui-agent-chat__propose', type: 'button', text: tr('Propor aprendizado'), title: tr('Enviar este trecho para revisão antes de salvar na memória da conversa'), on: { click: () => void this.propose(entry.text, entry.at) } });
      return h('article', { class: `ui-agent-chat__message${user ? ' is-user' : ' is-agent'}` }, head, body, propose);
    });
    this.list.replaceChildren(...children);
    if (following) this.list.scrollTop = this.list.scrollHeight;
    else this.list.scrollTop = scroll;
    setHidden(this.more, !this.loaded);
    const total = this.messagesInMemory();
    setText(this.status, !this.loaded ? tr('Aguardando mensagens…') : this.truncated || total > MAX_VISIBLE_ENTRIES ? tr('Mostrando as {0} mensagens mais recentes. O restante fica em “Abrir conversa completa”.', [messages.length]) : total ? tr('{0} mensagens guardadas nesta conversa', [total]) : tr('As respostas concluídas aparecerão aqui e ficarão salvas no histórico da sessão.'));
  }

  close(): void {
    this.disconnect();
    this.agentId = '';
    this.identity = '';
  }

  private messagesInMemory(): number {
    let n = 0;
    for (const e of this.values.values()) if ((e.kind === 'user' || e.kind === 'assistant') && !!e.text) n++;
    return n;
  }

  private disconnect(): void {
    this.source?.close();
    this.source = null;
  }

  private async propose(text: string, at: number): Promise<void> {
    const candidate = window.prompt(tr('Revise o aprendizado que a agente está propondo para a memória desta conversa:'), text.slice(0, 3000));
    if (!candidate?.trim()) return;
    try {
      const res = await fetch('/api/company/proposals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId: this.agentId, text: candidate, source: `${this.agentName} · ${new Date(at).toLocaleString()}` }) });
      const body = await res.json() as { error?: string };
      if (!res.ok) throw new Error(body.error || tr('não foi possível propor o aprendizado'));
      this.ctx.announce(tr('Proposta enviada para revisão em Operação da empresa.'));
    } catch (err) { this.ctx.announce(err instanceof Error ? err.message : tr('não foi possível propor o aprendizado')); }
  }
}
