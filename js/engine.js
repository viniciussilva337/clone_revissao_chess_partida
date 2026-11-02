// Wrapper simples em volta do Stockfish (WASM) rodando num Web Worker.
// Uma análise por vez; as chamadas ficam numa fila.

const ENGINE_URL = new URL('../vendor/stockfish/stockfish-18-lite-single.js', import.meta.url);

export class Engine {
  constructor() {
    this.worker = new Worker(ENGINE_URL);
    this.listeners = new Set();
    this.queue = Promise.resolve();
    this.worker.onmessage = (e) => {
      const line = typeof e.data === 'string' ? e.data : String(e.data);
      for (const fn of [...this.listeners]) fn(line);
    };
    this.ready = this.#init();
  }

  #waitFor(predicate) {
    return new Promise((resolve) => {
      const fn = (line) => {
        if (predicate(line)) {
          this.listeners.delete(fn);
          resolve(line);
        }
      };
      this.listeners.add(fn);
    });
  }

  send(cmd) {
    this.worker.postMessage(cmd);
  }

  async #init() {
    const uciok = this.#waitFor((l) => l === 'uciok');
    this.send('uci');
    await uciok;
    this.send('setoption name Hash value 64');
    const ready = this.#waitFor((l) => l === 'readyok');
    this.send('isready');
    await ready;
  }

  async newGame() {
    await this.ready;
    this.send('ucinewgame');
    const ready = this.#waitFor((l) => l === 'readyok');
    this.send('isready');
    await ready;
  }

  /**
   * Analisa uma posição.
   * @returns {Promise<{depth:number, lines:Array<{multipv:number, depth:number, score:{cp?:number, mate?:number}, pv:string[]}>, bestmove:string}>}
   * As avaliações são sempre do ponto de vista de quem joga na posição.
   */
  analyze(fen, { depth = 16, multipv = 2, movetime } = {}) {
    const job = async () => {
      await this.ready;
      this.send(`setoption name MultiPV value ${multipv}`);
      const lines = [];
      let maxDepth = 0;
      const info = (line) => {
        if (!line.startsWith('info ') || !line.includes(' pv ')) return;
        const d = /\bdepth (\d+)/.exec(line);
        const mpv = /\bmultipv (\d+)/.exec(line);
        const cp = /\bscore cp (-?\d+)/.exec(line);
        const mate = /\bscore mate (-?\d+)/.exec(line);
        const pv = / pv (.+)$/.exec(line);
        if (!d || !pv || (!cp && !mate)) return;
        if (/\b(lowerbound|upperbound)\b/.test(line)) return;
        const idx = mpv ? Number(mpv[1]) : 1;
        const entry = {
          multipv: idx,
          depth: Number(d[1]),
          score: cp ? { cp: Number(cp[1]) } : { mate: Number(mate[1]) },
          pv: pv[1].trim().split(/\s+/),
        };
        lines[idx - 1] = entry;
        maxDepth = Math.max(maxDepth, entry.depth);
      };
      this.listeners.add(info);
      const done = this.#waitFor((l) => l.startsWith('bestmove'));
      this.send(`position fen ${fen}`);
      this.send(movetime ? `go movetime ${movetime}` : `go depth ${depth}`);
      const best = await done;
      this.listeners.delete(info);
      const bestmove = best.split(/\s+/)[1];
      return { depth: maxDepth, lines: lines.filter(Boolean), bestmove };
    };
    const p = this.queue.then(job, job);
    this.queue = p.catch(() => {});
    return p;
  }

  stop() {
    this.send('stop');
  }

  terminate() {
    this.worker.terminate();
  }
}
