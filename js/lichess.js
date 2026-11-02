// Problemas aleatórios da API pública (e gratuita) do Lichess.
// Docs: https://lichess.org/api#tag/Puzzles

import { Chess } from '../vendor/chessjs/chess.js';
import { uciToMove } from './review.js';

export const THEMES = {
  mix: 'Misto (todos)',
  mateIn1: 'Mate em 1',
  mateIn2: 'Mate em 2',
  mateIn3: 'Mate em 3',
  hangingPiece: 'Peça pendurada',
  fork: 'Garfo',
  pin: 'Cravada',
  skewer: 'Espeto',
  discoveredAttack: 'Ataque descoberto',
  doubleCheck: 'Xeque duplo',
  trappedPiece: 'Peça presa',
  sacrifice: 'Sacrifício',
  deflection: 'Desvio',
  attraction: 'Atração',
  backRankMate: 'Mate no corredor',
  kingsideAttack: 'Ataque ao roque',
  defensiveMove: 'Lance defensivo',
  quietMove: 'Lance silencioso',
  intermezzo: 'Lance intermediário',
  promotion: 'Promoção',
  endgame: 'Final',
  opening: 'Abertura',
  short: 'Curto (2 lances)',
  long: 'Longo (3+ lances)',
};

export const DIFFICULTIES = {
  easiest: 'Muito fácil',
  easier: 'Fácil',
  normal: 'Normal',
  harder: 'Difícil',
  hardest: 'Muito difícil',
};

/** Nome em português de um tema do Lichess (ou o próprio código). */
export function themeLabel(key) {
  return THEMES[key] || null;
}

export async function fetchLichessPuzzle({ angle = 'mix', difficulty = 'normal' } = {}) {
  const url = new URL('https://lichess.org/api/puzzle/next');
  if (angle && angle !== 'mix') url.searchParams.set('angle', angle);
  if (difficulty) url.searchParams.set('difficulty', difficulty);
  let res;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch {
    throw new Error('Não deu pra falar com o Lichess. Verifique sua internet.');
  }
  if (res.status === 429) throw new Error('Muitos pedidos ao Lichess. Espere um minutinho e tente de novo.');
  if (!res.ok) throw new Error(`Erro ao buscar problema no Lichess (HTTP ${res.status}).`);
  return normalizeLichessPuzzle(await res.json());
}

function isLegal(chess, uci) {
  try {
    const c = new Chess(chess.fen());
    c.move(uciToMove(uci));
    return true;
  } catch {
    return false;
  }
}

/**
 * Converte a resposta da API em { fen, prevFen, lastMove, solution, ... }.
 * `game.pgn` traz os lances da partida até a posição do problema (o último lance é do adversário).
 */
export function normalizeLichessPuzzle(data) {
  const { game, puzzle } = data;
  const tokens = String(game.pgn || '')
    .replace(/\{[^}]*\}/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^\d+\.+/, ''))
    .filter((t) => t && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t));

  const chess = new Chess();
  const fens = [chess.fen()];
  const ucis = [];
  for (const san of tokens) {
    const m = chess.move(san);
    ucis.push(m.from + m.to + (m.promotion || ''));
    fens.push(chess.fen());
  }

  // Normalmente o problema começa no fim do PGN; se o 1º lance da solução não for legal
  // ali, procura alguns lances antes (robustez contra variações no formato).
  let idx = -1;
  for (let back = 0; back <= 2 && idx < 0; back++) {
    const i = fens.length - 1 - back;
    if (i >= 0 && isLegal(new Chess(fens[i]), puzzle.solution[0])) idx = i;
  }
  if (idx < 0) throw new Error('Problema do Lichess em formato inesperado.');

  return {
    kind: 'lichess',
    id: puzzle.id,
    rating: puzzle.rating,
    themes: puzzle.themes || [],
    solution: puzzle.solution,
    fen: fens[idx],
    prevFen: idx > 0 ? fens[idx - 1] : null,
    lastMove: idx > 0 ? ucis[idx - 1] : null,
    url: `https://lichess.org/training/${puzzle.id}`,
  };
}
