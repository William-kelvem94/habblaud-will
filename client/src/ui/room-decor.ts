// Modal/popover para personalização de sala e catálogo de mobis (Fases 4 e 2).
// Suporta troca de piso, cor de tapete, mobis extras, presets prontos e histórico Undo/Redo com atalhos de teclado.
import { tr } from '../../../shared/i18n';
import type { FloorKind } from '../art/api';
import { DECOR_CATALOG, DECOR_PRESETS, type DecorPreset, type RoomDecor } from '../world/layout/decor';
import type { UiContext } from './context';
import { h, iconButton, setAttr, setText } from './dom';
import { ICONS } from './icons';

const FLOOR_OPTIONS: Array<{ id: FloorKind; label: string }> = [
  { id: 'marble', label: tr('Mármore') },
  { id: 'wood', label: tr('Madeira') },
  { id: 'concrete', label: tr('Concreto') },
  { id: 'carpet', label: tr('Carpete') },
  { id: 'tile_check', label: tr('Xadrez') },
  { id: 'tile_white', label: tr('Azulejo') },
];

const CARPET_COLORS = [
  { color: '#3f7fd8', label: tr('Azul Habblaud') },
  { color: '#10b981', label: tr('Esmeralda') },
  { color: '#ef4444', label: tr('Rubi') },
  { color: '#f59e0b', label: tr('Âmbar') },
  { color: '#8b5cf6', label: tr('Roxo Cyber') },
  { color: '#ec4899', label: tr('Rosa Sakura') },
  { color: '#374151', label: tr('Grafite') },
];

export class RoomDecorPopover {
  readonly el: HTMLElement;
  private currentRoomId = '';
  private currentDecor: RoomDecor = {};
  private anchor: HTMLElement | null = null;
  private roomTitle: HTMLElement;
  private floorButtons: HTMLButtonElement[] = [];
  private colorButtons: HTMLButtonElement[] = [];
  private mobiItemsContainer: HTMLElement;
  private presetsContainer: HTMLElement;

  // Histórico para Desfazer / Refazer (Undo / Redo)
  private undoStack: RoomDecor[] = [];
  private redoStack: RoomDecor[] = [];
  private undoBtn: HTMLButtonElement;
  private redoBtn: HTMLButtonElement;

  constructor(private readonly ctx: UiContext) {
    this.roomTitle = h('span', { class: 'ui-muted ui-small' });
    const closeBtn = iconButton(ICONS.close, tr('Fechar'), () => this.hide(), 'ui-icon-btn--sm');

    // Seção Estilos Prontos (Presets)
    this.presetsContainer = h('div', { class: 'ui-decor-presets' });

    // Seção Pisos
    const floorSeg = h('div', { class: 'ui-seg ui-seg--wrap', role: 'radiogroup', attrs: { 'aria-label': tr('Piso da sala') } });
    for (const opt of FLOOR_OPTIONS) {
      const btn = h('button', {
        class: 'ui-seg__opt',
        type: 'button',
        role: 'radio',
        text: opt.label,
        attrs: { 'aria-checked': 'false' },
        on: {
          click: () => this.setFloor(opt.id),
        },
      }) as HTMLButtonElement;
      this.floorButtons.push(btn);
      floorSeg.append(btn);
    }

    // Seção Cores de Tapete
    const colorRow = h('div', { class: 'ui-decor-colors' });
    for (const pal of CARPET_COLORS) {
      const btn = h('button', {
        class: 'ui-decor-color-btn',
        type: 'button',
        title: pal.label,
        attrs: { 'aria-label': pal.label },
        style: `background-color: ${pal.color};`,
        on: {
          click: () => this.setCarpetColor(pal.color),
        },
      }) as HTMLButtonElement;
      this.colorButtons.push(btn);
      colorRow.append(btn);
    }

    // Seção Catálogo de Mobis
    this.mobiItemsContainer = h('div', { class: 'ui-decor-catalog' });

    // Botões de Histórico e Ações do Rodapé
    this.undoBtn = h('button', {
      class: 'ui-btn ui-btn--sm',
      type: 'button',
      text: tr('↺ Desfazer'),
      title: tr('Desfazer última alteração (Ctrl+Z)'),
      on: {
        click: () => this.undo(),
      },
    }) as HTMLButtonElement;

    this.redoBtn = h('button', {
      class: 'ui-btn ui-btn--sm',
      type: 'button',
      text: tr('↻ Refazer'),
      title: tr('Refazer alteração desfeita (Ctrl+Y)'),
      on: {
        click: () => this.redo(),
      },
    }) as HTMLButtonElement;

    const resetBtn = h('button', {
      class: 'ui-btn ui-btn--sm',
      type: 'button',
      text: tr('Restaurar padrão'),
      title: tr('Remove customizações e volta ao estilo procedural original'),
      on: {
        click: () => this.resetDecor(),
      },
    });

    this.el = h(
      'div',
      {
        class: 'ui-popover ui-decor-popover',
        role: 'dialog',
        tabIndex: -1,
        attrs: { 'aria-label': tr('Decoração da sala'), popover: 'auto' },
      },
      h(
        'div',
        { class: 'ui-popover__head' },
        h('div', { class: 'ui-popover__title-wrap' }, h('h2', { text: tr('Decoração & Mobis') }), this.roomTitle),
        closeBtn,
      ),
      h(
        'div',
        { class: 'ui-set-group' },
        h('h3', { text: tr('Estilos Prontos (1 clique)') }),
        this.presetsContainer,
      ),
      h(
        'div',
        { class: 'ui-set-group' },
        h('h3', { text: tr('Estilo do Piso') }),
        floorSeg,
      ),
      h(
        'div',
        { class: 'ui-set-group' },
        h('h3', { text: tr('Cor do Tapete Central') }),
        colorRow,
      ),
      h(
        'div',
        { class: 'ui-set-group' },
        h('h3', { text: tr('Mobis Extras (Catálogo)') }),
        h('p', { class: 'ui-set__hint', text: tr('Adicione móveis interativos e decorativos à sua sala.') }),
        this.mobiItemsContainer,
      ),
      h(
        'div',
        { class: 'ui-popover__foot' },
        h('div', { class: 'ui-decor-history' }, this.undoBtn, this.redoBtn),
        resetBtn,
      ),
    );

    this.el.addEventListener('toggle', () => {
      this.anchor?.setAttribute('aria-expanded', String(this.isOpen));
    });

    // Captura de atalhos de teclado Ctrl+Z e Ctrl+Y
    this.el.addEventListener('keydown', (e: KeyboardEvent) => {
      if (!this.isOpen) return;
      const isZ = e.key === 'z' || e.key === 'Z';
      const isY = e.key === 'y' || e.key === 'Y';
      if ((e.ctrlKey || e.metaKey) && isZ) {
        if (e.shiftKey) this.redo();
        else this.undo();
        e.preventDefault();
        e.stopPropagation();
      } else if ((e.ctrlKey || e.metaKey) && isY) {
        this.redo();
        e.preventDefault();
        e.stopPropagation();
      }
    });
  }

  get isOpen(): boolean {
    try {
      return this.el.matches(':popover-open');
    } catch {
      return this.el.classList.contains('is-open');
    }
  }

  open(roomId: string, anchor: HTMLElement, roomName?: string): void {
    this.currentRoomId = roomId;
    this.anchor = anchor;
    this.currentDecor = this.ctx.world.getRoomDecor?.(roomId) ? JSON.parse(JSON.stringify(this.ctx.world.getRoomDecor!(roomId))) : {};
    this.undoStack = [];
    this.redoStack = [];

    setText(this.roomTitle, roomName ? `· ${roomName}` : '');
    this.render();

    const r = anchor.getBoundingClientRect();
    this.el.style.top = `${Math.min(innerHeight - 480, Math.max(16, Math.round(r.bottom + 8)))}px`;
    this.el.style.right = `${Math.max(8, Math.round(innerWidth - r.right))}px`;

    if (typeof this.el.showPopover === 'function') {
      try {
        this.el.showPopover();
      } catch {
        // Já aberto
      }
    } else {
      this.el.classList.add('is-open');
    }
    anchor.setAttribute('aria-expanded', 'true');
  }

  hide(): void {
    if (typeof this.el.hidePopover === 'function') {
      try {
        this.el.hidePopover();
      } catch {
        // Já fechado
      }
    }
    this.el.classList.remove('is-open');
    this.anchor?.setAttribute('aria-expanded', 'false');
  }

  private pushUndo(): void {
    this.undoStack.push(JSON.parse(JSON.stringify(this.currentDecor)));
    if (this.undoStack.length > 25) this.undoStack.shift();
    this.redoStack = [];
  }

  private undo(): void {
    if (!this.undoStack.length) return;
    const prev = this.undoStack.pop()!;
    this.redoStack.push(JSON.parse(JSON.stringify(this.currentDecor)));
    this.currentDecor = prev;
    this.applyCurrentDecor();
    this.render();
  }

  private redo(): void {
    if (!this.redoStack.length) return;
    const next = this.redoStack.pop()!;
    this.undoStack.push(JSON.parse(JSON.stringify(this.currentDecor)));
    this.currentDecor = next;
    this.applyCurrentDecor();
    this.render();
  }

  private applyPreset(preset: DecorPreset): void {
    this.pushUndo();
    this.currentDecor = JSON.parse(JSON.stringify(preset.decor));
    this.applyCurrentDecor();
    this.render();
  }

  private setFloor(floor: FloorKind): void {
    this.pushUndo();
    this.currentDecor = { ...this.currentDecor, floor };
    this.applyCurrentDecor();
    this.render();
  }

  private setCarpetColor(carpetColor: string): void {
    this.pushUndo();
    this.currentDecor = { ...this.currentDecor, carpetColor };
    this.applyCurrentDecor();
    this.render();
  }

  private toggleMobi(mobiId: string): void {
    const catalogItem = DECOR_CATALOG.find((m) => m.id === mobiId);
    if (!catalogItem) return;

    this.pushUndo();
    const existingProps = [...(this.currentDecor.extraProps ?? [])];
    const index = existingProps.findIndex((p) => p.kind === catalogItem.kind && (p.variant ?? '') === (catalogItem.variant ?? ''));

    if (index >= 0) {
      existingProps.splice(index, 1);
    } else {
      existingProps.push({
        kind: catalogItem.kind,
        variant: catalogItem.variant,
        lx: catalogItem.defaultLx,
        ly: catalogItem.defaultLy,
      });
    }

    this.currentDecor = { ...this.currentDecor, extraProps: existingProps };
    this.applyCurrentDecor();
    this.render();
  }

  private resetDecor(): void {
    this.pushUndo();
    this.currentDecor = {};
    this.applyCurrentDecor();
    this.render();
  }

  private applyCurrentDecor(): void {
    if (!this.currentRoomId) return;
    const hasProps = this.currentDecor.extraProps && this.currentDecor.extraProps.length > 0;
    const hasFloor = !!this.currentDecor.floor;
    const hasCarpet = !!this.currentDecor.carpetColor;
    const hasWall = !!this.currentDecor.wallBase;

    const decorToSave = hasProps || hasFloor || hasCarpet || hasWall ? this.currentDecor : null;
    this.ctx.world.setRoomDecor?.(this.currentRoomId, decorToSave);
  }

  private render(): void {
    // Atualiza botões de histórico
    this.undoBtn.disabled = this.undoStack.length === 0;
    this.redoBtn.disabled = this.redoStack.length === 0;

    // Renderiza Presets
    this.presetsContainer.replaceChildren();
    for (const preset of DECOR_PRESETS) {
      const card = h(
        'button',
        {
          class: 'ui-decor-preset-card',
          type: 'button',
          title: preset.description,
          on: {
            click: () => this.applyPreset(preset),
          },
        },
        h('span', { class: 'ui-decor-preset-icon', text: preset.icon }),
        h(
          'div',
          { class: 'ui-decor-preset-info' },
          h('strong', { text: preset.name }),
          h('small', { text: preset.description }),
        ),
      );
      this.presetsContainer.append(card);
    }

    // Atualiza seleção de piso
    const activeFloor = this.currentDecor.floor ?? 'marble';
    FLOOR_OPTIONS.forEach((opt, i) => {
      const btn = this.floorButtons[i];
      if (btn) {
        const isChecked = opt.id === activeFloor;
        setAttr(btn, 'aria-checked', String(isChecked));
        btn.classList.toggle('is-selected', isChecked);
      }
    });

    // Atualiza seleção de cor de tapete
    const activeColor = (this.currentDecor.carpetColor ?? '').toLowerCase();
    CARPET_COLORS.forEach((pal, i) => {
      const btn = this.colorButtons[i];
      if (btn) {
        const isChecked = pal.color.toLowerCase() === activeColor;
        setAttr(btn, 'aria-checked', String(isChecked));
        btn.classList.toggle('is-selected', isChecked);
      }
    });

    // Atualiza catálogo de mobis
    this.mobiItemsContainer.replaceChildren();
    const activeProps = this.currentDecor.extraProps ?? [];

    for (const item of DECOR_CATALOG) {
      const isActive = activeProps.some((p) => p.kind === item.kind && (p.variant ?? '') === (item.variant ?? ''));

      const card = h(
        'div',
        { class: `ui-decor-item ${isActive ? 'is-active' : ''}` },
        h('span', { class: 'ui-decor-item__icon', text: item.icon }),
        h(
          'div',
          { class: 'ui-decor-item__info' },
          h('span', { class: 'ui-decor-item__name', text: item.name }),
        ),
        h('button', {
          class: `ui-btn ui-btn--sm ${isActive ? 'ui-btn--primary' : ''}`,
          type: 'button',
          text: isActive ? tr('✓ Na sala') : tr('+ Adicionar'),
          on: {
            click: () => this.toggleMobi(item.id),
          },
        }),
      );
      this.mobiItemsContainer.append(card);
    }
  }
}
