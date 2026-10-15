import { describe, expect, it } from 'vitest';
import { renderPet } from '../art/pets';
import { PetManager } from './pets';

describe('pets (mascotes do escritório)', () => {
  it('renderPet gera buffers de sprite válidos com outline para gato e cachorro', () => {
    const catSit = renderPet({ kind: 'cat', pose: 'sit', dir: 'right', frame: 0 });
    expect(catSit.buf.w).toBeGreaterThan(10);
    expect(catSit.buf.h).toBeGreaterThan(10);
    expect(catSit.ax).toBeGreaterThan(0);
    expect(catSit.ay).toBeGreaterThan(0);

    const dogWalk = renderPet({ kind: 'dog', pose: 'walk', dir: 'left', frame: 1 });
    expect(dogWalk.buf.w).toBeGreaterThan(10);
    expect(dogWalk.buf.h).toBeGreaterThan(10);
  });

  it('PetManager gerencia Pipoca e Biscoito com movimentação e interação', () => {
    const pm = new PetManager();
    expect(pm.pets.length).toBe(2);

    const cat = pm.pets.find((p) => p.kind === 'cat')!;
    expect(cat.name).toBe('Pipoca');

    const dog = pm.pets.find((p) => p.kind === 'dog')!;
    expect(dog.name).toBe('Biscoito');

    // Interação (carinho/clique)
    const now = 10000;
    expect(pm.interact(cat.id, now)).toBe(true);
    expect(cat.bubble).toBe('Miau~ ❤️');
    expect(cat.bubbleUntil).toBeGreaterThan(now);

    expect(pm.interact(dog.id, now)).toBe(true);
    expect(dog.bubble).toBe('Au au! 🐾');
  });
});
