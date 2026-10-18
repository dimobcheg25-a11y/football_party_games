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
    // перекидне табло: короткі клацання з кроком, як перекидаються клітинки ('Вгадай гравця')
    flap(count = 11, step = 0.06) {
      for (let i = 0; i < count; i++) {
        tone(1000 + Math.random() * 500, { start: i * step, dur: 0.03, type: 'square', vol: 0.04, slideTo: 500 });
      }
    },
    // «Шлях»: нова станція — дзвіночок, як у метро
    station() {
      tone(N.E5, { dur: 0.22, type: 'sine', vol: 0.14 });
      tone(N.C5, { start: 0.2, dur: 0.38, type: 'sine', vol: 0.12 });
    },
    // телешоу: «дзинь» відкриття плашки топу ('Топ-10')
    ding() {
      tone(1318.5, { dur: 0.5, type: 'triangle', vol: 0.14 });
      tone(1975.5, { start: 0.04, dur: 0.6, type: 'sine', vol: 0.08 });
      tone(2637, { start: 0.04, dur: 0.25, type: 'sine', vol: 0.04 });
    },
    // печатка на теці: глухий удар + короткий «шлепок» паперу ('Шпигун')
    stamp() {
      tone(140, { dur: 0.16, type: 'sine', vol: 0.3, slideTo: 60 });
      tone(900, { dur: 0.04, type: 'square', vol: 0.05, slideTo: 300 });
    },
    // боксерський гонг: два удари по дзвону з довгим затуханням і металевими обертонами ('Один на один')
    gong() {
      [0, 0.32].forEach((start) => {
        tone(620, { start, dur: 0.9, type: 'sine', vol: 0.16 });
        tone(1556, { start, dur: 0.55, type: 'sine', vol: 0.05 });
        tone(2470, { start, dur: 0.3, type: 'triangle', vol: 0.025 });
      });
    },
    pop() {
      tone(600, { dur: 0.09, vol: 0.1, slideTo: 1100 });
    },
    // трибуна: короткий гул натовпу — шум через смуговий фільтр, наростає й стихає ('Склад матчу')
    crowd() {
      const ac = audio();
      if (!ac || muted || volume === 0) return;
      const len = Math.floor(ac.sampleRate * 1.1);
      const buf = ac.createBuffer(1, len, ac.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = ac.createBufferSource();
      src.buffer = buf;
      const band = ac.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 520;
      band.Q.value = 0.8;
      const gain = ac.createGain();
      const t = ac.currentTime;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.32, t + 0.25);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 1.05);
      src.connect(band).connect(gain).connect(master);
      src.start(t);
      tone(392, { start: 0.05, dur: 0.5, type: 'sawtooth', vol: 0.015, slideTo: 440 }); // «у-у» в гулі
    },
  };

  function play(name, ...args) {
    if (!muted) sounds[name]?.(...args);
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
