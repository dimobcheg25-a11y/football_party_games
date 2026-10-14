// Звуки ігор — синтезуються в браузері (Web Audio), без файлів. Спільні для всіх ігор сайту.
// Браузери дозволяють звук лише після першої дії користувача, тому контекст «розблоковуємо» на першому кліку.
window.Sound = (() => {
  let ctx = null;
  let master = null; // загальна гучність
  let muted = false;
  let volume = 0.7;
  try {
    muted = localStorage.getItem('g9:muted') === '1';
    const v = parseFloat(localStorage.getItem('g9:volume'));
    if (!Number.isNaN(v)) volume = Math.min(1, Math.max(0, v));
  } catch { /* приватний режим */ }

  function audio() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  ['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, audio, { once: true }));

  // Один тон з плавною атакою й затуханням.
  function tone(freq, { start = 0, dur = 0.15, type = 'sine', vol = 0.18, slideTo = null } = {}) {
    const ac = audio();
    if (!ac || muted || volume === 0) return;
    const t = ac.currentTime + start;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  const N = { C5: 523.25, E5: 659.25, G5: 783.99, C6: 1046.5, A4: 440, F4: 349.23, D4: 293.66, G4: 392, E4: 329.63 };

  const sounds = {
    // свисток арбітра — два «трелі»
    whistle() {
      tone(2300, { dur: 0.16, type: 'triangle', vol: 0.12, slideTo: 2500 });
      tone(2300, { start: 0.2, dur: 0.38, type: 'triangle', vol: 0.12, slideTo: 2450 });
    },
    myTurn() {
      tone(N.G5, { dur: 0.12, vol: 0.14 });
      tone(N.C6, { start: 0.09, dur: 0.2, vol: 0.12 });
    },
    hit() {
      tone(N.C5, { dur: 0.12, type: 'triangle' });
      tone(N.E5, { start: 0.07, dur: 0.12, type: 'triangle' });
      tone(N.G5, { start: 0.14, dur: 0.25, type: 'triangle' });
    },
    miss() {
      tone(160, { dur: 0.28, type: 'sawtooth', vol: 0.08, slideTo: 110 });
    },
    tick() {
      tone(1400, { dur: 0.04, type: 'square', vol: 0.05 });
    },
    win() {
      [N.C5, N.E5, N.G5, N.C6].forEach((f, i) => tone(f, { start: i * 0.11, dur: 0.22, type: 'triangle', vol: 0.16 }));
      tone(N.C6, { start: 0.48, dur: 0.6, type: 'triangle', vol: 0.14 });
      tone(N.G5, { start: 0.48, dur: 0.6, type: 'sine', vol: 0.08 });
    },
    lose() {
      [N.G4, N.F4, N.E4, N.D4].forEach((f, i) => tone(f, { start: i * 0.16, dur: 0.3, type: 'sine', vol: 0.14 }));
    },
    draw() {
      tone(N.E5, { dur: 0.3, vol: 0.1 });
      tone(N.A4, { dur: 0.3, vol: 0.1 });
      tone(N.C5, { start: 0.18, dur: 0.4, vol: 0.1 });
    },
    pop() {
      tone(600, { dur: 0.09, vol: 0.1, slideTo: 1100 });
    },
  };

  function play(name) {
    if (!muted) sounds[name]?.();
  }

  function setMuted(value) {
    muted = value;
    try { localStorage.setItem('g9:muted', value ? '1' : '0'); } catch { /* ignore */ }
  }

  function setVolume(value) {
    volume = Math.min(1, Math.max(0, value));
    if (master) master.gain.setTargetAtTime(volume, ctx.currentTime, 0.01);
    try { localStorage.setItem('g9:volume', String(volume)); } catch { /* ignore */ }
  }

  return { play, setMuted, isMuted: () => muted, setVolume, getVolume: () => volume };
})();
