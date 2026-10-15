// Simulação e gerenciamento autônomo dos animais de estimação (pets) do escritório.
import type { PetKind, PetPose } from '../art/pets';
import type { Sim } from './sim/sim';

export interface Pet {
  id: string;
  kind: PetKind;
  name: string;
  x: number;
  y: number;
  dir: 'left' | 'right';
  pose: PetPose;
  frame: number;
  target: { x: number; y: number } | null;
  bubble: string | null;
  bubbleUntil: number;
  stateUntil: number;
  variant: number;
  /** Profundidade no render */
  depth(): number;
}

export class PetManager {
  readonly pets: Pet[] = [];

  constructor() {
    this.pets.push(
      this.createPet('pet:pipoca', 'cat', 'Pipoca', 45, 175, 0),
      this.createPet('pet:biscoito', 'dog', 'Biscoito', -15, 130, 0),
    );
  }

  private createPet(id: string, kind: PetKind, name: string, x: number, y: number, variant: number): Pet {
    return {
      id,
      kind,
      name,
      x,
      y,
      dir: 'right',
      pose: 'sit',
      frame: 0,
      target: null,
      bubble: null,
      bubbleUntil: 0,
      stateUntil: Date.now() + 5000 + Math.random() * 5000,
      variant,
      depth() {
        return this.y;
      },
    };
  }

  update(dt: number, now: number, sim: Sim): void {
    for (const pet of this.pets) {
      // Limpeza de balão expirado
      if (pet.bubble && now > pet.bubbleUntil) {
        pet.bubble = null;
      }

      // Se está a caminho de um alvo
      if (pet.target) {
        const dx = pet.target.x - pet.x;
        const dy = pet.target.y - pet.y;
        const dist = Math.hypot(dx, dy);

        if (dist < 2) {
          // Chegou ao destino
          pet.x = pet.target.x;
          pet.y = pet.target.y;
          pet.target = null;
          pet.pose = Math.random() < 0.5 ? 'sleep' : 'sit';
          pet.stateUntil = now + 8000 + Math.random() * 12000;
        } else {
          // Caminhando
          const speed = 22; // px por segundo
          const step = Math.min(dist, speed * dt);
          pet.x += (dx / dist) * step;
          pet.y += (dy / dist) * step;
          pet.dir = dx < 0 ? 'left' : 'right';
          pet.pose = 'walk';
          pet.frame = Math.floor(now / 160) % 4;
        }
        continue;
      }

      // Parado: animação de respiração ou rabo
      pet.frame = Math.floor(now / (pet.pose === 'sleep' ? 900 : 400)) % 4;

      // Troca de atividade quando o tempo de repouso termina
      if (now >= pet.stateUntil) {
        // Encontra um novo ponto de interesse (perto da recepção, lounge, ou perto de um agente ocioso)
        const newTarget = this.pickTarget(pet, sim);
        if (newTarget) {
          pet.target = newTarget;
          pet.pose = 'walk';
        } else {
          // Apenas alterna pose no mesmo lugar
          pet.pose = pet.pose === 'sleep' ? 'sit' : 'sleep';
          pet.stateUntil = now + 6000 + Math.random() * 8000;
        }
      }
    }
  }

  /** Escolhe um ponto aconchegante para o pet passear */
  private pickTarget(pet: Pet, sim: Sim): { x: number; y: number } | null {
    // 40% de chance de ir perto de um colega no escritório
    if (Math.random() < 0.4 && sim.chars.size > 0) {
      const chars = [...sim.chars.values()].filter((c) => !c.inside && c.visible);
      if (chars.length > 0) {
        const targetChar = chars[Math.floor(Math.random() * chars.length)];
        const offsetX = (Math.random() < 0.5 ? -14 : 14);
        const offsetY = 6;
        return { x: targetChar.x + offsetX, y: targetChar.y + offsetY };
      }
    }

    // Caso contrário, vagueia pelas áreas comuns (Recepção / Lounge)
    if (pet.kind === 'cat') {
      // O gato adora o Lounge (x entre 20 e 80, y entre 150 e 190)
      return {
        x: 25 + Math.random() * 60,
        y: 155 + Math.random() * 35,
      };
    } else {
      // O cão prefere a Recepção e Corredor (x entre -30 e 30, y entre 110 e 150)
      return {
        x: -30 + Math.random() * 60,
        y: 115 + Math.random() * 35,
      };
    }
  }

  /** Interação ao clicar no pet */
  interact(petId: string, now: number): boolean {
    const pet = this.pets.find((p) => p.id === petId);
    if (!pet) return false;

    pet.pose = 'action';
    pet.target = null;
    pet.bubble = pet.kind === 'cat' ? 'Miau~ ❤️' : 'Au au! 🐾';
    pet.bubbleUntil = now + 3500;
    pet.stateUntil = now + 3500;
    return true;
  }
}
