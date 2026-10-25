
    /* LightTube · заставка приветствия. Один таймлайн T управляет и картинкой, и звуком. */
    (function () {
      "use strict";
      const EXPO = "cubic-bezier(.16,1,.3,1)", SOFT = "cubic-bezier(.65,0,.35,1)", POP = "cubic-bezier(.34,1.56,.64,1)";
      // Секунды от старта. Меняешь число здесь, и сдвигаются и анимация, и звук.
      const T = { dots: .30, step: .11, wave: .95, merge: 1.45, hit: 1.75, word: 2.05, tube: 2.55, hello: 3.05, finale: 3.95, end: 5.4 };
      const LEAD = .12;                                   // общая задержка старта картинки и звука
      const NOTES = [659.25, 830.61, 987.77, 1318.51];    // E5 G#5 B5 E6: одна тональность на всю заставку
      const COLORS = ["#6ee7ff", "#a78bfa", "#ff7ad9", "#ffd479"];
      let run = null, styled = false, seq = 0;

      const CSS = `
#welcome.lt-intro{--s:clamp(64px,13vw,128px);position:fixed;inset:0;z-index:90;display:block;gap:0;background:#08080a;color:#f5f5f7;font:16px Inter,"SF Pro Display","Segoe UI",Arial,sans-serif;overflow:hidden;pointer-events:auto;cursor:pointer;animation:none;-webkit-font-smoothing:antialiased}
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
.lt-row{display:flex;align-items:center;gap:clamp(12px,2.2vw,22px)}
.lt-markbox{position:relative;width:var(--s);height:var(--s);flex-shrink:0}
.lt-mark{position:absolute;inset:0;width:100%;height:100%;overflow:visible;fill:none;stroke:none}
.lt-s1{stroke:url(#lt-g);stroke-width:3;stroke-linecap:round;stroke-dasharray:1;stroke-dashoffset:1}
.lt-f{fill:url(#lt-g);stroke:url(#lt-g);stroke-width:6;stroke-linejoin:round;opacity:0;transform-origin:60px 60px}
.lt-dot{position:absolute;left:50%;top:50%;width:calc(var(--s)*.17);height:calc(var(--s)*.17);margin:calc(var(--s)*-.085) 0 0 calc(var(--s)*-.085);border-radius:50%;opacity:0;mix-blend-mode:screen;box-shadow:0 0 18px currentColor}
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
.lt-calm .lt-fx,.lt-static .lt-fx,.lt-static .lt-flash{display:none}
.lt-calm .lt-aurora i,.lt-calm .lt-grain{animation:none}
.lt-static .lt-aurora{opacity:1}.lt-static .lt-s1{stroke-dashoffset:0}.lt-static .lt-f{opacity:1}.lt-static .lt-word{clip-path:none}.lt-static .lt-rule{transform:none}.lt-static .lt-line>div{transform:none}.lt-static .lt-word .lt-sh{background-position:50% 0}
`;

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

      // t0: момент ctx.currentTime, который соответствует нулю таймлайна; from: с какой секунды играть (если звук разблокировали позже)
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
        // тёплый фон: аккорд E (E2 B2 E3 G#3)
        [82.41, 123.47, 164.81, 207.65].forEach(f => {
          const w = Math.max(ctx.currentTime, t0), o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
          o.type = "triangle"; o.frequency.value = f; lp.type = "lowpass"; lp.frequency.value = 500;
          g.gain.setValueAtTime(.0001, w); g.gain.exponentialRampToValueAtTime(.045, w + 2.2);
          g.gain.setValueAtTime(.045, w + 2.2); g.gain.exponentialRampToValueAtTime(.0001, Math.max(w + 2.5, t0 + T.end + .5));
          o.connect(lp); lp.connect(g); g.connect(out); o.start(w); o.stop(Math.max(w + 2.6, t0 + T.end + .6));
        });
        noise(.2, 2.2, "bandpass", 200, 6500, .24);                                         // вихрь нарастает ровно до вспышки
        tone(T.hit, 55, .9, .55, "sine", 38);                                               // глубокий бас
        [2637.02, 2959.96, 3322.44, 3951.07, 2637.02, 3322.44].forEach((f, i) => tone(T.hit + .12 + i * .13, f, .9, .03)); // дождь искр
        [1318.51, 1479.98, 1661.22, 1975.53, 2217.46, 2637.02, 2959.96, 3322.44].forEach((f, i) => tone(T.word + .1 + i * .13, f, .5, .035)); // искры за словом
        NOTES.forEach((f, i) => pluck(T.dots + i * T.step + .03, f, .6, .15));            // точки: четыре ноты
        noise(T.merge - .05, .4, "bandpass", 500, 3500, .2);                                // схлопывание точек
        tone(T.hit, 130, .6, .5, "sine", 48);                                               // мягкий удар
        [1318.51, 1975.53, 2637.02].forEach((f, i) => tone(T.hit + i * .025, f, 2.2, [.07, .06, .04][i]));
        noise(T.hit, .25, "highpass", 6000, 9000, .06);                                     // «стеклянный» блеск
        noise(T.word - .05, 1, "bandpass", 700, 4200, .16);                                 // выезд слова
        pluck(T.tube + .1, 987.77, .9, .14); pluck(T.tube + .1, 1479.98, .9, .07);          // приземление «Tube»
        pluck(T.hello + .05, 830.61, .9, .1); pluck(T.hello + .2, 1318.51, 1.2, .1);         // приветствие
        [659.25, 830.61, 987.77, 1108.73, 1479.98].forEach((f, i) => pluck(T.finale + i * .07, f, 1.6, .1)); // финальный аккорд
      }

      function markup(root, nick) {
        root.removeAttribute("style"); root.className = "lt-intro";
        root.innerHTML = `<div class="lt-aurora"><i></i><i></i><i></i></div><div class="lt-vig"></div><div class="lt-grain"></div>
<div class="lt-stage"><div class="lt-row"><div class="lt-markbox"><i class="lt-bloom"></i><i class="lt-ring"></i><i class="lt-ring"></i>
<svg class="lt-mark" viewBox="0 0 120 120" aria-hidden="true"><defs><linearGradient id="lt-g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6ee7ff"/><stop offset=".55" stop-color="#a78bfa"/><stop offset="1" stop-color="#ff7ad9"/></linearGradient></defs>
<rect class="lt-s1" x="6" y="6" width="108" height="108" rx="30" pathLength="1"/><path class="lt-f" d="M48 38 L48 82 L84 60 Z"/></svg>
<i class="lt-dot"></i><i class="lt-dot"></i><i class="lt-dot"></i><i class="lt-dot"></i></div>
<div class="lt-word"><span class="lt-sh">Light</span><b class="lt-sh">Tube</b></div></div><div class="lt-rule"></div>
<div class="lt-line"><div class="lt-l1">Приветствуем, <span class="lt-nick"></span>!</div></div><div class="lt-line"><div class="lt-l2">Рады видеть снова.</div></div></div>
<i class="lt-flash"></i><canvas class="lt-fx"></canvas><div class="lt-hint" hidden>🔊 Нажми, чтобы включить звук</div>`;
        root.querySelector(".lt-nick").textContent = nick || "зритель";   // textContent: ник не может внедрить HTML
        root.querySelectorAll(".lt-dot").forEach((d, i) => { d.style.background = COLORS[i]; d.style.color = COLORS[i]; });
      }

      // Частицы на canvas: вихрь втягивается в логотип, взрыв искр на вспышке, искры бегут за выезжающим словом
      function fx(r, root, zero) {
        const cv = root.querySelector(".lt-fx"), c = cv && cv.getContext && cv.getContext("2d");
        if (!c) return;
        const dpr = Math.min(2, window.devicePixelRatio || 1), W = root.clientWidth, H = root.clientHeight;
        cv.width = W * dpr; cv.height = H * dpr; c.setTransform(dpr, 0, 0, dpr, 0, 0);
        const mb = root.querySelector(".lt-markbox"), wd = root.querySelector(".lt-word");
        const rnd = (a, b) => a + Math.random() * (b - a), pal = COLORS.concat(["#ffffff", "#ffffff"]), pick = () => pal[(Math.random() * pal.length) | 0];
        const R0 = Math.hypot(W, H) / 2, k = Math.min(W, H) / 700;
        const V = Array.from({ length: 700 }, () => ({ a: rnd(0, 6.283), d: rnd(.2, 1.05) * R0, s: rnd(.8, 2.2), t0: rnd(.1, .7), t1: rnd(1.3, T.hit), w: rnd(.8, 1.7), col: pick() }));
        let S = [], last = performance.now(); const fired = {};
        const burst = (x, y, n, v, life, big) => { for (let i = 0; i < n; i++) { const an = rnd(0, 6.283), sp = Math.pow(Math.random(), .6) * v * k; S.push({ x: x, y: y, vx: Math.cos(an) * sp, vy: Math.sin(an) * sp, l: 0, m: rnd(.6, 1) * life, s: rnd(.8, big), col: pick() }); } };
        function frame() {
          if (run !== r) return;
          const now = performance.now(), t = (now - zero) / 1000, dt = Math.min(3, (now - last) / 16.7); last = now;
          c.globalCompositeOperation = "destination-out"; c.fillStyle = "rgba(0,0,0,.2)"; c.fillRect(0, 0, W, H);   // шлейфы: каждый кадр чуть стираем
          c.globalCompositeOperation = "lighter";                                                                  // свет складывается, а не перекрывает
          const mr = mb.getBoundingClientRect(), cx = mr.left + mr.width / 2, cy = mr.top + mr.height / 2;
          for (const p of V) {
            const q = (t - p.t0) / (p.t1 - p.t0);
            if (q <= 0 || q >= 1) continue;
            const e = q * q * q, rad = p.d * (1 - e), ang = p.a + p.w * 7 * e + q * 1.5;
            c.globalAlpha = Math.min(1, q * 6) * (1 - e * .4); c.fillStyle = p.col; c.beginPath();
            c.arc(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad * .62, p.s * (1 + e * 1.5), 0, 6.283); c.fill();
          }
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
          if (h > 0 && h < 1.4) {                                                                                  // ударная волна и анаморфный блик
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
        r.anims.forEach(a => { try { a.cancel(); } catch (e) { } });
        document.removeEventListener("keydown", r.onKey);
        r.root.hidden = true; r.root.textContent = ""; r.root.className = "";
        if (run === r) run = null;
      }

      function finish() {
        const r = run;
        if (!r || r.ending) return;
        r.ending = true; clearTimeout(r.timer);
        if (r.audio) {
          r.audio.master.gain.setTargetAtTime(0, r.audio.ctx.currentTime, .2);
          setTimeout(() => { try { r.audio.ctx.close(); } catch (e) { } }, 1200);
        }
        const x = r.root.animate([{ opacity: 1, filter: "blur(0px)", transform: "scale(1)" }, { opacity: 0, filter: "blur(10px)", transform: "scale(1.04)" }], { duration: 600, easing: SOFT, fill: "forwards" });
        r.anims.push(x); x.onfinish = () => cleanup(r);
      }

      function show(nick, lng) {
        const root = document.getElementById("welcome");
        if (!root) return;
        if (run) cleanup(run);
        if (!styled) { const s = document.createElement("style"); s.textContent = CSS; s.dataset.introStyle = "dots"; document.head.appendChild(s); styled = true; }
        markup(root, nick); root.hidden = false;
        let prefs={};try{prefs=JSON.parse(localStorage.getItem("lighttube-preferences")||"{}");}catch(e){}
        const english=(lng||document.documentElement.lang)!=="ru";
        if(english){root.querySelector(".lt-l1").firstChild.textContent="Welcome, ";root.querySelector(".lt-l2").textContent="Great to see you again.";root.querySelector(".lt-hint").textContent="Tap to enable sound";}
        const reduced = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
        const r = run = { id: ++seq, root: root, anims: [], timer: 0, audio: null, sound: false, ending: false };
        r.onKey = e => { if (e.key === "Escape" || ((e.key === "Enter" || e.key === " ") && e.target.tagName !== "BUTTON")) finish(); };
        if (reduced) root.classList.add("lt-calm");  // «уменьшить анимацию» в ОС: играем, но без наезда камеры и фонового дрейфа
        if (!root.animate) {                         // совсем старый браузер: готовый кадр без звука
          root.classList.add("lt-static"); r.timer = setTimeout(() => cleanup(r), 1800); root.onclick = () => cleanup(r); return;
        }
        const $ = q => root.querySelector(q), $$ = q => Array.from(root.querySelectorAll(q));
        const an = (el, kf, o) => { const a = el.animate(kf, Object.assign({ fill: "forwards", easing: EXPO }, o)); r.anims.push(a); return a; };
        const at = t => (LEAD + t) * 1000;

        const S = $(".lt-markbox").offsetWidth, gap = parseFloat(getComputedStyle($(".lt-row")).columnGap) || 16;
        const xs = [-1.5, -.5, .5, 1.5].map(k => k * S * .27), up = S * .26;
        an($(".lt-aurora"), [{ opacity: 0 }, { opacity: 1 }], { duration: 2500, easing: "linear", fill: "both" });
        // 1) четыре точки: выскакивают с «пружинкой», бегут волной, схлопываются в центр
        $$(".lt-dot").forEach((d, i) => {
          an(d, [{ opacity: 0, transform: `translate(${xs[i]}px,0) scale(0)` }, { opacity: 1, transform: `translate(${xs[i]}px,0) scale(1)` }], { delay: at(T.dots + i * T.step), duration: 500, easing: POP, fill: "both" });
          an(d, [{ transform: `translate(${xs[i]}px,0) scale(1)` }, { transform: `translate(${xs[i]}px,${-up}px) scale(1)`, offset: .4 }, { transform: `translate(${xs[i]}px,0) scale(1)` }], { delay: at(T.wave + i * .09), duration: 700 });
          an(d, [{ transform: `translate(${xs[i]}px,0) scale(1)` }, { transform: "translate(0,0) scale(.7)" }], { delay: at(T.merge), duration: (T.hit - T.merge) * 1000, easing: SOFT });
          an(d, [{ opacity: 1 }, { opacity: 0 }], { delay: at(T.hit), duration: 120, easing: "linear" });
        });
        // 2) вспышка: контур рисуется, треугольник «выпрыгивает», расходятся кольца
        an($(".lt-s1"), [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { delay: at(T.merge), duration: 700, easing: SOFT, fill: "both" });
        an($(".lt-f"), [{ opacity: 0, transform: "scale(.2)" }, { opacity: 1, transform: "scale(1)" }], { delay: at(T.hit), duration: 650, easing: POP, fill: "both" });
        an($(".lt-bloom"), [{ opacity: 0, transform: "scale(.3)" }, { opacity: 1, offset: .3, transform: "scale(1.4)" }, { opacity: 0, transform: "scale(2.3)" }], { delay: at(T.hit), duration: 1400, easing: "ease-out", fill: "both" });
        $$(".lt-ring").forEach((g, i) => an(g, [{ opacity: .8, transform: "scale(.5)" }, { opacity: 0, transform: "scale(3)" }], { delay: at(T.hit + i * .14), duration: 1100, easing: "ease-out", fill: "both" }));
        // 3) слово выезжает из-под логотипа, группа возвращается в центр
        const shift = ($(".lt-word").offsetWidth + gap) / 2;
        an($(".lt-row"), [{ transform: `translateX(${shift}px)` }, { transform: "translateX(0)" }], { delay: at(T.word), duration: 1300, fill: "both" });
        an($(".lt-word"), [{ clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)" }], { delay: at(T.word), duration: 1300, fill: "both" });
        an($(".lt-word span"), [{ transform: "translateX(-40px)" }, { transform: "translateX(0)" }], { delay: at(T.word), duration: 1300, fill: "both" });
        an($(".lt-word b"), [{ opacity: 0, filter: "blur(8px)", transform: "translateY(18px) scale(.92)" }, { opacity: 1, filter: "blur(0)", transform: "none" }], { delay: at(T.tube), duration: 800, easing: POP, fill: "both" });
        $$(".lt-sh").forEach(s => an(s, [{ backgroundPosition: "150% 0" }, { backgroundPosition: "-50% 0" }], { delay: at(T.tube + .35), duration: 1400, easing: "ease-in-out" }));
        // 4) приветствие и финальный пульс логотипа вместе с аккордом
        an($(".lt-rule"), [{ transform: "scaleX(0)" }, { transform: "scaleX(1)" }], { delay: at(T.hello - .2), duration: 1100 });
        an($(".lt-l1"), [{ transform: "translateY(120%)" }, { transform: "translateY(0)" }], { delay: at(T.hello), duration: 1000 });
        an($(".lt-l2"), [{ transform: "translateY(120%)" }, { transform: "translateY(0)" }], { delay: at(T.hello + .15), duration: 1000 });
        an($(".lt-nick"), [{ backgroundPosition: "0% 0" }, { backgroundPosition: "250% 0" }], { delay: at(T.hello), duration: 4000, iterations: Infinity, easing: "linear" });
        an($(".lt-markbox"), [{ transform: "scale(1)" }, { transform: "scale(1.07)", offset: .3 }, { transform: "scale(1)" }], { delay: at(T.finale), duration: 900 });
        an($(".lt-flash"), [{ opacity: 0 }, { opacity: 1, offset: .12 }, { opacity: 0 }], { delay: at(T.hit), duration: 700, easing: "ease-out", fill: "both" });          // белая вспышка на экран
        an($(".lt-markbox"), [{ transform: "translate(0,0)" }, { transform: "translate(-6px,3px)" }, { transform: "translate(5px,-4px)" }, { transform: "translate(-3px,2px)" }, { transform: "translate(0,0)" }], { delay: at(T.hit), duration: 450, easing: "linear" }); // толчок
        if (!reduced) an($(".lt-stage"), [{ transform: "scale(1)" }, { transform: "scale(1.05)" }], { duration: at(T.end), easing: "linear" });

        // звук привязан к тому же нулю времени; задержку устройства вывода вычитаем
        const zero = performance.now() + LEAD * 1000, a = r.audio = (function(){if(prefs.introSound===false)return null;try{return audioKit();}catch(e){return null;}})();
        if (!reduced) fx(r, root, zero);
        const go = () => {
          if (run !== r || r.sound || r.ending || a.ctx.state !== "running") return;
          r.sound = true; $(".lt-hint").hidden = true;
          const elapsed = (performance.now() - zero) / 1000, lat = Math.min(.12, a.ctx.outputLatency || a.ctx.baseLatency || 0);
          score(a, a.ctx.currentTime - elapsed - lat, Math.max(0, elapsed));
        };
        if (a) {
          a.ctx.onstatechange = go;
          if (a.ctx.state === "running") go();
          else { a.ctx.resume().catch(() => { }); setTimeout(() => { if (run === r && !r.sound) $(".lt-hint").hidden = false; }, 400); }
        }
        const button=document.createElement("button");button.type="button";button.textContent=english?"Enable sound":"Включить звук";
        button.style.cssText="position:absolute;bottom:24px;left:50%;transform:translateX(-50%);z-index:10;background:#142039;color:white;padding:12px 20px;border-radius:24px;border:1px solid #647cb3";
        button.hidden=!a || a.ctx.state==="running";
        button.onclick=e=>{e.stopPropagation();if(a)a.ctx.resume().then(()=>{go();button.hidden=a.ctx.state==="running";}).catch(()=>{});};root.appendChild(button);
        if(a)a.ctx.addEventListener("statechange",()=>{button.hidden=a.ctx.state==="running";});
        // первый тап включает звук (браузер требует жест), следующий пропускает заставку
        root.onclick = () => { if (a && !r.sound) { a.ctx.resume().catch(() => { }); } else finish(); };
        document.addEventListener("keydown", r.onKey);
        r.timer = setTimeout(finish, at(T.end));
      }

      window.LightTubeDotsWelcome = {show:show, skip:finish, stop:()=>{if(run){if(run.audio)run.audio.ctx.close().catch(()=>{});cleanup(run);}}};
    })();
