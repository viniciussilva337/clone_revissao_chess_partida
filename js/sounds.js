// Sons do tabuleiro.
// - Conjuntos gravados em sounds/<conjunto>/*.mp3 (tocados via Web Audio, sem atraso).
// - "Sintetizado": gerado na hora, sem arquivos.
// - "Personalizado": coloque seus próprios arquivos em sounds/custom/ (ex.: baixados do Pixabay).

export const SOUND_SETS = {
  sfx: 'Madeira (padrão)',
  piano: 'Piano',
  nes: '8-bit (NES)',
  futuristic: 'Futurista',
  synth: 'Sintetizado',
  custom: 'Personalizado (sounds/custom)',
};

// Nome do som -> arquivos tentados, em ordem (o primeiro que existir é usado).
const FILES = {
  move: ['move'],
  capture: ['capture', 'move'],
  castle: ['castle', 'move'],
  check: ['check', 'move'],
  promote: ['promote', 'move'],
  end: ['end'],
};

let ctx = null;
let enabled = true;
let currentSet = 'sfx';
try {
  enabled = localStorage.getItem('sound') !== 'off';
  const saved = localStorage.getItem('soundSet');
  if (saved && SOUND_SETS[saved]) currentSet = saved;
} catch { /* sem localStorage */ }

// Arquivos que existem nos conjuntos que vêm com o site (evita requisições 404).
const BUILTIN_FILES = ['move', 'capture', 'check', 'end'];

const buffers = new Map(); // "set/arquivo" -> Promise<AudioBuffer|null>

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function loadBuffer(set, file) {
  const key = `${set}/${file}`;
  if (set !== 'custom' && !BUILTIN_FILES.includes(file)) return Promise.resolve(null);
  if (!buffers.has(key)) {
    const ac = audio();
    const p = !ac
      ? Promise.resolve(null)
      : fetch(new URL(`../sounds/${key}.mp3`, import.meta.url))
        .then((r) => (r.ok ? r.arrayBuffer() : null))
        .then((data) => (data ? new Promise((res, rej) => ac.decodeAudioData(data, res, rej)) : null))
        .catch(() => null);
    buffers.set(key, p);
  }
  return buffers.get(key);
}

async function bufferFor(set, name) {
  for (const file of FILES[name]) {
    const buf = await loadBuffer(set, file);
    if (buf) return buf;
  }
  return null;
}

/** Pré-carrega o conjunto atual (chamado quando a revisão abre). */
export function preload() {
  if (currentSet === 'synth' || !audio()) return;
  for (const name of Object.keys(FILES)) bufferFor(currentSet, name);
}

let noiseBuffer = null;
function noise(ac) {
  if (!noiseBuffer) {
    noiseBuffer = ac.createBuffer(1, ac.sampleRate * 0.2, ac.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

/** "Toc" de madeira: ruído filtrado curto + um grave curtinho. */
function knock(ac, t, { gain = 0.9, freq = 1900, body = 190 } = {}) {
  const src = ac.createBufferSource();
  src.buffer = noise(ac);
  const band = ac.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = freq;
  band.Q.value = 1.4;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.002);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
  src.connect(band).connect(g).connect(ac.destination);
  src.start(t);
  src.stop(t + 0.1);

  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(body, t);
  osc.frequency.exponentialRampToValueAtTime(body * 0.6, t + 0.08);
  const og = ac.createGain();
  og.gain.setValueAtTime(0.0001, t);
  og.gain.exponentialRampToValueAtTime(gain * 0.6, t + 0.003);
  og.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  osc.connect(og).connect(ac.destination);
  osc.start(t);
  osc.stop(t + 0.1);
}

function tone(ac, t, freq, dur = 0.18, gain = 0.18, type = 'triangle') {
  const osc = ac.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(ac.destination);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

const SOUNDS = {
  move: (ac, t) => knock(ac, t),
  capture: (ac, t) => {
    knock(ac, t, { gain: 1, freq: 2600, body: 230 });
    knock(ac, t + 0.045, { gain: 0.7, freq: 1500, body: 160 });
  },
  castle: (ac, t) => {
    knock(ac, t);
    knock(ac, t + 0.11, { gain: 0.8, freq: 1700 });
  },
  check: (ac, t) => {
    knock(ac, t);
    tone(ac, t + 0.01, 988, 0.16, 0.12, 'square');
  },
  promote: (ac, t) => {
    knock(ac, t);
    tone(ac, t + 0.03, 660, 0.12);
    tone(ac, t + 0.11, 990, 0.16);
  },
  end: (ac, t) => {
    tone(ac, t, 523, 0.5, 0.12);
    tone(ac, t + 0.12, 659, 0.5, 0.12);
    tone(ac, t + 0.24, 784, 0.6, 0.12);
  },
};

function synth(name) {
  const ac = audio();
  if (ac && SOUNDS[name]) SOUNDS[name](ac, ac.currentTime + 0.005);
}

export async function play(name) {
  if (!enabled) return;
  const ac = audio();
  if (!ac) return;
  if (currentSet === 'synth') return synth(name);
  const buf = await bufferFor(currentSet, name);
  if (!buf) return synth(name); // arquivo não encontrado: cai no sintetizado
  const src = ac.createBufferSource();
  src.buffer = buf;
  src.connect(ac.destination);
  src.start();
}

/** Escolhe o som certo a partir do SAN do lance. */
export function playMove(san, gameOver = false) {
  if (/#$/.test(san) || gameOver) {
    play(/x/.test(san) ? 'capture' : 'move');
    setTimeout(() => play('end'), 150);
  } else if (/\+$/.test(san)) play('check');
  else if (/=/.test(san)) play('promote');
  else if (/^O-O/.test(san)) play('castle');
  else if (/x/.test(san)) play('capture');
  else play('move');
}

export function getSet() {
  return currentSet;
}

export function setSet(name) {
  if (!SOUND_SETS[name]) return;
  currentSet = name;
  try { localStorage.setItem('soundSet', name); } catch { /* ignora */ }
  preload();
}

export function isEnabled() {
  return enabled;
}

export function setEnabled(on) {
  enabled = on;
  try { localStorage.setItem('sound', on ? 'on' : 'off'); } catch { /* ignora */ }
  if (on) audio();
}
