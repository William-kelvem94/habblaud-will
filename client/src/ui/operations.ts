// Painel local de operação da empresa: caixa de tarefas, papéis, memória revisável e indicadores.
import type { AgentInfo, DeliveryInfo } from '../../../shared/types';
import type { UiComponent, UiContext } from './context';
import { h, iconButton, setHidden, setText } from './dom';
import { ICONS } from './icons';
import { Movable } from './movable';
import { CODEX_MODEL_PRICES } from '../../../shared/codex-pricing';
import { createTeamChat, type TeamChat } from './team-chat';

type Task = { id: string; title: string; description: string; project: string; agentId: string; status: 'pending'|'in_progress'|'blocked'|'completed'; dueAt: number|null; dependsOn: string[]; createdAt: number; updatedAt: number };
type Profile = { name: string; specialty: string; instructions: string; limits: string; updatedAt: number };
type Proposal = { id: string; agentId: string; text: string; source: string; scope: 'conversation'|'company'; createdAt: number; provider?: 'claude'|'codex'; account?: string; sessionId?: string; roomId?: string; memoryOwnerKey?: string; eventId?: string };
type Idea = { id: string; title: string; body: string; project: string; agentIds: string[]; createdAt: number };
type Data = { name: string; profiles: Record<string, Profile>; tasks: Task[]; proposals: Proposal[]; ideas: Idea[]; sharedMemory: string };
const STATUS: Task['status'][] = ['pending','in_progress','blocked','completed'];
const LABEL: Record<Task['status'], string> = { pending: 'Pendente', in_progress: 'Em andamento', blocked: 'Bloqueada', completed: 'Concluída' };

async function send(url: string, method: string, body?: unknown): Promise<void> {
  const res = await fetch(url, { method, headers: body === undefined ? undefined : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = await res.json() as { error?: string };
  if (!res.ok) throw new Error(json.error || 'Não foi possível salvar.');
}
function field(label: string, control: HTMLElement): HTMLElement { return h('label', { class: 'ui-ops-field' }, h('span', { text: label }), control); }
function select(values: Array<[string,string]>, value = ''): HTMLSelectElement {
  const el = h('select', { class: 'ui-ops-input' }) as HTMLSelectElement;
  el.append(h('option', { text: '— Selecione —', attrs: { value: '' } }));
  for (const [v, label] of values) el.append(h('option', { text: label, attrs: { value: v } }));
  el.value = value; return el;
}

export class Operations implements UiComponent {
  readonly button: HTMLButtonElement;
  readonly el: HTMLElement;
  private panel: HTMLElement;
  private body: HTMLElement;
  private movable: Movable;
  private data: Data = { name: '', profiles: {}, tasks: [], proposals: [], ideas: [], sharedMemory: '' };
  private deliveries: DeliveryInfo[] = [];
  private codexDefaults = new Map<string, { model: string; effort: string; models: Array<{ id: string; displayName?: string }> }>();
  private loaded = false;
  private refreshing = false;
  private busy = false;
  private timer: ReturnType<typeof setInterval>;
  private message = '';
  private teamChat: TeamChat;

  constructor(private ctx: UiContext) {
    this.teamChat = createTeamChat(() => this.agents());
    this.button = iconButton(ICONS.feed, 'Operação da empresa: tarefas, agentes e resultados', () => this.toggle(), 'ui-btn-ops');
    this.button.setAttribute('aria-haspopup', 'dialog');
    this.body = h('div', { class: 'ui-ops__body' });
    const header = h('div', { class: 'ui-popover__head' }, h('h2', { text: 'Operação da empresa' }), iconButton(ICONS.close, 'Fechar', () => this.hide(), 'ui-icon-btn--sm'));
    this.panel = h('div', { class: 'ui-popover ui-ops', role: 'dialog', tabIndex: -1, attrs: { 'aria-label': 'Operação da empresa', popover: 'auto' } },
      header,
      h('p', { class: 'ui-muted ui-small', text: 'Acompanhe o trabalho, organize responsáveis e veja as memórias atualizadas automaticamente conforme os agentes concluem tarefas. No computador, arraste pelo cabeçalho; dê duplo clique para devolver ao lugar.' }), this.body);
    this.panel.addEventListener('toggle', () => {
      this.button.classList.toggle('is-on', this.open);
      this.button.setAttribute('aria-expanded', String(this.open));
      this.ctx.root.classList.toggle('has-popover', this.open);
      if (this.open) {
        void this.refresh(true);
        void this.teamChat.refresh();
      }
      else this.button.focus({ preventScroll: true });
    });
    this.el = h('div', { class: 'ui-ops-root' }, this.panel);
    this.movable = new Movable(this.panel, header, {
      key: 'habblaud.move.operations',
      minWidth: 600,
      enabled: () => !this.ctx.isNarrow(),
      onChange: (floating) => {
        if (floating) {
          // A janela flutuante usa left/top/width/height do Movable, sem as âncoras do popover.
          this.panel.style.removeProperty('right');
          this.panel.style.removeProperty('max-height');
        } else if (this.open) this.position();
      },
    });
    this.timer = setInterval(() => { if (this.open && !document.hidden) void this.refresh(); }, 5_000);
    if (typeof window !== 'undefined') window.addEventListener('resize', () => { if (this.open && !this.movable.floating) this.position(); });
  }
  get open(): boolean { try { return typeof this.panel.matches === 'function' ? this.panel.matches(':popover-open') : this.panel.classList.contains?.('is-open') ?? false; } catch { return this.panel.classList.contains?.('is-open') ?? false; } }
  render(): void { setHidden(this.button, this.ctx.store.mock || this.ctx.store.replaying); }
  private toggle(): void {
    if (this.open) return this.hide();
    if (!this.movable.floating) this.position();
    if (typeof this.panel.showPopover === 'function') this.panel.showPopover();
    else this.panel.classList.add('is-open');
    this.panel.focus({ preventScroll: true });
    this.button.setAttribute('aria-expanded', 'true');
    this.button.classList.add('is-on');
    this.ctx.root.classList.add('has-popover');
    if (!this.loaded) { this.message = 'Carregando dados da empresa…'; this.draw(); }
    void this.refresh(true);
    void this.teamChat.refresh();
  }
  private position(): void {
    const rect = this.button.getBoundingClientRect();
    const margin = 8;
    const gap = 8;
    const below = Math.max(0, window.innerHeight - rect.bottom - margin - gap);
    const above = Math.max(0, rect.top - margin - gap);
    const maxHeight = Math.max(120, Math.min(900, window.innerHeight * 0.84, Math.max(below, above)));
    const openBelow = below >= 420 || below >= above;
    const top = openBelow ? rect.bottom + gap : Math.max(margin, rect.top - gap - maxHeight);
    const panelWidth = Math.min(760, Math.max(0, window.innerWidth - 24));
    const maxRight = Math.max(margin, window.innerWidth - panelWidth - margin);
    const right = Math.min(maxRight, Math.max(margin, window.innerWidth - rect.right - 4));
    this.panel.style.top = `${Math.round(top)}px`;
    this.panel.style.right = `${Math.round(right)}px`;
    this.panel.style.maxHeight = `${Math.round(maxHeight)}px`;
  }
  private hide(): void {
    if (typeof this.panel.hidePopover === 'function' && this.open) this.panel.hidePopover();
    this.panel.classList.remove('is-open');
    this.button.setAttribute('aria-expanded', 'false');
    this.button.classList.remove('is-on');
    this.ctx.root.classList.remove('has-popover');
    this.button.focus({ preventScroll: true });
  }
  private async refresh(force = false): Promise<void> {
    if (!force && typeof document !== 'undefined' && this.body.contains(document.activeElement)) return;
    if (this.refreshing) return;
    this.refreshing = true;
    try { const res = await fetch('/api/company', { cache: 'no-store' }); if (!res.ok) throw new Error('Não foi possível carregar os dados da empresa.'); this.data = await res.json() as Data; const mr = await fetch('/api/company/shared-memory', { cache: 'no-store' }); if (!mr.ok) throw new Error('Não foi possível carregar a memória compartilhada.'); const value = await mr.json() as { memory?: { text?: unknown } }; this.data.sharedMemory = typeof value.memory?.text === 'string' ? value.memory.text : ''; const dr = await fetch('/api/deliveries', { cache: 'no-store' }).catch(() => undefined); if (dr?.ok) { const list = await dr.json() as { deliveries?: unknown }; this.deliveries = Array.isArray(list.deliveries) ? list.deliveries as DeliveryInfo[] : []; } this.loaded = true; this.draw(); }
    catch (e) { this.message = e instanceof Error ? e.message : 'Falha ao carregar'; this.draw(); }
    finally { this.refreshing = false; }
  }
  private agents(): AgentInfo[] { return (this.ctx.store.snapshot?.agents ?? []).filter((a) => a.kind === 'main'); }
  private draw(): void {
    const agents = this.agents(); const live = agents.filter((a) => a.status !== 'offline' && a.status !== 'done');
    const tasks = this.data.tasks ?? []; const pending = tasks.filter((t) => t.status === 'pending' || t.status === 'in_progress').length;
    const blocked = tasks.filter((t) => t.status === 'blocked').length;
    const completed = tasks.filter((t) => t.status === 'completed').length;
    const status = h('p', { class: 'ui-ops__status', role: 'status', text: this.message }); this.message = '';
    const overdue = tasks.filter((t) => t.status !== 'completed' && t.dueAt !== null && t.dueAt < Date.now()).length;
    const metrics = h('div', { class: 'ui-ops__metrics' }, ...[['Agentes ativos', live.length], ['Em aberto', pending], ['Bloqueadas', blocked], ['Concluídas', completed], ['Atrasadas', overdue]].map(([k,v]) => h('div', { class: 'ui-ops__metric' }, h('strong', { text: String(v) }), h('span', { text: String(k) }))));
    const agentOptions = agents.map((a) => [a.id, `${a.name} · ${a.provider ?? 'Claude'}`] as [string,string]);
    const ideaTitle = h('input', { class: 'ui-ops-input', attrs: { maxlength: 180, placeholder: 'O que você quer que a equipe imagine ou faça?', required: true } }) as HTMLInputElement;
    const ideaBody = h('textarea', { class: 'ui-ops-input', attrs: { rows: 4, maxlength: 8000, placeholder: 'Contexto, objetivo, referências e restrições. A equipe vai analisar, levantar dúvidas e sugerir uma divisão do trabalho.' } }) as HTMLTextAreaElement;
    const ideaProject = h('input', { class: 'ui-ops-input', attrs: { maxlength: 240, placeholder: 'Projeto ou caminho de trabalho' } }) as HTMLInputElement;
    const ideaTeam = select(agentOptions); ideaTeam.multiple = true; ideaTeam.size = Math.min(6, Math.max(3, agents.length));
    const ideaStatus = h('span', { class: 'ui-ops__status', role: 'status' });
    const ideaSection = h('section', { class: 'ui-ops__section' }, h('h3', { text: 'Mural de ideias' }), h('p', { class: 'ui-muted ui-small', text: 'Publique uma ideia para abrir uma rodada de discussão. Cada agente recebe a proposta e pode apontar dúvidas, riscos e uma divisão possível do trabalho. As respostas aparecem em Resultados recentes.' }), h('div', { class: 'ui-ops__form' }, field('Ideia', ideaTitle), field('Detalhes e contexto', ideaBody), field('Projeto', ideaProject), field('Equipe (Ctrl/Cmd + clique para vários)', ideaTeam), h('div', { class: 'ui-ops__actions' }, h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: 'Publicar e consultar equipe', on: { click: () => void this.publishIdea(ideaTitle, ideaBody, ideaProject, ideaTeam, ideaStatus) } }), ideaStatus)));
    for (const idea of [...(this.data.ideas ?? [])].reverse()) {
      const responses = this.deliveries.filter((d) => d.request.includes(`MURAL:${idea.id}`));
      const reply = h('textarea', { class: 'ui-ops-input', attrs: { rows: 2, maxlength: 4000, placeholder: 'Responda às dúvidas ou direcione a próxima rodada' } }) as HTMLTextAreaElement;
      const replyStatus = h('span', { class: 'ui-ops__status', role: 'status' });
      const assignments = new Map<string, HTMLTextAreaElement>();
      const scopes = idea.agentIds.map((id) => { const agent = agents.find((a) => a.id === id); const input = h('textarea', { class: 'ui-ops-input', attrs: { rows: 2, maxlength: 600, placeholder: `Responsabilidade exclusiva de ${agent?.name ?? 'agente'} (ex.: implementar a API)` } }) as HTMLTextAreaElement; assignments.set(id, input); return field(agent?.name ?? 'Agente', input); });
      ideaSection.append(h('article', { class: 'ui-ops__task' }, h('div', { class: 'ui-ops__task-main' }, h('strong', { text: idea.title }), h('span', { class: 'ui-muted ui-small', text: `${idea.project || 'Sem projeto'} · ${idea.agentIds.length} agente(s) · ${responses.length}/${idea.agentIds.length} respostas` }), h('p', { class: 'ui-small', text: idea.body }), ...responses.map((d) => h('p', { class: 'ui-small' }, h('strong', { text: `${d.agentName ?? 'Agente'}: ` }), document.createTextNode((d.summary || d.text).slice(0, 700)))), reply, h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: 'Responder à equipe', on: { click: () => void this.replyToIdea(idea, reply, replyStatus) } }), h('h4', { text: 'Divisão de responsabilidades' }), h('p', { class: 'ui-muted ui-small', text: 'Defina uma entrega exclusiva para cada agente. A execução só começa quando todos estão designados e nenhuma responsabilidade está repetida.' }), ...scopes, h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: 'Criar tarefas e começar execução', on: { click: () => void this.executeIdea(idea, responses, assignments, replyStatus) } }), replyStatus)));
    }
    const taskTitle = h('input', { class: 'ui-ops-input', attrs: { maxlength: 180, placeholder: 'Ex.: preparar proposta comercial', required: true } }) as HTMLInputElement;
    const taskDesc = h('textarea', { class: 'ui-ops-input', attrs: { rows: 2, maxlength: 4000, placeholder: 'Resultado esperado e contexto' } }) as HTMLTextAreaElement;
    const projectList = h('datalist', { attrs: { id: 'ui-ops-projects' } });
    for (const room of this.ctx.store.snapshot?.rooms ?? []) projectList.append(h('option', { attrs: { value: room.path, label: room.name } }));
    const project = h('input', { class: 'ui-ops-input', attrs: { maxlength: 240, list: 'ui-ops-projects', placeholder: 'Escolha um projeto ou digite o caminho' } }) as HTMLInputElement;
    const owner = select(agentOptions); const deadline = h('input', { class: 'ui-ops-input', attrs: { type: 'date' } }) as HTMLInputElement;
    const dependency = select(tasks.filter((t) => t.status !== 'completed').map((t) => [t.id, t.title])); dependency.multiple = true; dependency.size = Math.min(4, Math.max(2, tasks.length));
    const taskStatus = h('span', { class: 'ui-ops__status', role: 'status' });
    const sharedInput = h('textarea', { class: 'ui-ops-input', attrs: { rows: 5, maxlength: 12000, placeholder: 'Princípios, preferências e contexto que todos os agentes devem conhecer.' } }) as HTMLTextAreaElement; sharedInput.value = this.data.sharedMemory;
    const sharedMemory = h('section', { class: 'ui-ops__section' }, h('h3', { text: 'Memória compartilhada da empresa' }), h('p', { class: 'ui-muted ui-small', text: 'Este conteúdo será incluído nas próximas mensagens enviadas pelo Habblaud a qualquer agente. Mantenha aqui apenas informações úteis para toda a equipe.' }), sharedInput, h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: 'Salvar memória compartilhada', on: { click: () => void this.saveSharedMemory(sharedInput.value) } }));
    const create = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: 'Adicionar tarefa', on: { click: () => void this.createTask(taskTitle, taskDesc, project, owner, deadline, dependency, taskStatus) } });
    const taskForm = h('div', { class: 'ui-ops__form' }, field('Resultado desejado', taskTitle), field('Contexto', taskDesc), field('Projeto', project), projectList, h('div', { class: 'ui-ops__row' }, field('Responsável', owner), field('Prazo', deadline)), field('Depende de (Ctrl/Cmd + clique para vários)', dependency), h('div', { class: 'ui-ops__actions' }, create, taskStatus));
    const taskList = h('div', { class: 'ui-ops__list' });
    if (!tasks.length) taskList.append(h('p', { class: 'ui-muted ui-small', text: 'Ainda não há tarefas. Crie a primeira acima.' }));
    for (const t of [...tasks].sort((a,b) => (a.status === 'completed' ? 1 : 0) - (b.status === 'completed' ? 1 : 0) || a.createdAt-b.createdAt)) taskList.append(this.taskCard(t, agents));
    const profileCards = agents.map((a) => this.profileCard(a));
    const codexAgents = agents.filter((a) => a.provider === 'codex');
    const codexSettings = codexAgents.length ? this.codexDefaultsCard(codexAgents) : undefined;
    const proposalSection = h('section', { class: 'ui-ops__section' }, h('h3', { text: 'Aprendizados para revisar' }), h('p', { class: 'ui-muted ui-small', text: 'Os agentes podem sugerir lembranças ao concluir tarefas. Nada entra na memória sem sua aprovação; a memória de cada projeto fica disponível em sessões futuras da mesma conta.' }));
    const proposalText = h('textarea', { class: 'ui-ops-input', attrs: { rows: 2, maxlength: 3000, placeholder: 'Escreva um aprendizado que a agente sugeriu nesta conversa' } }) as HTMLTextAreaElement;
    const proposalAgent = select(agentOptions); const proposalSource = h('input', { class: 'ui-ops-input', attrs: { maxlength: 400, placeholder: 'Origem: tarefa, conversa ou contexto' } }) as HTMLInputElement; const proposalScope = select([['conversation','Só esta conversa'],['company','Compartilhar com a empresa']]);
    proposalSection.append(h('div', { class: 'ui-ops__form' }, field('Agente / conversa de origem', proposalAgent), field('Aprendizado proposto', proposalText), field('Escopo ao aprovar', proposalScope), field('Origem', proposalSource), h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: 'Enviar para revisão', on: { click: () => void this.propose(proposalAgent.value, proposalText, proposalSource, proposalScope.value) } })));
    for (const p of this.data.proposals ?? []) proposalSection.append(this.proposalCard(p, agents));
    const profiles = h('section', { class: 'ui-ops__section' }, h('h3', { text: 'Identidade e função dos agentes' }), ...(profileCards.length ? profileCards : [h('p', { class: 'ui-muted ui-small', text: 'Abra uma conversa de agente para editar seu papel.' })]));
    const agentBoard = h('section', { class: 'ui-ops__section' }, h('h3', { text: 'Operação por agente' }));
    for (const a of agents) {
      const profile = this.data.profiles?.[`${a.provider ?? 'claude'}:${a.account}:${a.sessionId}`];
      const ownTasks = tasks.filter((t) => t.agentId === a.id);
      const done = ownTasks.filter((t) => t.status === 'completed').length;
      const spent = a.stats.costUSD === undefined ? 'estimativa indisponível' : `${a.provider === 'codex' ? '≈ ' : ''}US$ ${a.stats.costUSD.toFixed(a.stats.costUSD < 0.01 ? 6 : 2)}${a.provider === 'codex' ? ' (Standard)' : ''}`;
      agentBoard.append(h('article', { class: 'ui-ops__task' }, h('div', { class: 'ui-ops__task-main' }, h('strong', { text: `${profile?.name || a.name} · ${profile?.specialty || a.role}` }), h('span', { class: 'ui-muted ui-small', text: `${a.status} · ${done}/${ownTasks.length} tarefas concluídas · ${a.stats.toolCalls} ações · ${a.stats.tokensIn + a.stats.tokensOut} tokens · ${spent}` }))));
    }
    const results = h('section', { class: 'ui-ops__section' }, h('h3', { text: 'Resultados recentes' }));
    if (!this.deliveries.length) results.append(h('p', { class: 'ui-muted ui-small', text: 'As respostas finais e arquivos aparecem aqui quando a leitura de entregas está habilitada.' }));
    for (const d of this.deliveries.slice(0, 8)) {
      const a = this.ctx.store.snapshot?.agents.find((x) => x.id === d.agentId);
      const item = h('a', { class: 'ui-ops__result', attrs: { href: `?delivery=${encodeURIComponent(d.id)}` } }, h('strong', { text: d.headline }), h('span', { class: 'ui-muted ui-small', text: `${a?.name ?? d.agentName ?? 'Agente'} · ${d.attachments.length} arquivo(s) · ${new Date(d.finishedAt).toLocaleString()}` }), h('p', { class: 'ui-small', text: d.summary || d.text.slice(0, 220) }));
      results.append(item);
    }
    const codexPricing = codexAgents.length ? this.codexPricingCard() : undefined;
    this.body.replaceChildren(status, metrics, sharedMemory, ...(codexSettings ? [codexSettings] : []), ...(codexPricing ? [codexPricing] : []), ideaSection, this.teamChat.element, h('section', { class: 'ui-ops__section' }, h('h3', { text: 'Caixa de entrada de tarefas' }), taskForm, taskList), profiles, agentBoard, proposalSection, results);
  }
  private taskCard(t: Task, agents: AgentInfo[]): HTMLElement {
    const owner = agents.find((a) => a.id === t.agentId); const dep = t.dependsOn.map((id) => this.data.tasks.find((x) => x.id === id)?.title).filter(Boolean);
    const state = select(STATUS.map((s) => [s,LABEL[s]]), t.status);
    state.addEventListener('change', () => void this.saveTask({ ...t, status: state.value as Task['status'] }));
    const del = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: 'Remover', on: { click: () => void this.removeTask(t.id) } });
    const details = [t.project, owner ? `Responsável: ${owner.name}` : 'Sem responsável', t.dueAt ? `Prazo: ${new Date(t.dueAt).toLocaleDateString()}` : '', dep.length ? `Depois de: ${dep.join(', ')}` : '', owner ? `Uso: ${owner.stats.toolCalls} ações · ${owner.stats.tokensIn + owner.stats.tokensOut} tokens${owner.stats.costUSD === undefined ? '' : ` · $${owner.stats.costUSD.toFixed(2)}`}` : ''].filter(Boolean).join(' · ');
    const dispatch = owner?.canMessage && t.status !== 'completed' ? h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: 'Enviar ao agente', on: { click: () => void this.dispatchTask(t, owner) } }) : null;
    return h('article', { class: 'ui-ops__task' }, h('div', { class: 'ui-ops__task-main' }, h('strong', { text: t.title }), h('span', { class: 'ui-muted ui-small', text: details }), t.description ? h('p', { class: 'ui-small', text: t.description }) : null), h('div', { class: 'ui-ops__task-actions' }, state, dispatch, del));
  }
  private profileCard(a: AgentInfo): HTMLElement {
    const current = this.data.profiles?.[`${a.provider ?? 'claude'}:${a.account}:${a.sessionId}`] ?? { name: '', specialty: '', instructions: '', limits: '', updatedAt: 0 };
    const name = h('input', { class: 'ui-ops-input', attrs: { maxlength: 80, placeholder: a.name, value: current.name } }) as HTMLInputElement;
    const specialty = h('input', { class: 'ui-ops-input', attrs: { maxlength: 160, placeholder: 'Especialidade', value: current.specialty } }) as HTMLInputElement;
    const instructions = h('textarea', { class: 'ui-ops-input', attrs: { rows: 2, maxlength: 4000, placeholder: 'Instruções de trabalho' } }) as HTMLTextAreaElement; instructions.value = current.instructions;
    const limits = h('textarea', { class: 'ui-ops-input', attrs: { rows: 2, maxlength: 2000, placeholder: 'Limites e quando pedir aprovação' } }) as HTMLTextAreaElement; limits.value = current.limits;
    const save = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: 'Salvar função', on: { click: () => void this.saveProfile(a.id, { name: name.value, specialty: specialty.value, instructions: instructions.value, limits: limits.value }) } });
    return h('details', { class: 'ui-ops__profile' }, h('summary', { text: `${current.name || a.name} · ${current.specialty || a.role}` }), h('div', { class: 'ui-ops__form' }, field('Nome de trabalho', name), field('Especialidade', specialty), field('Instruções', instructions), field('Limites', limits), save));
  }
  private codexDefaultsCard(agents: AgentInfo[]): HTMLElement {
    const accounts = [...new Map(agents.map((agent) => [agent.account, agent])).values()];
    const account = select(accounts.map((agent) => [agent.account, `${agent.name} (${agent.account})`]));
    account.value = accounts[0]?.account ?? '';
    const modelList = h('datalist', { attrs: { id: 'habblaud-codex-models' } });
    const model = h('input', { class: 'ui-ops-input', attrs: { maxlength: 100, placeholder: 'Selecione ou digite um modelo', list: 'habblaud-codex-models' }, on: { focus: () => void this.loadCodexDefaults(account.value, modelList, model, effort) } }) as HTMLInputElement;
    const effort = select([['none', 'Nenhum'], ['minimal', 'Mínimo'], ['low', 'Baixo'], ['medium', 'Médio'], ['high', 'Alto'], ['xhigh', 'Extra alto'], ['max', 'Máximo'], ['ultra', 'Ultra']]);
    const initial = this.codexDefaults.get(account.value);
    if (initial) { model.value = initial.model; effort.value = initial.effort; for (const item of initial.models) modelList.append(h('option', { attrs: { value: item.id }, text: item.displayName || item.id })); }
    account.addEventListener('change', () => { const saved = this.codexDefaults.get(account.value); model.value = saved?.model ?? ''; effort.value = saved?.effort ?? ''; modelList.replaceChildren(); void this.loadCodexDefaults(account.value, modelList, model, effort); });
    const apply = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: 'Salvar padrão da conta', on: { click: () => void this.applyCodexDefaults(account.value, model, effort) } });
    return h('section', { class: 'ui-ops__section' }, h('h3', { text: 'Modelo e raciocínio do Codex' }), h('p', { class: 'ui-muted ui-small', text: 'Define os padrões do CODEX_HOME selecionado para novas conversas. Threads já abertos mantêm as configurações atuais; abra uma nova conversa do Codex para usar o padrão salvo.' }), h('div', { class: 'ui-ops__form' }, field('Conta do Codex', account), field('Modelo', model), modelList, field('Força do raciocínio', effort), apply));
  }
  private codexPricingCard(): HTMLElement {
    const money = (value: number) => `US$ ${value.toFixed(value < 0.01 ? 3 : 2)}`;
    const rows = CODEX_MODEL_PRICES.map((price) => h('tr', {},
      h('th', { text: price.label, attrs: { scope: 'row' } }),
      h('td', { text: money(price.input) }),
      h('td', { text: money(price.cachedInput) }),
      h('td', { text: money(price.output) }),
      h('td', { text: `${money(price.input * 2)} / ${money(price.cachedInput * 2)} / ${money(price.output * 2)}` }),
    ));
    const table = h('table', { class: 'ui-ops__pricing' },
      h('thead', {}, h('tr', {}, h('th', { text: 'Modelo' }), h('th', { text: 'Entrada' }), h('th', { text: 'Entrada em cache' }), h('th', { text: 'Saída' }), h('th', { text: 'Fast: entrada / cache / saída' }))),
      h('tbody', {}, ...rows),
    );
    return h('section', { class: 'ui-ops__section' },
      h('h3', { text: 'Tarifas de referência do Codex' }),
      h('p', { class: 'ui-muted ui-small', text: 'USD por 1 milhão de tokens. A estimativa usa Standard; Fast dobra as tarifas por token em cobrança Enterprise tokenizada. Em planos com uso incluído, Fast consome 2,5× da franquia. O Habblaud não consegue identificar com segurança o plano nem se cada turno foi Fast, então isto é equivalente estimado, não uma fatura.' }),
      table,
      h('p', { class: 'ui-muted ui-small', text: 'Cache writes não são tarifados. O esforço de raciocínio não altera o preço por token, mas pode aumentar os tokens consumidos. Tarifas consultadas em 13/10/2026; sua conta/contrato pode usar créditos ou outras condições.' }),
    );
  }
  private async loadCodexDefaults(account: string, list: HTMLElement, model: HTMLInputElement, effort: HTMLSelectElement): Promise<void> {
    if (!account) return;
    if (this.codexDefaults.has(account)) {
      const saved = this.codexDefaults.get(account);
      if (saved && !list.childElementCount) for (const item of saved.models) list.append(h('option', { attrs: { value: item.id }, text: item.displayName || item.id }));
      return;
    }
    try {
      const query = `?account=${encodeURIComponent(account)}`;
      const [modelsRes, defaultsRes] = await Promise.all([fetch(`/api/codex/models${query}`, { cache: 'no-store' }), fetch(`/api/codex/defaults${query}`, { cache: 'no-store' })]);
      const body = await modelsRes.json() as { models?: Array<{ id?: string; displayName?: string }> };
      const saved = await defaultsRes.json() as { defaults?: { model?: string; effort?: string } };
      if (!modelsRes.ok || !defaultsRes.ok) throw new Error('Não foi possível carregar as configurações do Codex.');
      const models = (body.models ?? []).filter((item): item is { id: string; displayName?: string } => typeof item.id === 'string');
      const defaults = { model: saved.defaults?.model ?? '', effort: saved.defaults?.effort ?? '', models };
      this.codexDefaults.set(account, defaults);
      model.value = defaults.model; effort.value = defaults.effort;
      for (const item of models) list.append(h('option', { attrs: { value: item.id }, text: item.displayName || item.id }));
    } catch { /* O campo continua aceitando um id de modelo digitado manualmente. */ }
  }
  private async applyCodexDefaults(account: string, model: HTMLInputElement, effort: HTMLSelectElement): Promise<void> {
    await this.run(async () => {
      const query = `?account=${encodeURIComponent(account)}`;
      const res = await fetch(`/api/codex/defaults${query}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: model.value.trim(), effort: effort.value }) });
      const body = await res.json() as { error?: string; defaults?: { model?: string; effort?: string } };
      if (!res.ok) throw new Error(body.error || 'Não foi possível alterar as configurações do Codex.');
      const previous = this.codexDefaults.get(account);
      this.codexDefaults.set(account, { model: body.defaults?.model ?? '', effort: body.defaults?.effort ?? '', models: previous?.models ?? [] });
    });
  }
  private proposalCard(p: Proposal, agents: AgentInfo[]): HTMLElement {
    const agent = agents.find((a) => a.id === p.agentId);
    const scope = p.scope === 'company' ? 'Memória compartilhada' : 'Memória desta conversa';
    const origin = agent?.name ?? ([p.provider, p.account, p.roomId && `sala ${p.roomId.slice(0, 10)}`].filter(Boolean).join(' · ') || 'Agente');
    return h('article', { class: 'ui-ops__proposal' }, h('p', { text: p.text }), h('span', { class: 'ui-muted ui-small', text: `${origin} · ${scope} · ${p.source || 'conversa'}` }), h('div', { class: 'ui-ops__actions' }, h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: p.scope === 'company' ? 'Aprovar e compartilhar' : 'Aprovar e salvar na memória', on: { click: () => void this.proposalAction(p.id, 'approve') } }), h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: 'Descartar', on: { click: () => void this.proposalAction(p.id, 'dismiss') } })));
  }
  private async createTask(title: HTMLInputElement, description: HTMLTextAreaElement, project: HTMLInputElement, owner: HTMLSelectElement, deadline: HTMLInputElement, dependency: HTMLSelectElement, status: HTMLElement): Promise<void> {
    if (!title.value.trim() || this.busy) { setText(status, 'Informe o resultado desejado.'); return; }
    const dueAt = deadline.value ? new Date(`${deadline.value}T23:59:59`).getTime() : null;
    const dependsOn = [...dependency.selectedOptions].map((option) => option.value).filter(Boolean);
    await this.run(async () => send('/api/company/tasks', 'POST', { title: title.value, description: description.value, project: project.value, agentId: owner.value, dueAt, dependsOn }), status);
  }
  private async saveTask(task: Partial<Task>): Promise<void> { await this.run(() => send('/api/company/tasks', 'POST', task)); }
  private async publishIdea(title: HTMLInputElement, body: HTMLTextAreaElement, project: HTMLInputElement, team: HTMLSelectElement, status: HTMLElement): Promise<void> {
    const agentIds = [...team.selectedOptions].map((o) => o.value).filter(Boolean);
    if (!title.value.trim() || !body.value.trim() || !agentIds.length) { setText(status, 'Preencha a ideia, o contexto e escolha pelo menos um agente.'); return; }
    await this.run(async () => {
      const res = await fetch('/api/company/ideas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title.value, body: body.value, project: project.value, agentIds }) });
      const response = await res.json() as { idea?: Idea; error?: string }; if (!res.ok || !response.idea) throw new Error(response.error || 'Não foi possível publicar a ideia.');
      const idea = response.idea; const agents = this.agents();
      const messages = agentIds.map(async (id) => { const a = agents.find((x) => x.id === id); if (!a?.canMessage) return; const text = `MURAL:${idea.id} — ${idea.title}\n\nIDEIA DA EQUIPE: ${idea.body}\nProjeto: ${idea.project || 'não definido'}\n\nAnalise a proposta de forma independente. Responda no seu próprio estilo: faça perguntas se houver ambiguidades, aponte riscos e sugira tarefas concretas para dividir o trabalho entre os agentes selecionados. Não inicie alterações no projeto ainda; primeiro apresente sua análise e diga o que precisa ser esclarecido.`; const r = await fetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId: id, text }) }); const b = await r.json() as { error?: string }; if (!r.ok) throw new Error(`${a.name}: ${b.error || 'falha no envio'}`); });
      const results = await Promise.allSettled(messages); const errors = results.filter((x): x is PromiseRejectedResult => x.status === 'rejected').map((x) => String(x.reason)); if (errors.length) throw new Error(`Ideia salva; alguns envios falharam: ${errors.join('; ')}`);
    }, status);
  }
  private async replyToIdea(idea: Idea, reply: HTMLTextAreaElement, status: HTMLElement): Promise<void> {
    const text = reply.value.trim(); if (!text) { setText(status, 'Escreva uma orientação antes de enviar.'); return; }
    await this.run(async () => {
      const agents = this.agents().filter((a) => idea.agentIds.includes(a.id) && a.canMessage);
      if (!agents.length) throw new Error('Nenhum agente da equipe está disponível para receber mensagens.');
      const results = await Promise.allSettled(agents.map(async (agent) => { const r = await fetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId: agent.id, text: `MURAL:${idea.id} — atualização de William\n\n${text}\n\nConsidere também as análises dos colegas já visíveis no mural. Atualize suas dúvidas, riscos e proposta de divisão do trabalho.` }) }); const b = await r.json() as { error?: string }; if (!r.ok) throw new Error(`${agent.name}: ${b.error || 'falha no envio'}`); }));
      const errors = results.filter((x): x is PromiseRejectedResult => x.status === 'rejected').map((x) => String(x.reason)); if (errors.length) throw new Error(errors.join('; '));
      reply.value = '';
    }, status);
  }
  private async executeIdea(idea: Idea, responses: DeliveryInfo[], assignments: Map<string, HTMLTextAreaElement>, status: HTMLElement): Promise<void> {
    await this.run(async () => {
      const agents = this.agents();
      const chosen = idea.agentIds.map((id) => ({ agent: agents.find((a) => a.id === id), scope: assignments.get(id)?.value.trim() ?? '' }));
      if (chosen.some((item) => !item.agent?.canMessage)) throw new Error('Todos os agentes designados precisam estar disponíveis para mensagens.');
      if (chosen.some((item) => !item.scope)) throw new Error('Defina uma responsabilidade para cada agente antes de iniciar.');
      const normalized = chosen.map((item) => item.scope.toLocaleLowerCase().replace(/[\s.,;:!?]+/g, ' ').trim());
      if (new Set(normalized).size !== normalized.length) throw new Error('As responsabilidades precisam ser diferentes entre si.');
      const discussion = responses.map((d) => `\n${d.agentName ?? 'Agente'}: ${(d.summary || d.text).slice(0, 1800)}`).join('\n');
      const results = await Promise.allSettled(chosen.map(async ({ agent, scope }) => {
        const taskResponse = await fetch('/api/company/tasks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: `${idea.title}: ${scope}`.slice(0, 180), description: `Ideia do mural: ${idea.body}\nResponsabilidade exclusiva: ${scope}\n\nDiscussão da equipe:${discussion}`, project: idea.project, agentId: agent!.id, status: 'pending', dependsOn: [] }) });
        const taskData = await taskResponse.json() as { task?: Task; error?: string }; if (!taskResponse.ok || !taskData.task) throw new Error(`${agent!.name}: ${taskData.error || 'falha ao criar tarefa'}`);
        const r = await fetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId: agent!.id, text: `MURAL:${idea.id} — execução atribuída\n\nIDEIA: ${idea.title}\n${idea.body}\nProjeto: ${idea.project || 'não definido'}\n\nSUA RESPONSABILIDADE EXCLUSIVA: ${scope}\n\nA divisão está registrada como tarefas separadas. Trabalhe somente nessa responsabilidade e não replique a entrega dos colegas. Considere a discussão reunida abaixo. Se houver dependência real ou conflito entre escopos, pare e pergunte antes de alterar o projeto. Ao concluir, relate arquivos e resultado.\n${discussion}` }) });
        const b = await r.json() as { error?: string }; if (!r.ok) throw new Error(`${agent!.name}: ${b.error || 'falha no envio'}`);
        await send('/api/company/tasks', 'POST', { ...taskData.task, status: 'in_progress' });
      }));
      const errors = results.filter((x): x is PromiseRejectedResult => x.status === 'rejected').map((x) => String(x.reason)); if (errors.length) throw new Error(errors.join('; '));
    }, status);
  }
  private async removeTask(id: string): Promise<void> { await this.run(() => send(`/api/company/tasks/${encodeURIComponent(id)}`, 'DELETE')); }
  private async dispatchTask(t: Task, agent: AgentInfo): Promise<void> {
    const blocked = t.dependsOn.map((id) => this.data.tasks.find((x) => x.id === id)).filter((x) => x && x.status !== 'completed');
    if (blocked.length) { this.message = `Aguarde as dependências: ${blocked.map((x) => x!.title).join(', ')}`; this.draw(); return; }
    const deps = t.dependsOn.map((id) => this.data.tasks.find((x) => x.id === id)?.title).filter(Boolean);
    const text = [`TAREFA DA EMPRESA: ${t.title}`, t.description && `Resultado esperado: ${t.description}`, t.project && `Projeto: ${t.project}`, t.dueAt && `Prazo: ${new Date(t.dueAt).toLocaleDateString()}`, deps.length && `Dependências concluídas: ${deps.join(', ')}`, 'Ao terminar, registre o resultado, arquivos gerados e próximos passos na resposta final.'].filter(Boolean).join('\n');
    await this.run(async () => { const res = await fetch('/api/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agentId: agent.id, text }) }); const body = await res.json() as { error?: string }; if (!res.ok) throw new Error(body.error || 'Não foi possível enviar a tarefa ao agente.'); await send('/api/company/tasks', 'POST', { ...t, status: 'in_progress' }); });
  }
  private async saveProfile(agentId: string, profile: Omit<Profile, 'updatedAt'>): Promise<void> { await this.run(() => send('/api/company/profile', 'PUT', { agentId, profile })); }
  private async saveSharedMemory(text: string): Promise<void> { await this.run(() => send('/api/company/shared-memory', 'PUT', { text })); }
  private async propose(agentId: string, text: HTMLTextAreaElement, source: HTMLInputElement, scope: string): Promise<void> { if (!agentId || !text.value.trim()) { this.message = 'Escolha agente e escreva o aprendizado.'; this.draw(); return; } await this.run(() => send('/api/company/proposals', 'POST', { agentId, text: text.value, source: source.value, scope })); }
  private async proposalAction(id: string, action: 'approve'|'dismiss'): Promise<void> { await this.run(() => send(`/api/company/proposals/${encodeURIComponent(id)}/${action}`, 'POST')); }
  private async run(action: () => Promise<void>, status?: HTMLElement): Promise<void> { if (this.busy) return; this.busy = true; try { await action(); this.message = 'Salvo.'; await this.refresh(true); } catch (e) { const m = e instanceof Error ? e.message : 'Falha ao salvar'; if (status) setText(status, m); else this.message = m; this.draw(); } finally { this.busy = false; } }
}
