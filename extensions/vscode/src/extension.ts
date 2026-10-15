import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface HabblaudInstance {
  pid?: number;
  port: number;
  url: string;
  startedAt?: number;
  version?: string;
}

let activeServerUrl: string | null = null;
let currentProvider: HabblaudViewProvider | null = null;
const activePanels = new Set<vscode.WebviewPanel>();

export function activate(context: vscode.ExtensionContext): void {
  const provider = new HabblaudViewProvider(context.extensionUri);
  currentProvider = provider;

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(HabblaudViewProvider.viewType, provider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('habblaud.openTab', async () => {
      await openHabblaudPanel(context.extensionUri);
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('habblaud.openBrowser', async () => {
      const url = await getServerUrl();
      void vscode.env.openExternal(vscode.Uri.parse(url));
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('habblaud.refresh', () => {
      provider.refresh();
      for (const panel of activePanels) {
        panel.webview.html = getWebviewContent(activeServerUrl ?? getConfiguredUrl());
      }
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('habblaud.connectServer', async () => {
      const selected = await selectOrPromptServer();
      if (selected) {
        activeServerUrl = selected;
        provider.setServerUrl(selected);
        for (const panel of activePanels) {
          panel.webview.html = getWebviewContent(selected);
        }
        vscode.window.showInformationMessage(`Habblaud: Conectado a ${selected}`);
      }
    }),
  );

  // Inicia descoberta dinâmica em segundo plano no boot
  void autoDiscoverServer().then((url) => {
    if (url && url !== activeServerUrl) {
      activeServerUrl = url;
      provider.setServerUrl(url);
    }
  });
}

export function deactivate(): void {
  activePanels.clear();
  currentProvider = null;
}

function getConfiguredUrl(): string {
  const config = vscode.workspace.getConfiguration('habblaud');
  return config.get<string>('serverUrl', 'http://127.0.0.1:4747');
}

function getInstanceFilePath(): string {
  return path.join(os.homedir(), '.habblaud', 'instance.json');
}

function readInstanceFile(): HabblaudInstance | null {
  try {
    const file = getInstanceFilePath();
    if (!fs.existsSync(file)) return null;
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (raw && typeof raw.port === 'number') {
      return {
        pid: raw.pid,
        port: raw.port,
        url: raw.url || `http://127.0.0.1:${raw.port}`,
        startedAt: raw.startedAt,
        version: raw.version,
      };
    }
  } catch {
    // ignorar erros de leitura/parse do arquivo temporário
  }
  return null;
}

async function probeUrl(url: string, timeoutMs = 500): Promise<{ ok: boolean; version?: string }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch(`${url}/api/snapshot`, { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      try {
        const json = (await res.json()) as { meta?: { version?: string } };
        return { ok: true, version: json?.meta?.version };
      } catch {
        return { ok: true };
      }
    }
  } catch {
    // falhou no probe
  }
  return { ok: false };
}

async function probePort(port: number): Promise<HabblaudInstance | null> {
  const url = `http://127.0.0.1:${port}`;
  const probe = await probeUrl(url, 400);
  if (probe.ok) {
    return { port, url, version: probe.version };
  }
  return null;
}

export async function discoverLocalInstances(): Promise<HabblaudInstance[]> {
  const discovered: HabblaudInstance[] = [];
  const probedPorts = new Set<number>();

  // 1. Verifica arquivo de instância ~/.habblaud/instance.json
  const fileInst = readInstanceFile();
  if (fileInst) {
    const probe = await probeUrl(fileInst.url, 400);
    if (probe.ok) {
      discovered.push({ ...fileInst, version: probe.version ?? fileInst.version });
      probedPorts.add(fileInst.port);
    }
  }

  // 2. Procura em paralelo na faixa padrão de portas 4747..4755
  const probeTasks: Promise<HabblaudInstance | null>[] = [];
  for (let port = 4747; port <= 4755; port++) {
    if (!probedPorts.has(port)) {
      probeTasks.push(probePort(port));
    }
  }

  const results = await Promise.all(probeTasks);
  for (const r of results) {
    if (r) discovered.push(r);
  }

  return discovered;
}

async function autoDiscoverServer(): Promise<string> {
  const instances = await discoverLocalInstances();
  if (instances.length === 1) {
    return instances[0].url;
  }
  if (instances.length > 1) {
    // Se temos mais de um servidor rodando, conecta no do instance.json se existir, ou no primeiro
    const fileInst = readInstanceFile();
    const matched = fileInst ? instances.find((i) => i.port === fileInst.port) : undefined;
    return matched ? matched.url : instances[0].url;
  }
  return getConfiguredUrl();
}

async function selectOrPromptServer(): Promise<string | undefined> {
  const instances = await discoverLocalInstances();
  
  interface QuickPickItemWithUrl extends vscode.QuickPickItem {
    url?: string;
    isCustom?: boolean;
  }

  const items: QuickPickItemWithUrl[] = instances.map((inst) => ({
    label: `$(server) Habblaud : ${inst.port}`,
    description: inst.url,
    detail: `PID: ${inst.pid ?? 'local'} · ${inst.version ? `v${inst.version}` : 'ativo'}`,
    url: inst.url,
  }));

  items.push({
    label: '$(edit) Conectar a outra URL...',
    description: 'Digitar endereço IP ou porta personalizada manualmente',
    isCustom: true,
  });

  const pick = await vscode.window.showQuickPick(items, {
    placeHolder: 'Selecione a instância do Habblaud para conectar:',
  });

  if (!pick) return undefined;

  if (pick.isCustom) {
    const input = await vscode.window.showInputBox({
      prompt: 'Digite a URL do servidor Habblaud',
      value: activeServerUrl ?? getConfiguredUrl(),
      validateInput: (val) => {
        if (!val.startsWith('http://') && !val.startsWith('https://')) {
          return 'A URL deve iniciar com http:// ou https://';
        }
        return null;
      },
    });
    return input ? input.trim() : undefined;
  }

  return pick.url;
}

export async function getServerUrl(): Promise<string> {
  if (activeServerUrl) {
    return activeServerUrl;
  }
  const discovered = await autoDiscoverServer();
  activeServerUrl = discovered;
  return discovered;
}

class HabblaudViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'habblaud.officeView';
  private _view?: vscode.WebviewView;
  private _serverUrl?: string;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    void getServerUrl().then((url) => {
      this._serverUrl = url;
      this.render();
    });
  }

  public setServerUrl(url: string): void {
    this._serverUrl = url;
    this.render();
  }

  public refresh(): void {
    if (this._view) {
      this.render();
    }
  }

  private render(): void {
    if (!this._view) return;
    const url = this._serverUrl ?? activeServerUrl ?? getConfiguredUrl();
    this._view.webview.html = getWebviewContent(url);
  }
}

async function openHabblaudPanel(extensionUri: vscode.Uri): Promise<void> {
  const panel = vscode.window.createWebviewPanel(
    'habblaud.tabView',
    'Habblaud - Escritório Virtual',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [extensionUri],
    },
  );

  activePanels.add(panel);
  panel.onDidDispose(() => activePanels.delete(panel));

  const url = await getServerUrl();
  panel.webview.html = getWebviewContent(url);
}

function getWebviewContent(serverUrl: string): string {
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Habblaud</title>
  <style>
    body, html {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background-color: var(--vscode-editor-background, #1a1e29);
      color: var(--vscode-editor-foreground, #cccccc);
      font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
    }
    iframe {
      width: 100%;
      height: 100%;
      border: none;
      display: block;
    }
    #fallback {
      display: none;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      text-align: center;
      padding: 24px;
      box-sizing: border-box;
    }
    .badge {
      font-size: 32px;
      margin-bottom: 12px;
    }
    h2 {
      margin: 0 0 8px 0;
      font-size: 16px;
      font-weight: 600;
    }
    p {
      margin: 0 0 16px 0;
      font-size: 13px;
      color: var(--vscode-descriptionForeground, #888888);
      max-width: 320px;
      line-height: 1.4;
    }
    code {
      background: var(--vscode-textCodeBlock-background, rgba(0,0,0,0.3));
      padding: 3px 6px;
      border-radius: 4px;
      font-size: 12px;
    }
    .actions {
      display: flex;
      gap: 8px;
    }
    .btn {
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #ffffff);
      border: none;
      padding: 6px 14px;
      font-size: 12px;
      font-weight: 500;
      border-radius: 4px;
      cursor: pointer;
    }
    .btn:hover {
      background: var(--vscode-button-hoverBackground, #1177bb);
    }
  </style>
</head>
<body>
  <iframe id="habblaud-frame" src="${serverUrl}"></iframe>
  <div id="fallback">
    <div class="badge">🏢</div>
    <h2>Servidor Habblaud Offline</h2>
    <p>O servidor local do Habblaud não foi detectado em <code>${serverUrl}</code>.</p>
    <p>Inicie o Habblaud em seu terminal com <code>npm run dev</code> e tente novamente.</p>
    <div class="actions">
      <button class="btn" onclick="retry()">Tentar Reconectar</button>
    </div>
  </div>

  <script>
    const frame = document.getElementById('habblaud-frame');
    const fallback = document.getElementById('fallback');

    let loaded = false;
    const timeout = setTimeout(() => {
      if (!loaded) {
        checkServer();
      }
    }, 4000);

    frame.onload = () => {
      loaded = true;
      clearTimeout(timeout);
    };

    function checkServer() {
      fetch('${serverUrl}/api/snapshot', { mode: 'no-cors' })
        .then(() => {
          frame.style.display = 'block';
          fallback.style.display = 'none';
        })
        .catch(() => {
          frame.style.display = 'none';
          fallback.style.display = 'flex';
        });
    }

    function retry() {
      fallback.style.display = 'none';
      frame.style.display = 'block';
      frame.src = '${serverUrl}?t=' + Date.now();
    }
  </script>
</body>
</html>`;
}
