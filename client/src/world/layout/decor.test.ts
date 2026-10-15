import { describe, expect, it } from 'vitest';
import {
  DECOR_CATALOG,
  DECOR_PRESETS,
  exportRoomDecorsJson,
  importRoomDecorsJson,
  loadRoomDecors,
  loadVersionedRoomDecors,
  migrateRoomDecor,
  sanitizeExtraProp,
  sanitizeRoomDecor,
  saveRoomDecor,
  type RoomDecor,
} from './decor';
import { layoutProjectRoom } from './room';

const TEST_THEME = {
  carpet: '#5b7fa6',
  carpet2: '#4f7093',
  wall: { base: '#e7e3db', trim: '#9b9184', pattern: 'plain' as const },
  accent: '#3f7fd8',
  deskVariant: 'wood' as const,
  chairVariant: 'black' as const,
};

describe('Room Decor & Catalog (Fases 4 e 2)', () => {
  it('carrega e salva configurações de decoração em storage isolado com schema v2', () => {
    const memory = new Map<string, string>();
    const fakeStorage = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
    };

    expect(loadRoomDecors(fakeStorage)).toEqual({});

    const decor: RoomDecor = {
      floor: 'wood',
      carpetColor: '#ef4444',
      extraProps: [{ kind: 'arcade', lx: 14, ly: 7 }],
    };

    saveRoomDecor(fakeStorage, 'room-1', decor);
    expect(loadRoomDecors(fakeStorage)['room-1']).toEqual(decor);

    // Verifica envelope versionado v2
    const versioned = loadVersionedRoomDecors(fakeStorage);
    expect(versioned['room-1'].schemaVersion).toBe(2);
    expect(versioned['room-1'].layoutRevision).toBe(1);
    expect(versioned['room-1'].updatedAt).toBeGreaterThan(0);

    // Segunda alteração incrementa layoutRevision
    saveRoomDecor(fakeStorage, 'room-1', { ...decor, carpetColor: '#10b981' });
    const versioned2 = loadVersionedRoomDecors(fakeStorage);
    expect(versioned2['room-1'].layoutRevision).toBe(2);
    expect(versioned2['room-1'].decor.carpetColor).toBe('#10b981');

    // Exportação e importação JSON
    const exported = exportRoomDecorsJson(fakeStorage);
    expect(exported).toContain('arcade');
    expect(exported).toContain('schemaVersion');

    const freshStorage = {
      getItem: (k: string) => memory.get(k) ?? null,
      setItem: (k: string, v: string) => void memory.set(k, v),
    };
    memory.clear();
    const imported = importRoomDecorsJson(freshStorage, exported);
    expect(imported).not.toBeNull();
    expect(imported?.['room-1']?.floor).toBe('wood');

    // Remover decor
    saveRoomDecor(fakeStorage, 'room-1', null);
    expect(loadRoomDecors(fakeStorage)['room-1']).toBeUndefined();
  });

  it('migrateRoomDecor migra dados no formato antigo v1 para o schema versionado v2', () => {
    const legacyV1 = {
      floor: 'concrete',
      carpetColor: '#8b5cf6',
      extraProps: [{ kind: 'coffee_machine', lx: 14, ly: 5 }],
    };

    const migrated = migrateRoomDecor(legacyV1);
    expect(migrated.schemaVersion).toBe(2);
    expect(migrated.layoutRevision).toBe(1);
    expect(migrated.decor.floor).toBe('concrete');
    expect(migrated.decor.carpetColor).toBe('#8b5cf6');
  });

  it('sanitizeRoomDecor ajusta posições fora dos limites seguros da sala', () => {
    const propOut = sanitizeExtraProp({ kind: 'arcade', lx: 99, ly: -5 });
    expect(propOut?.lx).toBe(14);
    expect(propOut?.ly).toBe(2);

    const propValid = sanitizeExtraProp({ kind: 'arcade', lx: 7, ly: 6 });
    expect(propValid?.lx).toBe(7);
    expect(propValid?.ly).toBe(6);
  });

  it('presets DECOR_PRESETS contêm estilos pré-fabricados válidos', () => {
    expect(DECOR_PRESETS.length).toBeGreaterThanOrEqual(3);
    for (const preset of DECOR_PRESETS) {
      expect(preset.id).toBeTruthy();
      expect(preset.name).toBeTruthy();
      expect(preset.decor.floor).toBeDefined();
      expect(preset.decor.carpetColor).toBeDefined();
    }
  });

  it('layoutProjectRoom continua idêntico quando decor não é fornecido (aditivo)', () => {
    const roomDefault1 = layoutProjectRoom({ id: 'r1', slot: 0, seed: 12345 }, TEST_THEME);
    const roomDefault2 = layoutProjectRoom({ id: 'r1', slot: 0, seed: 12345 }, TEST_THEME, null);

    expect(roomDefault1.furniture.length).toBe(roomDefault2.furniture.length);
    expect(roomDefault1.floors.length).toBe(roomDefault2.floors.length);
    expect(roomDefault1.spots.length).toBe(roomDefault2.spots.length);
  });

  it('layoutProjectRoom aplica piso customizado e cor de tapete quando especificados', () => {
    const decorated = layoutProjectRoom(
      { id: 'r1', slot: 0, seed: 12345 },
      TEST_THEME,
      { floor: 'wood', carpetColor: '#10b981' },
    );

    expect(decorated.floorTint).toBe('#10b981');
    const floorPatch = decorated.floors.find((s) => s.kind === 'wood');
    expect(floorPatch).toBeDefined();
  });

  it('layoutProjectRoom adiciona mobis extras do catálogo respeitando limites', () => {
    const decorated = layoutProjectRoom(
      { id: 'r1', slot: 0, seed: 12345 },
      TEST_THEME,
      {
        extraProps: [
          { kind: 'arcade', lx: 14, ly: 7 },
          { kind: 'coffee_machine', lx: 14, ly: 5 },
          // Item fora da área permitida da sala (deve ser ignorado para proteger layout)
          { kind: 'water_cooler', lx: 99, ly: 99 },
        ],
      },
    );

    const arcadeFurn = decorated.furniture.find((f) => f.kind === 'arcade' && f.order === 0.75);
    const coffeeFurn = decorated.furniture.find((f) => f.kind === 'coffee_machine' && f.order === 0.75);
    const invalidFurn = decorated.furniture.find((f) => f.kind === 'water_cooler' && f.order === 0.75);

    expect(arcadeFurn).toBeDefined();
    expect(coffeeFurn).toBeDefined();
    expect(invalidFurn).toBeUndefined();
  });

  it('catálogo DECOR_CATALOG possui itens válidos com posições default seguras', () => {
    expect(DECOR_CATALOG.length).toBeGreaterThanOrEqual(6);
    for (const item of DECOR_CATALOG) {
      expect(item.id).toBeTruthy();
      expect(item.name).toBeTruthy();
      expect(item.defaultLx).toBeGreaterThanOrEqual(1);
      expect(item.defaultLx).toBeLessThanOrEqual(14);
      expect(item.defaultLy).toBeGreaterThanOrEqual(2);
      expect(item.defaultLy).toBeLessThanOrEqual(10);
    }
  });
});

