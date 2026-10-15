// Seção "Vida social" da gaveta do agente: o que está fazendo numa roda, carteira de moedinhas,
// placar, personalidade, amizades/rivalidades com quem está no escritório e o extrato.
import type { AgentSocial } from '../world/api';
import type { UiContext } from './context';
import { h, setHidden, setText, setTitle } from './dom';
import { plural, relativeTime } from './format';
import { canSend, messageText } from './composer-model';
import { tr } from '../../../shared/i18n';
import { MESSAGE_MAX } from '../../../shared/messages';

/** "+🪙10" / "−🪙10" (sinal tipográfico de menos). */
export function coinDelta(delta: number): string {
  return `${delta >= 0 ? '+' : '−'}🪙${Math.abs(delta)}`;
}

/** "3 vitórias · 1 derrota" (ou "Sem partidas ainda"). */
export function recordText(wins: number, losses: number): string {
  if (!wins && !losses) return tr('Sem partidas ainda');
  return `${plural(wins, tr('vitória'), tr('vitórias'))} · ${plural(losses, tr('derrota'), tr('derrotas'))}`;
}

const LEDGER_SHOWN = 6;

export class SocialSection {
  readonly el: HTMLElement;
  private extra: HTMLElement;
  private doing: HTMLElement;
  private coins: HTMLElement;
  private earned: HTMLElement;
  private record: HTMLElement;
  private traits: HTMLElement;
  private phrase: HTMLElement;
  private friends: HTMLElement;
  private rivals: HTMLElement;
  private friendsRow: HTMLElement;
  private rivalsRow: HTMLElement;
  private ledger: HTMLElement;
  private ledgerBox: HTMLDetailsElement;
  private playBox: HTMLElement;
  private playButtons: HTMLButtonElement[] = [];
  private providerBox: HTMLElement;
  private providerInput: HTMLInputElement;
  private providerSend: HTMLButtonElement;
  private providerHint: HTMLElement;
  private providerSending = false;
  private providerCanSend = false;
  /** Assinaturas do que já está no DOM (só refaz as listas quando mudam). */
  private keys = { traits: '', bonds: '', ledger: '' };

  constructor(private ctx: UiContext) {
    const title = h('h3', { class: 'ui-sec__title', text: tr('Vida social') });
    this.extra = h('span', { class: 'ui-sec__extra ui-social__balance' });
    this.doing = h('p', { class: 'ui-social__doing' });
    this.coins = h('strong', { class: 'ui-social__coins' });
    this.earned = h('span', { class: 'ui-social__earned' });
    this.record = h('span', { class: 'ui-social__record' });
    this.traits = h('div', { class: 'ui-social__traits' });
    this.phrase = h('p', { class: 'ui-social__phrase' });
    this.friends = h('span', { class: 'ui-social__names' });
    this.rivals = h('span', { class: 'ui-social__names' });
    this.friendsRow = h('p', { class: 'ui-social__bond' }, h('span', { class: 'ui-social__bond-label', text: tr('💛 Amizades') }), this.friends);
    this.rivalsRow = h('p', { class: 'ui-social__bond' }, h('span', { class: 'ui-social__bond-label', text: tr('⚔️ Rivalidades') }), this.rivals);
    this.ledger = h('ol', { class: 'ui-social__ledger' });
    this.ledgerBox = h('details', { class: 'ui-social__extract' }, h('summary', { text: tr('Extrato') }), this.ledger);
    const action = (label: string, title: string, run: () => void) => {
      const button = h('button', { class: 'ui-btn ui-btn--sm', type: 'button', text: label, title, on: { click: run } });
      this.playButtons.push(button);
      return button;
    };
    const actions = h('div', { class: 'ui-social__actions', role: 'group', attrs: { 'aria-label': tr('Ações de jogo') } },
      action(tr('Acenar'), tr('Fazer o personagem acenar'), () => this.act('wave')),
      action(tr('Dar café'), tr('Oferecer um cafezinho ao personagem'), () => this.act('coffee')),
      action(tr('Comemorar'), tr('Fazer o personagem comemorar'), () => this.act('cheer')),
      action(tr('Cochilar'), tr('Fazer o personagem cochilar se estiver sentado'), () => this.act('sleep')),
      action(tr('Pingue-pongue'), tr('Convidar colegas livres para jogar pingue-pongue'), () => this.game('pingpong')),
      action(tr('Videogame'), tr('Convidar colegas livres para jogar videogame'), () => this.game('videogame')),
      action(tr('Jokenpô'), tr('Convidar colegas livres para jogar jokenpô'), () => this.game('rps')),
    );
    this.providerInput = h('input', { class: 'ui-social__prompt', type: 'text', attrs: { maxlength: MESSAGE_MAX, placeholder: tr('Peça uma ação ou uma fala ao agente…'), 'aria-label': tr('Peça uma ação ou uma fala ao agente…') } });
    this.providerSend = h('button', { class: 'ui-btn ui-btn--sm ui-btn--primary', type: 'button', text: tr('Enviar ao provedor'), on: { click: () => void this.sendToAgent() } });
    this.providerHint = h('p', { class: 'ui-muted ui-small', role: 'status', text: tr('O pedido será enviado à sessão do agente pelo Claude Code ou Codex.') });
    this.providerInput.addEventListener('input', () => this.syncProviderButton());
    this.providerBox = h('div', { class: 'ui-social__provider' }, h('div', { class: 'ui-social__provider-row' }, this.providerInput, this.providerSend), this.providerHint);
    this.playBox = h('div', { class: 'ui-social__play' }, h('h4', { class: 'ui-sec__title', text: tr('Brincar com o personagem') }), actions, this.providerBox);
    const wallet = h(
      'div',
      { class: 'ui-social__wallet' },
      h('span', { class: 'ui-social__purse', attrs: { 'aria-hidden': 'true' }, text: '🪙' }),
      h('div', { class: 'ui-social__wallet-body' }, h('div', { class: 'ui-social__wallet-line' }, this.coins, this.record), this.earned),
    );
    setTitle(wallet, tr('Moedinhas fictícias: entra no escritório com um saldo, ganha 🪙10 por tarefa concluída e 🪙5 por pedido atendido, e aposta com os colegas. Ficam salvas neste navegador.'));
    this.el = h(
      'section',
      { class: 'ui-sec ui-social' },
      h('div', { class: 'ui-sec__head' }, title, this.extra),
      this.doing,
      wallet,
      this.playBox,
      this.traits,
      this.phrase,
      this.friendsRow,
      this.rivalsRow,
      this.ledgerBox,
    );
  }

  /** Atualiza com o agente `id`; some quando o mundo não sabe dele (já saiu, ou mundo antigo). */
  render(id: string, now: number): void {
    const s: AgentSocial | null = this.ctx.world.social?.(id) ?? null;
    setHidden(this.el, !s);
    if (!s) return;
    const selectedAgent = this.ctx.agent(id);
    this.providerCanSend = !this.ctx.store.replaying && selectedAgent?.kind === 'main' && !!selectedAgent.canMessage;
    for (const button of this.playButtons) button.disabled = this.ctx.store.replaying;
    setHidden(this.providerBox, selectedAgent?.kind !== 'main');
    this.providerInput.disabled = !this.providerCanSend || this.providerSending;
    this.providerHint.textContent = this.providerCanSend
      ? tr('O pedido será enviado à sessão do agente pelo Claude Code ou Codex.')
      : tr('A sessão precisa estar conectada e aceitar mensagens para usar o provedor.');
    this.syncProviderButton();
    setText(this.extra, `🪙 ${s.coins}`);
    setText(this.doing, s.doing ?? '');
    setHidden(this.doing, !s.doing);
    setText(this.coins, tr('{0} moedinhas', [s.coins]));
    setText(this.record, recordText(s.wins, s.losses));
    setText(this.earned, tr('{0} ganhos trabalhando', [coinDelta(s.earned)]));
    setText(this.phrase, tr('Bordão: “{0}”', [s.catchphrase]));

    const tk = s.traits.map((t) => t.label).join('|');
    if (tk !== this.keys.traits) {
      this.keys.traits = tk;
      this.traits.replaceChildren(...s.traits.map((t) => h('span', { class: 'ui-trait', title: t.desc, text: `${t.emoji} ${t.label}` })));
    }

    const bk = s.bonds.map((b) => `${b.id}:${b.kind}:${b.name}:${b.record?.join('-') ?? ''}`).join('|');
    if (bk !== this.keys.bonds) {
      this.keys.bonds = bk;
      const link = (b: AgentSocial['bonds'][number]) => {
        const label = b.record ? `${b.name} (${b.record[0]}×${b.record[1]})` : b.name;
        return h('button', {
          class: 'ui-social__name',
          type: 'button',
          text: label,
          title: b.record ? tr('Retrospecto contra {0}: {1}', [b.name, recordText(b.record[0], b.record[1])]) : tr('Ver {0}', [b.name]),
          on: { click: () => this.ctx.select({ type: 'agent', id: b.id }, { focus: true }) },
        });
      };
      const friends = s.bonds.filter((b) => b.kind === 'amizade');
      const rivals = s.bonds.filter((b) => b.kind === 'rivalidade');
      this.friends.replaceChildren(...friends.map(link));
      this.rivals.replaceChildren(...rivals.map(link));
      setHidden(this.friendsRow, !friends.length);
      setHidden(this.rivalsRow, !rivals.length);
    }

    const items = s.ledger.slice(0, LEDGER_SHOWN);
    const lk = items.map((e) => `${e.at}:${e.delta}:${e.text}`).join('|') + `@${Math.floor(now / 30_000)}`;
    if (lk !== this.keys.ledger) {
      this.keys.ledger = lk;
      this.ledger.replaceChildren(
        ...items.map((e) =>
          h(
            'li',
            { class: `ui-social__entry ${e.delta >= 0 ? 'is-plus' : 'is-minus'}` },
            h('span', { class: 'ui-social__delta', text: coinDelta(e.delta) }),
            h('span', { class: 'ui-social__what', text: `${e.icon} ${e.text}` }),
            h('time', { class: 'ui-social__when', text: relativeTime(e.at, now) }),
          ),
        ),
      );
    }
    setHidden(this.ledgerBox, !items.length);
  }

  private act(action: 'wave' | 'coffee' | 'cheer' | 'sleep'): void {
    const id = this.ctx.selection();
    const agentId = id?.type === 'agent' ? id.id : null;
    if (!agentId) return;
    if (this.ctx.world.playAction?.(agentId, action)) {
      const label = action === 'wave' ? tr('O personagem acenou!') : action === 'coffee' ? tr('O personagem ganhou um cafezinho!') : action === 'cheer' ? tr('O personagem está comemorando!') : tr('O personagem vai cochilar quando puder.');
      this.ctx.announce(label);
    }
  }

  private game(kind: 'pingpong' | 'videogame' | 'rps'): void {
    const sel = this.ctx.selection();
    if (sel?.type !== 'agent') return;
    const players = this.ctx.world.startGame?.(sel.id, kind);
    if (!players) {
      this.ctx.announce(tr('Este personagem precisa estar livre e ter um colega livre para jogar.'));
      return;
    }
    const game = kind === 'pingpong' ? tr('pingue-pongue') : kind === 'videogame' ? tr('videogame') : tr('jokenpô');
    this.ctx.announce(tr('Partida de {0} começando com {1}.', [game, players.join(' e ')]));
  }

  private syncProviderButton(): void {
    this.providerSend.disabled = !this.providerCanSend || this.providerSending || !canSend(this.providerInput.value);
  }

  private async sendToAgent(): Promise<void> {
    const sel = this.ctx.selection();
    const agentId = sel?.type === 'agent' ? sel.id : null;
    const raw = this.providerInput.value;
    if (!agentId || !this.providerCanSend || !canSend(raw) || this.providerSending) return;
    this.providerSending = true;
    this.syncProviderButton();
    try {
      const result = await this.ctx.store.sendMessage(agentId, messageText(raw));
      if ('error' in result) {
        this.ctx.announce(tr('Não foi possível enviar o pedido: {0}', [result.error]));
        return;
      }
      if (this.providerInput.value === raw) this.providerInput.value = '';
      this.ctx.announce(tr('Pedido enviado à sessão do agente.'));
    } catch {
      this.ctx.announce(tr('Não foi possível falar com o provedor agora.'));
    } finally {
      this.providerSending = false;
      this.syncProviderButton();
    }
  }
}
