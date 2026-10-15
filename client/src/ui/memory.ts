// Memória editável por conversa de agente, persistida pelo servidor local do Habblaud.
import type { AgentInfo } from '../../../shared/types';
import { h, setText } from './dom';
import type { UiComponent } from './context';
import { tr } from '../../../shared/i18n';

const MAX_MEMORY = 12_000;

export class AgentMemoryPanel implements UiComponent {
  readonly el: HTMLElement;
  private readonly input: HTMLTextAreaElement;
  private readonly saveButton: HTMLButtonElement;
  private readonly clearButton: HTMLButtonElement;
  private readonly status: HTMLElement;
  private agentId = '';
  private identity = '';
  private request = 0;
  private saving = false;

  constructor() {
    this.input = h('textarea', {
      class: 'ui-memory__input',
      attrs: { maxlength: MAX_MEMORY, rows: 5, placeholder: tr('Registre fatos, preferências e orientações que esta agente deve lembrar entre conversas.'), 'aria-label': tr('Memória persistente da agente') },
    });
    this.status = h('span', { class: 'ui-memory__status', role: 'status', attrs: { 'aria-live': 'polite' } });
    this.saveButton = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Salvar memória'), on: { click: () => void this.save() } });
    this.clearButton = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: tr('Apagar memória'), on: { click: () => { this.input.value = ''; void this.save(); } } });
    const panel = h(
      'details',
      { class: 'ui-memory' },
      h('summary', { text: tr('Memória persistente') }),
      h('p', { class: 'ui-muted ui-small', text: tr('Esta memória fica salva localmente e não é enviada por padrão. Marque “Incluir memória neste envio” na caixa de mensagem para usá-la uma única vez.') }),
      this.input,
      h('div', { class: 'ui-memory__foot' }, this.status, h('span', { class: 'ui-memory__actions' }, this.clearButton, this.saveButton)),
    );
    this.el = h('section', { class: 'ui-sec ui-memory-sec' }, panel);
    this.input.addEventListener('input', () => {
      this.saveButton.disabled = this.saving || this.input.value.length > MAX_MEMORY;
      this.clearButton.disabled = this.saving;
      if (this.status.textContent?.startsWith('Salva')) setText(this.status, tr('Alterações não salvas'));
    });
  }

  setAgent(agent: AgentInfo | undefined): void {
    if (!agent || agent.kind !== 'main') {
      this.request++;
      this.identity = '';
      this.agentId = '';
      this.el.hidden = true;
      return;
    }
    this.el.hidden = false;
    const identity = `${agent.provider ?? 'claude'}:${agent.account}:${agent.sessionId}`;
    if (identity === this.identity) {
      this.agentId = agent.id;
      return;
    }
    this.identity = identity;
    this.agentId = agent.id;
    this.input.value = '';
    this.input.disabled = true;
    this.saveButton.disabled = true;
    this.clearButton.disabled = true;
    setText(this.status, tr('Carregando memória…'));
    const request = ++this.request;
    fetch(`/api/agents/${encodeURIComponent(agent.id)}/memory`)
      .then(async (res) => {
        const body = (await res.json()) as { memory?: { text?: unknown }; error?: string };
        if (!res.ok) throw new Error(body.error || tr('não foi possível carregar'));
        if (request !== this.request) return;
        this.input.value = typeof body.memory?.text === 'string' ? body.memory.text : '';
        this.input.disabled = false;
        this.saveButton.disabled = false;
        setText(this.status, this.input.value ? tr('Memória carregada') : tr('Ainda sem memória salva'));
      })
      .catch((err: unknown) => {
        if (request !== this.request) return;
        this.input.disabled = true;
        setText(this.status, err instanceof Error ? err.message : tr('não foi possível carregar'));
      });
  }

  render(): void {}

  private async save(): Promise<void> {
    if (!this.agentId || this.saving || this.input.value.length > MAX_MEMORY) return;
    const request = this.request;
    this.saving = true;
    this.saveButton.disabled = true;
    setText(this.status, tr('Salvando…'));
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(this.agentId)}/memory`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: this.input.value }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error || tr('não foi possível salvar'));
      if (request === this.request) setText(this.status, tr('Memória salva; será usada nas próximas mensagens'));
    } catch (err) {
      if (request === this.request) setText(this.status, err instanceof Error ? err.message : tr('não foi possível salvar'));
    } finally {
      this.saving = false;
      if (request === this.request) this.saveButton.disabled = this.input.disabled;
      if (request === this.request) this.clearButton.disabled = this.input.disabled;
    }
  }
}
