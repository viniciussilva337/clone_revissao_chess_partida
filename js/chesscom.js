// Busca partidas pela API pública (e gratuita) do chess.com.
// Docs: https://www.chess.com/news/view/published-data-api

const API = 'https://api.chess.com/pub';

async function getJson(url) {
  const res = await fetch(url);
  if (res.status === 404) throw new Error('Usuário não encontrado no chess.com.');
  if (!res.ok) throw new Error(`Erro ao falar com o chess.com (HTTP ${res.status}).`);
  return res.json();
}

/**
 * Retorna as partidas mais recentes do usuário (mais nova primeiro).
 * Percorre os arquivos mensais de trás pra frente até juntar `limit` partidas.
 */
export async function fetchRecentGames(username, { limit = 30, maxMonths = 3 } = {}) {
  const user = username.trim().toLowerCase();
  if (!user) throw new Error('Digite seu usuário do chess.com.');
  const { archives = [] } = await getJson(`${API}/player/${encodeURIComponent(user)}/games/archives`);
  if (!archives.length) throw new Error('Esse usuário ainda não tem partidas públicas.');

  const games = [];
  for (const url of archives.slice(-maxMonths).reverse()) {
    const data = await getJson(url);
    const list = (data.games || []).filter((g) => g.rules === 'chess' && g.pgn);
    games.push(...list.reverse());
    if (games.length >= limit) break;
  }
  return games.slice(0, limit).map((g) => summarize(g, user));
}

function summarize(g, user) {
  const meWhite = g.white.username.toLowerCase() === user;
  const me = meWhite ? g.white : g.black;
  const opp = meWhite ? g.black : g.white;
  let outcome = 'draw';
  if (me.result === 'win') outcome = 'win';
  else if (opp.result === 'win') outcome = 'loss';
  return {
    url: g.url,
    pgn: g.pgn,
    timeClass: g.time_class,
    timeControl: g.time_control,
    endTime: g.end_time ? new Date(g.end_time * 1000) : null,
    rated: g.rated,
    myColor: meWhite ? 'w' : 'b',
    me: { name: me.username, rating: me.rating },
    opponent: { name: opp.username, rating: opp.rating },
    outcome,
    reason: outcome === 'win' ? opp.result : me.result,
  };
}

export const RESULT_REASON = {
  checkmated: 'xeque-mate',
  resigned: 'abandono',
  timeout: 'tempo',
  abandoned: 'abandono da partida',
  stalemate: 'afogamento',
  agreed: 'acordo',
  repetition: 'repetição',
  insufficient: 'material insuficiente',
  timevsinsufficient: 'tempo x material insuficiente',
  '50move': 'regra dos 50 lances',
  win: 'vitória',
};

export const TIME_CLASS = {
  bullet: 'Bullet',
  blitz: 'Blitz',
  rapid: 'Rápida',
  daily: 'Diária',
  classical: 'Clássica',
};
