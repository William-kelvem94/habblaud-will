// Decoração e personalização opcional das salas do escritório.
// Aditivo: se nenhuma decoração for definida, a sala continua 100% procedural padrão.
import type { FloorKind, FurnitureKind } from '../../art/api';

export const DECOR_STORAGE_KEY = 'habblaud:room-decor';

export interface ExtraProp {
  kind: FurnitureKind;
  variant?: string;
  lx: number;
  ly: number;
}

export interface RoomDecor {
  floor?: FloorKind;
  carpetColor?: string;
  wallBase?: string;
  accent?: string;
  extraProps?: ExtraProp[];
}

/** Envelope versionado para migrações e auditoria de layout (Fase 2). */
export interface VersionedRoomDecor {
  schemaVersion: 2;
  layoutRevision: number;
  updatedAt: number;
  decor: RoomDecor;
}

export type RoomDecorMap = Record<string, RoomDecor>;
export type VersionedRoomDecorMap = Record<string, VersionedRoomDecor>;

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

/** Sanitiza a posição de um móvel para mantê-lo dentro da área segura da sala. */
export function sanitizeExtraProp(p: ExtraProp): ExtraProp | null {
  if (typeof p !== 'object' || p === null) return null;
  const lx = Math.max(1, Math.min(14, Math.round(Number(p.lx) || 1)));
  const ly = Math.max(2, Math.min(10, Math.round(Number(p.ly) || 2)));
  return {
    kind: p.kind,
    ...(p.variant ? { variant: p.variant } : {}),
    lx,
    ly,
  };
}

/** Sanitiza e valida um RoomDecor. */
export function sanitizeRoomDecor(d: RoomDecor): RoomDecor {
  const result: RoomDecor = {};
  if (d.floor) result.floor = d.floor;
  if (typeof d.carpetColor === 'string') result.carpetColor = d.carpetColor;
  if (typeof d.wallBase === 'string') result.wallBase = d.wallBase;
  if (typeof d.accent === 'string') result.accent = d.accent;
  if (Array.isArray(d.extraProps)) {
    const valid = d.extraProps.map(sanitizeExtraProp).filter((p): p is ExtraProp => p !== null);
    if (valid.length) result.extraProps = valid;
  }
  return result;
}

/** Migra qualquer formato anterior (v1 simples) para o schema versionado v2. */
export function migrateRoomDecor(raw: unknown): VersionedRoomDecor {
  if (typeof raw !== 'object' || raw === null) {
    return { schemaVersion: 2, layoutRevision: 1, updatedAt: Date.now(), decor: {} };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.schemaVersion === 2 && typeof obj.decor === 'object' && obj.decor !== null) {
    return {
      schemaVersion: 2,
      layoutRevision: typeof obj.layoutRevision === 'number' ? obj.layoutRevision : 1,
      updatedAt: typeof obj.updatedAt === 'number' ? obj.updatedAt : Date.now(),
      decor: sanitizeRoomDecor(obj.decor as RoomDecor),
    };
  }

  // Formato v1 anterior: o próprio objeto é o RoomDecor
  return {
    schemaVersion: 2,
    layoutRevision: 1,
    updatedAt: Date.now(),
    decor: sanitizeRoomDecor(raw as RoomDecor),
  };
}

/** Lê os decors no formato versionado do storage. */
export function loadVersionedRoomDecors(storage: StorageLike | null): VersionedRoomDecorMap {
  if (!storage) return {};
  try {
    const raw = storage.getItem(DECOR_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};

    const result: VersionedRoomDecorMap = {};
    for (const [id, value] of Object.entries(parsed)) {
      result[id] = migrateRoomDecor(value);
    }
    return result;
  } catch {
    return {};
  }
}

/** Retorna o mapa tradicional RoomDecorMap para consumo transparente pelo Sim e Layout. */
export function loadRoomDecors(storage: StorageLike | null): RoomDecorMap {
  const versioned = loadVersionedRoomDecors(storage);
  const result: RoomDecorMap = {};
  for (const [id, v] of Object.entries(versioned)) {
    if (v.decor && Object.keys(v.decor).length > 0) {
      result[id] = v.decor;
    }
  }
  return result;
}

/** Salva o decor de uma sala com incremento de revisão e timestamp no schema v2. */
export function saveRoomDecor(storage: StorageLike | null, roomId: string, decor: RoomDecor | null): RoomDecorMap {
  const current = loadVersionedRoomDecors(storage);
  const cleanDecor = decor ? sanitizeRoomDecor(decor) : null;

  if (!cleanDecor || Object.keys(cleanDecor).length === 0) {
    delete current[roomId];
  } else {
    const prev = current[roomId];
    current[roomId] = {
      schemaVersion: 2,
      layoutRevision: (prev?.layoutRevision ?? 0) + 1,
      updatedAt: Date.now(),
      decor: cleanDecor,
    };
  }

  if (storage) {
    try {
      storage.setItem(DECOR_STORAGE_KEY, JSON.stringify(current));
    } catch {
      // storage cheio
    }
  }

  return loadRoomDecors(storage);
}

export function exportRoomDecorsJson(storage: StorageLike | null): string {
  return JSON.stringify(loadVersionedRoomDecors(storage), null, 2);
}

export function importRoomDecorsJson(storage: StorageLike | null, json: string): RoomDecorMap | null {
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const versioned: VersionedRoomDecorMap = {};
    for (const [id, val] of Object.entries(parsed)) {
      versioned[id] = migrateRoomDecor(val);
    }
    if (storage) {
      storage.setItem(DECOR_STORAGE_KEY, JSON.stringify(versioned));
    }
    return loadRoomDecors(storage);
  } catch {
    return null;
  }
}

import { FURNITURE_MANIFESTS, type FurnitureManifest } from '../../art/manifest';

/** Catálogo de mobis decorativos pré-configurados que podem ser adicionados à sala (baseado em manifestos) */
export const DECOR_CATALOG: Array<{
  id: string;
  name: string;
  kind: FurnitureKind;
  variant?: string;
  defaultLx: number;
  defaultLy: number;
  icon: string;
}> = FURNITURE_MANIFESTS.map((m) => ({
  id: m.id,
  name: m.name,
  kind: m.kind,
  variant: m.variant,
  defaultLx: m.defaultLx,
  defaultLy: m.defaultLy,
  icon: m.icon,
}));

/** Estilos prontos (presets) que transformam a sala com 1 clique (Fase 2) */
export interface DecorPreset {
  id: string;
  name: string;
  description: string;
  icon: string;
  decor: RoomDecor;
}

export const DECOR_PRESETS: DecorPreset[] = [
  {
    id: 'minimalist',
    name: 'Minimalista Clean',
    description: 'Mármore claro, tapete azul neutro e bonsai decorativo',
    icon: '🪴',
    decor: {
      floor: 'marble',
      carpetColor: '#3f7fd8',
      extraProps: [{ kind: 'plant_tall', variant: 'bonsai', lx: 1, ly: 8 }],
    },
  },
  {
    id: 'tech_lounge',
    name: 'Tech Lounge',
    description: 'Madeira nobre, tapete esmeralda, pufe e fliperama retrô',
    icon: '🕹️',
    decor: {
      floor: 'wood',
      carpetColor: '#10b981',
      extraProps: [
        { kind: 'arcade', lx: 14, ly: 7 },
        { kind: 'beanbag', variant: 'blue', lx: 13, ly: 8 },
      ],
    },
  },
  {
    id: 'creative_cafe',
    name: 'Café Criativo',
    description: 'Piso xadrez retrô, tapete âmbar, cafeteira e estante',
    icon: '☕',
    decor: {
      floor: 'tile_check',
      carpetColor: '#f59e0b',
      extraProps: [
        { kind: 'coffee_machine', lx: 14, ly: 5 },
        { kind: 'bookshelf', lx: 8, ly: 2 },
      ],
    },
  },
];
