import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

describe('Fase 5: Registro de Instância Ativa e Auto-Discovery', () => {
  const habblaudDir = path.join(os.homedir(), '.habblaud');
  const instanceFile = path.join(habblaudDir, 'instance.json');

  it('salva e lê a estrutura esperada de instance.json', () => {
    if (!fs.existsSync(habblaudDir)) {
      fs.mkdirSync(habblaudDir, { recursive: true });
    }

    const testInstance = {
      pid: process.pid,
      port: 4748,
      url: 'http://127.0.0.1:4748',
      startedAt: Date.now(),
      version: '0.11.0',
    };

    fs.writeFileSync(instanceFile, JSON.stringify(testInstance, null, 2), 'utf8');

    expect(fs.existsSync(instanceFile)).toBe(true);
    const parsed = JSON.parse(fs.readFileSync(instanceFile, 'utf8'));
    expect(parsed.port).toBe(4748);
    expect(parsed.pid).toBe(process.pid);
    expect(parsed.url).toBe('http://127.0.0.1:4748');
    expect(parsed.version).toBe('0.11.0');

    // Limpeza
    fs.unlinkSync(instanceFile);
    expect(fs.existsSync(instanceFile)).toBe(false);
  });
});
