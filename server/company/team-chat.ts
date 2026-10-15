// Conversas duráveis entre participantes da equipe. Armazenamento em arquivo próprio
// dentro de dataDir para não acoplar esta camada à serialização atual de CompanyStore.
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { log } from '../log';

export const TEAM_CHAT_TITLE_MAX = 180;
export const TEAM_CHAT_PARTICIPANTS_MAX = 30;
export const TEAM_CHAT_MESSAGE_MAX = 8_000;
export const TEAM_CHAT_MESSAGES_PER_THREAD_MAX = 500;
export const TEAM_CHAT_THREADS_MAX = 500;
export const TEAM_CHAT_FILE_MAX_BYTES = 32 * 1024 * 1024;

export interface TeamChatMessage {
  id: string;
  threadId: string;
  senderId: string;
  text: string;
  createdAt: number;
}

export interface TeamChatThread {
  id: string;
  title: string;
  participants: string[];
  createdAt: number;
  updatedAt: number;
  messages: TeamChatMessage[];
}

export type TeamChatSummary = Omit<TeamChatThread, 'messages'> & { messageCount: number; lastMessage?: TeamChatMessage };

interface TeamChatFile {
  version: 1;
  threads: TeamChatThread[];
}

export type CreateTeamChatThread = { title: unknown; participants: unknown };

/**
 * Armazena mensagens reais em `<dataDir>/team-chat.json` com gravação atômica.
 * Os identificadores dos participantes são opacos (por exemplo, os IDs de AgentInfo);
 * a camada HTTP deve validar que eles correspondem a agentes/usuários autorizados.
 */
export class TeamChatStore {
  private threads: TeamChatThread[];

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
    private readonly newId: () => string = randomUUID,
  ) {
    this.threads = this.load();
  }

  /** Lista threads mais recentes primeiro; se informado, restringe às de um participante. */
  listThreads(participantId?: string): TeamChatThread[] {
    return [...this.threads]
      .filter((thread) => participantId === undefined || thread.participants.includes(participantId))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(copyThread);
  }

  /** Metadados leves para atualizar a lista sem reenviar todo o histórico a cada polling. */
  listThreadSummaries(): TeamChatSummary[] {
    return [...this.threads]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(({ messages, ...thread }) => ({ ...thread, messageCount: messages.length, ...(messages.length ? { lastMessage: { ...messages[messages.length - 1]! } } : {}) }));
  }

  /** Retorna uma cópia completa da thread, incluindo mensagens em ordem cronológica. */
  getThread(threadId: string): TeamChatThread | undefined {
    const thread = this.threads.find((item) => item.id === threadId);
    return thread ? copyThread(thread) : undefined;
  }

  /** Cria uma conversa com participantes estáveis identificados por IDs opacos. */
  createThread(input: CreateTeamChatThread): TeamChatThread | undefined {
    if (!isRecord(input) || typeof input.title !== 'string' || !Array.isArray(input.participants)) return;
    if (!input.participants.every((id) => typeof id === 'string')) return;
    const title = input.title.trim();
    const participants = [...new Set(input.participants
      .filter((id): id is string => typeof id === 'string')
      .map((id) => id.trim())
      .filter(Boolean))];
    if (!title || title.includes('\0') || title.length > TEAM_CHAT_TITLE_MAX
      || !participants.length || participants.length > TEAM_CHAT_PARTICIPANTS_MAX
      || participants.some((id) => id.includes('\0') || id.length > 240)) return;
    if (this.threads.length >= TEAM_CHAT_THREADS_MAX) return;

    const createdAt = this.timestamp();
    const thread: TeamChatThread = {
      id: this.uniqueId(),
      title,
      participants,
      createdAt,
      updatedAt: createdAt,
      messages: [],
    };
    const next = [...this.threads, thread];
    this.persist(next);
    this.threads = next;
    return copyThread(thread);
  }

  /** Acrescenta uma mensagem se o remetente participar da thread. */
  appendMessage(threadId: string, senderId: unknown, value: unknown): TeamChatMessage | undefined {
    const thread = this.threads.find((item) => item.id === threadId);
    if (!thread || typeof senderId !== 'string') return;
    const sender = senderId.trim();
    if (!sender || sender.includes('\0') || sender.length > 240 || !thread.participants.includes(sender) || typeof value !== 'string') return;
    const text = value.trim();
    if (!text || text.includes('\0') || text.length > TEAM_CHAT_MESSAGE_MAX) return;
    if (thread.messages.length >= TEAM_CHAT_MESSAGES_PER_THREAD_MAX) return;

    const message: TeamChatMessage = {
      id: this.uniqueId(),
      threadId,
      senderId: sender,
      text,
      createdAt: this.timestamp(),
    };
    const next = this.threads.map((item) => item.id === threadId
      ? { ...item, updatedAt: message.createdAt, messages: [...item.messages, message] }
      : item);
    this.persist(next);
    this.threads = next;
    return { ...message };
  }

  private load(): TeamChatThread[] {
    let raw: string;
    try {
      if (statSync(this.file).size > TEAM_CHAT_FILE_MAX_BYTES) {
        this.preserveInvalid(new Error(`Arquivo de conversas excede o limite de ${TEAM_CHAT_FILE_MAX_BYTES} bytes.`));
        return [];
      }
      raw = readFileSync(this.file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch (error) { this.preserveInvalid(new Error(`Arquivo de conversas inválido: ${this.file}`, { cause: error })); return []; }
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.threads)) {
      this.preserveInvalid(new Error(`Formato de conversas inválido: ${this.file}`));
      return [];
    }
    const threads = parsed.threads.filter(isThread).slice(-TEAM_CHAT_THREADS_MAX).map((thread) => ({
      ...thread,
      participants: [...new Set(thread.participants)].slice(0, TEAM_CHAT_PARTICIPANTS_MAX),
      messages: thread.messages.slice(-TEAM_CHAT_MESSAGES_PER_THREAD_MAX).map((message) => ({ ...message })),
    }));
    return threads;
  }

  private preserveInvalid(error: Error): void {
    const backup = `${this.file}.corrupt-${Date.now()}`;
    try {
      renameSync(this.file, backup);
      log.warnOnce('team-chat-recovery', `Arquivo de conversas inválido; cópia preservada em ${backup} (${error.message}).`);
    } catch (preserveError) {
      log.warnOnce('team-chat-recovery', `Não foi possível preservar o arquivo de conversas inválido ${this.file} (${String(preserveError)}).`);
      throw error;
    }
  }

  private persist(threads: TeamChatThread[]): void {
    mkdirSync(dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    const data: TeamChatFile = { version: 1, threads };
    const serialized = `${JSON.stringify(data, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > TEAM_CHAT_FILE_MAX_BYTES) throw new Error('Limite total de armazenamento do chat da equipe atingido.');
    writeFileSync(temp, serialized, { encoding: 'utf8', mode: 0o600 });
    renameSync(temp, this.file);
  }

  private timestamp(): number {
    const value = this.now();
    if (!Number.isFinite(value) || value < 0) throw new Error('Relógio inválido para a conversa.');
    return value;
  }

  private uniqueId(): string {
    const id = this.newId();
    if (!id || this.threads.some((thread) => thread.id === id || thread.messages.some((message) => message.id === id))) {
      throw new Error('O gerador produziu um ID repetido.');
    }
    return id;
  }
}

function copyThread(thread: TeamChatThread): TeamChatThread {
  return { ...thread, participants: [...thread.participants], messages: thread.messages.map((message) => ({ ...message })) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isThread(value: unknown): value is TeamChatThread {
  if (!isRecord(value)) return false;
  if (typeof value.id !== 'string' || !value.id || typeof value.title !== 'string'
    || !value.title || value.title.length > TEAM_CHAT_TITLE_MAX
    || !Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt)
    || !Array.isArray(value.participants) || !Array.isArray(value.messages)) return false;
  const id = value.id;
  const participants = value.participants;
  const messages = value.messages;
  if (!participants.length || participants.length > TEAM_CHAT_PARTICIPANTS_MAX
    || !participants.every((participant) => typeof participant === 'string' && !!participant && participant.length <= 240)
    || messages.length > TEAM_CHAT_MESSAGES_PER_THREAD_MAX) return false;
  return messages.every((item) => isRecord(item)
    && typeof item.id === 'string' && !!item.id
    && item.threadId === id
    && typeof item.senderId === 'string' && participants.includes(item.senderId)
    && typeof item.text === 'string' && !!item.text && item.text.length <= TEAM_CHAT_MESSAGE_MAX
    && Number.isFinite(item.createdAt));
}
