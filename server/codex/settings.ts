import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { log } from '../log';

export type CodexModel = { id: string; displayName?: string; description?: string; supportedReasoningEfforts?: Array<{ reasoningEffort?: string; description?: string }> };
export type CodexDefaults = { model: string; effort: string };

function readConfig(file: string): string {
  try { return readFileSync(file, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return ''; throw error; }
}

function topValue(config: string, key: string): string {
  const line = config.split(/\r?\n/).find((entry) => new RegExp(`^\\s*${key}\\s*=`).test(entry));
  const raw = line?.slice(line.indexOf('=') + 1).trim().split(/\s+#/, 1)[0].trim();
  if (!raw) return '';
  try { return JSON.parse(raw) as string; } catch { return raw.replace(/^['"]|['"]$/g, ''); }
}

/** Cliente curto para o daemon local do Codex; ajustes valem para os próximos turnos do thread selecionado. */
export class CodexSettingsClient {
  constructor(private readonly bin: string, private readonly homeOf: (account: string) => string | undefined) {}

  async models(account: string): Promise<CodexModel[]> {
    return this.withServer(account, async (rpc) => {
      const result = await rpc('model/list', {});
      const data = (result as { data?: unknown }).data;
      if (!Array.isArray(data)) throw new Error('O Codex não retornou a lista de modelos.');
      return data.filter((v): v is CodexModel => !!v && typeof v === 'object' && typeof (v as CodexModel).id === 'string');
    });
  }

  defaults(account: string): CodexDefaults {
    const home = this.homeOf(account);
    if (!home) throw new Error('Pasta CODEX_HOME desta conta não encontrada.');
    const text = readConfig(join(home, 'config.toml'));
    const top = text.split(/^\s*\[[^\]]+\]\s*$/m, 1)[0];
    return { model: topValue(top, 'model'), effort: topValue(top, 'model_reasoning_effort') };
  }

  async setDefaults(account: string, model: string, effort: string): Promise<CodexDefaults> {
    if (model.length > 100 || !['', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(effort)) throw new Error('Escolha um modelo e esforço válidos.');
    const home = this.homeOf(account);
    if (!home) throw new Error('Pasta CODEX_HOME desta conta não encontrada.');
    const catalog = await this.models(account);
    if (model && !catalog.some((item) => item.id === model)) throw new Error('Selecione um modelo disponível para esta conta.');
    const selected = catalog.find((item) => item.id === model);
    const levels = selected?.supportedReasoningEfforts?.map((item) => item.reasoningEffort).filter((v): v is string => typeof v === 'string') ?? [];
    if (model && effort && levels.length && !levels.includes(effort)) throw new Error(`O modelo ${model} não oferece o esforço ${effort}.`);
    const file = join(home, 'config.toml');
    const original = readConfig(file);
    const lines = original.split(/(?<=\n)/);
    let inTable = false;
    const kept = lines.filter((line) => {
      if (/^\s*\[[^\]]+\]\s*(?:#.*)?(?:\r?\n)?$/.test(line)) inTable = true;
      if (!inTable && /^\s*(?:model|model_reasoning_effort)\s*=/.test(line)) return false;
      return true;
    });
    const prefs = [model && `model = ${JSON.stringify(model)}`, effort && `model_reasoning_effort = ${JSON.stringify(effort)}`].filter(Boolean).join('\n');
    const next = `${prefs}${prefs ? '\n' : ''}${kept.join('')}`;
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, next, { encoding: 'utf8', mode: 0o600 });
    renameSync(tmp, file);
    return { model, effort };
  }

  private async withServer<T>(account: string, action: (rpc: (method: string, params: unknown) => Promise<unknown>) => Promise<T>): Promise<T> {
    const home = this.homeOf(account);
    if (!home) throw new Error('Pasta CODEX_HOME desta conta não encontrada.');
    const child = spawn(this.bin, ['app-server', '--stdio'], { env: { ...process.env, CODEX_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
    let seq = 0;
    let stderr = '';
    const failAll = (message: string) => { for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error(message)); } pending.clear(); };
    const lines = createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      try {
        const packet = JSON.parse(line) as { id?: number; result?: unknown; error?: { message?: string } };
        if (typeof packet.id !== 'number') return;
        const p = pending.get(packet.id);
        if (!p) return;
        clearTimeout(p.timer); pending.delete(packet.id);
        if (packet.error) p.reject(new Error(packet.error.message || 'O Codex recusou a alteração.'));
        else p.resolve(packet.result);
      } catch { /* ignora mensagens não JSON */ }
    });
    child.stderr.on('data', (chunk: Buffer) => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-2000); });
    child.on('error', (error) => failAll(error.message));
    child.on('exit', (code) => { if (pending.size) failAll(stderr.trim() || `O app-server do Codex encerrou (${code ?? 'sem código'}).`); });
    const rpc = (method: string, params: unknown): Promise<unknown> => new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error(`O Codex não respondeu a ${method} em 15 segundos.`)); }, 15_000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
    try {
      await rpc('initialize', { clientInfo: { name: 'habblaud', version: '0.10.0' }, capabilities: { experimentalApi: true, requestAttestation: false } });
      child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`);
      return await action(rpc);
    } catch (error) {
      log.warn(`Controle de sessão Codex falhou (${error instanceof Error ? error.message : String(error)}).`);
      throw error;
    } finally {
      failAll('Conexão com o Codex encerrada.');
      lines.close();
      child.stdin.end();
      const killTimer = setTimeout(() => child.kill(), 1_000);
      killTimer.unref?.();
    }
  }
}
