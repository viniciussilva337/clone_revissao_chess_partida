// Setas em "L" para lances de cavalo.
// O Chessground só desenha setas retas. Aqui observamos o SVG das setas e, quando uma seta
// tem o formato de lance de cavalo (2 casas para um lado e 1 para o outro), trocamos a linha
// reta por um caminho em L: anda 2 casas na direção longa e depois vira 1 casa.

const SVG_NS = 'http://www.w3.org/2000/svg';

function bendLine(line) {
  const x1 = +line.getAttribute('x1');
  const y1 = +line.getAttribute('y1');
  const x2 = +line.getAttribute('x2');
  const y2 = +line.getAttribute('y2');
  const dx = x2 - x1;
  const dy = y2 - y1;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  // Uma casa = 1 unidade no SVG do Chessground. A linha termina um pouco antes do centro
  // da casa de destino (pra caber a ponta), então o vetor fica entre ~1.7 e 2 por ~0.85 e 1.
  const long = Math.max(ax, ay);
  const short = Math.min(ax, ay);
  if (long < 1.5 || long > 2.1 || short < 0.6 || short > 1.05) return;

  const sx = Math.sign(dx);
  const sy = Math.sign(dy);
  const horizontal = ax > ay; // as 2 casas são na horizontal (na tela)
  const tx = x1 + sx * (horizontal ? 2 : 1);
  const ty = y1 + sy * (horizontal ? 1 : 2);
  const margin = Math.hypot(tx - x2, ty - y2); // quanto a linha original encurtava no fim

  let d;
  if (horizontal) d = `M${x1},${y1} L${tx},${y1} L${tx},${ty - sy * margin}`;
  else d = `M${x1},${y1} L${x1},${ty} L${tx - sx * margin},${ty}`;

  const path = document.createElementNS(SVG_NS, 'path');
  for (const attr of line.getAttributeNames()) {
    if (!['x1', 'y1', 'x2', 'y2'].includes(attr)) path.setAttribute(attr, line.getAttribute(attr));
  }
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke-linejoin', 'round');
  line.replaceWith(path);
}

/** Ativa as setas em L num tabuleiro do Chessground (o elemento onde ele foi montado). */
export function enableKnightArrows(boardEl) {
  const process = () => {
    boardEl.querySelectorAll('svg.cg-shapes line').forEach(bendLine);
    // A seta provisória (enquanto você arrasta) é desenhada suave por smooth-arrows.js.
    boardEl.querySelectorAll('svg.cg-shapes > g > g').forEach((g) => {
      const current = (g.getAttribute('cgHash') || '').split(',').includes('true');
      if (current) g.style.display = 'none';
    });
  };
  new MutationObserver(process).observe(boardEl, { childList: true, subtree: true });
  process();
}
