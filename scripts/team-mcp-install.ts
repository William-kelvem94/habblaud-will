// Instala o MCP local de equipe nos clientes CLI disponíveis, preservando servidores já configurados.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const name = 'habblaud-equipe';
const entry = resolve(ROOT, 'mod/habblaud-equipe/index.ts');
const loader = resolve(ROOT, 'node_modules/tsx/dist/loader.mjs');
const loaderSpecifier = pathToFileURL(loader).href;
const entryArg = entry.replaceAll('\\', '/');
const node = process.execPath;
const port = process.env.HABBLAUD_PORT?.trim() || '4747';

if (!existsSync(entry) || !existsSync(loader)) {
  console.error('Dependências incompletas. Rode npm install na raiz do Habblaud.');
  process.exit(1);
}

function run(command: string, args: string[]): { code: number | null; output: string; error?: string } {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  return {
    code: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim(),
    ...(result.error ? { error: result.error.message } : {}),
  };
}

function installClient(command: string, args: string[]): void {
  const current = run(command, [args[0]!, 'get', name]);
  if (current.code === 0) {
    console.log(`${command}: ${name} já está configurado; nenhuma entrada existente foi sobrescrita.`);
    return;
  }
  const added = run(command, args);
  if (added.code === 0) console.log(`${command}: ${name} instalado.`);
  else console.error(`${command}: instalação indisponível${added.error ? ` (${added.error})` : ''}${added.output ? `\n${added.output}` : ''}`);
}

installClient('codex', [
  'mcp', 'add', '--env', `HABBLAUD_PORT=${port}`, name, '--', node, '--import', loaderSpecifier, entryArg,
]);
installClient('claude', [
  'mcp', 'add', '--scope', 'user', name, '--', node, '--import', loaderSpecifier, entryArg,
]);
