// Sistema de Manifestos Declarativos de Assets (Fase 3).
// Padroniza catálogo de mobis, dimensões (footprint), categorias, regras de colisão e pontos de interação.
import type { Dir, FurnitureKind } from './api';
import type { SpotKind } from '../world/layout/types';

export type FurnitureCategory = 'seating' | 'work' | 'tech' | 'decor' | 'plants' | 'lighting' | 'utility';

export interface FurnitureManifest {
  /** Identificador único do manifesto no catálogo */
  id: string;
  /** Kind correspondente no sistema de arte */
  kind: FurnitureKind;
  /** Variante visual opcional */
  variant?: string;
  /** Nome amigável exibido na UI */
  name: string;
  /** Categoria temática */
  category: FurnitureCategory;
  /** Dimensões em tiles de chão (w x h) */
  footprint: { w: number; h: number };
  /** Modo de montagem */
  mount: 'floor' | 'wall';
  /** Tipo de colisão para a grade de caminhabilidade */
  collision: 'block' | 'walkable' | 'seat';
  /** Onde este móvel pode ser instalado */
  allowedPlacements: ('floor' | 'wall_face' | 'wall_south')[];
  /** Rotações/direções suportadas */
  rotations?: Dir[];
  /** Ponto de interação para personagens usarem o móvel */
  interactiveSpot?: {
    kind: SpotKind;
    offset?: { dx: number; dy: number };
    dir?: Dir;
  };
  /** Ícone pixel-art/emoji na UI */
  icon: string;
  /** Posição sugerida inicial ao adicionar em uma sala */
  defaultLx: number;
  defaultLy: number;
  /** Descrição detalhada */
  description?: string;
}

/** Catálogo formal e canônico de manifestos de móveis declarativos */
export const FURNITURE_MANIFESTS: readonly FurnitureManifest[] = [
  {
    id: 'arcade',
    kind: 'arcade',
    name: 'Fliperama Retrô',
    category: 'tech',
    footprint: { w: 1, h: 1 },
    mount: 'floor',
    collision: 'block',
    allowedPlacements: ['floor'],
    interactiveSpot: {
      kind: 'arcade',
      offset: { dx: 0, dy: -2 },
      dir: 'up',
    },
    icon: '🕹️',
    defaultLx: 14,
    defaultLy: 7,
    description: 'Máquina de fliperama clássica com jogos arcade para os agentes jogarem nos intervalos.',
  },
  {
    id: 'coffee',
    kind: 'coffee_machine',
    name: 'Cafeteira Privativa',
    category: 'utility',
    footprint: { w: 1, h: 1 },
    mount: 'floor',
    collision: 'block',
    allowedPlacements: ['floor'],
    interactiveSpot: {
      kind: 'coffee',
      offset: { dx: 0, dy: -2 },
      dir: 'up',
    },
    icon: '☕',
    defaultLx: 14,
    defaultLy: 5,
    description: 'Máquina expressa na sala para reabastecer a energia sem precisar ir até a copa.',
  },
  {
    id: 'monstera',
    kind: 'plant_tall',
    variant: 'monstera',
    name: 'Planta Monstera',
    category: 'plants',
    footprint: { w: 1, h: 1 },
    mount: 'floor',
    collision: 'block',
    allowedPlacements: ['floor'],
    icon: '🌿',
    defaultLx: 14,
    defaultLy: 9,
    description: 'Folhagem verde exuberante que melhora a acústica e a sensação natural da sala.',
  },
  {
    id: 'bonsai',
    kind: 'plant_tall',
    variant: 'bonsai',
    name: 'Vaso Bonsai',
    category: 'plants',
    footprint: { w: 1, h: 1 },
    mount: 'floor',
    collision: 'block',
    allowedPlacements: ['floor'],
    icon: '🪴',
    defaultLx: 1,
    defaultLy: 8,
    description: 'Árvore em miniatura com estética oriental para foco e equilíbrio.',
  },
  {
    id: 'lamp',
    kind: 'floor_lamp',
    name: 'Luminária de Chão',
    category: 'lighting',
    footprint: { w: 1, h: 1 },
    mount: 'floor',
    collision: 'walkable',
    allowedPlacements: ['floor'],
    icon: '🛋️',
    defaultLx: 1,
    defaultLy: 6,
    description: 'Iluminação indireta e aconchegante para trabalho criativo.',
  },
  {
    id: 'beanbag_blue',
    kind: 'beanbag',
    variant: 'blue',
    name: 'Pufe Azul Confortável',
    category: 'seating',
    footprint: { w: 1, h: 1 },
    mount: 'floor',
    collision: 'seat',
    allowedPlacements: ['floor'],
    interactiveSpot: {
      kind: 'beanbag',
      dir: 'down',
    },
    icon: '🪑',
    defaultLx: 13,
    defaultLy: 8,
    description: 'Assento macio e descontraído para leitura ou relaxamento.',
  },
  {
    id: 'bookshelf',
    kind: 'bookshelf',
    name: 'Estante de Livros',
    category: 'decor',
    footprint: { w: 2, h: 1 },
    mount: 'floor',
    collision: 'block',
    allowedPlacements: ['floor'],
    icon: '📚',
    defaultLx: 8,
    defaultLy: 2,
    description: 'Prateleiras com manuais técnicos, documentações e livros de referência.',
  },
  {
    id: 'cooler',
    kind: 'water_cooler',
    name: 'Bebedouro',
    category: 'utility',
    footprint: { w: 1, h: 1 },
    mount: 'floor',
    collision: 'block',
    allowedPlacements: ['floor'],
    interactiveSpot: {
      kind: 'water',
      offset: { dx: 0, dy: -2 },
      dir: 'up',
    },
    icon: '💧',
    defaultLx: 14,
    defaultLy: 3,
    description: 'Ponto de hidratação e pequenas conversas entre tarefas.',
  },
];

const manifestMap = new Map<string, FurnitureManifest>(
  FURNITURE_MANIFESTS.map((m) => [m.id, m]),
);

/** Encontra um manifesto pelo ID do catálogo */
export function getFurnitureManifest(id: string): FurnitureManifest | undefined {
  return manifestMap.get(id);
}

/** Encontra um manifesto compatível pelo kind e variant */
export function findManifestForProp(kind: FurnitureKind, variant?: string): FurnitureManifest | undefined {
  return FURNITURE_MANIFESTS.find(
    (m) => m.kind === kind && (m.variant ?? '') === (variant ?? ''),
  );
}

/** Filtra manifestos por categoria */
export function getManifestsByCategory(cat: FurnitureCategory): FurnitureManifest[] {
  return FURNITURE_MANIFESTS.filter((m) => m.category === cat);
}
