// Treino de problemas: aleatórios do Lichess ou gerados a partir dos seus erros.

import { Chessground } from '../vendor/chessground/chessground.min.js';
import { enableKnightArrows } from './knight-arrows.js';
import { enableModifierDrawing } from './draw-shortcuts.js';
import { Chess } from '../vendor/chessjs/chess.js';
import { Engine } from './engine.js';
import { playMove, play, preload as preloadSounds } from './sounds.js';
import { fetchLichessPuzzle, THEMES, DIFFICULTIES, themeLabel } from './lichess.js';
import { getMyPuzzles, updateMyPuzzle, clearMyPuzzles, scanGames } from './mistakes.js';
import { fetchRecentGames } from './chesscom.js';
import { uciToMove, winPercent, scoreToCp, pvToSan } from './review.js';

const $ = (sel) => document.querySelector(sel);

/* ---------------- Estatísticas (localStorage) ---------------- */

const STATS_KEY = 'puzzleStats';
function loadStats() {
  const base = { rating: 1500, played: 0, solved: 0, failed: 0, streak: 0, bestStreak: 0 };
  try {
    return { ...base, ...JSON.parse(localStorage.getItem(STATS_KEY) || '{}') };
  } catch {
    return base;
  }
}
function saveStats() {
  try { localStorage.setItem(STATS_KEY, JSON.stringify(stats)); } catch { /* ignora */ }
}
const stats = loadStats();

function loadPref(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function savePref(key, value) {
  try { localStorage.setItem(key, value); } catch { /* ignora */ }
}

/* ---------------- Estado ---------------- */

const pz = {
  source: loadPref('pzSource', 'lichess'),
  puzzle: null,
  chess: null,
  color: 'white',
  step: 0,            // índice do próximo lance da solução
  status: 'idle',     // idle | loading | playing | thinking | solved | failed
  clean: true,        // sem erro, sem dica, sem solução
  finished: false,
  token: 0,
  initialized: false,
};

let board = null;
let engine = null;
let scanning = false;

function getEngine() {
  engine ??= new Engine();
  return engine;
}

/* ---------------- Inicialização ---------------- */

export function initPuzzles() {
  if (pz.initialized) {
    board.redrawAll();
    return;
  }
  pz.initialized = true;
  preloadSounds();

  board = Chessground($('#pz-board'), {
    coordinates: true,
    animation: { duration: 200 },
    movable: { free: false, showDests: true, events: { after: onUserMove } },
    premovable: { enabled: false },
    draggable: { showGhost: true },
    highlight: { lastMove: true, check: true },
    drawable: { enabled: true, visible: true },
  });
  new ResizeObserver(() => board.redrawAll()).observe($('#pz-board'));
  enableKnightArrows($('#pz-board'));
  enableModifierDrawing($('#pz-board'));

  const theme = $('#pz-theme');
  theme.innerHTML = Object.entries(THEMES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  theme.value = loadPref('pzTheme', 'mix');
  theme.addEventListener('change', () => { savePref('pzTheme', theme.value); nextPuzzle(); });

  const diff = $('#pz-difficulty');
  diff.innerHTML = Object.entries(DIFFICULTIES).map(([k, v]) => `<option value="${k}">${v}</option>`).join('');
  diff.value = loadPref('pzDifficulty', 'normal');
  diff.addEventListener('change', () => { savePref('pzDifficulty', diff.value); nextPuzzle(); });

  document.querySelectorAll('.seg-btn[data-source]').forEach((btn) => {
    btn.addEventListener('click', () => setSource(btn.dataset.source));
  });

  $('#pz-next').addEventListener('click', nextPuzzle);
  $('#pz-hint').addEventListener('click', hint);
  $('#pz-solution').addEventListener('click', showSolution);
  $('#pz-retry').addEventListener('click', retry);
  $('#pz-scan').addEventListener('click', scan);
  $('#pz-clear').addEventListener('click', () => {
    if (!confirm('Apagar todos os problemas gerados das suas partidas?')) return;
    clearMyPuzzles();
    renderMine();
    if (pz.source === 'mine') nextPuzzle();
  });

  document.addEventListener('keydown', (e) => {
    if ($('#puzzles').classList.contains('hidden')) return;
    if (e.target.matches('input, textarea, select')) return;
    if (e.key === 'Enter' || e.key === 'n' || e.key === 'N') { if (pz.finished) nextPuzzle(); }
    else if (e.key === 'h' || e.key === 'H') hint();
    else return;
    e.preventDefault();
  });

  renderStats();
  setSource(pz.source);
}

function setSource(source) {
  pz.source = source;
  savePref('pzSource', source);
  document.querySelectorAll('.seg-btn[data-source]').forEach((b) => b.classList.toggle('active', b.dataset.source === source));
  $('#pz-lichess-opts').classList.toggle('hidden', source !== 'lichess');
  $('#pz-mine-opts').classList.toggle('hidden', source !== 'mine');
  renderMine();
  nextPuzzle();
}

/* ---------------- Carregar problema ---------------- */

async function nextPuzzle() {
  const token = ++pz.token;
  setStatus('loading', 'Carregando problema…');
  board.set({ drawable: { autoShapes: [] } });
  try {
    let puzzle;
    if (pz.source === 'lichess') {
      puzzle = await fetchLichessPuzzle({ angle: $('#pz-theme').value, difficulty: $('#pz-difficulty').value });
    } else {
      puzzle = pickMine();
      if (!puzzle) {
        if (token !== pz.token) return;
        pz.puzzle = null;
        pz.finished = false;
        board.set({ fen: '8/8/8/8/8/8/8/8 w - - 0 1', lastMove: undefined, movable: { color: undefined, dests: new Map() } });
        setStatus('idle', 'Você ainda não tem problemas dos seus erros. Clique em “Buscar erros nas minhas partidas” — ou revise uma partida na aba Revisão.');
        renderInfo();
        return;
      }
    }
    if (token !== pz.token) return;
    load(puzzle);
  } catch (err) {
    if (token !== pz.token) return;
    setStatus('failed', err.message || 'Não deu pra carregar o problema.');
    pz.finished = true;
    renderButtons();
  }
}

/** Escolhe um dos seus problemas: primeiro os nunca tentados, depois os que você errou. */
function pickMine() {
  const list = getMyPuzzles();
  if (!list.length) return null;
  const current = pz.puzzle?.id;
  const pool = (f) => list.filter((p) => f(p) && p.id !== current);
  const candidates = [pool((p) => !p.attempts), pool((p) => p.lastResult === 'failed'), pool(() => true), list];
  const chosen = candidates.find((c) => c.length);
  const p = chosen[Math.floor(Math.random() * chosen.length)];
  return {
    kind: 'mine',
    id: p.id,
    fen: p.fen,
    solution: [p.best],
    bestSan: p.bestSan,
    line: p.line,
    played: p.played,
    winBest: p.winBest,
    category: p.category,
    opponent: p.opponent,
    date: p.date,
    url: p.url,
    attempts: p.attempts,
  };
}

function load(puzzle) {
  pz.puzzle = puzzle;
  pz.step = 0;
  pz.clean = true;
  pz.finished = false;
  pz.chess = new Chess(puzzle.prevFen || puzzle.fen);
  const turn = new Chess(puzzle.fen).turn();
  pz.color = turn === 'w' ? 'white' : 'black';
  $('#pz-turn').innerHTML = `<span><span class="color-dot ${turn}"></span>Jogam as ${turn === 'w' ? 'brancas' : 'pretas'}</span>`;

  board.set({
    fen: pz.chess.fen(),
    orientation: pz.color,
    turnColor: pz.chess.turn() === 'w' ? 'white' : 'black',
    lastMove: undefined,
    check: false,
    movable: { color: undefined, dests: new Map() },
    drawable: { autoShapes: [] },
  });
  renderInfo();
  renderButtons();

  const token = pz.token;
  const start = () => {
    if (token !== pz.token) return;
    setStatus('playing', `Sua vez: encontre o melhor lance para as ${pz.color === 'white' ? 'brancas' : 'pretas'}.`);
    enableMoves();
  };
  if (puzzle.prevFen && puzzle.lastMove) {
    setStatus('loading', 'Veja o lance do adversário…');
    setTimeout(() => {
      if (token !== pz.token) return;
      applyMove(puzzle.lastMove);
      start();
    }, 600);
  } else {
    start();
  }
}

/* ---------------- Jogando ---------------- */

function legalDests() {
  const dests = new Map();
  for (const m of pz.chess.moves({ verbose: true })) {
    if (!dests.has(m.from)) dests.set(m.from, []);
    dests.get(m.from).push(m.to);
  }
  return dests;
}

function enableMoves() {
  board.set({
    turnColor: pz.color,
    movable: { color: pz.color, dests: legalDests() },
  });
}

function disableMoves() {
  board.set({ movable: { color: undefined, dests: new Map() } });
}

/** Aplica um lance (UCI) no estado e no tabuleiro, com som. */
function applyMove(uci) {
  const m = pz.chess.move(uciToMove(uci));
  board.set({
    fen: pz.chess.fen(),
    lastMove: [m.from, m.to],
    turnColor: pz.chess.turn() === 'w' ? 'white' : 'black',
    check: pz.chess.inCheck() ? (pz.chess.turn() === 'w' ? 'white' : 'black') : false,
  });
  playMove(m.san);
  return m;
}

async function onUserMove(orig, dest) {
  if (pz.status !== 'playing') return;
  const expected = pz.puzzle.solution[pz.step];
  // Promoção: usa a peça da solução se o lance bater; senão, dama.
  const piece = pz.chess.get(orig);
  const isPromotion = piece?.type === 'p' && (dest[1] === '8' || dest[1] === '1');
  let uci = orig + dest;
  if (isPromotion) uci += expected && expected.startsWith(uci) && expected.length > 4 ? expected[4] : 'q';

  const fenBefore = pz.chess.fen();
  let move;
  try {
    move = applyMove(uci);
  } catch {
    board.set({ fen: fenBefore });
    return;
  }

  if (uci === expected || pz.chess.isCheckmate()) {
    return correct();
  }

  if (pz.puzzle.kind === 'mine') {
    // Nos seus problemas, aceita qualquer lance tão bom quanto o do motor.
    disableMoves();
    setStatus('thinking', 'Analisando seu lance…');
    const token = pz.token;
    const res = await getEngine().analyze(pz.chess.fen(), { depth: 13, multipv: 1 });
    if (token !== pz.token) return;
    const line = res.lines[0];
    const winAfter = line ? 100 - winPercent(scoreToCp(line.score)) : 50;
    if (pz.puzzle.winBest - winAfter <= 3) {
      return solved(`${move.san} também serve! O motor preferia ${pz.puzzle.bestSan}.`);
    }
    return wrong(fenBefore, move.san);
  }
  wrong(fenBefore, move.san);
}

function correct() {
  pz.step++;
  const sol = pz.puzzle.solution;
  if (pz.step >= sol.length || pz.chess.isCheckmate()) return solved();
  // Resposta do adversário.
  setStatus('good', '✓ Isso! Continue…');
  disableMoves();
  const token = pz.token;
  setTimeout(() => {
    if (token !== pz.token) return;
    applyMove(sol[pz.step]);
    pz.step++;
    if (pz.step >= sol.length) return solved();
    pz.status = 'playing';
    setStatus('good', '✓ Isso! Agora, o próximo lance.');
    pz.status = 'playing';
    enableMoves();
  }, 450);
}

function wrong(fenBefore, san) {
  pz.clean = false;
  stats.streak = 0;
  saveStats();
  renderStats();
  play('check');
  setStatus('bad', `✗ ${san} não é o lance. Tente de novo!`);
  disableMoves();
  const token = pz.token;
  setTimeout(() => {
    if (token !== pz.token) return;
    pz.chess.load(fenBefore);
    board.set({ fen: fenBefore, lastMove: undefined, check: pz.chess.inCheck() ? pz.color : false });
    pz.status = 'playing';
    setStatus('bad', `✗ ${san} não é o lance. Tente de novo!`);
    pz.status = 'playing';
    enableMoves();
  }, 700);
}

function solved(message) {
  disableMoves();
  finish(pz.clean);
  const msg = message || (pz.clean ? '🎉 Resolvido! Muito bem.' : '✓ Resolvido (com ajuda ou depois de errar).');
  setStatus('solved', msg + extraForMine());
  setTimeout(() => play('end'), 120);
}

function extraForMine() {
  const p = pz.puzzle;
  if (p.kind !== 'mine' || !p.played) return '';
  return ` Na partida você jogou ${p.played}.`;
}

/** Registra o resultado (uma vez por problema). */
function finish(success) {
  if (pz.finished) return;
  pz.finished = true;
  const p = pz.puzzle;
  stats.played++;
  if (success) {
    stats.solved++;
    stats.streak++;
    stats.bestStreak = Math.max(stats.bestStreak, stats.streak);
  } else {
    stats.failed++;
    stats.streak = 0;
  }
  let delta = null;
  if (p.kind === 'lichess' && p.rating) {
    const k = stats.played < 20 ? 40 : 20;
    const expected = 1 / (1 + 10 ** ((p.rating - stats.rating) / 400));
    delta = Math.round(k * ((success ? 1 : 0) - expected));
    stats.rating = Math.max(400, stats.rating + delta);
  }
  if (p.kind === 'mine') {
    updateMyPuzzle(p.id, {
      attempts: (p.attempts || 0) + 1,
      lastResult: success ? 'solved' : 'failed',
    });
    renderMine();
  }
  saveStats();
  renderStats(delta);
  renderButtons();
}

/* ---------------- Ajuda ---------------- */

function hint() {
  if (pz.status !== 'playing' || !pz.puzzle) return;
  pz.clean = false;
  const exp = pz.puzzle.solution[pz.step];
  board.set({ drawable: { autoShapes: [{ orig: exp.slice(0, 2), brush: 'green' }] } });
  setStatus('playing', '💡 Dica: mexa a peça marcada.');
}

function showSolution() {
  if (!pz.puzzle || pz.finished && pz.status === 'solved') return;
  pz.clean = false;
  disableMoves();
  pz.status = 'failed';
  const sol = pz.puzzle.solution;
  const token = pz.token;
  const sans = pvToSan(pz.chess.fen(), sol.slice(pz.step), 20);
  const stepPlay = () => {
    if (token !== pz.token) return;
    if (pz.step >= sol.length) {
      const extra = pz.puzzle.kind === 'mine' && pz.puzzle.line?.length ? ` Linha do motor: ${pz.puzzle.line.join(' ')}.` : '';
      setStatus('failed', `Solução: ${sans.join(' ')}.${extra}${extraForMine()}`);
      return;
    }
    const uci = sol[pz.step];
    applyMove(uci);
    board.set({ drawable: { autoShapes: [{ orig: uci.slice(0, 2), dest: uci.slice(2, 4), brush: 'green' }] } });
    pz.step++;
    setTimeout(stepPlay, 650);
  };
  finish(false);
  setStatus('failed', 'Mostrando a solução…');
  stepPlay();
}

function retry() {
  if (!pz.puzzle) return;
  const p = pz.puzzle;
  const wasFinished = pz.finished;
  pz.token++;
  load(p);
  pz.finished = wasFinished; // não conta de novo pro rating
  pz.clean = false;
  renderButtons();
}

/* ---------------- Buscar erros nas partidas ---------------- */

async function scan() {
  if (scanning) return;
  let user = '';
  try { user = localStorage.getItem('username') || ''; } catch { /* ignora */ }
  user = prompt('Seu usuário do chess.com:', user) || '';
  user = user.trim();
  if (!user) return;
  try { localStorage.setItem('username', user); } catch { /* ignora */ }

  const count = Number($('#pz-scan-count').value) || 10;
  const status = $('#pz-scan-status');
  const bar = $('#pz-scan-bar');
  scanning = true;
  $('#pz-scan').disabled = true;
  $('#pz-scan-progress').classList.remove('hidden');
  status.textContent = 'Buscando partidas…';
  bar.style.width = '0%';
  try {
    const games = await fetchRecentGames(user, { limit: count });
    status.textContent = `Analisando ${games.length} partidas…`;
    const added = await scanGames(games, getEngine(), {
      depth: 11,
      onProgress: ({ game, total, pct }) => {
        bar.style.width = pct + '%';
        status.textContent = `Analisando partida ${game} de ${total}… ${pct}%`;
      },
    });
    status.textContent = added
      ? `Pronto! ${added === 1 ? '1 problema novo criado' : `${added} problemas novos criados`} a partir dos seus erros.`
      : 'Pronto! Nenhum problema novo (essas partidas já tinham sido analisadas ou não tiveram erros graves).';
    renderMine();
    if (added && pz.source === 'mine' && (!pz.puzzle || pz.finished)) nextPuzzle();
  } catch (err) {
    status.textContent = err.message || 'Não deu pra buscar as partidas.';
  } finally {
    scanning = false;
    $('#pz-scan').disabled = false;
    bar.style.width = '100%';
  }
}

/* ---------------- Renderização ---------------- */

function setStatus(kind, text) {
  if (['loading', 'playing', 'thinking', 'solved', 'failed', 'idle'].includes(kind)) pz.status = kind;
  const el = $('#pz-status');
  el.className = `card pz-status ${kind}`;
  el.textContent = text;
  renderButtons();
}

function renderButtons() {
  const has = !!pz.puzzle;
  const playing = pz.status === 'playing';
  $('#pz-hint').disabled = !playing;
  $('#pz-solution').disabled = !has || !playing;
  $('#pz-retry').disabled = !has || pz.status === 'loading';
  const next = $('#pz-next');
  next.classList.toggle('primary', pz.finished || !has);
  next.textContent = pz.finished ? 'Próximo ▶' : 'Pular ▶';
}

function renderStats(delta) {
  $('#pz-rating').textContent = Math.round(stats.rating);
  const d = $('#pz-delta');
  if (delta) {
    d.textContent = (delta > 0 ? '+' : '') + delta;
    d.className = delta > 0 ? 'delta up' : 'delta down';
  } else {
    d.textContent = '';
  }
  $('#pz-streak').textContent = stats.streak;
  $('#pz-best').textContent = stats.bestStreak;
  $('#pz-solved').textContent = stats.solved;
  $('#pz-failed').textContent = stats.failed;
}

function renderInfo() {
  const p = pz.puzzle;
  const el = $('#pz-info');
  if (!p) {
    el.innerHTML = '';
    return;
  }
  if (p.kind === 'lichess') {
    const themes = p.themes.map(themeLabel).filter(Boolean);
    el.innerHTML = `
      <div><span class="muted">Problema do Lichess</span> · rating <strong>${p.rating}</strong></div>
      ${themes.length ? `<div class="muted small" id="pz-themes" hidden>Temas: ${themes.join(', ')}</div>
      <button class="link" id="pz-show-themes">mostrar temas</button>` : ''}
      <div><a href="${p.url}" target="_blank" rel="noopener">Abrir no Lichess ↗</a></div>`;
    const btn = $('#pz-show-themes');
    if (btn) btn.addEventListener('click', () => { $('#pz-themes').hidden = false; btn.remove(); });
  } else {
    const date = p.date ? new Date(p.date).toLocaleDateString('pt-BR') : '';
    const cat = { blunder: 'capivarada', mistake: 'erro', miss: 'chance perdida' }[p.category] || 'erro';
    el.innerHTML = `
      <div><span class="muted">Da sua partida</span>${p.opponent ? ` contra <strong>${esc(p.opponent)}</strong>` : ''}${date ? ` · ${date}` : ''}</div>
      <div class="muted small">Aqui você cometeu uma ${cat}. Ache o lance que você deixou passar.</div>
      ${p.url ? `<div><a href="${p.url}" target="_blank" rel="noopener">Ver partida no chess.com ↗</a></div>` : ''}`;
  }
}

function renderMine() {
  const list = getMyPuzzles();
  const solved = list.filter((p) => p.lastResult === 'solved').length;
  const pending = list.filter((p) => !p.attempts || p.lastResult === 'failed').length;
  $('#pz-mine-count').textContent = list.length
    ? `${list.length === 1 ? '1 problema' : `${list.length} problemas`} dos seus erros · ${pending} para treinar · ${solved} ${solved === 1 ? 'resolvido' : 'resolvidos'}`
    : 'Nenhum problema ainda.';
  $('#pz-clear').classList.toggle('hidden', !list.length);
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
