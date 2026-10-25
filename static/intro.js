/* LightTube · заставка. Сюжет: поиск → набирается «LightTube» → Enter → поле сжимается в логотип → вспышка → слово → приветствие.
   Один таймлайн T управляет и картинкой, и звуком: меняешь число, сдвигается и то и другое. */
(function () {
  "use strict";
  const EXPO = "cubic-bezier(.16,1,.3,1)", SOFT = "cubic-bezier(.65,0,.35,1)", POP = "cubic-bezier(.34,1.56,.64,1)";
  const T = { dot: .15, pill: .35, type: 1.05, sug: 2.15, enter: 2.75, hit: 3.3, word: 3.6, tube: 4.1, hello: 4.55, finale: 5.35, end: 6.7 };
  const GAPS = [.10, .08, .13, .07, .11, .09, .14, .08, .10];       // неровный «живой» ритм набора, секунды между буквами
  const KEY = []; GAPS.reduce((acc, g) => (KEY.push(acc), acc + g), T.type);
  const LEAD = .12, WORD = "LightTube";
  const NOTES = [659.25, 830.61, 987.77, 1318.51];                    // E5 G#5 B5 E6: одна тональность на всю заставку
  const COLORS = ["#6ee7ff", "#a78bfa", "#ff7ad9", "#ffd479"];
  const TXT = {
    ru: { hi: "Приветствуем, ", again: "Рады видеть снова.", s2: "домашний видеосервер", hint: "Нажми, чтобы включить звук · Esc — пропустить" },
    en: { hi: "Welcome, ", again: "Great to see you again.", s2: "home video server", hint: "Tap for sound · Esc to skip" }
  };
  let run = null, styled = false, seq = 0;

  let CSS = `
#welcome.lt-intro{--s:clamp(64px,13vw,128px);position:fixed;inset:0;z-index:200;display:block;gap:0;background:#08080a;color:#f5f5f7;font:16px Inter,"SF Pro Display","Segoe UI",Arial,sans-serif;overflow:hidden;pointer-events:auto;cursor:pointer;animation:none;-webkit-font-smoothing:antialiased}
.lt-intro *{box-sizing:border-box}
.lt-aurora{position:absolute;inset:0;opacity:0;overflow:hidden}
.lt-aurora i{position:absolute;width:55vmax;height:55vmax;border-radius:50%;filter:blur(90px);opacity:.5;mix-blend-mode:screen;animation:lt-drift 14s ease-in-out infinite alternate}
.lt-aurora i:nth-child(1){background:#6ee7ff;left:-15vmax;top:-10vmax}
.lt-aurora i:nth-child(2){background:#a78bfa;right:-18vmax;bottom:-18vmax;animation-delay:-5s}
.lt-aurora i:nth-child(3){background:#ff7ad9;width:35vmax;height:35vmax;left:35vw;top:45vh;opacity:.28;animation-delay:-9s}
@keyframes lt-drift{to{transform:translate(8vmax,6vmax) scale(1.2) rotate(30deg)}}
.lt-vig{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at center,transparent 35%,rgba(0,0,0,.85) 100%)}
.lt-grain{position:absolute;inset:-50%;pointer-events:none;opacity:.1;animation:lt-grain .9s steps(6) infinite;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.9' numOctaves='2' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>")}
@keyframes lt-grain{20%{transform:translate(-3%,2%)}40%{transform:translate(2%,-3%)}60%{transform:translate(-2%,-1%)}80%{transform:translate(3%,3%)}}
.lt-stage{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:clamp(16px,3vw,30px);padding:0 16px}
.lt-sbox{position:absolute;inset:0;display:grid;place-items:center}
.lt-pill{position:relative;width:10px;height:10px;border-radius:50%;background:rgba(255,255,255,.07);box-shadow:0 0 24px rgba(255,255,255,1);border:1px solid rgba(255,255,255,0);opacity:0;overflow:hidden;-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}
.lt-pin{position:absolute;inset:0;display:flex;align-items:center;gap:14px;padding:0 24px;opacity:0;white-space:nowrap}
.lt-mag{width:26px;height:26px;flex-shrink:0;fill:none;stroke:#bfefff;stroke-width:2;stroke-linecap:round}
.lt-typed{display:flex;align-items:center;font-size:clamp(20px,4vw,28px);letter-spacing:-.01em;line-height:1.4}
.lt-k{display:inline-block;max-width:0;opacity:0;overflow:hidden;white-space:pre;font-weight:300;padding-bottom:.1em}.lt-k.b{font-weight:800}
.lt-caret{width:2px;height:1.15em;margin-left:3px;background:#6ee7ff;box-shadow:0 0 10px #6ee7ff;animation:lt-blink 1s steps(1) infinite}
@keyframes lt-blink{50%{opacity:0}}
.lt-sug{position:absolute;left:50%;top:calc(50% + 50px);width:min(86vw,620px);transform:translateX(-50%);display:flex;flex-direction:column;gap:6px;pointer-events:none}
.lt-sg{display:flex;align-items:center;gap:12px;padding:13px 22px;border-radius:18px;font-size:clamp(14px,2.6vw,17px);background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);color:#dcdcea;opacity:0;-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}
.lt-sg svg{width:18px;height:18px;flex-shrink:0;fill:none;stroke:#8fa8b8;stroke-width:2;stroke-linecap:round}
.lt-sg em{font-style:normal;color:#8fa8b8}
.lt-sg:first-child{background:linear-gradient(90deg,rgba(110,231,255,.18),rgba(167,139,250,.14));border-color:rgba(167,139,250,.45);color:#fff}
.lt-row{display:flex;align-items:center;gap:clamp(12px,2.2vw,22px)}
.lt-markbox{position:relative;width:var(--s);height:var(--s);flex-shrink:0}
.lt-mark{position:absolute;inset:0;width:100%;height:100%;overflow:visible;fill:none;stroke:none}
.lt-s1{stroke:url(#lt-g);stroke-width:3;stroke-linecap:round;stroke-dasharray:1;stroke-dashoffset:1}
.lt-f{fill:url(#lt-g);stroke:url(#lt-g);stroke-width:6;stroke-linejoin:round;opacity:0;transform-origin:60px 60px}
.lt-bloom{position:absolute;inset:-35%;border-radius:50%;opacity:0;filter:blur(16px);background:radial-gradient(closest-side,rgba(110,231,255,.85),rgba(167,139,250,.4) 55%,transparent)}
.lt-ring{position:absolute;inset:0;border-radius:50%;border:2px solid rgba(140,235,255,.8);opacity:0}
.lt-word{font-size:clamp(40px,10vw,100px);line-height:1.3;margin:-.15em 0;padding:.05em .04em .15em;letter-spacing:-.03em;white-space:nowrap;clip-path:inset(0 100% 0 0)}
.lt-word span{font-weight:300;display:inline-block}.lt-word b{font-weight:800;display:inline-block}
.lt-word .lt-sh{background:linear-gradient(100deg,#f5f5f7 40%,#fff 50%,#f5f5f7 60%);background-size:300% 100%;background-position:150% 0;-webkit-background-clip:text;background-clip:text;color:transparent}
.lt-rule{height:1px;width:min(60vw,420px);background:linear-gradient(90deg,transparent,#6ee7ff,#a78bfa,transparent);transform:scaleX(0)}
.lt-line{overflow:hidden;padding:.15em 0}
.lt-line>div{transform:translateY(120%);font-size:clamp(15px,2.8vw,26px);text-align:center}
.lt-l2{opacity:.6}
.lt-nick{font-weight:700;background:linear-gradient(90deg,#6ee7ff,#a78bfa,#ff7ad9,#6ee7ff);background-size:250% 100%;-webkit-background-clip:text;background-clip:text;color:transparent;display:inline-block}
.lt-hint{position:absolute;left:0;right:0;bottom:calc(18px + env(safe-area-inset-bottom,0px));text-align:center;font-size:13px;opacity:.55;letter-spacing:.04em}
.lt-fx{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}.lt-flash{position:absolute;inset:0;pointer-events:none;opacity:0;background:radial-gradient(circle at 50% 50%,rgba(255,255,255,.55),rgba(140,220,255,.25) 35%,transparent 65%)}
.lt-static .lt-sbox,.lt-static .lt-sug,.lt-static .lt-fx,.lt-static .lt-flash{display:none}
.lt-static .lt-aurora{opacity:1}.lt-static .lt-s1{stroke-dashoffset:0}.lt-static .lt-f{opacity:1}.lt-static .lt-word{clip-path:none}.lt-static .lt-rule{transform:none}.lt-static .lt-line>div{transform:none}.lt-static .lt-word .lt-sh{background-position:50% 0}
.lt-reveal .grid>*{animation:lt-rise .8s cubic-bezier(.16,1,.3,1) both}
@keyframes lt-rise{from{opacity:0;transform:translateY(26px) scale(.97)}}
`;
  for (let i = 1; i <= 16; i++) CSS += `.lt-reveal .grid>*:nth-child(${i}){animation-delay:${(i * .045).toFixed(3)}s}\n`;   // карточки ленты выезжают по очереди после заставки

  function lang(l) {
    if (!l) { try { l = (JSON.parse(localStorage.getItem("lighttube-preferences") || "{}") || {}).language; } catch (e) {} }
    return l === "ru" ? "ru" : "en";
  }

  function audioKit() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC(), master = ctx.createGain(), comp = ctx.createDynamicsCompressor();
    master.gain.value = .9; master.connect(comp); comp.connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 2.4), ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); }
    const verb = ctx.createConvolver(), wet = ctx.createGain(), out = ctx.createGain();
    verb.buffer = ir; wet.gain.value = .4; verb.connect(wet); wet.connect(master); out.connect(master); out.connect(verb);
    const nb = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), nd = nb.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    return { ctx: ctx, master: master, out: out, nb: nb };
  }

  // t0: момент ctx.currentTime, соответствующий нулю таймлайна; from: с какой секунды играть (если звук разблокировали позже)
  function score(a, t0, from) {
    const ctx = a.ctx, out = a.out;
    const ok = t => t >= from - .02 && t0 + t >= ctx.currentTime - .02;
    const tone = (t, f, dur, peak, type, f2) => {
      if (!ok(t)) return;
      const w = t0 + t, o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || "sine"; o.frequency.setValueAtTime(f, w);
      if (f2) o.frequency.exponentialRampToValueAtTime(f2, w + dur);
      g.gain.setValueAtTime(.0001, w); g.gain.exponentialRampToValueAtTime(peak, w + .006); g.gain.exponentialRampToValueAtTime(.0001, w + dur);
      o.connect(g); g.connect(out); o.start(w); o.stop(w + dur + .05);
    };
    const pluck = (t, f, dur, peak) => { tone(t, f, dur, peak); tone(t, f * 2, dur * .5, peak * .35, "triangle"); };
    const noise = (t, dur, type, f0, f1, peak) => {
      if (!ok(t)) return;
      const w = t0 + t, s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
      s.buffer = a.nb; f.type = type; f.Q.value = 1.2;
      f.frequency.setValueAtTime(f0, w); f.frequency.exponentialRampToValueAtTime(f1, w + dur);
      g.gain.setValueAtTime(.0001, w); g.gain.exponentialRampToValueAtTime(peak, w + dur * .7); g.gain.exponentialRampToValueAtTime(.0001, w + dur);
      s.connect(f); f.connect(g); g.connect(out); s.start(w, 0, dur + .05);
    };
    [82.41, 123.47, 164.81, 207.65].forEach(f => {                                      // тёплый фон: аккорд E
      const w = Math.max(ctx.currentTime, t0), o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
      o.type = "triangle"; o.frequency.value = f; lp.type = "lowpass"; lp.frequency.value = 500;
      g.gain.setValueAtTime(.0001, w); g.gain.exponentialRampToValueAtTime(.04, w + 2.2);
      g.gain.setValueAtTime(.04, w + 2.2); g.gain.exponentialRampToValueAtTime(.0001, Math.max(w + 2.5, t0 + T.end + .5));
      o.connect(lp); lp.connect(g); g.connect(out); o.start(w); o.stop(Math.max(w + 2.6, t0 + T.end + .6));
    });
    tone(T.dot, 1318.51, .5, .07);                                                      // точка появилась
    noise(T.pill - .05, .7, "bandpass", 300, 3000, .12);                                // поле раскрывается
    KEY.forEach((t, i) => { noise(t, .03, "highpass", 2500, 4000, .1); tone(t, 160 + (i % 3) * 14, .06, .07, "sine", 110); });   // клавиши
    [0, 1, 2].forEach(i => pluck(T.sug + i * .09 + .04, NOTES[i], .5, .09));            // подсказки выпадают
    noise(T.enter, .05, "highpass", 1800, 3200, .14); tone(T.enter, 120, .12, .12, "sine", 70);   // Enter
    noise(T.enter + .05, (T.hit - T.enter - .05) / .7, "bandpass", 250, 6500, .26);     // нарастание до вспышки
    tone(T.hit, 55, .9, .55, "sine", 38); tone(T.hit, 130, .6, .45, "sine", 48);        // бас и удар
    [1318.51, 1975.53, 2637.02].forEach((f, i) => tone(T.hit + i * .025, f, 2.2, [.07, .06, .04][i]));
    noise(T.hit, .25, "highpass", 6000, 9000, .06);                                     // «стеклянный» блеск
    [2637.02, 2959.96, 3322.44, 3951.07, 2637.02, 3322.44].forEach((f, i) => tone(T.hit + .12 + i * .13, f, .9, .03));  // дождь искр
    noise(T.word - .05, 1, "bandpass", 700, 4200, .16);                                 // выезд слова
    [1318.51, 1479.98, 1661.22, 1975.53, 2217.46, 2637.02, 2959.96, 3322.44].forEach((f, i) => tone(T.word + .1 + i * .13, f, .5, .035));
    pluck(T.tube + .1, 987.77, .9, .14); pluck(T.tube + .1, 1479.98, .9, .07);          // приземление «Tube»
    pluck(T.hello + .05, 830.61, .9, .1); pluck(T.hello + .2, 1318.51, 1.2, .1);        // приветствие
    [659.25, 830.61, 987.77, 1108.73, 1479.98].forEach((f, i) => pluck(T.finale + i * .07, f, 1.6, .1));  // финальный аккорд
  }

  const MAG = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg>';
  function markup(root, nick, L) {
    root.className = "lt-intro";
    const letters = WORD.split("").map((ch, i) => `<span class="lt-k${i > 4 ? " b" : ""}">${ch}</span>`).join("");
    root.innerHTML = `<div class="lt-aurora"><i></i><i></i><i></i></div><div class="lt-vig"></div><div class="lt-grain"></div>
<div class="lt-stage"><div class="lt-sbox"><div class="lt-pill"><div class="lt-pin"><svg class="lt-mag" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><div class="lt-typed">${letters}<i class="lt-caret"></i></div></div></div></div>
<div class="lt-sug"><div class="lt-sg">${MAG}<span>LightTube</span></div><div class="lt-sg">${MAG}<span>LightTube <em>· ${L.s2}</em></span></div><div class="lt-sg">${MAG}<span>LightTube <em>beta</em></span></div></div>
<div class="lt-row"><div class="lt-markbox"><i class="lt-bloom"></i><i class="lt-ring"></i><i class="lt-ring"></i>
<svg class="lt-mark" viewBox="0 0 120 120" aria-hidden="true"><defs><linearGradient id="lt-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6ee7ff"/><stop offset=".55" stop-color="#a78bfa"/><stop offset="1" stop-color="#ff7ad9"/></linearGradient></defs>
<rect class="lt-s1" x="6" y="6" width="108" height="108" rx="30" pathLength="1"/><path class="lt-f" d="M48 38 L48 82 L84 60 Z"/></svg></div>
<div class="lt-word"><span class="lt-sh">Light</span><b class="lt-sh">Tube</b></div></div><div class="lt-rule"></div>
<div class="lt-line"><div class="lt-l1">${L.hi}<span class="lt-nick"></span>!</div></div><div class="lt-line"><div class="lt-l2">${L.again}</div></div></div>
<i class="lt-flash"></i><canvas class="lt-fx"></canvas><div class="lt-hint" hidden>${L.hint}</div>`;
    root.querySelector(".lt-nick").textContent = nick || "viewer";   // textContent: ник не может внедрить HTML
  }

  // Частицы на canvas: искры от клавиш, взрыв на вспышке, искры за выезжающим словом, ударная волна и анаморфный блик
  function fx(r, root, zero) {
    const cv = root.querySelector(".lt-fx"), c = cv && cv.getContext && cv.getContext("2d");
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1), W = root.clientWidth, H = root.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr; c.setTransform(dpr, 0, 0, dpr, 0, 0);
    const mb = root.querySelector(".lt-markbox"), wd = root.querySelector(".lt-word"), cr = root.querySelector(".lt-caret");
    const rnd = (a, b) => a + Math.random() * (b - a), pal = COLORS.concat(["#ffffff", "#ffffff"]), pick = () => pal[(Math.random() * pal.length) | 0];
    const R0 = Math.hypot(W, H) / 2, k = Math.min(W, H) / 700;
    let S = [], last = performance.now(); const fired = {};
    const burst = (x, y, n, v, life, big) => { for (let i = 0; i < n; i++) { const an = rnd(0, 6.283), sp = Math.pow(Math.random(), .6) * v * k; S.push({ x: x, y: y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, l: 0, m: rnd(.6, 1) * life, s: rnd(.8, big), col: pick() }); } };
    function frame() {
      if (run !== r) return;
      const now = performance.now(), t = (now - zero) / 1000, dt = Math.min(3, (now - last) / 16.7); last = now;
      c.globalCompositeOperation = "destination-out"; c.fillStyle = "rgba(0,0,0,.2)"; c.fillRect(0, 0, W, H);   // шлейфы
      c.globalCompositeOperation = "lighter";                                                                  // свет складывается
      const mr = mb.getBoundingClientRect(), cx = mr.left + mr.width / 2, cy = mr.top + mr.height / 2;
      KEY.forEach((kt, i) => { if (t >= kt && !fired["k" + i]) { fired["k" + i] = 1; const q = cr.getBoundingClientRect(); if (q.width) burst(q.left, q.top + q.height / 2, 5, 3.2, .55, 1.8); } });
      if (t >= T.hit && !fired.h) { fired.h = 1; burst(cx, cy, 520, 15, 1.9, 2.8); }
      if (t >= T.finale && !fired.f) { fired.f = 1; burst(cx, cy, 160, 9, 1.6, 2.2); }
      const wq = (t - T.word) / 1.3;
      if (wq > 0 && wq < 1) {
        const wr = wd.getBoundingClientRect(), ex = wr.left + wr.width * (1 - Math.pow(1 - wq, 4));
        for (let i = 0; i < 5; i++) S.push({ x: ex, y: rnd(wr.top + wr.height * .15, wr.bottom - wr.height * .15), vx: rnd(-.4, 1.2) * k, vy: rnd(-1.2, .4) * k, l: 0, m: rnd(.4, .9), s: rnd(.8, 2), col: pick() });
      }
      for (let i = S.length - 1; i >= 0; i--) {
        const s = S[i]; s.l += dt / 60;
        if (s.l >= s.m) { S.splice(i, 1); continue; }
        const d = Math.pow(.965, dt); s.vx *= d; s.vy = s.vy * d + .03 * dt * k; s.x += s.vx * dt; s.y += s.vy * dt;
        const a = 1 - s.l / s.m; c.globalAlpha = a * a; c.fillStyle = s.col; c.beginPath(); c.arc(s.x, s.y, s.s * (.4 + a), 0, 6.283); c.fill();
      }
      const h = t - T.hit;
      if (h > 0 && h < 1.4) {
        c.globalAlpha = Math.max(0, 1 - h / 1.2) * .7; c.strokeStyle = "#bff4ff"; c.lineWidth = 3 * k + 2;
        c.beginPath(); c.arc(cx, cy, (1 - Math.pow(1 - Math.min(1, h / 1.4), 4)) * R0 * .9, 0, 6.283); c.stroke();
        const fr = Math.min(W * .7, 1000) * (.4 + Math.min(1, h * 4) * .6), g = (c.save(), c.translate(cx, cy), c.scale(1, .045), c.createRadialGradient(0, 0, 0, 0, 0, fr));
        g.addColorStop(0, "rgba(255,255,255,1)"); g.addColorStop(.25, "rgba(130,230,255,.55)"); g.addColorStop(1, "rgba(130,230,255,0)");
        c.globalAlpha = Math.exp(-h * 3.2) * .6; c.fillStyle = g; c.beginPath(); c.arc(0, 0, fr, 0, 6.283); c.fill(); c.restore();
      }
      c.globalAlpha = 1;
      if (t < T.end + 1.2) requestAnimationFrame(frame); else c.clearRect(0, 0, W, H);
    }
    requestAnimationFrame(frame);
  }

  function cleanup(r) {
    clearTimeout(r.timer);
    r.anims.forEach(a => { try { a.cancel(); } catch (e) {} });
    document.removeEventListener("keydown", r.onKey);
    r.root.hidden = true; r.root.textContent = ""; r.root.className = ""; r.root.removeAttribute("style");
    if (run === r) run = null;
    const h = document.documentElement; h.classList.add("lt-reveal"); setTimeout(() => h.classList.remove("lt-reveal"), 2200);
  }

  function finish() {
    const r = run;
    if (!r || r.ending) return;
    r.ending = true; clearTimeout(r.timer);
    if (!r.root.animate) { cleanup(r); return; }
    if (r.audio) {
      r.audio.master.gain.setTargetAtTime(0, r.audio.ctx.currentTime, .2);
      setTimeout(() => { try { r.audio.ctx.close(); } catch (e) {} }, 1200);
    }
    const x = r.root.animate([{ opacity: 1, filter: "blur(0px)", transform: "scale(1)" }, { opacity: 0, filter: "blur(10px)", transform: "scale(1.04)" }], { duration: 600, easing: SOFT, fill: "forwards" });
    r.anims.push(x); x.onfinish = () => cleanup(r);
  }

  function show(nick, lng) {
    const root = document.getElementById("welcome");
    if (!root) return;
    if (run) cleanup(run);
    if (!styled) { const s = document.createElement("style"); s.textContent = CSS; s.dataset.introStyle = "search"; document.head.appendChild(s); styled = true; }
    const L = TXT[lang(lng)];
    markup(root, nick, L); root.hidden = false; root.removeAttribute("style");
    const reduced = !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
    const r = run = { id: ++seq, root: root, anims: [], timer: 0, audio: null, sound: false, ending: false };
    r.onKey = e => { if (e.key === "Escape" || ((e.key === "Enter" || e.key === " ") && e.target.tagName !== "BUTTON")) finish(); };
    if (!root.animate) {                         // совсем старый браузер: готовый кадр логотипа без звука
      root.classList.add("lt-css-fallback", "lt-static"); r.timer = setTimeout(() => cleanup(r), 3200); root.onclick = () => cleanup(r); return;
    }
    const $ = q => root.querySelector(q), $$ = q => Array.from(root.querySelectorAll(q));
    const an = (el, kf, o) => { const a = el.animate(kf, Object.assign({ fill: "forwards", easing: EXPO }, o)); r.anims.push(a); return a; };
    const at = t => (LEAD + t) * 1000;
    // «Уменьшить анимацию» в ОС: заставка всё равно играет, но без тряски, вспышки на весь экран, наезда камеры и частиц
    let prefs = {}; try { prefs = JSON.parse(localStorage.getItem("lighttube-preferences") || "{}"); } catch (e) {}
    if (prefs.introStyle === "none") { cleanup(r); return; }
    const calm = reduced || prefs.introStyle === "calm";

    const S = $(".lt-markbox").offsetWidth, gap = parseFloat(getComputedStyle($(".lt-row")).columnGap) || 16;
    const PW = Math.min(root.clientWidth * .86, 620), PH = 62, pill = $(".lt-pill"), pin = $(".lt-pin"), rows = $$(".lt-sg");
    an($(".lt-aurora"), [{ opacity: 0 }, { opacity: 1 }], { duration: 2500, easing: "linear", fill: "both" });

    // 1) точка света превращается в поле поиска
    an(pill, [{ opacity: 0 }, { opacity: 1 }], { delay: at(T.dot), duration: 250, easing: "linear", fill: "both" });
    an(pill, [{ width: "10px", height: "10px", borderRadius: "50%", boxShadow: "0 0 24px rgba(255,255,255,1)", borderColor: "rgba(255,255,255,0)" },
              { width: PW + "px", height: PH + "px", borderRadius: PH / 2 + "px", boxShadow: "0 12px 40px rgba(0,0,0,.45)", borderColor: "rgba(255,255,255,.22)" }], { delay: at(T.pill), duration: 750 });
    an(pin, [{ opacity: 0 }, { opacity: 1 }], { delay: at(T.pill + .3), duration: 300, easing: "linear", fill: "both" });
    // 2) набор «LightTube» в неровном ритме, курсор мигает
    $$(".lt-k").forEach((k, i) => an(k, [{ maxWidth: "0em", opacity: 0 }, { maxWidth: "1.2em", opacity: 1 }], { delay: at(KEY[i]), duration: 70, easing: "linear", fill: "both" }));
    // 3) выпадают подсказки, первая выбрана
    rows.forEach((row, i) => an(row, [{ opacity: 0, transform: "translateY(-10px) scale(.98)" }, { opacity: 1, transform: "none" }], { delay: at(T.sug + i * .09), duration: 500, fill: "both" }));
    // 4) Enter: подсказка вспыхивает, список уходит, поле пульсирует и сжимается в квадрат логотипа
    an(rows[0], [{ filter: "brightness(1)" }, { filter: "brightness(1.9)" }, { filter: "brightness(1)" }], { delay: at(T.enter - .08), duration: 200 });
    rows.forEach((row, i) => an(row, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-12px)" }], { delay: at(T.enter + .05 + i * .04), duration: 250, easing: SOFT }));
    an(pill, [{ transform: "scale(1)" }, { transform: "scale(1.035)" }, { transform: "scale(1)" }], { delay: at(T.enter), duration: 260 });
    an(pin, [{ opacity: 1, filter: "blur(0)", transform: "scale(1)" }, { opacity: 0, filter: "blur(8px)", transform: "scale(.94)" }], { delay: at(T.enter + .05), duration: 300, easing: SOFT });
    an(pill, [{ width: PW + "px", height: PH + "px", borderRadius: PH / 2 + "px", borderColor: "rgba(255,255,255,.22)", boxShadow: "0 12px 40px rgba(0,0,0,.45)" },
              { width: S + "px", height: S + "px", borderRadius: S * .28 + "px", borderColor: "rgba(167,139,250,.95)", boxShadow: "0 0 40px rgba(167,139,250,.6)" }], { delay: at(T.enter + .1), duration: (T.hit - T.enter - .1) * 1000, easing: SOFT });
    an(pill, [{ opacity: 1 }, { opacity: 0 }], { delay: at(T.hit), duration: 200, easing: "linear" });
    // 5) вспышка: настоящий контур логотипа, треугольник «выпрыгивает», расходятся кольца
    an($(".lt-s1"), [{ opacity: 0, strokeDashoffset: 0 }, { opacity: 1, strokeDashoffset: 0 }], { delay: at(T.hit), duration: 250, easing: "linear" });
    an($(".lt-f"), [{ opacity: 0, transform: "scale(.2)" }, { opacity: 1, transform: "scale(1)" }], { delay: at(T.hit), duration: 650, easing: POP, fill: "both" });
    an($(".lt-bloom"), [{ opacity: 0, transform: "scale(.3)" }, { opacity: 1, offset: .3, transform: "scale(1.4)" }, { opacity: 0, transform: "scale(2.3)" }], { delay: at(T.hit), duration: 1400, easing: "ease-out", fill: "both" });
    $$(".lt-ring").forEach((g, i) => an(g, [{ opacity: .8, transform: "scale(.5)" }, { opacity: 0, transform: "scale(3)" }], { delay: at(T.hit + i * .14), duration: 1100, easing: "ease-out", fill: "both" }));
    // 6) слово выезжает из-под логотипа, группа возвращается в центр
    const shift = ($(".lt-word").offsetWidth + gap) / 2;
    an($(".lt-row"), [{ transform: `translateX(${shift}px)` }, { transform: "translateX(0)" }], { delay: at(T.word), duration: 1300, fill: "both" });
    an($(".lt-word"), [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)" }], { delay: at(T.word), duration: 1300, fill: "both" });
    an($(".lt-word span"), [{ transform: "translateX(-40px)" }, { transform: "translateX(0)" }], { delay: at(T.word), duration: 1300, fill: "both" });
    an($(".lt-word b"), [{ opacity: 0, filter: "blur(8px)", transform: "translateY(18px) scale(.92)" }, { opacity: 1, filter: "blur(0)", transform: "none" }], { delay: at(T.tube), duration: 800, easing: POP, fill: "both" });
    $$(".lt-sh").forEach(s => an(s, [{ backgroundPosition: "150% 0" }, { backgroundPosition: "-50% 0" }], { delay: at(T.tube + .35), duration: 1400, easing: "ease-in-out" }));
    // 7) приветствие и финальный пульс логотипа вместе с аккордом
    an($(".lt-rule"), [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { delay: at(T.hello - .2), duration: 1100 });
    an($(".lt-l1"), [{ transform: "translateY(120%)" }, { transform: "translateY(0)" }], { delay: at(T.hello), duration: 1000 });
    an($(".lt-l2"), [{ transform: "translateY(120%)" }, { transform: "translateY(0)" }], { delay: at(T.hello + .15), duration: 1000 });
    an($(".lt-nick"), [{ backgroundPosition: "0% 0" }, { backgroundPosition: "250% 0" }], { delay: at(T.hello), duration: 4000, iterations: Infinity, easing: "linear" });
    an($(".lt-markbox"), [{ transform: "scale(1)" }, { transform: "scale(1.07)", offset: .3 }, { transform: "scale(1)" }], { delay: at(T.finale), duration: 900 });
    if (!calm) {
      an($(".lt-flash"), [{ opacity: 0 }, { opacity: 1, offset: .12 }, { opacity: 0 }], { delay: at(T.hit), duration: 700, easing: "ease-out", fill: "both" });
      an($(".lt-markbox"), [{ transform: "translate(0,0)" }, { transform: "translate(-6px,3px)" }, { transform: "translate(5px,-4px)" }, { transform: "translate(-3px,2px)" }, { transform: "translate(0,0)" }], { delay: at(T.hit), duration: 450, easing: "linear" });
      an($(".lt-stage"), [{ transform: "scale(1)" }, { transform: "scale(1.05)" }], { duration: at(T.end), easing: "linear" });
    }

    // звук привязан к тому же нулю времени; задержку устройства вывода вычитаем
    const zero = performance.now() + LEAD * 1000, a = r.audio = (function () { if (prefs.introSound === false) return null; try { return audioKit(); } catch (e) { return null; } })();
    if (!calm) fx(r, root, zero);
    const go = () => {
      if (run !== r || r.sound || r.ending || a.ctx.state !== "running") return;
      r.sound = true; $(".lt-hint").hidden = true;
      const elapsed = (performance.now() - zero) / 1000, lat = Math.min(.12, a.ctx.outputLatency || a.ctx.baseLatency || 0);
      score(a, a.ctx.currentTime - elapsed - lat, Math.max(0, elapsed));
    };
    if (a) {
      a.ctx.onstatechange = go;
      if (a.ctx.state === "running") go();
      else { a.ctx.resume().catch(() => {}); setTimeout(() => { if (run === r && !r.sound) $(".lt-hint").hidden = false; }, 400); }
    }
    const soundButton = document.createElement("button");
    soundButton.type = "button";
    soundButton.className = "lt-sound-button";
    soundButton.textContent = lang(lng) === "ru" ? "Включить звук" : "Enable sound";
    soundButton.style.cssText = "position:absolute;bottom:26px;left:50%;transform:translateX(-50%);z-index:10;padding:12px 20px;border-radius:24px;border:1px solid #7184b3;background:#141c32;color:white;cursor:pointer";
    soundButton.hidden = !a || a.ctx.state === "running";
    soundButton.onclick = e => { e.stopPropagation(); if (!a) return; a.ctx.resume().then(() => { go(); soundButton.hidden = a.ctx.state === "running"; }).catch(() => {}); };
    root.appendChild(soundButton);
    if (a) a.ctx.addEventListener("statechange", () => { soundButton.hidden = a.ctx.state === "running"; });
    // первый тап включает звук (браузер требует жест), следующий пропускает заставку
    root.onclick = () => { if (a && !r.sound) { a.ctx.resume().then(go).catch(() => {}); } else finish(); };
    document.addEventListener("keydown", r.onKey);
    r.timer = setTimeout(finish, at(T.end));
  }

  window.LightTubeSearchWelcome = {show:show, skip:finish, stop:()=>{if(run){if(run.audio)run.audio.ctx.close().catch(()=>{});cleanup(run);}}};
})();

/* Select a supplied intro without mixing its stylesheet or audio context. */
(function(){
  let active=null;
  window.LightTubeWelcome={
    show:function(nick,lng){
      if(active && active.stop)active.stop();
      let prefs={};try{prefs=JSON.parse(localStorage.getItem("lighttube-preferences")||"{}");}catch(e){}
      const root=document.getElementById("welcome");
      if(prefs.introStyle==="none"){root.hidden=true;return;}
      const dots=prefs.introStyle==="dots" && window.LightTubeDotsWelcome;
      active=dots?window.LightTubeDotsWelcome:window.LightTubeSearchWelcome;
      const key=dots?"dots":"search";
      document.querySelectorAll("style[data-intro-style]").forEach(s=>{s.disabled=s.dataset.introStyle!==key;});
      active.show(nick,lng);
      document.querySelectorAll("style[data-intro-style]").forEach(s=>{s.disabled=s.dataset.introStyle!==key;});
    },
    skip:function(){if(active)active.skip();}
  };
})();

/* Автозапуск: заставка идёт сразу при загрузке страницы, до показа ленты рекомендаций. */
(function () {
  const ONCE_PER_TAB = false;   // true: показывать только один раз за вкладку (повтор через «Replay intro» в настройках)
  function fallback(nick) {
    const root = document.getElementById("welcome");
    root.className = "intro-fallback"; root.textContent = "";
    const logo = document.createElement("strong"); logo.textContent = "LightTube";
    const text = document.createElement("span"); text.textContent = "Welcome, " + (nick || "viewer") + ".";
    root.appendChild(logo); root.appendChild(text); root.hidden = false;
    root.onclick = function () { root.hidden = true; };
    setTimeout(function () { root.hidden = true; }, 3200);
  }
  function start() {
    const root = document.getElementById("welcome");
    if (ONCE_PER_TAB) { try { if (sessionStorage.getItem("lighttube-intro-seen")) { if (root) root.hidden = true; return; } sessionStorage.setItem("lighttube-intro-seen", "1"); } catch (e) {} }
    let nick = "viewer"; try { nick = (JSON.parse(localStorage.getItem("lighttube-preferences") || "{}") || {}).nickname || nick; } catch (e) {}
    try { window.LightTubeWelcome.show(nick); } catch (e) { console.error("LightTube intro:", e); fallback(nick); }
  }
  start();
  window.addEventListener("pageshow", function (e) { if (e.persisted) start(); });
})();
