// "Meus erros": transforma os erros das suas partidas em problemas pra treinar.
// Tudo fica salvo no navegador (localStorage).

import { parseGame, buildReview } from './review.js';

const KEY_PUZZLES = 'myPuzzles';
const KEY_SCANNED = 'scannedGames';
const MAX_PUZZLES = 600;

function read(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* cheio ou bloqueado */ }
}

export function getMyPuzzles() {
  return read(KEY_PUZZLES, []);
}

export function saveMyPuzzles(list) {
  write(KEY_PUZZLES, list.slice(-MAX_PUZZLES));
}

export function updateMyPuzzle(id, patch) {
  const list = getMyPuzzles();
  const p = list.find((x) => x.id === id);
  if (p) {
    Object.assign(p, patch);
    saveMyPuzzles(list);
  }
}

export function clearMyPuzzles() {
  write(KEY_PUZZLES, []);
  write(KEY_SCANNED, []);
}

/**
 * Extrai problemas de uma revisão pronta: lances do jogador `color` classificados como
 * erro, capivarada ou chance perdida, onde havia um lance bom pra achar.
 * @returns {number} quantos problemas novos foram adicionados
 */
export function addFromReview(review, { color, gameId, opponent, date, url }) {
  const list = getMyPuzzles();
  const ids = new Set(list.map((p) => p.id));
  let added = 0;
  for (const m of review.moves) {
    if (m.color !== color) continue;
    if (!['mistake', 'blunder', 'miss'].includes(m.category)) continue;
    if (!m.bestUci || m.winBefore < 30) continue;
    const id = `${gameId}#${m.ply}`;
    if (ids.has(id)) continue;
    list.push({
      id,
      fen: m.fenBefore,
      best: m.bestUci,
      bestSan: m.bestSan,
      line: m.bestLineSan,
      played: m.san,
      winBest: m.winBefore,
      category: m.category,
      opponent: opponent || null,
      date: date || null,
      url: url || null,
      attempts: 0,
      solved: 0,
      lastResult: null,
    });
    ids.add(id);
    added++;
  }
  if (added) saveMyPuzzles(list);
  if (gameId) markScanned(gameId);
  return added;
}

export function isScanned(gameId) {
  return read(KEY_SCANNED, []).includes(gameId);
}

function markScanned(gameId) {
  const s = read(KEY_SCANNED, []);
  if (!s.includes(gameId)) {
    s.push(gameId);
    write(KEY_SCANNED, s.slice(-500));
  }
}

let openings = null;
async function loadOpenings() {
  openings ??= await fetch('data/openings.json').then((r) => r.json()).catch(() => ({}));
  return openings;
}

/**
 * Analisa partidas do chess.com (já buscadas) e cria problemas com os erros do usuário.
 * @param {Array} games saída de fetchRecentGames
 * @param {import('./engine.js').Engine} engine
 * @param {(info:{game:number,total:number,pct:number})=>void} onProgress
 * @param {()=>boolean} cancelled
 */
export async function scanGames(games, engine, { depth = 11, onProgress, cancelled } = {}) {
  const book = await loadOpenings();
  let added = 0;
  const todo = games.filter((g) => !isScanned(g.url));
  for (let gi = 0; gi < todo.length; gi++) {
    const g = todo[gi];
    let game;
    try {
      game = parseGame(g.pgn);
    } catch {
      continue;
    }
    await engine.newGame();
    const total = game.positions.length;
    for (let i = 0; i < total; i++) {
      if (cancelled?.()) return added;
      const pos = game.positions[i];
      if (!pos.terminal) pos.analysis = await engine.analyze(pos.fen, { depth, multipv: 2 });
      onProgress?.({ game: gi + 1, total: todo.length, pct: Math.round(((gi + (i + 1) / total) / todo.length) * 100) });
    }
    const review = buildReview(game, book);
    added += addFromReview(review, {
      color: g.myColor,
      gameId: g.url,
      opponent: g.opponent.name,
      date: g.endTime ? g.endTime.toISOString() : null,
      url: g.url,
    });
  }
  return added;
}
