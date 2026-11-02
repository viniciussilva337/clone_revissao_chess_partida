// Lógica da revisão: transforma as análises do motor em classificação de lances,
// precisão e comentários. Não depende do DOM (dá pra testar no Node).

import { Chess } from '../vendor/chessjs/chess.js';

export const CATEGORIES = {
  brilliant:  { label: 'Brilhante',      symbol: '!!', color: '#26c2a3' },
  great:      { label: 'Ótimo',          symbol: '!',  color: '#749bbf' },
  best:       { label: 'Melhor',         symbol: '★',  color: '#81b64c' },
  excellent:  { label: 'Excelente',      symbol: '👍', color: '#81b64c' },
  good:       { label: 'Bom',            symbol: '✓',  color: '#95b776' },
  book:       { label: 'Teoria',         symbol: '📖', color: '#a88865' },
  forced:     { label: 'Forçado',        symbol: '→',  color: '#95b776' },
  inaccuracy: { label: 'Imprecisão',     symbol: '?!', color: '#f7c631' },
  mistake:    { label: 'Erro',           symbol: '?',  color: '#ffa459' },
  miss:       { label: 'Chance perdida', symbol: '✕',  color: '#ff7769' },
  blunder:    { label: 'Capivarada',     symbol: '??', color: '#fa412d' },
};

export const SUMMARY_ORDER = [
  'brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder',
];

const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const MATE_CP = 100000;

/** Converte um score UCI em centipeões (mate vira um número enorme). */
export function scoreToCp(score) {
  if (score.mate !== undefined) {
    if (score.mate === 0) return -MATE_CP; // quem joga levou mate
    return Math.sign(score.mate) * (MATE_CP - Math.abs(score.mate) * 100);
  }
  return score.cp;
}

/** Probabilidade de vitória (0–100) a partir de centipeões — fórmula do Lichess. */
export function winPercent(cp) {
  if (cp >= MATE_CP / 2) return 100;
  if (cp <= -MATE_CP / 2) return 0;
  const c = Math.max(-1000, Math.min(1000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}

/** Precisão de um lance (0–100) a partir da perda de % de vitória — fórmula do Lichess. */
export function moveAccuracy(winLoss) {
  const acc = 103.1668 * Math.exp(-0.04354 * Math.max(0, winLoss)) - 3.1669;
  return Math.max(0, Math.min(100, acc));
}

export function gameAccuracy(accs) {
  if (!accs.length) return null;
  const mean = accs.reduce((a, b) => a + b, 0) / accs.length;
  const harmonic = accs.length / accs.reduce((a, b) => a + 1 / Math.max(5, b), 0);
  return (mean + harmonic) / 2;
}

/** Formata uma avaliação (do ponto de vista das brancas) para exibição. */
export function formatEval(score) {
  if (score.mate !== undefined) {
    if (score.mate === 0) return '#';
    return (score.mate > 0 ? '+M' : '-M') + Math.abs(score.mate);
  }
  const v = score.cp / 100;
  return (v > 0 ? '+' : '') + v.toFixed(2);
}

function negate(score) {
  return score.mate !== undefined ? { mate: -score.mate } : { cp: -score.cp };
}

function epd(fen) {
  return fen.split(' ').slice(0, 4).join(' ');
}

function material(chess, color) {
  let sum = 0;
  for (const row of chess.board()) {
    for (const sq of row) {
      if (!sq) continue;
      sum += (sq.color === color ? 1 : -1) * PIECE_VALUE[sq.type];
    }
  }
  return sum;
}

/**
 * Peças (exceto rei e peões) do lado `color` que estão penduradas: podem ser capturadas
 * por peça de menor valor, ou estão sem defesa. Se for a vez do adversário, só conta
 * capturas legais (ignora atacantes cravados).
 */
function hangingPieces(chess, color) {
  const opp = color === 'w' ? 'b' : 'w';
  const oppToMove = chess.turn() === opp;
  const legalCaptures = oppToMove ? chess.moves({ verbose: true }).filter((m) => m.captured) : null;
  const result = [];
  for (const row of chess.board()) {
    for (const sq of row) {
      if (!sq || sq.color !== color || sq.type === 'k' || sq.type === 'p') continue;
      const attackers = oppToMove
        ? legalCaptures.filter((m) => m.to === sq.square).map((m) => m.from)
        : chess.attackers(sq.square, opp);
      if (!attackers.length) continue;
      const defenders = chess.attackers(sq.square, color);
      const cheapest = Math.min(...attackers.map((s) => PIECE_VALUE[chess.get(s).type] || 100));
      if (cheapest < PIECE_VALUE[sq.type] || defenders.length === 0) {
        result.push({ square: sq.square, value: PIECE_VALUE[sq.type] });
      }
    }
  }
  return result;
}

/**
 * Detecta se o lance é um sacrifício: o jogador entrega (ou deixa entregue) material
 * de forma que, seguindo a melhor linha do motor, fica com pelo menos 2 pontos a menos.
 */
function isSacrifice(fenBefore, uci, replyPv) {
  const chess = new Chess(fenBefore);
  const me = chess.turn();
  const before = material(chess, me);
  const hangingBefore = new Set(hangingPieces(chess, me).map((h) => h.square));
  chess.move(uciToMove(uci));
  const afterMove = material(chess, me);

  // 1) Peça nova deixada pendurada que custa material líquido.
  for (const h of hangingPieces(chess, me)) {
    if (hangingBefore.has(h.square) && h.square !== uci.slice(2, 4)) continue;
    if (h.value >= 3 && afterMove - h.value <= before - 2) return true;
  }

  // 2) Seguindo a linha do motor, o material cai e não volta em 4 meios-lances.
  let count = 0;
  for (const m of replyPv.slice(0, 4)) {
    try {
      chess.move(uciToMove(m));
    } catch {
      break;
    }
    count++;
  }
  return count >= 2 && material(chess, me) <= before - 2;
}

export function uciToMove(uci) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci.length > 4 ? uci[4] : undefined };
}

/** Converte uma linha em UCI para SAN, a partir de uma posição. */
export function pvToSan(fen, pv, max = 8) {
  const chess = new Chess(fen);
  const out = [];
  for (const m of pv.slice(0, max)) {
    try {
      out.push(chess.move(uciToMove(m)).san);
    } catch {
      break;
    }
  }
  return out;
}

/**
 * Lê o PGN e devolve a lista de posições/lances com dados úteis.
 */
export function parseGame(pgn) {
  const chess = new Chess();
  chess.loadPgn(pgn);
  const headers = chess.getHeaders();
  const history = chess.history({ verbose: true });
  const startFen = headers.FEN || new Chess().fen();

  const replay = new Chess(startFen);
  const positions = [{ fen: replay.fen(), terminal: null }];
  const moves = [];
  for (const m of history) {
    const legalCount = replay.moves().length;
    replay.move(m.san);
    let terminal = null;
    if (replay.isCheckmate()) terminal = 'checkmate';
    else if (replay.isStalemate() || replay.isInsufficientMaterial() || replay.isThreefoldRepetition()) terminal = 'draw';
    positions.push({ fen: replay.fen(), terminal });
    moves.push({
      san: m.san,
      uci: m.from + m.to + (m.promotion || ''),
      from: m.from,
      to: m.to,
      color: m.color,
      captured: m.captured,
      legalCount,
      fenBefore: m.before,
      fenAfter: m.after,
    });
  }
  return { headers, positions, moves };
}

/** Score de uma posição do ponto de vista de quem joga nela. */
function positionScore(pos) {
  if (pos.terminal === 'checkmate') return { mate: 0 };
  if (pos.terminal === 'draw') return { cp: 0 };
  return pos.analysis.lines[0].score;
}

/**
 * Recebe o jogo (parseGame) com `positions[i].analysis` preenchido e devolve a revisão.
 * @param {Record<string,[string,string]>} openings mapa EPD -> [eco, nome]
 */
export function buildReview(game, openings = {}) {
  const { positions, moves } = game;

  // Avaliação de cada posição do ponto de vista das brancas (para gráfico e barra).
  for (const pos of positions) {
    const s = positionScore(pos);
    const whiteToMove = pos.fen.split(' ')[1] === 'w';
    pos.whiteScore = whiteToMove ? s : negate(s);
    pos.whiteCp = scoreToCp(pos.whiteScore);
    pos.whiteWin = winPercent(pos.whiteCp);
  }

  let opening = null;
  let inBook = true;
  const reviewed = [];

  moves.forEach((mv, i) => {
    const before = positions[i];
    const after = positions[i + 1];
    const lines = before.terminal ? [] : before.analysis.lines;
    const best = lines[0];
    const second = lines[1];

    const bestScore = best ? best.score : positionScore(before);
    const winBefore = winPercent(scoreToCp(bestScore));

    // Usa a avaliação da mesma busca quando o lance jogado está entre as linhas do MultiPV.
    const sameLine = lines.find((l) => l.pv[0] === mv.uci);
    let playedScore;
    if (sameLine) playedScore = sameLine.score;
    else playedScore = negate(positionScore(after));
    const winAfter = winPercent(scoreToCp(playedScore));
    const loss = Math.max(0, winBefore - winAfter);
    const isBest = best && best.pv[0] === mv.uci;

    // Teoria (livro de aberturas).
    const book = openings[epd(after.fen)];
    if (book && inBook) opening = { eco: book[0], name: book[1] };
    else inBook = false;

    let category;
    if (book && inBook) category = 'book';
    else if (mv.legalCount === 1) category = 'forced';
    else if (isBest || loss <= 2) category = isBest ? 'best' : 'excellent';
    else if (loss <= 5) category = 'good';
    else if (loss <= 10) category = 'inaccuracy';
    else if (loss <= 20) category = 'mistake';
    else category = 'blunder';

    // Chance perdida: o adversário errou e o jogador não aproveitou.
    const prev = reviewed[i - 1];
    if (prev && ['mistake', 'blunder'].includes(prev.category) && ['inaccuracy', 'mistake'].includes(category) && winBefore >= 60) {
      category = 'miss';
    }

    // Brilhante: sacrifício correto sem estar já completamente ganho.
    if ((category === 'best' || category === 'excellent') && winBefore < 95 && winAfter >= 50) {
      const replyPv = after.terminal ? [] : after.analysis.lines[0]?.pv || [];
      if (isSacrifice(mv.fenBefore, mv.uci, replyPv)) category = 'brilliant';
    }

    // Ótimo: único lance bom da posição (o segundo melhor é bem pior).
    if (category === 'best' && second) {
      const winSecond = winPercent(scoreToCp(second.score));
      const prevMove = moves[i - 1];
      const isRecapture = prevMove && prevMove.captured && prevMove.to === mv.to;
      if (winBefore - winSecond >= 15 && !isRecapture && winBefore < 97) category = 'great';
    }

    const bestSan = best ? pvToSan(mv.fenBefore, best.pv, 1)[0] : null;
    reviewed.push({
      ...mv,
      ply: i + 1,
      category,
      loss,
      accuracy: moveAccuracy(isBest ? 0 : loss),
      winBefore,
      winAfter,
      bestUci: best?.pv[0] || null,
      bestSan,
      bestLineSan: best ? pvToSan(mv.fenBefore, best.pv, 8) : [],
      replyLineSan: after.terminal || !after.analysis ? [] : pvToSan(after.fen, after.analysis.lines[0]?.pv || [], 6),
      evalAfter: after.whiteScore,
      comment: makeComment(category, mv, bestSan, after),
    });
  });

  const players = {};
  for (const color of ['w', 'b']) {
    const mine = reviewed.filter((m) => m.color === color);
    const counts = Object.fromEntries(SUMMARY_ORDER.map((c) => [c, 0]));
    for (const m of mine) if (counts[m.category] !== undefined) counts[m.category]++;
    const scored = mine.filter((m) => m.category !== 'book' && m.category !== 'forced');
    players[color] = {
      accuracy: gameAccuracy(scored.map((m) => m.accuracy)),
      counts,
    };
  }

  return { moves: reviewed, positions, players, opening };
}

function makeComment(category, mv, bestSan, after) {
  const mate = after.terminal === 'checkmate';
  if (mate) return `${mv.san} é xeque-mate!`;
  switch (category) {
    case 'book': return `${mv.san} é um lance de teoria.`;
    case 'forced': return `${mv.san} era o único lance legal.`;
    case 'brilliant': return `${mv.san} é um sacrifício brilhante!`;
    case 'great': return `${mv.san} é um ótimo lance — o único que mantém a avaliação.`;
    case 'best': return `${mv.san} é o melhor lance.`;
    case 'excellent': return `${mv.san} é excelente. ${bestSan && bestSan !== mv.san ? `O motor preferia ${bestSan}.` : ''}`.trim();
    case 'good': return `${mv.san} é bom. O melhor era ${bestSan}.`;
    case 'inaccuracy': return `${mv.san} é uma imprecisão. O melhor era ${bestSan}.`;
    case 'mistake': return `${mv.san} é um erro. O melhor era ${bestSan}.`;
    case 'miss': return `${mv.san} deixou passar a chance de punir o erro do adversário. O melhor era ${bestSan}.`;
    case 'blunder': return `${mv.san} é uma capivarada. O melhor era ${bestSan}.`;
    default: return '';
  }
}
