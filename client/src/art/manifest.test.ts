import { describe, expect, it } from 'vitest';
import {
  findManifestForProp,
  FURNITURE_MANIFESTS,
  getFurnitureManifest,
  getManifestsByCategory,
} from './manifest';
import { layoutProjectRoom } from '../world/layout/room';

const TEST_THEME = {
  carpet: '#5b7fa6',
  carpet2: '#4f7093',
  wall: { base: '#e7e3db', trim: '#9b9184', pattern: 'plain' as const },
  accent: '#3f7fd8',
  deskVariant: 'wood' as const,
  chairVariant: 'black' as const,
};

describe('Furniture Manifests & Declarative Assets (Fase 3)', () => {
  it('todos os manifestos possuem definições válidas e campos obrigatórios', () => {
    expect(FURNITURE_MANIFESTS.length).toBeGreaterThanOrEqual(6);
    for (const m of FURNITURE_MANIFESTS) {
      expect(m.id).toBeTruthy();
      expect(m.kind).toBeTruthy();
      expect(m.name).toBeTruthy();
      expect(m.category).toBeTruthy();
      expect(m.footprint.w).toBeGreaterThanOrEqual(1);
      expect(m.footprint.h).toBeGreaterThanOrEqual(1);
      expect(['floor', 'wall']).toContain(m.mount);
      expect(['block', 'walkable', 'seat']).toContain(m.collision);
      expect(m.allowedPlacements.length).toBeGreaterThan(0);
      expect(m.icon).toBeTruthy();
      expect(m.defaultLx).toBeGreaterThanOrEqual(1);
      expect(m.defaultLx).toBeLessThanOrEqual(14);
      expect(m.defaultLy).toBeGreaterThanOrEqual(2);
      expect(m.defaultLy).toBeLessThanOrEqual(10);
    }
  });

  it('getFurnitureManifest e findManifestForProp recuperam os manifestos esperados', () => {
    const arcade = getFurnitureManifest('arcade');
    expect(arcade).toBeDefined();
    expect(arcade?.kind).toBe('arcade');
    expect(arcade?.category).toBe('tech');
    expect(arcade?.interactiveSpot?.kind).toBe('arcade');

    const coffee = findManifestForProp('coffee_machine');
    expect(coffee).toBeDefined();
    expect(coffee?.id).toBe('coffee');
    expect(coffee?.category).toBe('utility');

    const monstera = findManifestForProp('plant_tall', 'monstera');
    expect(monstera).toBeDefined();
    expect(monstera?.category).toBe('plants');

    const unknown = findManifestForProp('trash_bin', 'unknown');
    expect(unknown).toBeUndefined();
  });

  it('getManifestsByCategory filtra as categorias adequadamente', () => {
    const techItems = getManifestsByCategory('tech');
    expect(techItems.some((m) => m.id === 'arcade')).toBe(true);

    const utilityItems = getManifestsByCategory('utility');
    expect(utilityItems.some((m) => m.id === 'coffee')).toBe(true);
    expect(utilityItems.some((m) => m.id === 'cooler')).toBe(true);

    const plantsItems = getManifestsByCategory('plants');
    expect(plantsItems.length).toBeGreaterThanOrEqual(2);
  });

  it('mobis com interactiveSpot adicionam spots interativos na sala automaticamente', () => {
    // Sala sem decor
    const defaultRoom = layoutProjectRoom({ id: 'r1', slot: 0, seed: 42 }, TEST_THEME);
    const defaultSpotCount = defaultRoom.spots.length;

    // Sala com fliperama (arcade tem interactiveSpot tipo 'arcade')
    const roomWithArcade = layoutProjectRoom(
      { id: 'r1', slot: 0, seed: 42 },
      TEST_THEME,
      { extraProps: [{ kind: 'arcade', lx: 14, ly: 7 }] },
    );

    expect(roomWithArcade.spots.length).toBe(defaultSpotCount + 1);
    const arcadeSpot = roomWithArcade.spots.find((s) => s.kind === 'arcade');
    expect(arcadeSpot).toBeDefined();
    expect(arcadeSpot?.dir).toBe('up');

    // Sala com cafeteira e pufe
    const roomWithMultiple = layoutProjectRoom(
      { id: 'r1', slot: 0, seed: 42 },
      TEST_THEME,
      {
        extraProps: [
          { kind: 'coffee_machine', lx: 14, ly: 5 },
          { kind: 'beanbag', variant: 'blue', lx: 13, ly: 8 },
        ],
      },
    );

    const coffeeSpot = roomWithMultiple.spots.find((s) => s.kind === 'coffee');
    const beanbagSpot = roomWithMultiple.spots.find((s) => s.kind === 'beanbag');
    expect(coffeeSpot).toBeDefined();
    expect(beanbagSpot).toBeDefined();
  });
});
