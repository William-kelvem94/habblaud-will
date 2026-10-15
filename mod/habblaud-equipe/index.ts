#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { AgentInfo, OfficeSnapshot } from '../../shared/types.js';

const MAX_TEXT = 8_000;
const MAX_AGENT_MESSAGE = 6_000;
const API_BASE = getApiBase();

function getApiBase(): URL {
  const value = process.env.HABBLAUD_API_URL;
  const url = value ? new URL(value) : new URL(`http://127.0.0.1:${validPort(process.env.HABBLAUD_PORT)}`);
  // MCP can cause agents to message other local agents. Refuse remote hosts, DNS names,
  // credentials, paths, and non-HTTP schemes even if supplied through the environment.
  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || (url.pathname !== '/' && url.pathname !== '')
    || url.search || url.hash) {
    throw new Error('HABBLAUD_API_URL deve apontar diretamente para http://127.0.0.1:<porta> ou http://[::1]:<porta>.');
  }
  return url;
}

function validPort(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 4747;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('HABBLAUD_PORT inválida.');
  return port;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(new URL(path, API_BASE), {
      ...init,
      signal: controller.signal,
      headers: { ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
    });
    const payload: unknown = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = isRecord(payload) && typeof payload.error === 'string' ? payload.error : `HTTP ${response.status}`;
      throw new Error(`Habblaud respondeu ${response.status}: ${detail}`);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') throw new Error('Tempo esgotado ao acessar o Habblaud local.');
    if (error instanceof TypeError) throw new Error(`Não foi possível acessar o Habblaud em ${API_BASE.origin}. Confirme se o servidor está ativo.`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function eligible(agent: AgentInfo): boolean {
  return agent.kind === 'main' && agent.canMessage === true;
}

async function snapshot(): Promise<OfficeSnapshot> {
  return api<OfficeSnapshot>('/api/snapshot');
}

async function currentAgent(requestedId?: string): Promise<AgentInfo> {
  const pinnedId = process.env.HABBLAUD_AGENT_ID?.trim();
  const id = pinnedId || requestedId?.trim();
  if (!id || id.length > 240 || id.includes('\0')) {
    throw new Error('Informe agentId com o ID do agente principal desta sessão, ou configure HABBLAUD_AGENT_ID para fixá-lo.');
  }
  if (pinnedId && requestedId && pinnedId !== requestedId.trim()) throw new Error('agentId não corresponde à identidade fixada para este servidor MCP.');
  const office = await snapshot();
  const agent = office.agents.find((item) => item.id === id);
  if (!agent || !eligible(agent)) throw new Error('O agente configurado não está ativo ou ainda não pode receber mensagens pelo Habblaud.');
  return agent;
}

function toolError(error: unknown) {
  return { isError: true, content: [{ type: 'text' as const, text: error instanceof Error ? error.message : 'Falha inesperada na integração com o Habblaud.' }] };
}

function toolResult(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

const server = new McpServer({
  name: 'habblaud-equipe',
  version: '1.0.0',
}, {
  instructions: 'Facilita conversas reais e persistentes entre agentes principais no escritório Habblaud. Mensagens são duráveis e encaminhadas às sessões participantes. Use somente para colaboração necessária à tarefa atual.',
});

server.registerTool('habblaud_listar_agentes', {
  title: 'Listar agentes disponíveis',
  description: 'Lista os agentes principais ativos que podem receber mensagens pelo Habblaud.',
  inputSchema: {},
}, async () => {
  try {
    const office = await snapshot();
    const agents = office.agents.filter(eligible).map(({ id, name, provider, role, title, roomId, status }) => ({ id, name, provider, role, title, roomId, status }));
    return toolResult({ agents, total: agents.length });
  } catch (error) { return toolError(error); }
});

server.registerTool('habblaud_criar_conversa', {
  title: 'Criar conversa da equipe',
  description: 'Cria uma conversa durável e adiciona os agentes principais escolhidos. Informe o seu agentId conforme a mensagem recebida do Habblaud, a menos que HABBLAUD_AGENT_ID esteja configurado.',
  inputSchema: {
    agentId: z.string().min(1).max(240).optional(),
    title: z.string().trim().min(1).max(180),
    participantIds: z.array(z.string().min(1).max(240)).min(1).max(29),
  },
}, async ({ agentId, title, participantIds }) => {
  try {
    const self = await currentAgent(agentId);
    const ids = [...new Set([...participantIds, self.id])];
    if (ids.length > 29) throw new Error('A conversa aceita até 29 agentes, além do usuário.');
    if (!ids.some((id) => id !== self.id)) throw new Error('Inclua pelo menos um colega além do agente atual.');
    const office = await snapshot();
    const byId = new Map(office.agents.filter(eligible).map((agent) => [agent.id, agent]));
    const unavailable = ids.filter((id) => !byId.has(id));
    if (unavailable.length) throw new Error(`Agente(s) não disponível(is) para conversa: ${unavailable.join(', ')}.`);
    const result = await api<{ thread: unknown }>('/api/company/team-chat/threads', {
      method: 'POST', body: JSON.stringify({ title, participantIds: ids }),
    });
    return toolResult(result.thread);
  } catch (error) { return toolError(error); }
});

server.registerTool('habblaud_ler_conversa', {
  title: 'Ler conversa da equipe',
  description: 'Lê uma conversa durável somente se o agente indicado for participante. Informe o seu agentId conforme a mensagem recebida do Habblaud, a menos que HABBLAUD_AGENT_ID esteja configurado.',
  inputSchema: { agentId: z.string().min(1).max(240).optional(), threadId: z.string().min(1).max(240) },
}, async ({ agentId, threadId }) => {
  try {
    const self = await currentAgent(agentId);
    const result = await api<{ thread: { id: string; title: string; participants: string[]; messages: unknown[] } }>(`/api/company/team-chat/threads/${encodeURIComponent(threadId)}`);
    if (!result.thread || !Array.isArray(result.thread.participants) || !result.thread.participants.includes(self.id)) {
      throw new Error('A conversa não existe ou este agente não participa dela.');
    }
    return toolResult(result.thread);
  } catch (error) { return toolError(error); }
});

server.registerTool('habblaud_enviar_mensagem_a_equipe', {
  title: 'Enviar mensagem à equipe',
  description: 'Registra a mensagem na conversa durável e encaminha o contexto recente somente aos colegas que você indicar, evitando disparos em cadeia. Informe o seu agentId conforme a mensagem recebida do Habblaud, a menos que HABBLAUD_AGENT_ID esteja configurado.',
  inputSchema: {
    agentId: z.string().min(1).max(240).optional(),
    threadId: z.string().min(1).max(240),
    text: z.string().trim().min(1).max(MAX_AGENT_MESSAGE),
    recipientIds: z.array(z.string().min(1).max(240)).max(29).default([]),
  },
}, async ({ agentId, threadId, text, recipientIds }) => {
  try {
    const self = await currentAgent(agentId);
    const read = await api<{ thread: { id: string; title: string; participants: string[]; messages: Array<{ senderId: string; text: string; createdAt: number }> } }>(`/api/company/team-chat/threads/${encodeURIComponent(threadId)}`);
    const thread = read.thread;
    if (!thread || !Array.isArray(thread.participants) || !thread.participants.includes(self.id)) {
      throw new Error('A conversa não existe ou este agente não participa dela.');
    }
    const recipients = [...new Set(recipientIds)];
    if (recipients.some((id) => id === self.id || id === 'user' || !thread.participants.includes(id))) {
      throw new Error('Cada destinatário deve ser outro agente participante desta conversa.');
    }
    const { message } = await api<{ message: { id: string; senderId: string; text: string; createdAt: number } }>(`/api/company/team-chat/threads/${encodeURIComponent(threadId)}/messages`, {
      method: 'POST', body: JSON.stringify({ senderId: self.id, text }),
    });
    const latest = [...thread.messages, message].slice(-8).map((item) => `${item.senderId}: ${item.text}`).join('\n\n');
    const messageBlock = `CONVERSA HABBLAUD: ${thread.title}\nID: ${thread.id}\n\nMensagem de ${self.name}: ${text}`;
    const contextHeader = '\n\nCONTEXTO RECENTE (responda pela ferramenta habblaud_enviar_mensagem_a_equipe, se útil):\n';
    const contextBudget = Math.max(0, MAX_TEXT - messageBlock.length - contextHeader.length);
    if (contextBudget === 0) throw new Error('A mensagem não cabe no limite de encaminhamento da caixa do Habblaud.');
    const body = `${messageBlock}${contextHeader}${latest.slice(-contextBudget)}`;
    const forwarded: string[] = [];
    const skipped: string[] = [];
    const failed: Array<{ agentId: string; error: string }> = [];
    for (const agentId of recipients) {
      try {
        const office = await snapshot();
        const colleague = office.agents.find((agent) => agent.id === agentId && eligible(agent));
        if (!colleague) { skipped.push(agentId); continue; }
        await api('/api/messages', { method: 'POST', body: JSON.stringify({ agentId, text: body, includeMemory: true }) });
        forwarded.push(agentId);
      } catch (error) {
        failed.push({ agentId, error: error instanceof Error ? error.message : 'Falha de envio.' });
      }
    }
    return toolResult({ message, forwarded, skipped, failed, durable: true });
  } catch (error) { return toolError(error); }
});

const transport = new StdioServerTransport();
await server.connect(transport);

process.on('SIGINT', () => { void server.close().finally(() => process.exit(0)); });
process.on('SIGTERM', () => { void server.close().finally(() => process.exit(0)); });
