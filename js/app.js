import { Chessground } from '../vendor/chessground/chessground.min.js';
import { Engine } from './engine.js';
import { playMove, isEnabled, setEnabled } from './sounds.js';
import { fetchRecentGames, RESULT_REASON, TIME_CLASS } from './chesscom.js';
import {
  CATEGORIES, SUMMARY_ORDER, parseGame, buildReview, formatEval, pvToSan,
} from './review.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  game: null,      // resultado de parseGame
  review: null,    // resultado de buildReview
  ply: 0,
  orientation: 'white',
  meta: null,      // dados do chess.com (se veio de lá)
  runId: 0,
};

let engine = null;
let openingsPromise = null;
const board = Chessground($('#board'), {
  viewOnly: true,
  coordinates: true,
  animation: { duration: 180 },
  drawable: { enabled: true, visible: true },
});

function loadOpenings() {
  openingsPromise ??= fetch('data/openings.json').then((r) => r.json()).catch(() => ({}));
  return openingsPromise;
}

/* ---------------- Escolha de partida ---------------- */

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.toggle('hidden', p.dataset.panel !== tab.dataset.tab));
  });
});

const usernameInput = $('#username');
try {
  usernameInput.value = localStorage.getItem('username') || '';
  const d = localStorage.getItem('depth');
  if (d) $('#depth').value = d;
} catch { /* sem localStorage */ }
$('#depth').addEventListener('change', (e) => {
  try { localStorage.setItem('depth', e.target.value); } catch { /* ignora */ }
});

$('#user-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const status = $('#user-status');
  const list = $('#games');
  const user = usernameInput.value.trim();
  status.className = 'status';
  status.textContent = 'Buscando partidas…';
  list.innerHTML = '';
  try {
    try { localStorage.setItem('username', user); } catch { /* ignora */ }
    const games = await fetchRecentGames(user);
    status.textContent = games.length ? 'Escolha uma partida para revisar:' : 'Nenhuma partida encontrada nos últimos meses.';
    for (const g of games) list.appendChild(gameItem(g));
  } catch (err) {
    status.className = 'status error';
    status.textContent = err.message || 'Não deu pra buscar as partidas.';
  }
});

function gameItem(g) {
  const li = document.createElement('li');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'game';
  const letter = { win: 'V', loss: 'D', draw: '½' }[g.outcome];
  const reason = RESULT_REASON[g.reason] || g.reason || '';
  const when = g.endTime ? g.endTime.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '';
  btn.innerHTML = `
    <span class="result ${g.outcome}">${letter}</span>
    <span>
      <span class="vs"><span class="color-dot ${g.myColor}"></span>vs ${esc(g.opponent.name)} <span class="rating">(${g.opponent.rating})</span></span><br>
      <span class="meta">${TIME_CLASS[g.timeClass] || g.timeClass} · ${esc(reason)}</span>
    </span>
    <span class="when">${when}</span>`;
  btn.addEventListener('click', () => startReview(g.pgn, g));
  li.appendChild(btn);
  return li;
}

$('#pgn-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const status = $('#pgn-status');
  status.className = 'status';
  const pgn = $('#pgn').value.trim();
  if (!pgn) {
    status.className = 'status error';
    status.textContent = 'Cole um PGN primeiro.';
    return;
  }
  try {
    startReview(pgn, null);
  } catch (err) {
    status.className = 'status error';
    status.textContent = 'PGN inválido: ' + (err.message || err);
  }
});

$('#btn-back').addEventListener('click', () => {
  state.runId++;
  engine?.stop();
  $('#review').classList.add('hidden');
  $('#picker').classList.remove('hidden');
  window.scrollTo({ top: 0 });
});

/* ---------------- Análise ---------------- */

function startReview(pgn, meta) {
  const game = parseGame(pgn); // lança erro se o PGN for inválido
  if (!game.moves.length) throw new Error('a partida não tem lances.');

  const runId = ++state.runId;
  state.game = game;
  state.review = null;
  state.meta = meta;
  state.ply = 0;
  state.orientation = meta?.myColor === 'b' ? 'black' : 'white';

  $('#picker').classList.add('hidden');
  $('#review').classList.remove('hidden');
  $('#progress-card').classList.remove('hidden');
  $('#summary-card').classList.add('hidden');
  const link = $('#btn-open');
  const url = meta?.url || game.headers.Link;
  link.classList.toggle('hidden', !url);
  if (url) link.href = url;

  renderPlayers();
  renderMoveList();
  renderGraph();
  goTo(0);
  window.scrollTo({ top: 0 });

  analyze(runId).catch((err) => {
    console.error(err);
    $('#progress-text').textContent = 'Erro na análise: ' + (err.message || err);
  });
}

async function analyze(runId) {
  engine?.stop();
  engine ??= new Engine();
  await engine.newGame();
  const depth = Number($('#depth').value) || 15;
  const { positions } = state.game;
  const total = positions.length;
  const t0 = performance.now();

  for (let i = 0; i < total; i++) {
    if (runId !== state.runId) return;
    const pos = positions[i];
    if (!pos.terminal) {
      pos.analysis = await engine.analyze(pos.fen, { depth, multipv: 2 });
    }
    if (runId !== state.runId) return;
    const done = i + 1;
    const pct = Math.round((done / total) * 100);
    const elapsed = (performance.now() - t0) / 1000;
    const eta = Math.max(0, Math.round((elapsed / done) * (total - done)));
    $('#progress-bar').style.width = pct + '%';
    $('#progress-text').textContent = `${pct}% · ~${eta}s`;
  }

  const openings = await loadOpenings();
  if (runId !== state.runId) return;
  state.review = buildReview(state.game, openings);
  $('#progress-card').classList.add('hidden');
  $('#summary-card').classList.remove('hidden');
  renderPlayers();
  renderSummary();
  renderMoveList();
  renderGraph();
  goTo(state.ply);
}

/* ---------------- Renderização ---------------- */

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function badgeHtml(cat, extraClass = '') {
  const c = CATEGORIES[cat];
  if (!c) return '';
  return `<span class="badge ${extraClass}" style="background:${c.color}" title="${c.label}">${c.symbol}</span>`;
}

function playerInfo(color) {
  const h = state.game.headers;
  const clean = (v) => (v && v !== '?' ? v : '');
  const name = clean(color === 'w' ? h.White : h.Black);
  const rating = clean(color === 'w' ? h.WhiteElo : h.BlackElo);
  return { name: name || (color === 'w' ? 'Brancas' : 'Pretas'), rating };
}

function renderPlayers() {
  const top = state.orientation === 'white' ? 'b' : 'w';
  const bottom = top === 'w' ? 'b' : 'w';
  for (const [el, color] of [[$('#player-top'), top], [$('#player-bottom'), bottom]]) {
    const p = playerInfo(color);
    const acc = state.review?.players[color].accuracy;
    el.innerHTML = `
      <span><span class="color-dot ${color}"></span>${esc(p.name)} ${p.rating ? `<span class="rating">(${esc(p.rating)})</span>` : ''}</span>
      ${acc != null ? `<span class="acc" title="Precisão">${acc.toFixed(1)}%</span>` : ''}`;
  }
  const bar = $('#evalbar');
  bar.classList.toggle('flipped', state.orientation === 'black');
}

function renderSummary() {
  const r = state.review;
  $('#opening').innerHTML = r.opening ? `Abertura: <strong>${esc(r.opening.name)}</strong> (${esc(r.opening.eco)})` : '';
  const w = playerInfo('w');
  const b = playerInfo('b');
  let html = `<tr><th></th><th>${esc(w.name)}</th><th>${esc(b.name)}</th></tr>`;
  html += `<tr class="acc"><td class="name">Precisão</td><td>${fmtAcc(r.players.w.accuracy)}</td><td>${fmtAcc(r.players.b.accuracy)}</td></tr>`;
  for (const cat of SUMMARY_ORDER) {
    const cw = r.players.w.counts[cat];
    const cb = r.players.b.counts[cat];
    html += `<tr>
      <td class="name">${badgeHtml(cat, 'mini')} ${CATEGORIES[cat].label}</td>
      <td class="${cw ? '' : 'zero'}" style="${cw ? `color:${CATEGORIES[cat].color}` : ''}">${cw}</td>
      <td class="${cb ? '' : 'zero'}" style="${cb ? `color:${CATEGORIES[cat].color}` : ''}">${cb}</td>
    </tr>`;
  }
  $('#summary').innerHTML = html;
}

function fmtAcc(a) {
  return a == null ? '–' : a.toFixed(1);
}

function renderMoveList() {
  const moves = state.review?.moves || state.game.moves;
  const ol = $('#moves');
  ol.innerHTML = '';
  const firstColor = moves[0]?.color || 'w';
  let i = 0;
  let num = Number(state.game.positions[0].fen.split(' ')[5]) || 1;
  while (i < moves.length) {
    const li = document.createElement('li');
    let white = null;
    let black = null;
    if (i === 0 && firstColor === 'b') {
      black = i++;
    } else {
      white = i++;
      if (i < moves.length) black = i++;
    }
    li.innerHTML = `<span class="num">${num}.</span>${moveCell(moves, white)}${moveCell(moves, black)}`;
    ol.appendChild(li);
    num++;
  }
  ol.querySelectorAll('.mv[data-ply]').forEach((el) => el.addEventListener('click', () => goTo(Number(el.dataset.ply))));
}

function moveCell(moves, idx) {
  if (idx == null) return '<span></span>';
  const m = moves[idx];
  const badge = m.category ? badgeHtml(m.category, 'dot') : '';
  return `<button class="mv" data-ply="${idx + 1}">${badge}<span>${esc(m.san)}</span></button>`;
}

function renderGraph() {
  const svg = $('#graph');
  const positions = state.game.positions;
  const n = positions.length - 1;
  const W = 600;
  const H = 120;
  const x = (i) => (n === 0 ? 0 : (i / n) * W);
  const y = (win) => H - (win / 100) * H;
  let html = `<rect x="0" y="0" width="${W}" height="${H}" fill="#403d39"/>`;
  if (state.review) {
    const pts = positions.map((p, i) => `${x(i).toFixed(1)},${y(p.whiteWin).toFixed(1)}`);
    html += `<polygon fill="#f0f0f0" points="0,${H} ${pts.join(' ')} ${W},${H}"/>`;
    html += `<line x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}" stroke="#888" stroke-width="1" stroke-dasharray="4 4" opacity=".6"/>`;
    state.review.moves.forEach((m, i) => {
      if (['blunder', 'mistake', 'miss', 'brilliant', 'great', 'inaccuracy'].includes(m.category)) {
        const p = positions[i + 1];
        html += `<circle cx="${x(i + 1)}" cy="${y(p.whiteWin)}" r="4" fill="${CATEGORIES[m.category].color}" stroke="#222" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
      }
    });
  }
  html += `<line id="graph-cursor" x1="0" x2="0" y1="0" y2="${H}" stroke="#81b64c" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
  svg.innerHTML = html;
  svg.onclick = (e) => {
    const rect = svg.getBoundingClientRect();
    const ply = Math.round(((e.clientX - rect.left) / rect.width) * n);
    goTo(Math.max(0, Math.min(n, ply)));
  };
  updateGraphCursor();
}

function updateGraphCursor() {
  const cursor = $('#graph-cursor');
  if (!cursor) return;
  const n = state.game.positions.length - 1;
  const xPos = n === 0 ? 0 : (state.ply / n) * 600;
  cursor.setAttribute('x1', xPos);
  cursor.setAttribute('x2', xPos);
}

function goTo(ply) {
  const { positions } = state.game;
  ply = Math.max(0, Math.min(positions.length - 1, ply));
  const changed = ply !== state.ply;
  state.ply = ply;
  const pos = positions[ply];
  const move = ply > 0 ? (state.review?.moves || state.game.moves)[ply - 1] : null;
  const turn = pos.fen.split(' ')[1] === 'w' ? 'white' : 'black';
  if (changed && move) {
    const last = ply === positions.length - 1;
    const result = state.game.headers.Result;
    playMove(move.san, last && result && result !== '*');
  }

  const shapes = [];
  if (move && move.category) {
    const c = CATEGORIES[move.category];
    shapes.push({
      orig: move.to,
      customSvg: {
        html: `<g><circle cx="82" cy="18" r="17" fill="${c.color}" stroke="#fff" stroke-width="3"/>` +
          `<text x="82" y="19" text-anchor="middle" dominant-baseline="central" font-size="${c.symbol.length > 1 && !/\p{Emoji_Presentation}/u.test(c.symbol) ? 17 : 19}" font-weight="900" font-family="system-ui,sans-serif" fill="#fff">${c.symbol}</text></g>`,
      },
    });
    if (move.bestUci && move.bestUci !== move.uci && !['book', 'forced'].includes(move.category)) {
      shapes.push({ orig: move.bestUci.slice(0, 2), dest: move.bestUci.slice(2, 4), brush: 'green' });
    }
  }

  board.set({
    fen: pos.fen,
    orientation: state.orientation,
    turnColor: turn,
    lastMove: move ? [move.from, move.to] : undefined,
    check: lastMoveGaveCheck(move) ? turn : false,
    drawable: { autoShapes: shapes },
  });

  renderMoveCard(ply, move, pos);
  renderEvalBar(pos);

  document.querySelectorAll('.mv.active').forEach((el) => el.classList.remove('active'));
  const active = document.querySelector(`.mv[data-ply="${ply}"]`);
  if (active) {
    active.classList.add('active');
    const list = $('#moves');
    const top = active.offsetTop - list.offsetTop;
    if (top < list.scrollTop || top > list.scrollTop + list.clientHeight - 30) {
      list.scrollTop = top - list.clientHeight / 2;
    }
  }
  updateGraphCursor();
}

function lastMoveGaveCheck(move) {
  return !!move && /[+#]$/.test(move.san);
}

function renderMoveCard(ply, move, pos) {
  const badge = $('#move-badge');
  const comment = $('#move-comment');
  const evalEl = $('#move-eval');
  const line = $('#best-line');
  badge.textContent = '';
  badge.style.background = 'transparent';
  evalEl.textContent = '';
  line.innerHTML = '';

  if (!move) {
    comment.textContent = 'Posição inicial';
    if (pos.analysis) {
      const best = pos.analysis.lines[0];
      line.innerHTML = `<span class="label">Linha do motor:</span> <span class="san">${esc(pvToSan(pos.fen, best.pv, 8).join(' '))}</span>`;
    }
    return;
  }

  if (!move.category) {
    comment.textContent = state.review === null ? `${move.san} — aguardando análise…` : move.san;
    return;
  }

  const c = CATEGORIES[move.category];
  badge.textContent = c.symbol;
  badge.style.background = c.color;
  comment.textContent = move.comment;
  if (pos.whiteScore) evalEl.textContent = `Avaliação: ${formatEval(pos.whiteScore)}`;

  const parts = [];
  if (move.bestUci && move.bestUci !== move.uci && move.bestLineSan.length) {
    parts.push(`<div><span class="label">Melhor linha:</span> <span class="san">${esc(numbered(move.fenBefore, move.bestLineSan))}</span></div>`);
  }
  if (move.replyLineSan.length) {
    parts.push(`<div><span class="label">Continuação:</span> <span class="san">${esc(numbered(move.fenAfter, move.replyLineSan))}</span></div>`);
  }
  line.innerHTML = parts.join('');
}

/** Numera uma lista de lances em SAN a partir de uma FEN ("12. Nf3 Nc6 13. ..."). */
function numbered(fen, sans) {
  const parts = fen.split(' ');
  let num = Number(parts[5]) || 1;
  let white = parts[1] === 'w';
  const out = [];
  sans.forEach((san, i) => {
    if (white) out.push(`${num}. ${san}`);
    else out.push(i === 0 ? `${num}... ${san}` : san);
    if (!white) num++;
    white = !white;
  });
  return out.join(' ');
}

function renderEvalBar(pos) {
  const white = $('#evalbar-white');
  const text = $('#evalbar-text');
  if (!pos.whiteScore) {
    white.style.height = '50%';
    text.textContent = '';
    return;
  }
  white.style.height = pos.whiteWin + '%';
  const s = pos.whiteScore;
  let label;
  if (s.mate !== undefined) label = s.mate === 0 ? '#' : 'M' + Math.abs(s.mate);
  else label = Math.abs(s.cp / 100).toFixed(1);
  text.textContent = label;
  const whiteAhead = pos.whiteCp >= 0;
  // O texto fica do lado de quem está melhor.
  const atBottom = (state.orientation === 'white') === whiteAhead;
  text.classList.toggle('top', !atBottom);
  text.style.color = whiteAhead ? '#333' : '#ddd';
}

/* ---------------- Controles ---------------- */

$('#btn-first').addEventListener('click', () => goTo(0));
$('#btn-prev').addEventListener('click', () => goTo(state.ply - 1));
$('#btn-next').addEventListener('click', () => goTo(state.ply + 1));
$('#btn-last').addEventListener('click', () => goTo(Infinity));
$('#btn-flip').addEventListener('click', flip);

const soundBtn = $('#btn-sound');
function renderSoundBtn() {
  soundBtn.textContent = isEnabled() ? '🔊' : '🔇';
  soundBtn.title = isEnabled() ? 'Desligar som (M)' : 'Ligar som (M)';
}
function toggleSound() {
  setEnabled(!isEnabled());
  renderSoundBtn();
}
soundBtn.addEventListener('click', toggleSound);
renderSoundBtn();

function flip() {
  state.orientation = state.orientation === 'white' ? 'black' : 'white';
  renderPlayers();
  goTo(state.ply);
}

document.addEventListener('keydown', (e) => {
  if (!state.game || $('#review').classList.contains('hidden')) return;
  if (e.target.matches('input, textarea, select')) return;
  if (e.key === 'ArrowLeft') goTo(state.ply - 1);
  else if (e.key === 'ArrowRight') goTo(state.ply + 1);
  else if (e.key === 'Home' || e.key === 'ArrowUp') goTo(0);
  else if (e.key === 'End' || e.key === 'ArrowDown') goTo(Infinity);
  else if (e.key === 'f' || e.key === 'F') flip();
  else if (e.key === 'm' || e.key === 'M') toggleSound();
  else return;
  e.preventDefault();
});

// Exposto para depuração no console.
window.__review = state;
