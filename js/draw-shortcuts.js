// Atalho pra desenhar setas sem botão direito (bom no trackpad do notebook):
// Cmd (Mac) ou Ctrl (Windows/Linux) + clicar e arrastar desenha uma seta;
// Cmd/Ctrl + clicar numa casa marca um círculo.
//
// O Chessground já desenha com Shift + clique. Aqui, ao detectar Cmd/Ctrl + clique,
// trocamos o evento por um equivalente com Shift, antes de ele chegar ao tabuleiro.

export function enableModifierDrawing(boardEl) {
  boardEl.addEventListener(
    'mousedown',
    (e) => {
      if (!e.isTrusted || e.button !== 0 || !(e.metaKey || e.ctrlKey) || e.shiftKey) return;
      e.stopPropagation();
      e.preventDefault();
      e.target.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          cancelable: true,
          clientX: e.clientX,
          clientY: e.clientY,
          screenX: e.screenX,
          screenY: e.screenY,
          button: 0,
          buttons: e.buttons,
          shiftKey: true, // o Chessground entende Shift + clique como "desenhar"
        }),
      );
    },
    { capture: true },
  );
  // No Mac, Ctrl + clique abre o menu de contexto; não queremos isso no tabuleiro.
  boardEl.addEventListener('contextmenu', (e) => e.preventDefault());
}
