// Metas persistentes de /goal do Codex. Cada CODEX_HOME tem um goals_N.sqlite; o Habblaud só
// abre esses bancos em modo somente leitura e lê a tabela de metas, sem tocar nos rollouts.
import { readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { join, resolve } from 'node:path';
import type { AgentGoal } from '../../../shared/types';

const GOAL_DB = /^goals_\d+\.sqlite$/i;
const STATUSES = new Set<AgentGoal['status']>(['active', 'paused', 'blocked', 'usage_limited', 'budget_limited', 'complete']);
const REFRESH_MS = 2_000;

interface GoalRow {
  thread_id: unknown;
  objective: unknown;
  status: unknown;
  updated_at_ms: unknown;
}

function roomKey(cwd: string): string {
  let path = cwd.trim();
  if (process.platform === 'win32') {
    path = path.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '');
    return resolve(path).toLowerCase();
  }
  return resolve(path);
}

export function codexGoalRoomKey(cwd: string): string {
  return roomKey(cwd);
}

function readFromDisk(home: string): Map<string, AgentGoal> | null {
  let names: string[];
  try {
    names = readdirSync(home);
  } catch {
    return new Map();
  }
  const goalFiles = names.filter((name) => GOAL_DB.test(name)).sort();
  const stateFiles = names.filter((name) => /^state_\d+\.sqlite$/i.test(name)).sort().reverse();
  if (!goalFiles.length || !stateFiles.length) return new Map();
  const byThread = new Map<string, AgentGoal>();
  for (const file of goalFiles) {
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(join(home, file), { readOnly: true });
      const rows = db.prepare('SELECT thread_id, objective, status, updated_at_ms FROM thread_goals').all() as unknown as GoalRow[];
      for (const row of rows) {
        if (typeof row.thread_id !== 'string' || typeof row.objective !== 'string' || typeof row.status !== 'string' || !STATUSES.has(row.status as AgentGoal['status'])) continue;
        const updatedAt = typeof row.updated_at_ms === 'number' ? row.updated_at_ms : Number(row.updated_at_ms);
        if (!Number.isFinite(updatedAt)) continue;
        const prior = byThread.get(row.thread_id);
        if (!prior || prior.updatedAt < updatedAt) byThread.set(row.thread_id, {
          objective: row.objective,
          status: row.status as AgentGoal['status'],
          updatedAt,
        });
      }
    } catch {
      // A versão do Codex sem banco de metas, uma migração em andamento ou um ciclo concorrente não derrubam o app.
      if (goalFiles.length === 1) return null;
    } finally {
      db?.close();
    }
  }

  if (!byThread.size) return new Map();
  const threadIds = [...byThread.keys()];
  const placeholders = threadIds.map(() => '?').join(',');
  const paths = new Map<string, string>();
  for (const file of stateFiles) {
    let db: DatabaseSync | undefined;
    try {
      db = new DatabaseSync(join(home, file), { readOnly: true });
      const rows = db.prepare(`SELECT id, cwd FROM threads WHERE id IN (${placeholders})`).all(...threadIds) as unknown as Array<{ id: unknown; cwd: unknown }>;
      for (const row of rows) if (typeof row.id === 'string' && typeof row.cwd === 'string' && !paths.has(row.id)) paths.set(row.id, row.cwd);
      if (paths.size === byThread.size) break;
    } catch {
      // Outra versão ou migração do banco de estado: tenta o próximo arquivo.
    } finally {
      db?.close();
    }
  }
  const goals = new Map<string, AgentGoal>();
  for (const [threadId, goal] of byThread) {
    const cwd = paths.get(threadId);
    if (!cwd) continue;
    const key = roomKey(cwd);
    const prior = goals.get(key);
    if (!prior || prior.updatedAt < goal.updatedAt) goals.set(key, goal);
  }
  return goals;
}

/** Cache curto porque Codex atualiza esse SQLite enquanto a sessão está aberta. */
export class CodexGoals {
  private readAt = -Infinity;
  private goals = new Map<string, AgentGoal>();

  constructor(private readonly home: string, private readonly now: () => number = Date.now) {}

  forRooms(): ReadonlyMap<string, AgentGoal> {
    const now = this.now();
    if (now - this.readAt < REFRESH_MS) return this.goals;
    this.readAt = now;
    const next = readFromDisk(this.home);
    if (next) this.goals = next;
    return this.goals;
  }
}
