// Seta "ao vivo" suave enquanto você desenha.
// O Chessground redesenha a seta pulando de casa em casa. Aqui escondemos a seta provisória
// dele e desenhamos a nossa por cima, deslizando suavemente até a casa embaixo do cursor.
// Quando você solta, a seta definitiva é a do próprio Chessground (já em L se for de cavalo).

const SVG_NS = 'http://www.w3.org/2000/svg';
const EASE = 0.35; // fração do caminho percorrida por quadro (quanto maior, mais rápido)

function el(name, attrs = {}) {
  const e = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  return e;
}

export function enableSmoothDrawing(board, boardEl) {
  const wrap = boardEl.parentElement;
  wrap.style.position = 'relative';

  const svg = el('svg', { class: 'live-arrow' });
  Object.assign(svg.style, {
    position: 'absolute', left: '0', top: '0', pointerEvents: 'none', zIndex: '10', overflow: 'visible',
  });
  const defs = el('defs');
  const marker = el('marker', {
    id: `live-arrowhead-${Math.random().toString(36).slice(2)}`,
    orient: 'auto', overflow: 'visible', markerWidth: 4, markerHeight: 4, refX: 2.05, refY: 2,
  });
  const head = el('path', { d: 'M0,0 V4 L3,2 Z' });
  marker.appendChild(head);
  defs.appendChild(marker);
  const shape = el('path', { fill: 'none', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'marker-end': `url(#${marker.id})` });
  svg.append(defs, shape);
  svg.style.display = 'none';
  wrap.appendChild(svg);

  let running = false;
  let end = null; // ponta animada (px, relativo ao tabuleiro)

  const center = (key, sq, white) => {
    const f = key.charCodeAt(0) - 97;
    const r = Number(key[1]) - 1;
    return white ? [(f + 0.5) * sq, (7 - r + 0.5) * sq] : [(7 - f + 0.5) * sq, (r + 0.5) * sq];
  };

  const frame = () => {
    const s = board.state;
    const cur = s.drawable.current;
    if (!cur) {
      running = false;
      svg.style.display = 'none';
      end = null;
      return;
    }
    requestAnimationFrame(frame);
    if (!cur.dest || cur.dest === cur.orig) {
      svg.style.display = 'none';
      end = null;
      return;
    }

    const b = boardEl.getBoundingClientRect();
    const w = wrap.getBoundingClientRect();
    Object.assign(svg.style, { left: `${b.left - w.left}px`, top: `${b.top - w.top}px`, width: `${b.width}px`, height: `${b.height}px` });
    svg.setAttribute('viewBox', `0 0 ${b.width} ${b.height}`);

    const sq = b.width / 8;
    const white = s.orientation === 'white';
    const from = center(cur.orig, sq, white);
    const target = center(cur.dest, sq, white);
    if (!end) end = from.slice(); // a seta "cresce" a partir da casa de origem
    end[0] += (target[0] - end[0]) * EASE;
    end[1] += (target[1] - end[1]) * EASE;
    const settled = Math.hypot(target[0] - end[0], target[1] - end[1]) < sq * 0.02;
    if (settled) end = target.slice();

    const brush = s.drawable.brushes[cur.brush] || s.drawable.brushes.green;
    const width = (brush.lineWidth / 64) * sq;
    const margin = (10 / 64) * sq;
    shape.setAttribute('stroke', brush.color);
    shape.setAttribute('stroke-width', width);
    shape.setAttribute('opacity', brush.opacity);
    head.setAttribute('fill', brush.color);

    const dxSq = Math.round((target[0] - from[0]) / sq);
    const dySq = Math.round((target[1] - from[1]) / sq);
    const knight = (Math.abs(dxSq) === 1 && Math.abs(dySq) === 2) || (Math.abs(dxSq) === 2 && Math.abs(dySq) === 1);
    let d;
    if (knight && settled) {
      // Em L: 2 casas na direção longa, depois 1.
      const horizontal = Math.abs(dxSq) === 2;
      const corner = horizontal ? [target[0], from[1]] : [from[0], target[1]];
      const dir = horizontal ? [0, Math.sign(dySq)] : [Math.sign(dxSq), 0];
      d = `M${from[0]},${from[1]} L${corner[0]},${corner[1]} L${target[0] - dir[0] * margin},${target[1] - dir[1] * margin}`;
    } else {
      const len = Math.hypot(end[0] - from[0], end[1] - from[1]) || 1;
      const k = Math.max(0, len - margin) / len;
      d = `M${from[0]},${from[1]} L${from[0] + (end[0] - from[0]) * k},${from[1] + (end[1] - from[1]) * k}`;
    }
    shape.setAttribute('d', d);
    svg.style.display = '';
  };

  const start = () => {
    if (running) return;
    running = true;
    requestAnimationFrame(frame);
  };
  // O desenho começa no mousedown (botão direito, Shift ou Cmd/Ctrl); o loop só roda enquanto houver desenho.
  // Captura: o Chessground interrompe a propagação do mousedown quando começa a desenhar.
  boardEl.addEventListener('mousedown', () => setTimeout(start, 0), { capture: true });
  boardEl.addEventListener('touchstart', () => setTimeout(start, 0), { capture: true, passive: true });
}
