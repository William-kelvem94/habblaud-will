// Sprites em PixelBuf de animais de estimação (pets) do escritório.
// Estilo pixel art 3/4 isométrico compatível com a estética do Habblaud.
import { PixelBuf } from './core/pixbuf';
import type { BufSprite } from './core/sprite';

export type PetKind = 'cat' | 'dog';
export type PetPose = 'sit' | 'sleep' | 'walk' | 'action';

export interface PetFrameRequest {
  kind: PetKind;
  pose: PetPose;
  dir: 'left' | 'right';
  frame: number;
  variant?: number;
}

/** Paletas de cores para pets */
const CAT_COLORS = [
  // Laranja tigrado
  { base: '#e67e22', shadow: '#ba5d11', eye: '#2ecc71', white: '#ffffff', nose: '#f39c12' },
  // Preto / Bombay
  { base: '#2b2d42', shadow: '#1a1b29', eye: '#f1c40f', white: '#8d99ae', nose: '#e63946' },
  // Siamês
  { base: '#f4ede2', shadow: '#d8cbb8', eye: '#3498db', white: '#4a3b32', nose: '#4a3b32' },
];

const DOG_COLORS = [
  // Caramelo
  { base: '#e59866', shadow: '#ba6c3a', collar: '#e74c3c', white: '#fdfefe', eye: '#2c3e50' },
  // Corgi (marrom/branco)
  { base: '#d35400', shadow: '#963c00', collar: '#3498db', white: '#ffffff', eye: '#1b2631' },
];

export function renderPet(req: PetFrameRequest): BufSprite {
  const isDog = req.kind === 'dog';
  const colors = isDog
    ? DOG_COLORS[(req.variant ?? 0) % DOG_COLORS.length]
    : CAT_COLORS[(req.variant ?? 0) % CAT_COLORS.length];

  // Folha de 16x14 pixels com âncora nos pés (centro inferior)
  const w = 18;
  const h = 16;
  const buf = new PixelBuf(w, h);
  buf.ox = 2;
  buf.oy = 2;

  const flip = req.dir === 'left';
  const px = (x: number) => (flip ? 13 - x : x);

  const f = req.frame % 4;

  if (isDog) {
    drawDog(buf, req.pose, f, px, colors as typeof DOG_COLORS[0]);
  } else {
    drawCat(buf, req.pose, f, px, colors as typeof CAT_COLORS[0]);
  }

  buf.outline();

  return {
    buf,
    ax: 2 + 7,
    ay: 2 + 12,
  };
}

function drawCat(
  b: PixelBuf,
  pose: PetPose,
  frame: number,
  px: (x: number) => number,
  c: typeof CAT_COLORS[0],
): void {
  if (pose === 'sleep') {
    // Gato enroladinho dormindo (respiração sutil)
    const breathe = frame % 2 === 0 ? 0 : -1;
    // Corpo curvado
    b.rect(px(3), 8 + breathe, 7, 4, c.base);
    b.rect(px(4), 7 + breathe, 5, 2, c.base);
    b.rect(px(4), 11 + breathe, 5, 1, c.shadow);
    // Cabeça aconchegada
    b.rect(px(2), 9 + breathe, 3, 3, c.base);
    b.set(px(2), 8 + breathe, c.shadow); // orelhinha
    b.set(px(4), 8 + breathe, c.shadow);
    // Rabo curvado em volta
    b.set(px(10), 10 + breathe, c.shadow);
    b.set(px(10), 9 + breathe, c.shadow);
    b.set(px(9), 8 + breathe, c.shadow);
    // Olho fechado (risquinho)
    b.set(px(3), 10 + breathe, c.shadow);
    return;
  }

  if (pose === 'sit') {
    // Gato sentado observando com rabo balançando
    const tailY = frame % 2 === 0 ? 8 : 7;
    // Corpo
    b.rect(px(4), 7, 5, 5, c.base);
    b.rect(px(4), 11, 5, 1, c.shadow);
    // Patas dianteiras
    b.rect(px(4), 10, 2, 2, c.white);
    // Cabeça
    b.rect(px(4), 3, 5, 4, c.base);
    // Orelhas pontudas
    b.set(px(4), 2, c.shadow);
    b.set(px(8), 2, c.shadow);
    // Olhos
    b.set(px(5), 4, c.eye);
    b.set(px(7), 4, c.eye);
    // Focinho
    b.set(px(6), 5, c.nose);
    // Rabo
    b.set(px(9), 10, c.shadow);
    b.set(px(10), 9, c.shadow);
    b.set(px(10), tailY, c.base);
    return;
  }

  if (pose === 'walk') {
    // Gato caminhando com patas alternadas
    const leg0 = frame % 2 === 0 ? 0 : 1;
    const leg1 = frame % 2 === 0 ? 1 : 0;
    // Corpo
    b.rect(px(3), 6, 7, 4, c.base);
    b.rect(px(3), 9, 7, 1, c.shadow);
    // Patas
    b.rect(px(4), 10 + leg0, 2, 2 - leg0, c.white);
    b.rect(px(8), 10 + leg1, 2, 2 - leg1, c.white);
    // Cabeça erguida à frente
    b.rect(px(8), 4, 4, 4, c.base);
    b.set(px(8), 3, c.shadow);
    b.set(px(11), 3, c.shadow);
    b.set(px(10), 5, c.eye);
    b.set(px(11), 6, c.nose);
    // Rabo empinado curvado
    b.set(px(2), 6, c.shadow);
    b.set(px(1), 5, c.base);
    b.set(px(1), 4, c.base);
    b.set(px(2), 3, c.base);
    return;
  }

  // Action: lambendo a patinha
  b.rect(px(4), 7, 5, 5, c.base);
  b.rect(px(4), 3, 5, 4, c.base);
  b.set(px(4), 2, c.shadow);
  b.set(px(8), 2, c.shadow);
  b.set(px(5), 4, c.eye);
  b.set(px(7), 4, c.eye);
  // Pata levantada perto do rosto
  const pawY = frame % 2 === 0 ? 5 : 6;
  b.rect(px(7), pawY, 2, 2, c.white);
}

function drawDog(
  b: PixelBuf,
  pose: PetPose,
  frame: number,
  px: (x: number) => number,
  c: typeof DOG_COLORS[0],
): void {
  if (pose === 'sleep') {
    // Cachorrinho deitado de lado
    const breathe = frame % 2 === 0 ? 0 : -1;
    b.rect(px(3), 8 + breathe, 8, 4, c.base);
    b.rect(px(2), 9 + breathe, 4, 3, c.base); // cabeça
    b.set(px(1), 9 + breathe, c.shadow); // orelha caída
    b.set(px(2), 11 + breathe, c.eye); // focinho
    b.rect(px(4), 12 + breathe, 2, 1, c.white); // patas
    b.rect(px(8), 12 + breathe, 2, 1, c.white);
    b.set(px(11), 9 + breathe, c.shadow); // rabo
    return;
  }

  if (pose === 'sit') {
    // Cachorrinho sentado abanando o rabo animado
    const tailX = frame % 2 === 0 ? 10 : 11;
    // Corpo
    b.rect(px(4), 7, 6, 5, c.base);
    b.rect(px(4), 11, 6, 1, c.shadow);
    // Patas dianteiras
    b.rect(px(5), 10, 2, 2, c.white);
    // Coleira
    b.rect(px(4), 6, 5, 1, c.collar);
    // Cabeça
    b.rect(px(4), 2, 5, 4, c.base);
    // Orelhas caídas
    b.rect(px(3), 3, 1, 3, c.shadow);
    b.rect(px(9), 3, 1, 3, c.shadow);
    // Olhos e focinho
    b.set(px(5), 3, c.eye);
    b.set(px(7), 3, c.eye);
    b.rect(px(5), 4, 3, 2, c.white);
    b.set(px(6), 4, '#1b2631'); // focinho preto
    // Rabo abanando
    b.set(px(tailX), 8, c.base);
    b.set(px(tailX + 1), 7, c.shadow);
    return;
  }

  if (pose === 'walk') {
    // Cachorro trotando alegre
    const leg0 = frame % 2 === 0 ? 0 : 1;
    const leg1 = frame % 2 === 0 ? 1 : 0;
    b.rect(px(3), 6, 8, 4, c.base);
    b.rect(px(3), 9, 8, 1, c.shadow);
    // Coleira
    b.vline(px(9), 5, 7, c.collar);
    // Patas
    b.rect(px(4), 10 + leg0, 2, 2 - leg0, c.white);
    b.rect(px(9), 10 + leg1, 2, 2 - leg1, c.white);
    // Cabeça
    b.rect(px(9), 3, 4, 4, c.base);
    b.set(px(8), 4, c.shadow); // orelha
    b.set(px(11), 4, c.eye);
    b.set(px(12), 5, '#1b2631');
    // Rabo empinado abanando
    const tailY = frame % 2 === 0 ? 5 : 4;
    b.set(px(2), 6, c.shadow);
    b.set(px(1), tailY, c.base);
    return;
  }

  // Action: latidinho ou pulinho alegre
  const hop = frame % 2 === 0 ? 0 : -1;
  b.rect(px(4), 7 + hop, 6, 5, c.base);
  b.rect(px(4), 6 + hop, 5, 1, c.collar);
  b.rect(px(4), 2 + hop, 5, 4, c.base);
  b.set(px(5), 3 + hop, c.eye);
  b.set(px(7), 3 + hop, c.eye);
  b.set(px(6), 4 + hop, '#1b2631');
  // Patas no ar / abanando
  b.rect(px(4), 10 + hop, 2, 2, c.white);
  b.rect(px(8), 10 + hop, 2, 2, c.white);
  b.set(px(11), 7 + hop, c.base);
  b.set(px(12), 6 + hop, c.shadow);
}
