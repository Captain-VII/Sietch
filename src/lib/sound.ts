// Sons d'alarme synthétisés : aucun fichier audio à embarquer.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let stopAt = 0;

function audio() {
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.connect(ctx.destination);
  }
  return { ctx, master: master! };
}

function hit(at: number, freq: number, length: number, peak: number, type: OscillatorType = "sine", endFreq = freq) {
  const { ctx, master } = audio();
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  osc.frequency.exponentialRampToValueAtTime(endFreq, at + length);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(peak, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length);
  osc.connect(gain).connect(master);
  osc.start(at);
  osc.stop(at + length + 0.05);
}

const PATTERNS: Record<string, (t: number) => number> = {
  // Trois coups graves, puis un plus fort. Renvoie la durée du motif.
  tambour: (t) => {
    [0, 0.22, 0.44].forEach((d) => hit(t + d, 110, 0.25, 0.9, "sine", 55));
    hit(t + 0.8, 90, 0.45, 1, "sine", 40);
    return 1.4;
  },
  // Pulsation lente et sourde, comme un ver qui approche.
  ver: (t) => {
    [0, 0.5, 1.0].forEach((d, i) => hit(t + d, 60 + i * 8, 0.45, 0.8, "triangle", 40));
    return 1.6;
  },
  bip: (t) => {
    [0, 0.18].forEach((d) => hit(t + d, 880, 0.12, 0.35, "square"));
    return 0.8;
  },
};

/** Joue l'alarme `name` trois fois ; volume de 0 à 100. */
export function playAlarm(name: string, volume: number) {
  const pattern = PATTERNS[name];
  if (!pattern || volume <= 0) return;
  const { ctx, master } = audio();
  void ctx.resume();
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.setValueAtTime((volume / 100) ** 2, ctx.currentTime);
  let t = ctx.currentTime + 0.05;
  for (let i = 0; i < 3; i++) t += pattern(t) + 0.3;
  stopAt = t;
}

export function stopAlarm() {
  if (!ctx || !master || ctx.currentTime > stopAt) return;
  master.gain.cancelScheduledValues(ctx.currentTime);
  master.gain.setValueAtTime(0, ctx.currentTime);
}
