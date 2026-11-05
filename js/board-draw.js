// Desenho no tabuleiro no estilo do chess.com:
// - a seta vai exatamente para a casa onde você soltou (sem "puxar" para casas válidas);
// - setas laranja e mais grossas (cores alternativas com Alt/Shift, como no chess.com);
// - clique (direito ou Cmd/Ctrl) numa casa pinta a casa de vermelho, em vez de fazer um círculo;
// - clicar normalmente no tabuleiro apaga tudo.

const BRUSHES = {
  // Os nomes vêm do Chessground (green = padrão, red = Shift/Ctrl, blue = Alt, yellow = Alt+Shift);
  // só trocamos as cores.
  green: { key: 'g', color: '#ffaa00', opacity: 0.8, lineWidth: 9 },
  red: { key: 'r', color: '#f0524a', opacity: 0.8, lineWidth: 9 },
  blue: { key: 'b', color: '#48b2f0', opacity: 0.8, lineWidth: 9 },
  yellow: { key: 'y', color: '#86c13f', opacity: 0.8, lineWidth: 9 },
  // Seta do melhor lance / dica (desenhada pelo site).
  best: { key: 'bst', color: '#81b64c', opacity: 0.85, lineWidth: 9 },
};

export function setupDrawing(board, boardEl) {
  const marks = new Set();

  const applyMarks = () => {
    board.set({ highlight: { custom: new Map([...marks].map((k) => [k, 'marked'])) } });
  };

  board.set({
    drawable: {
      enabled: true,
      visible: true,
      defaultSnapToValidMove: false,
      brushes: BRUSHES,
      onChange: (shapes) => {
        // Círculos (forma sem destino) viram casa pintada; clicar de novo desmarca.
        const circles = shapes.filter((s) => !s.dest && !s.customSvg && !s.piece);
        if (!circles.length) return;
        for (const c of circles) {
          if (marks.has(c.orig)) marks.delete(c.orig);
          else marks.add(c.orig);
        }
        board.setShapes(shapes.filter((s) => !circles.includes(s)));
        applyMarks();
      },
    },
  });

  // Clique normal (sem tecla, botão esquerdo) apaga as casas pintadas, como o Chessground
  // já faz com as setas.
  boardEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
    if (marks.size) {
      marks.clear();
      applyMarks();
    }
  });
  boardEl.addEventListener('touchstart', () => {
    if (marks.size) {
      marks.clear();
      applyMarks();
    }
  }, { passive: true });

  return {
    clear() {
      marks.clear();
      applyMarks();
      board.setShapes([]);
    },
  };
}
