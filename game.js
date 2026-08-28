(() => {
  const ROUND_SECONDS = 30;
  const BEST_KEY = "slidescore-best";
  const COMBO_WINDOW_MS = 520;

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const hud = document.getElementById("hud");
  const startPanel = document.getElementById("start");
  const resultPanel = document.getElementById("result");
  const scoreEl = document.getElementById("score");
  const bestHudEl = document.getElementById("best-hud");
  const comboEl = document.getElementById("combo");
  const timeEl = document.getElementById("time");
  const playBtn = document.getElementById("play-btn");
  const againBtn = document.getElementById("again-btn");
  const bestStartEl = document.getElementById("best-start");
  const bestResultEl = document.getElementById("best-result");
  const finalScoreEl = document.getElementById("final-score");
  const resultDetailEl = document.getElementById("result-detail");
  const newBestEl = document.getElementById("new-best");
  const mascot = document.getElementById("mascot");
  const mascotImg = document.getElementById("mascot-img");

  const POSES = {
    idle: "assets/mascot-idle.png?v=9",
    six: "assets/mascot-six.png?v=9",
    seven: "assets/mascot-six.png?v=9",
  };
  Object.values(POSES).forEach((src) => {
    const img = new Image();
    img.src = src;
  });

  const state = {
    mode: "start",
    score: 0,
    combo: 0,
    maxCombo: 0,
    lastScoreAt: 0,
    remaining: ROUND_SECONDS,
    startedAt: 0,
    dpr: 1,
    w: 0,
    h: 0,
    pointerId: null,
    origin: { x: 0, y: 0 },
    expected: null,
    blade: [],
    pops: [],
    sparks: [],
    shake: 0,
    audio: null,
  };

  const readBest = () => Number(localStorage.getItem(BEST_KEY) || 0);
  const writeBest = (value) => localStorage.setItem(BEST_KEY, String(value));

  const showBest = () => {
    const best = readBest();
    bestStartEl.textContent = `สถิติสูงสุด — ${best}`;
    bestResultEl.textContent = `สถิติสูงสุด — ${best}`;
    bestHudEl.textContent = String(best);
  };

  const threshold = () => Math.max(56, Math.min(state.w, state.h) * 0.16);

  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  const len = (v) => Math.hypot(v.x, v.y);
  const normalize = (v) => {
    const d = len(v) || 1;
    return { x: v.x / d, y: v.y / d };
  };
  const neg = (v) => ({ x: -v.x, y: -v.y });
  const dot = (a, b) => a.x * b.x + a.y * b.y;

  const ensureAudio = () => {
    if (state.audio) return state.audio;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    state.audio = new AudioCtx();
    return state.audio;
  };

  let lastWhoosh = 0;
  const whoosh = (speed) => {
    const audio = ensureAudio();
    if (!audio) return;
    const t = performance.now();
    if (t - lastWhoosh < 90) return;
    lastWhoosh = t;
    const now = audio.currentTime;
    const dur = 0.12;
    const bufferSize = Math.floor(audio.sampleRate * dur);
    const buffer = audio.createBuffer(1, bufferSize, audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i += 1) {
      const t = i / bufferSize;
      data[i] = (Math.random() * 2 - 1) * (1 - t) * 0.55;
    }
    const noise = audio.createBufferSource();
    noise.buffer = buffer;
    const filter = audio.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 900 + speed * 8000;
    filter.Q.value = 0.7;
    const gain = audio.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(audio.destination);
    noise.start(now);
    noise.stop(now + dur);

    const osc = audio.createOscillator();
    const oscGain = audio.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(420, now);
    osc.frequency.exponentialRampToValueAtTime(180, now + 0.08);
    oscGain.gain.setValueAtTime(0.05, now);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
    osc.connect(oscGain);
    oscGain.connect(audio.destination);
    osc.start(now);
    osc.stop(now + 0.1);
  };

  const ding = () => {
    const audio = ensureAudio();
    if (!audio) return;
    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(880, now);
    osc.frequency.exponentialRampToValueAtTime(1320, now + 0.08);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(now);
    osc.stop(now + 0.16);
  };

  const vibrate = (ms) => {
    if (navigator.vibrate) navigator.vibrate(ms);
  };

  const resize = () => {
    state.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    state.w = window.innerWidth;
    state.h = window.innerHeight;
    canvas.width = Math.floor(state.w * state.dpr);
    canvas.height = Math.floor(state.h * state.dpr);
    canvas.style.width = `${state.w}px`;
    canvas.style.height = `${state.h}px`;
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  };

  const pointerPos = (event) => ({ x: event.clientX, y: event.clientY });

  const resetStroke = (pos) => {
    state.origin = pos ? { ...pos } : { x: 0, y: 0 };
    state.expected = null;
  };

  const addBlade = (pos) => {
    const now = performance.now();
    const last = state.blade[state.blade.length - 1];
    const speed = last ? Math.hypot(pos.x - last.x, pos.y - last.y) / Math.max(1, now - last.t) : 0;
    state.blade.push({ x: pos.x, y: pos.y, t: now, speed });
    if (state.blade.length > 48) state.blade.shift();
  };

  const spawnSparks = (pos, dir) => {
    for (let i = 0; i < 14; i += 1) {
      const angle = Math.atan2(dir.y, dir.x) + (Math.random() - 0.5) * 1.4;
      const mag = 2.2 + Math.random() * 6;
      state.sparks.push({
        x: pos.x,
        y: pos.y,
        vx: Math.cos(angle) * mag,
        vy: Math.sin(angle) * mag,
        life: 1,
        size: 1.5 + Math.random() * 2.5,
      });
    }
  };

  const addPop = (pos, text) => {
    state.pops.push({
      x: pos.x,
      y: pos.y,
      text,
      life: 1,
    });
  };

  const setScreen = (name) => {
    document.body.dataset.screen = name;
  };

  const setPose = (name) => {
    mascotImg.src = POSES[name];
    mascot.classList.remove("pose-idle", "pose-six", "pose-seven", "yell");
    mascot.classList.add(`pose-${name}`);
  };

  let comboTimer = 0;
  const hideCombo = () => {
    clearTimeout(comboTimer);
    state.combo = 0;
    comboEl.classList.add("hidden");
  };

  const showCombo = (n) => {
    comboEl.textContent = `Combo x ${n}`;
    comboEl.classList.remove("hidden");
    comboEl.classList.remove("pop");
    void comboEl.offsetWidth;
    comboEl.classList.add("pop");
    clearTimeout(comboTimer);
    comboTimer = setTimeout(hideCombo, COMBO_WINDOW_MS);
  };

  const award = (pos, dir) => {
    const now = performance.now();
    if (now - state.lastScoreAt <= COMBO_WINDOW_MS) {
      state.combo += 1;
    } else {
      state.combo = 1;
    }
    state.maxCombo = Math.max(state.maxCombo, state.combo);
    state.lastScoreAt = now;
    state.score += 1;
    state.shake = Math.min(10, 4 + state.combo * 0.35);
    scoreEl.textContent = String(state.score);
    if (state.score > readBest()) bestHudEl.textContent = String(state.score);
    showCombo(state.combo);
    const isSix = state.score % 2 === 1;
    setPose(isSix ? "six" : "seven");
    mascot.classList.add("yell");
    spawnSparks(pos, dir);
    ding();
    vibrate(state.combo >= 8 ? [8, 20, 12] : 12);
  };

  const onStrokeMove = (pos) => {
    const v = sub(pos, state.origin);
    const dist = len(v);
    if (dist < 6) return;
    const dir = normalize(v);
    const need = threshold();

    if (!state.expected) {
      if (dist >= need) {
        award(pos, dir);
        state.expected = neg(dir);
        state.origin = { ...pos };
      }
      return;
    }

    const alignment = dot(dir, state.expected);
    if (alignment > 0.28 && dist >= need) {
      award(pos, dir);
      state.expected = neg(dir);
      state.origin = { ...pos };
      return;
    }

    if (alignment < -0.25) {
      state.origin = { ...pos };
    }
  };

  const startRound = () => {
    state.mode = "play";
    state.score = 0;
    state.combo = 0;
    state.maxCombo = 0;
    state.lastScoreAt = 0;
    state.remaining = ROUND_SECONDS;
    state.startedAt = performance.now();
    state.pops = [];
    state.sparks = [];
    state.shake = 0;
    state.blade = [];
    state.pointerId = null;
    resetStroke();
    scoreEl.textContent = "0";
    hideCombo();
    showBest();
    timeEl.textContent = String(ROUND_SECONDS);
    startPanel.classList.add("hidden");
    resultPanel.classList.add("hidden");
    hud.classList.remove("hidden");
    setScreen("play");
    setPose("idle");
    ensureAudio()?.resume();
  };

  const endRound = () => {
    state.mode = "result";
    state.pointerId = null;
    state.blade = [];
    hud.classList.add("hidden");
    resultPanel.classList.remove("hidden");
    setScreen("result");
    setPose("idle");
    finalScoreEl.textContent = String(state.score);
    resultDetailEl.textContent = `คอมโบสูงสุด ${state.maxCombo}`;
    const best = readBest();
    const isNew = state.score > best;
    if (isNew) writeBest(state.score);
    newBestEl.classList.toggle("hidden", !isNew || state.score === 0);
    showBest();
  };

  const onPointerDown = (event) => {
    if (state.mode !== "play") return;
    event.preventDefault();
    state.pointerId = event.pointerId;
    canvas.setPointerCapture(event.pointerId);
    const pos = pointerPos(event);
    resetStroke(pos);
    addBlade(pos);
  };

  const onPointerMove = (event) => {
    if (state.mode !== "play" || event.pointerId !== state.pointerId) return;
    event.preventDefault();
    const pos = pointerPos(event);
    addBlade(pos);
    const last = state.blade[state.blade.length - 2];
    if (last) {
      const speed = Math.hypot(pos.x - last.x, pos.y - last.y);
      if (speed > 18) whoosh(Math.min(1, speed / 80));
    }
    onStrokeMove(pos);
  };

  const onPointerUp = (event) => {
    if (event.pointerId !== state.pointerId) return;
    state.pointerId = null;
    state.expected = null;
    hideCombo();
  };

  const drawStage = () => {
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    ctx.clearRect(0, 0, state.w, state.h);
  };

  const drawBlade = (now) => {
    const life = 180;
    state.blade = state.blade.filter((p) => now - p.t < life);
    if (state.blade.length < 2) return;

    const layers = [
      { width: 24, color: "rgba(255, 77, 154, 0.28)", blur: 16 },
      { width: 12, color: "rgba(182, 255, 74, 0.85)", blur: 5 },
      { width: 3.4, color: "rgba(255, 255, 255, 0.98)", blur: 0 },
    ];

    layers.forEach((layer) => {
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = layer.color;
      ctx.shadowColor = layer.color;
      ctx.shadowBlur = layer.blur;
      for (let i = 1; i < state.blade.length; i += 1) {
        const a = state.blade[i - 1];
        const b = state.blade[i];
        const age = (now - b.t) / life;
        ctx.beginPath();
        ctx.lineWidth = Math.max(0.8, layer.width * (1 - age) * (0.7 + Math.min(b.speed * 5, 0.8)));
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.restore();
    });
  };

  const drawFx = () => {
    state.sparks = state.sparks.filter((s) => s.life > 0);
    state.sparks.forEach((s) => {
      s.x += s.vx;
      s.y += s.vy;
      s.vy += 0.12;
      s.life -= 0.035;
      ctx.globalAlpha = Math.max(0, s.life);
      ctx.fillStyle = state.score % 2 === 1 ? "#ffe14a" : "#ff4d9a";
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    state.pops = state.pops.filter((p) => p.life > 0);
    state.pops.forEach((p) => {
      p.y -= 1.4;
      p.life -= 0.02;
      ctx.globalAlpha = Math.max(0, p.life);
      ctx.fillStyle = "#16120c";
      ctx.font = "700 34px Bangers, sans-serif";
      ctx.textAlign = "center";
      ctx.lineJoin = "round";
      ctx.miterLimit = 2;
      ctx.lineWidth = 8;
      ctx.strokeStyle = "#fff";
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillText(p.text, p.x, p.y);
    });
    ctx.globalAlpha = 1;
  };

  const loop = (now) => {
    if (state.mode === "play") {
      const elapsed = (now - state.startedAt) / 1000;
      const left = Math.max(0, ROUND_SECONDS - elapsed);
      if (Math.ceil(left) !== state.remaining) {
        state.remaining = Math.ceil(left);
        timeEl.textContent = String(state.remaining);
      }
      if (left <= 0) endRound();
    }

    drawStage();
    ctx.save();
    if (state.shake > 0) {
      ctx.translate((Math.random() - 0.5) * state.shake, (Math.random() - 0.5) * state.shake);
      state.shake *= 0.84;
      if (state.shake < 0.3) state.shake = 0;
    }

    drawBlade(now);
    drawFx();
    ctx.restore();
    requestAnimationFrame(loop);
  };

  const blockScroll = (event) => {
    if (event.target.closest("button")) return;
    event.preventDefault();
  };

  playBtn.addEventListener("click", startRound);
  againBtn.addEventListener("click", startRound);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("resize", resize);
  document.addEventListener("touchmove", blockScroll, { passive: false });

  showBest();
  resize();
  setPose("idle");
  requestAnimationFrame(loop);
})();
