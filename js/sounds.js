// Sons de xadrez sintetizados na hora com a Web Audio API (sem arquivos de áudio).
// Imitam o "toc" de peça de madeira no tabuleiro.

let ctx = null;
let enabled = true;
try {
  enabled = localStorage.getItem('sound') !== 'off';
} catch { /* sem localStorage */ }

function audio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
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

export function play(name) {
  if (!enabled) return;
  const ac = audio();
  if (!ac || !SOUNDS[name]) return;
  SOUNDS[name](ac, ac.currentTime + 0.005);
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

export function isEnabled() {
  return enabled;
}

export function setEnabled(on) {
  enabled = on;
  try { localStorage.setItem('sound', on ? 'on' : 'off'); } catch { /* ignora */ }
  if (on) audio();
}
