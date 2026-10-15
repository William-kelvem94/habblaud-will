// Identidade local da empresa e memória persistente das sessões de agentes.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { AgentInfo } from '../../shared/types';
import { errMsg, log } from '../log';

export const COMPANY_NAME_MAX = 80;
export const AGENT_MEMORY_MAX = 12_000;
const MEMORY_LIMIT = 500;
const PROFILE_LIMIT = 500;
const TASK_LIMIT = 500;
const IDEA_LIMIT = 200;

export interface SavedMemory {
  text: string;
  updatedAt: number;
}

export interface AgentProfile { name: string; specialty: string; instructions: string; limits: string; updatedAt: number }
export interface CompanyTask {
  id: string; title: string; description: string; project: string; agentId: string; status: 'pending' | 'in_progress' | 'blocked' | 'completed';
  dueAt: number | null; dependsOn: string[]; createdAt: number; updatedAt: number;
}
export interface MemoryProposal {
  id: string;
  agentId: string;
  text: string;
  source: string;
  scope: 'conversation' | 'company';
  createdAt: number;
  /** Identidade persistente da origem; permite aprovar após a sessão sair do escritório. */
  provider?: AgentInfo['provider'];
  account?: string;
  sessionId?: string;
  roomId?: string;
  /** Chave estável do agente/provedor/conta onde a memória de conversa será aprovada. */
  memoryOwnerKey?: string;
  /** Identificador da entrega automática, usado para evitar propostas duplicadas durante rescans. */
  eventId?: string;
}
export interface CompanyIdea { id: string; title: string; body: string; project: string; agentIds: string[]; createdAt: number }
interface CompanyFile {
  version: 4;
  name: string;
  sharedMemory: SavedMemory;
  memories: Record<string, SavedMemory>;
  profiles: Record<string, AgentProfile>;
  tasks: CompanyTask[];
  proposals: MemoryProposal[];
  memoryEventIds: string[];
  ideas: CompanyIdea[];
}

function record(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Chave legada da conversa; mantida para ler as memórias já salvas por sessão. */
export function memoryKey(agent: Pick<AgentInfo, 'provider' | 'account' | 'sessionId'>): string {
  return `${agent.provider ?? 'claude'}:${agent.account}:${agent.sessionId}`;
}

/** Memória de conversa compartilhada entre sessões da mesma conta e provedor. */
export function conversationMemoryKey(agent: Pick<AgentInfo, 'provider' | 'account'> & { roomId?: string }): string {
  const provider = agent.provider ?? 'claude';
  const account = encodeURIComponent(agent.account);
  // Agentes sem projeto conhecido mantêm o namespace de conta usado pela versão anterior.
  return agent.roomId
    ? `conversation:${provider}:${account}:${encodeURIComponent(agent.roomId)}`
    : `conversation:${provider}:${agent.account}`;
}

export function companyName(value: unknown, fallback = 'William Pereira'): string {
  if (typeof value !== 'string') return fallback;
  const text = value.trim().replace(/[\r\n\0]/g, ' ').slice(0, COMPANY_NAME_MAX);
  return text || fallback;
}

function parseFile(raw: string, fallbackName: string): CompanyFile {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!record(parsed)) throw new Error('invalid company file');
    const memories: Record<string, SavedMemory> = {};
    if (record(parsed.memories)) {
      for (const [key, value] of Object.entries(parsed.memories).slice(-MEMORY_LIMIT)) {
        if (!record(value) || typeof value.text !== 'string' || typeof value.updatedAt !== 'number') continue;
        const text = value.text.slice(0, AGENT_MEMORY_MAX);
        // Texto vazio é um tombstone: preserva dados antigos sem reativá-los após o usuário limpar a chave estável.
        memories[key] = { text, updatedAt: value.updatedAt };
      }
    }
    const profiles: Record<string, AgentProfile> = {};
    if (record(parsed.profiles)) for (const [key, value] of Object.entries(parsed.profiles)) {
      if (!record(value)) continue;
      profiles[key] = { name: clean(value.name, 80), specialty: clean(value.specialty, 160), instructions: clean(value.instructions, 4000), limits: clean(value.limits, 2000), updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : 0 };
    }
    const tasks = Array.isArray(parsed.tasks) ? parsed.tasks.filter(validTask).slice(-500) : [];
    const proposals = Array.isArray(parsed.proposals) ? parsed.proposals.filter(validProposal).slice(-200).map((p) => ({ ...p, scope: p.scope ?? 'conversation' })) : [];
    const shared = record(parsed.sharedMemory) ? parsed.sharedMemory : {};
    const sharedMemory = { text: clean(shared.text ?? parsed.sharedMemory, AGENT_MEMORY_MAX), updatedAt: typeof shared.updatedAt === 'number' ? shared.updatedAt : 0 };
    const memoryEventIds = Array.isArray(parsed.memoryEventIds) ? parsed.memoryEventIds.filter((id): id is string => typeof id === 'string').slice(-2000) : [];
    const ideas = Array.isArray(parsed.ideas) ? parsed.ideas.filter(validIdea).slice(-IDEA_LIMIT) : [];
    return { version: 4, name: companyName(parsed.name, fallbackName), sharedMemory, memories, profiles, tasks, proposals, memoryEventIds, ideas };
  } catch {
    throw new Error('invalid company file');
  }
}

function clean(value: unknown, max: number): string { return typeof value === 'string' ? value.trim().replace(/\0/g, '').slice(0, max) : ''; }
function validTask(value: unknown): value is CompanyTask {
  if (!record(value)) return false;
  return typeof value.id === 'string' && typeof value.title === 'string' && typeof value.description === 'string' && typeof value.project === 'string' && typeof value.agentId === 'string' && ['pending','in_progress','blocked','completed'].includes(String(value.status)) && (value.dueAt === null || typeof value.dueAt === 'number') && Array.isArray(value.dependsOn) && typeof value.createdAt === 'number' && typeof value.updatedAt === 'number';
}
function validProposal(value: unknown): value is MemoryProposal {
  return !!record(value) && typeof value.id === 'string' && typeof value.agentId === 'string' && typeof value.text === 'string' && typeof value.source === 'string' && typeof value.createdAt === 'number' && (value.scope === undefined || value.scope === 'conversation' || value.scope === 'company') && (value.provider === undefined || value.provider === 'claude' || value.provider === 'codex') && (value.account === undefined || typeof value.account === 'string') && (value.sessionId === undefined || typeof value.sessionId === 'string') && (value.roomId === undefined || typeof value.roomId === 'string') && (value.memoryOwnerKey === undefined || typeof value.memoryOwnerKey === 'string') && (value.eventId === undefined || typeof value.eventId === 'string');
}
function validIdea(value: unknown): value is CompanyIdea { return !!record(value) && typeof value.id === 'string' && typeof value.title === 'string' && typeof value.body === 'string' && typeof value.project === 'string' && Array.isArray(value.agentIds) && typeof value.createdAt === 'number'; }

/** Armazenamento local atômico; a memória nunca é enviada a um serviço externo. */
export class CompanyStore {
  private data: CompanyFile;

  constructor(private readonly file: string, initialName = 'William Pereira', private readonly now: () => number = Date.now) {
    let raw: string | undefined;
    try {
      raw = readFileSync(file, 'utf8');
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') log.warnOnce('company-read', `Não foi possível ler ${this.file} (${errMsg(err)}).`);
    }
    let parsed: CompanyFile | undefined;
    if (raw) {
      try { parsed = parseFile(raw, companyName(initialName)); }
      catch {
        try { renameSync(file, `${file}.corrupt-${this.now()}`); }
        catch (err) { log.warnOnce('company-recovery', `Não foi possível preservar o arquivo inválido ${file} (${errMsg(err)}).`); }
        log.warnOnce('company-recovery-message', 'O arquivo de dados da empresa estava inválido; uma cópia foi preservada quando possível.');
      }
    }
    this.data = parsed ?? { version: 4, name: companyName(initialName), sharedMemory: { text: '', updatedAt: 0 }, memories: {}, profiles: {}, tasks: [], proposals: [], memoryEventIds: [], ideas: [] };
    if (!raw || !parsed) this.flush();
  }

  name(): string {
    return this.data.name;
  }

  setName(value: unknown): string | undefined {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > COMPANY_NAME_MAX) return undefined;
    this.data.name = companyName(value, this.data.name);
    this.flush();
    return this.data.name;
  }
  sharedMemory(): SavedMemory { return { ...this.data.sharedMemory }; }
  setSharedMemory(value: unknown): SavedMemory | undefined {
    if (typeof value !== 'string' || value.length > AGENT_MEMORY_MAX || value.includes('\0')) return;
    this.data.sharedMemory = { text: value.trim(), updatedAt: this.now() }; this.flush(); return { ...this.data.sharedMemory };
  }

  snapshot() { return { name: this.data.name, profiles: { ...this.data.profiles }, tasks: this.data.tasks.map((t) => ({ ...t, dependsOn: [...t.dependsOn] })), proposals: this.data.proposals.map((p) => ({ ...p })), ideas: this.data.ideas.map((i) => ({ ...i, agentIds: [...i.agentIds] })) }; }
  saveIdea(input: unknown): CompanyIdea | undefined { if (!record(input)) return; const title = clean(input.title, 180), body = clean(input.body, 8000); if (!title || !body) return; const now = this.now(); const idea: CompanyIdea = { id: `${now.toString(36)}-${Math.random().toString(36).slice(2,8)}`, title, body, project: clean(input.project,240), agentIds: Array.isArray(input.agentIds) ? [...new Set(input.agentIds.filter((x): x is string => typeof x === 'string'))].slice(0,30) : [], createdAt: now }; if (!idea.agentIds.length || this.data.ideas.length >= IDEA_LIMIT) return; this.data.ideas.push(idea); this.flush(); return { ...idea, agentIds: [...idea.agentIds] }; }
  proposal(id: string) { const p = this.data.proposals.find((x) => x.id === id); return p ? { ...p } : undefined; }
  profile(key: string): AgentProfile { return { ...(this.data.profiles[key] ?? { name: '', specialty: '', instructions: '', limits: '', updatedAt: 0 }) }; }
  setProfile(key: string, value: unknown): AgentProfile | undefined {
    if (!record(value)) return;
    if (!this.data.profiles[key] && Object.keys(this.data.profiles).length >= PROFILE_LIMIT) return;
    const profile: AgentProfile = { name: clean(value.name, 80), specialty: clean(value.specialty, 160), instructions: clean(value.instructions, 4000), limits: clean(value.limits, 2000), updatedAt: this.now() };
    this.data.profiles[key] = profile; this.flush(); return { ...profile };
  }
  saveTask(input: unknown): CompanyTask | undefined {
    if (!record(input)) return;
    const now = this.now();
    const existing = typeof input.id === 'string' ? this.data.tasks.find((t) => t.id === input.id) : undefined;
    if (!existing && this.data.tasks.length >= TASK_LIMIT) return;
    const title = clean(input.title, 180); if (!title) return;
    const status = ['pending','in_progress','blocked','completed'].includes(String(input.status)) ? input.status as CompanyTask['status'] : 'pending';
    const dependsOn = Array.isArray(input.dependsOn) ? [...new Set(input.dependsOn.filter((x): x is string => typeof x === 'string' && x !== (existing?.id ?? input.id) && this.data.tasks.some((t) => t.id === x)))].slice(0,20) : [];
    const task: CompanyTask = { id: existing?.id ?? `${now.toString(36)}-${Math.random().toString(36).slice(2,8)}`, title, description: clean(input.description, 4000), project: clean(input.project, 240), agentId: clean(input.agentId, 240), status, dueAt: typeof input.dueAt === 'number' && Number.isFinite(input.dueAt) ? input.dueAt : null, dependsOn, createdAt: existing?.createdAt ?? now, updatedAt: now };
    if (existing) Object.assign(existing, task); else this.data.tasks.push(task);
    this.flush(); return { ...task };
  }
  deleteTask(id: string): boolean { const n = this.data.tasks.length; this.data.tasks = this.data.tasks.filter((t) => t.id !== id); if (this.data.tasks.length === n) return false; this.data.tasks.forEach((t) => t.dependsOn = t.dependsOn.filter((d) => d !== id)); this.flush(); return true; }
  proposeMemory(agentId: string, text: unknown, source: unknown, scope: unknown = 'conversation', owner?: Pick<AgentInfo, 'provider' | 'account' | 'sessionId' | 'roomId'>): MemoryProposal | undefined {
    if (this.data.proposals.length >= 200) return;
    const cleanText = clean(text, 3000); if (!cleanText) return;
    const proposal: MemoryProposal = { id: `${this.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`, agentId: clean(agentId, 240), text: cleanText, source: clean(source, 400), scope: scope === 'company' ? 'company' : 'conversation', createdAt: this.now(), ...(owner ? { provider: owner.provider ?? 'claude', account: clean(owner.account, 240), sessionId: clean(owner.sessionId, 240), roomId: clean(owner.roomId, 240), memoryOwnerKey: conversationMemoryKey(owner) } : {}) };
    this.data.proposals.push(proposal); this.data.proposals = this.data.proposals.slice(-200); this.flush(); return { ...proposal };
  }
  /** Cria uma proposta automática uma única vez por entrega, sem alterar a memória até aprovação. */
  proposeAutomaticMemory(
    agent: Pick<AgentInfo, 'id' | 'provider' | 'account' | 'sessionId'> & { roomId?: string },
    scope: 'conversation' | 'company',
    text: unknown,
    eventId: string,
    source: unknown,
  ): boolean {
    const cleanText = clean(text, 1500).replace(/[\r\n]+/g, ' ');
    if (!cleanText || !eventId || this.data.memoryEventIds.includes(eventId) || this.data.proposals.length >= 200) return false;
    const proposal: MemoryProposal = {
      id: `${this.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      agentId: clean(agent.id, 240),
      text: cleanText,
      source: clean(source, 400),
      scope,
      createdAt: this.now(),
      provider: agent.provider ?? 'claude',
      account: clean(agent.account, 240),
      sessionId: clean(agent.sessionId, 240),
      ...(agent.roomId ? { roomId: clean(agent.roomId, 500) } : {}),
      memoryOwnerKey: conversationMemoryKey(agent),
      eventId,
    };
    if (!proposal.agentId || !proposal.account || !proposal.sessionId) return false;
    this.data.proposals.push(proposal);
    this.data.proposals = this.data.proposals.slice(-200);
    this.data.memoryEventIds.push(eventId);
    this.data.memoryEventIds = this.data.memoryEventIds.slice(-2000);
    this.flush();
    return true;
  }
  removeProposal(id: string): boolean { const n = this.data.proposals.length; this.data.proposals = this.data.proposals.filter((p) => p.id !== id); if (n === this.data.proposals.length) return false; this.flush(); return true; }

  memory(agent: Pick<AgentInfo, 'provider' | 'account' | 'sessionId'> & { roomId?: string }): SavedMemory {
    const saved = this.data.memories[conversationMemoryKey(agent)] ?? this.data.memories[memoryKey(agent)];
    return saved ? { ...saved } : { text: '', updatedAt: 0 };
  }

  memoryText(agent: Pick<AgentInfo, 'provider' | 'account' | 'sessionId'> & { roomId?: string }): string {
    return this.data.memories[conversationMemoryKey(agent)]?.text ?? this.data.memories[memoryKey(agent)]?.text ?? '';
  }

  setMemory(agent: Pick<AgentInfo, 'provider' | 'account' | 'sessionId'> & { roomId?: string }, value: unknown): SavedMemory | undefined {
    if (typeof value !== 'string' || value.length > AGENT_MEMORY_MAX || value.includes('\0')) return undefined;
    const key = conversationMemoryKey(agent);
    return this.setMemoryByOwnerKey(key, value);
  }

  /** Grava memória aprovada por sua chave estável, mesmo quando a sessão de origem já encerrou. */
  memoryByOwnerKey(key: string): SavedMemory {
    if (!/^conversation:(claude|codex):[^\0]{1,800}$/.test(key)) return { text: '', updatedAt: 0 };
    const saved = this.data.memories[key];
    return saved ? { ...saved } : { text: '', updatedAt: 0 };
  }

  setMemoryByOwnerKey(key: string, value: unknown): SavedMemory | undefined {
    if (!/^conversation:(claude|codex):[^\0]{1,800}$/.test(key) || typeof value !== 'string' || value.length > AGENT_MEMORY_MAX || value.includes('\0')) return undefined;
    this.data.memories[key] = { text: value.trim(), updatedAt: this.now() };
    const kept = Object.entries(this.data.memories).sort((a, b) => b[1].updatedAt - a[1].updatedAt).slice(0, MEMORY_LIMIT);
    this.data.memories = Object.fromEntries(kept);
    this.flush();
    return { ...this.data.memories[key] };
  }

  /** Compatibilidade para chamadores antigos. Aprendizados automáticos atuais devem virar propostas. */
  applyAutomaticMemory(agent: Pick<AgentInfo, 'provider' | 'account' | 'sessionId'>, scope: 'conversation' | 'company', value: unknown, eventId: string): boolean {
    const text = clean(value, 1500).replace(/[\r\n]+/g, ' ');
    if (!text || !eventId || this.data.memoryEventIds.includes(eventId)) return false;
    const key = conversationMemoryKey(agent);
    const target = scope === 'company' ? this.data.sharedMemory : (this.data.memories[key] ?? this.data.memories[memoryKey(agent)] ?? { text: '', updatedAt: 0 });
    const normalized = (s: string) => s.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
    if (!target.text.split(/\n/).some((line) => normalized(line.replace(/^[-*•]\s*/, '')) === normalized(text))) {
      const line = `• ${text}`;
      const next = target.text ? `${target.text.trim()}\n${line}` : line;
      if (next.length > AGENT_MEMORY_MAX) return false;
      if (scope === 'company') this.data.sharedMemory = { text: next, updatedAt: this.now() };
      else this.data.memories[key] = { text: next, updatedAt: this.now() };
    }
    this.data.memoryEventIds.push(eventId);
    this.data.memoryEventIds = this.data.memoryEventIds.slice(-2000);
    this.flush();
    return true;
  }

  private flush(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.data, null, 2), { encoding: 'utf8', mode: 0o600 });
      renameSync(tmp, this.file);
      log.clearOnce('company-write');
    } catch (err) {
      log.warnOnce('company-write', `Não foi possível gravar ${this.file} (${errMsg(err)}).`);
    }
  }
}

