(() => {
  const BEST_KEY = "slidescore-best-pct";
  const VIDEO_FALLBACK_SECONDS = 18.9;
  const BPM = 144;
  const BEAT_MS = 60000 / BPM;
  const HIT_WINDOW_MS = 120;
  const BEAT_OFFSET_MS = 80;
  const COUNTDOWN_MS = 1000;
  const COUNTDOWN_STEPS = [3, 2, 1];

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const hud = document.getElementById("hud");
  const startPanel = document.getElementById("start");
  const resultPanel = document.getElementById("result");
  const bestHudEl = document.getElementById("best-hud");
  const comboEl = document.getElementById("combo");
  const timeEl = document.getElementById("time");
  const playBtn = document.getElementById("play-btn");
  const againBtn = document.getElementById("again-btn");
  const countdownEl = document.getElementById("countdown");
  const countdownNum = document.getElementById("countdown-num");
  const bestStartEl = document.getElementById("best-start");
  const bestResultEl = document.getElementById("best-result");
  const finalScoreEl = document.getElementById("final-score");
  const resultDetailEl = document.getElementById("result-detail");
  const mascotVideo = document.getElementById("mascot-video");

  const state = {
    mode: "start",
    score: 0,
    combo: 0,
    maxCombo: 0,
    lastScoreAt: 0,
    remaining: 0,
    startedAt: 0,
    dpr: 1,
    w: 0,
    h: 0,
    pointerId: null,
    origin: { x: 0, y: 0 },
    expected: null,
    lastHitBeat: -1,
    lastAttemptBeat: -1,
    lastClosedBeat: -1,
    blade: [],
    pops: [],
    sparks: [],
    audio: null,
    countdownTimer: 0,
  };

  const maxHits = () => {
    const durationMs = roundDuration() * 1000;
    let count = 0;
    while (BEAT_OFFSET_MS + count * BEAT_MS < durationMs) count += 1;
    return Math.max(1, count);
  };

  const percentOf = (hits) => (hits / maxHits()) * 100;

  const formatPct = (hits) => `${percentOf(hits).toFixed(2)}%`;

  const formatBest = (pct) => `${Number(pct).toFixed(2)}%`;

  const readBest = () => Number(localStorage.getItem(BEST_KEY) || 0);
  const writeBest = (value) => localStorage.setItem(BEST_KEY, String(value));

  const showBest = () => {
    const best = readBest();
    const label = formatBest(best);
    bestStartEl.textContent = `สถิติสูงสุด — ${label}`;
    bestResultEl.textContent = `สถิติสูงสุด — ${label}`;
    bestHudEl.textContent = label;
  };

  const showScore = () => {
    const pct = percentOf(state.score);
    if (pct > readBest()) bestHudEl.textContent = formatBest(pct);
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

  const countBeep = (step) => {
    const audio = ensureAudio();
    if (!audio) return;
    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(step === 1 ? 880 : 520, now);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(now);
    osc.stop(now + 0.12);
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

  const isInputLive = () => state.mode === "play" || state.mode === "countdown";

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
  };

  const roundDuration = () => {
    const duration = mascotVideo.duration;
    return Number.isFinite(duration) && duration > 0 ? duration : VIDEO_FALLBACK_SECONDS;
  };

  const showTime = (seconds) => {
    const value = Math.max(0, Math.ceil(seconds));
    if (value !== state.remaining) {
      state.remaining = value;
      timeEl.textContent = String(value);
    }
  };

  const beatAt = (now) => {
    const t = now - state.startedAt - BEAT_OFFSET_MS;
    const beatIndex = Math.round(t / BEAT_MS);
    const beatTime = beatIndex * BEAT_MS;
    return { beatIndex, offset: Math.abs(t - beatTime) };
  };

  const tryHit = (pos, dir) => {
    if (!state.startedAt) return;
    const { beatIndex, offset } = beatAt(performance.now());
    if (beatIndex < 0 || beatIndex === state.lastAttemptBeat) return;
    state.lastAttemptBeat = beatIndex;
    if (offset > HIT_WINDOW_MS) {
      hideCombo();
      return;
    }
    state.lastHitBeat = beatIndex;
    award(pos, dir);
  };

  const award = (pos, dir) => {
    state.combo += 1;
    state.maxCombo = Math.max(state.maxCombo, state.combo);
    state.score += 1;
    showScore();
    showCombo(state.combo);
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
        tryHit(pos, dir);
        state.expected = neg(dir);
        state.origin = { ...pos };
      }
      return;
    }

    const alignment = dot(dir, state.expected);
    if (alignment > 0.28 && dist >= need) {
      tryHit(pos, dir);
      state.expected = neg(dir);
      state.origin = { ...pos };
      return;
    }

    if (alignment < -0.25) {
      state.origin = { ...pos };
    }
  };

  const freezeVideo = () => {
    mascotVideo.pause();
    mascotVideo.muted = true;
    mascotVideo.loop = false;
    mascotVideo.currentTime = 0;
  };

  const showCount = (n) => {
    countdownNum.textContent = String(n);
    countdownNum.classList.remove("pop");
    void countdownNum.offsetWidth;
    countdownNum.classList.add("pop");
    countBeep(n);
  };

  const beginPlay = () => {
    if (state.mode !== "countdown") return;
    countdownEl.classList.add("hidden");
    state.mode = "play";
    state.startedAt = performance.now();
    state.expected = null;
    mascotVideo.loop = false;
    mascotVideo.muted = false;
    mascotVideo.play().catch(() => {});
  };

  const beginCountdown = () => {
    if (state.mode === "countdown") return;
    clearTimeout(state.countdownTimer);
    state.mode = "countdown";
    state.score = 0;
    state.combo = 0;
    state.maxCombo = 0;
    state.lastScoreAt = 0;
    state.lastHitBeat = -1;
    state.lastAttemptBeat = -1;
    state.lastClosedBeat = -1;
    state.remaining = -1;
    state.startedAt = 0;
    state.pops = [];
    state.sparks = [];
    state.blade = [];
    state.pointerId = null;
    resetStroke();
    hideCombo();
    showBest();
    showTime(roundDuration());
    startPanel.classList.add("hidden");
    resultPanel.classList.add("hidden");
    countdownEl.classList.remove("hidden");
    hud.classList.remove("hidden");
    setScreen("countdown");
    freezeVideo();
    ensureAudio()?.resume();
    mascotVideo.play().then(() => {
      if (state.mode !== "countdown") return;
      mascotVideo.pause();
      mascotVideo.currentTime = 0;
    }).catch(() => {});

    let step = 0;
    const tick = () => {
      if (state.mode !== "countdown") return;
      if (step >= COUNTDOWN_STEPS.length) {
        beginPlay();
        return;
      }
      showCount(COUNTDOWN_STEPS[step]);
      step += 1;
      state.countdownTimer = window.setTimeout(tick, COUNTDOWN_MS);
    };
    tick();
  };

  const endRound = () => {
    if (state.mode !== "play") return;
    state.mode = "result";
    state.pointerId = null;
    state.blade = [];
    hud.classList.add("hidden");
    countdownEl.classList.add("hidden");
    resultPanel.classList.remove("hidden");
    setScreen("result");
    mascotVideo.pause();
    mascotVideo.muted = true;
    const pct = percentOf(state.score);
    finalScoreEl.textContent = formatPct(state.score);
    resultDetailEl.textContent = `คอมโบสูงสุด ${state.maxCombo}`;
    const best = readBest();
    const isNew = pct > best;
    if (isNew) writeBest(pct.toFixed(2));
    showBest();
  };

  const onPointerDown = (event) => {
    if (!isInputLive()) return;
    if (event.target.closest?.("button")) return;
    event.preventDefault();
    state.pointerId = event.pointerId;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch (_) {
      /* capture is optional; window listeners still track the swipe */
    }
    const pos = pointerPos(event);
    resetStroke(pos);
    addBlade(pos);
  };

  const onPointerMove = (event) => {
    if (!isInputLive() || event.pointerId !== state.pointerId) return;
    event.preventDefault();
    const pos = pointerPos(event);
    addBlade(pos);
    if (state.mode === "countdown") {
      state.origin = { ...pos };
      return;
    }
    onStrokeMove(pos);
  };

  const onPointerUp = (event) => {
    if (event.pointerId !== state.pointerId) return;
    state.pointerId = null;
    state.expected = null;
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
      const duration = roundDuration();
      const vt = mascotVideo.currentTime || 0;
      const left = Math.max(0, duration - vt);
      showTime(left);
      if (vt > 0.25 && (mascotVideo.ended || left <= 0)) endRound();

      const t = performance.now() - state.startedAt - BEAT_OFFSET_MS;
      const closedBeat = Math.floor((t - HIT_WINDOW_MS) / BEAT_MS);
      if (closedBeat >= 0 && closedBeat > state.lastClosedBeat) {
        if (state.combo > 0 && state.lastHitBeat < closedBeat) hideCombo();
        state.lastClosedBeat = closedBeat;
      }
    }

    drawStage();
    ctx.save();
    drawBlade(now);
    drawFx();
    ctx.restore();
    requestAnimationFrame(loop);
  };

  const blockScroll = (event) => {
    if (event.target.closest("button")) return;
    event.preventDefault();
  };

  playBtn.addEventListener("click", beginCountdown);
  againBtn.addEventListener("click", beginCountdown);
  window.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("resize", resize);
  document.addEventListener("touchmove", blockScroll, { passive: false });
  mascotVideo.addEventListener("ended", () => {
    if (state.mode === "play") endRound();
  });
  mascotVideo.addEventListener("loadedmetadata", () => {
    if (state.mode !== "play") {
      freezeVideo();
      showTime(roundDuration());
    }
  });

  mascotVideo.playsInline = true;
  freezeVideo();
  showTime(roundDuration());

  showBest();
  resize();
  requestAnimationFrame(loop);
})();
