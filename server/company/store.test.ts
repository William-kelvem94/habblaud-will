import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CompanyStore } from './store';

const dirs: string[] = [];
function store(now = 1_700_000_000_000) {
  const dir = mkdtempSync(join(tmpdir(), 'habblaud-company-'));
  dirs.push(dir);
  return { dir, file: join(dir, 'company.json'), db: new CompanyStore(join(dir, 'company.json'), 'Equipe', () => now) };
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });

describe('CompanyStore', () => {
  it('persists tasks, profile, shared memory, proposals and conversation memory across restart', () => {
    const { file, db } = store();
    const agent = { provider: 'codex' as const, account: 'work', sessionId: 'session-1' };
    db.saveTask({ title: 'Ship feature', status: 'in_progress' });
    db.setProfile('codex:work:session-1', { name: 'Builder', specialty: 'Frontend' });
    db.setSharedMemory('Use concise reports');
    db.setMemory(agent, 'Project uses TypeScript');
    db.proposeMemory('agent-1', 'Keep the API stable', 'review');
    const restarted = new CompanyStore(file, 'Outro nome');
    expect(restarted.name()).toBe('Equipe');
    expect(restarted.snapshot().tasks).toHaveLength(1);
    expect(restarted.profile('codex:work:session-1').name).toBe('Builder');
    expect(restarted.sharedMemory().text).toBe('Use concise reports');
    expect(restarted.memory(agent).text).toBe('Project uses TypeScript');
    expect(restarted.snapshot().proposals[0].text).toBe('Keep the API stable');
    expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(4);
  });

  it('rejects invalid memory and task titles, and drops missing/self dependencies', () => {
    const { db } = store();
    expect(db.setMemory({ provider: 'claude', account: 'a', sessionId: 's' }, '\0')).toBeUndefined();
    expect(db.saveTask({ title: '   ' })).toBeUndefined();
    db.saveTask({ title: 'First' });
    const task = db.saveTask({ title: 'Second', dependsOn: ['missing', 'self'] });
    expect(task?.dependsOn).toEqual([]);
  });

  it('preserves malformed persisted data before recovering with an empty company file', () => {
    const { file } = store();
    writeFileSync(file, '{ broken json');
    const recovered = new CompanyStore(file, 'Recovered', () => 1234);
    expect(recovered.name()).toBe('Recovered');
    expect(existsSync(`${file}.corrupt-1234`)).toBe(true);
    expect(readFileSync(`${file}.corrupt-1234`, 'utf8')).toBe('{ broken json');
    expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(4);
  });
});
