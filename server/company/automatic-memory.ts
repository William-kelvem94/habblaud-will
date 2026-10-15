import { createHash } from 'node:crypto';
import type { DeliveryInfo } from '../../shared/types';
import type { DeliveryIndex } from '../deliveries/deliveries';
import { log } from '../log';
import { CompanyStore, conversationMemoryKey } from './store';

const MARKER = /<!--\s*HABBLAUD_MEMORY:(\{[^\r\n]*\})\s*-->/g;
const INTERVAL_MS = 2_000;

/** Enfileira aprendizados estruturados para revisão humana, sem alterar memórias automaticamente. */
export class AutomaticMemory {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(private readonly deliveries: DeliveryIndex, private readonly company: CompanyStore, private readonly roomIdOf: (agentId: string) => string | undefined = () => undefined) {}

  start(): void {
    if (this.timer) return;
    void this.scan();
    this.timer = setInterval(() => void this.scan(), INTERVAL_MS);
    this.timer.unref?.();
  }

  private async scan(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const deliveries = await this.deliveries.list();
      for (const delivery of deliveries) this.collect(delivery);
    } catch (error) {
      log.warnOnce('automatic-memory-scan', `Não foi possível verificar aprendizados automáticos (${String(error)}).`);
    } finally {
      this.running = false;
    }
  }

  private collect(delivery: DeliveryInfo): void {
    const matches = [...delivery.text.matchAll(MARKER)];
    matches.slice(0, 3).forEach((match, index) => {
      try {
        const parsed: unknown = JSON.parse(match[1]);
        if (!parsed || typeof parsed !== 'object') return;
        const item = parsed as { scope?: unknown; text?: unknown };
        if ((item.scope !== 'conversation' && item.scope !== 'company') || typeof item.text !== 'string') return;
        const eventId = createHash('sha256').update(`${delivery.id}:${index}:${item.scope}:${item.text}`).digest('hex');
        const identity = { provider: delivery.provider ?? 'claude', account: delivery.account, sessionId: delivery.sessionId };
        // A entrega pode ser antiga e seu agente já ter saído do escritório; o histórico ainda conserva o projeto.
        const roomId = (delivery.agentId ? this.roomIdOf(delivery.agentId) : undefined) ?? delivery.project;
        const proposed = this.company.proposeAutomaticMemory(
          { ...identity, ...(roomId ? { roomId } : {}), id: delivery.agentId ?? conversationMemoryKey(identity) },
          item.scope,
          item.text,
          eventId,
          `${delivery.agentName ?? delivery.account} · ${delivery.request}`,
        );
        if (proposed) log.info(`Aprendizado automático enviado para revisão (${item.scope}) de ${delivery.agentName ?? delivery.account}.`);
      } catch {
        // Marcador malformado é ignorado sem afetar a resposta nem o serviço.
      }
    });
  }
}
