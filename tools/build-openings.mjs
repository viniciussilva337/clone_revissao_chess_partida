// Gera data/openings.json a partir dos TSVs do lichess-org/chess-openings (CC0).
// Uso: node tools/build-openings.mjs a.tsv b.tsv c.tsv d.tsv e.tsv
import { readFileSync, writeFileSync } from 'node:fs';
import { Chess } from '../vendor/chessjs/chess.js';

const out = {};
for (const file of process.argv.slice(2)) {
  const lines = readFileSync(file, 'utf8').trim().split('\n').slice(1);
  for (const line of lines) {
    const [eco, name, pgn] = line.split('\t');
    const chess = new Chess();
    chess.loadPgn(pgn);
    const epd = chess.fen().split(' ').slice(0, 4).join(' ');
    // Mantém o nome mais curto (mais genérico) quando a mesma posição aparece mais de uma vez.
    if (!out[epd] || out[epd][1].length > name.length) out[epd] = [eco, name];
  }
}
writeFileSync(new URL('../data/openings.json', import.meta.url), JSON.stringify(out));
console.log(Object.keys(out).length, 'posições');
