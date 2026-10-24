(function () {
    "use strict";
    function el(id) { return document.getElementById(id); }
    var player = el("player"), section = el("player-section");
    var session = null, hls = null, timer = null, epoch = 0;
    var attached = false, polling = false, preparing = false, duration = 0;
    var playbackError = false, currentVideo = null, endedFor = null, minimized = false;
    var feedItems = [], searchItems = [], relatedItems = [], historyItems = [], history = {};
    var pendingFeed = null, feedBusy = false, feedLoaded = false, searchBusy = false, moreBusy = false;
    var feedCursor = null, searchCursor = null, relatedCursor = null, relatedBusy = false;
    var view = "home", filter = "all", feedNotice = "", feedError = false;
    var serverId = null, online = false, browser = "firefox", lastHistorySave = 0;
    var selectedProfile = "auto", askProfile = true, profileVersion = 0, settingsGeneration = null, loadingUrl = null;
    var channelItems = [], channelCursor = null, channelBusy = false, activeChannel = null, lastQuery = "", restoringUI = false;
    var deliveryMode = null, deliveryFallback = false, directTimer = null, prefetchTimer = null, prefetchAt = 0, prefetchKey = "", openedAt = 0, firstFrameSeconds = null;
    var settingsView = "profile", relatedVideo = null, upgradeToken = null, upgradeTimer = null, upgrading = false, preview = null, previewTimer = null, resumeAt = null, resumePlaying = true;
    var audioPreference = "auto", audioTracks = [], retryFullQuality = false, currentQualityInfo = "";
    var quality = 720, heartbeatBusy = false, settingsBusy = false, priorFocus = null;
    // Remove only the legacy LightTube key. New history lives on the server.
    try { localStorage.removeItem("lighttube-history"); } catch (error) {}

    function readUI() {
        try { return JSON.parse(localStorage.getItem("lighttube-ui") || "null"); } catch (e) { return null; }
    }
    function rememberUI(confirmed) {
        if (!serverId || restoringUI) return;
        var previous = readUI();
        var valid = previous && previous.server === serverId && previous.browser === browser && previous.profile === selectedProfile;
        try { localStorage.setItem("lighttube-ui", JSON.stringify({server: serverId, browser: browser, profile: selectedProfile,
            confirmed: !!confirmed || !!(valid && previous.confirmed), query: lastQuery, view: view, filter: filter,
            channel: activeChannel, playbackMode: el("playback-mode").value, prefetch: el("prefetch-enabled").checked, startLow: el("start-low").checked})); } catch (e) {}
    }
    function rememberedProfile() {
        var match = document.cookie.match(/(?:^|; )lighttube-profile=([^;]*)/);
        try { return match ? JSON.parse(decodeURIComponent(match[1])) : null; } catch (e) { return null; }
    }
    function rememberProfile() {
        var value = el("remember-profile").checked ? encodeURIComponent(JSON.stringify({browser: browser, profile: selectedProfile})) : "";
        document.cookie = "lighttube-profile=" + value + "; Path=/; Max-Age=" + (value ? 2592000 : 0) + "; SameSite=Strict" + (location.protocol === "https:" ? "; Secure" : "");
    }
    function cancelUpgrade() {
        clearTimeout(upgradeTimer); upgradeTimer = null;
        if (upgradeToken) api("POST", "/api/jobs/" + upgradeToken + "/stop", null, function () {});
        upgradeToken = null; upgrading = false; clearPreview();
    }
    function clearPreview() { clearTimeout(previewTimer); previewTimer = null; preview = null; }
    function previewStopped() {
        if (!preview || preview.since === null) return;
        preview.remaining = Math.max(0, preview.remaining - (Date.now() - preview.since));
        preview.since = null; clearTimeout(previewTimer); previewTimer = null;
    }
    function holdPreview() {
        if (!preview || preview.token !== session || preview.held || !upgrading) return;
        previewStopped(); preview.held = true;
        player.pause(); loading("Загружаем выбранное качество…", "busy");
        message("Первые секунды показаны. Дожидаемся основного потока…", false);
    }
    function previewPlaying() {
        if (!preview || preview.token !== session || preview.held) return;
        previewStopped(); preview.since = Date.now();
        previewTimer = setTimeout(holdPreview, preview.remaining);
    }
    function paintAudioOptions() {
        var select = el("settings-audio"), selected = audioPreference, seen = {};
        select.textContent = "";
        var common = [{id:"auto",label:"Авто · дорожка YouTube"},{id:"original",label:"Оригинальная дорожка"}];
        var defaults = [{id:"ru",label:"Русский"},{id:"en",label:"English"},{id:"uz",label:"Oʻzbekcha"},{id:"tg",label:"Тоҷикӣ"},{id:"de",label:"Deutsch"},{id:"tr",label:"Türkçe"},{id:"es",label:"Español"},{id:"fr",label:"Français"},{id:"pt",label:"Português"},{id:"ar",label:"العربية"},{id:"ja",label:"日本語"},{id:"ko",label:"한국어"},{id:"hi",label:"हिन्दी"}];
        common.concat(audioTracks.length ? audioTracks : defaults).concat([{id:selected,label:selected + " · сохранено"}]).forEach(function (track) {
            if (seen[track.id]) return; seen[track.id] = true;
            var option = document.createElement("option"); option.value = track.id; option.textContent = track.label; select.appendChild(option);
        });
        select.value = selected;
    }
    function changeQuality(limit, voice, automatic) {
        if (!session || upgrading) { if (upgrading) message("Качество уже переключается. Дождись подготовки.", false); return; }
        upgrading = true;
        if (!automatic) clearPreview();
        var original = session, generation = epoch, started = Date.now();
        message("Готовим выбранное качество. Текущее видео продолжает играть…", false);
        function fail(text) {
            var wasPreview = !!preview; cancelUpgrade();
            if (wasPreview) { player.pause(); retryFullQuality = true; playbackError = true; loading(text + " Повторить сразу в выбранном качестве?", "error"); message(text, true); }
            else message(text + " Продолжаем в прежнем качестве.", true);
        }
        api("POST", "/api/jobs/" + original + "/quality", {quality: limit, audio: voice || audioPreference}, function (error, result) {
            if (generation !== epoch || original !== session) { if (!error) api("POST", "/api/jobs/" + result.id + "/stop", null, function () {}); return; }
            if (error) { fail(error); return; }
            upgradeToken = result.id;
            function check() {
                if (generation !== epoch || original !== session || !upgradeToken) return;
                var next = upgradeToken;
                api("GET", "/api/jobs/" + next, null, function (err, data) {
                    if (generation !== epoch || original !== session || next !== upgradeToken) return;
                    if (err || data.stage === "error" || data.stage === "stopped") { fail(err || data.message || "Не удалось изменить качество."); return; }
                    var enough = data.mode === "mp4" || data.stage === "complete" || data.buffered >= (player.currentTime || 0) + 1.5;
                    if (data.ready && enough) {
                        api("POST", "/api/jobs/" + next + "/promote", null, function (promotionError) {
                            if (generation !== epoch || original !== session || next !== upgradeToken) return;
                            if (promotionError) { fail(promotionError); return; }
                            recordHistory(false, false);
                            resumeAt = player.currentTime || 0; resumePlaying = preview && preview.held ? true : !player.paused;
                            clearPreview();
                            attached = false; player.pause(); clearTimeout(directTimer);
                            if (hls) { hls.destroy(); hls = null; }
                            player.removeAttribute("src"); player.load();
                            session = next; upgradeToken = null; upgrading = false; deliveryFallback = false; polling = false;
                            loading("Переключаем качество…", "busy"); attach(data); poll();
                            api("POST", "/api/jobs/" + original + "/stop", null, function () {});
                        });
                    } else if (Date.now() - started > 90000) fail("Подготовка качества заняла слишком много времени.");
                    else upgradeTimer = setTimeout(check, 250);
                }, 10000);
            }
            check();
        });
    }
    function restorePosition() {
        if (resumeAt === null || !attached) return;
        var position = resumeAt;
        if (position > 0 && (!player.seekable.length || position > player.seekable.end(player.seekable.length - 1))) return;
        try { player.currentTime = position; } catch (e) { return; }
        resumeAt = null;
        if (resumePlaying) play(); else { player.pause(); loading("Нажми ▶ для просмотра.", "ready"); }
    }
    function isSeen(item) { return !!history[item.id] || item.is_watched === true; }
    function paintFilter() {
        Array.prototype.forEach.call(document.querySelectorAll("[data-filter]"), function (b) { b.className = "chip" + (b.getAttribute("data-filter") === filter ? " active" : ""); });
        el("filter-note").hidden = filter === "all";
    }
    function openChannel(id, name) {
        if (!/^UC[A-Za-z0-9_-]{22}$/.test(id || "")) { message("YouTube не прислал адрес канала.", true); return; }
        setView("channel"); activeChannel = {id: id, name: name || "Канал"}; channelBusy = true; channelItems = []; channelCursor = null;
        el("feed-heading").textContent = activeChannel.name; el("feed-source").textContent = "Видео канала"; renderCurrent(); rememberUI(false);
        var context = settingsGeneration;
        api("GET", "/api/channels/" + id, null, function (error, data) {
            if (context !== settingsGeneration || !activeChannel || activeChannel.id !== id) return;
            channelBusy = false; channelItems = error ? [] : data.items || []; channelCursor = error ? null : data.cursor || null;
            if (view === "channel") { renderCurrent(); el("feed-status").textContent = error || data.warning || "Видео канала: " + channelItems.length; }
        });
    }
    function message(text, error) {
        el("status").textContent = text;
        el("status").className = "status" + (error ? " error" : "");
    }
    function api(method, url, body, done, timeout) {
        var xhr = new XMLHttpRequest(), finished = false;
        function finish(error, data) { if (!finished) { finished = true; done(error, data); } }
        xhr.open(method, url); xhr.timeout = timeout || 60000;
        if (body !== null) xhr.setRequestHeader("Content-Type", "application/json");
        xhr.onload = function () {
            var data;
            try { data = JSON.parse(xhr.responseText); }
            catch (error) { finish("Непонятный ответ сервера."); return; }
            if (xhr.status < 200 || xhr.status >= 300) {
                finish(typeof data.detail === "string" ? data.detail : "Ошибка HTTP " + xhr.status); return;
            }
            finish(null, data);
        };
        xhr.onerror = function () { finish("Нет связи с сервером."); };
        xhr.ontimeout = function () { finish("Сервер не успел ответить."); };
        xhr.send(body === null ? null : JSON.stringify(body));
    }
    function time(value) {
        if (typeof value !== "number" || !isFinite(value) || value < 0) return "—";
        var n = Math.floor(value), h = Math.floor(n / 3600), m = Math.floor(n / 60) % 60;
        return (h ? h + ":" + ("0" + m).slice(-2) : String(m)) + ":" + ("0" + n % 60).slice(-2);
    }
    function icon(button, name, label) {
        var use = el(button).querySelector("use");
        if (use) use.setAttribute("href", "#i-" + name);
        el(button).setAttribute("aria-label", label); el(button).title = label;
    }
    function draw() {
        var current = player.currentTime || 0, ahead = 0;
        ["inside-buffer", "test-buffer"].forEach(function (id) {
            var layer = el(id); layer.textContent = "";
            if (!(duration > 0)) return;
            for (var i = 0; i < player.buffered.length; i++) {
                var a = Math.max(0, player.buffered.start(i)), b = Math.min(duration, player.buffered.end(i));
                if (current >= a && current <= b) ahead = Math.max(0, b - current);
                if (b <= a) continue;
                var part = document.createElement("div"); part.className = "buffer-part";
                part.style.left = a / duration * 100 + "%"; part.style.width = (b - a) / duration * 100 + "%";
                layer.appendChild(part);
            }
        });
        var label = time(current) + " / " + (duration > 0 ? time(duration) : "—");
        el("inside-time").textContent = label;
        el("test-time").textContent = label + " · Буфер впереди: " + Math.floor(ahead) + " с";
        ["inside-played", "test-played"].forEach(function (id) {
            el(id).style.width = (duration > 0 ? Math.min(100, current / duration * 100) : 0) + "%";
        });
        ["inside-track", "test-track"].forEach(function (id) {
            el(id).setAttribute("aria-valuemax", String(duration || 0));
            el(id).setAttribute("aria-valuenow", String(Math.floor(current)));
            el(id).setAttribute("aria-valuetext", label);
        });
        icon("toggle", player.paused ? "play" : "pause", player.paused ? "Продолжить" : "Пауза");
        icon("mute", player.muted ? "muted" : "volume", player.muted ? "Включить звук" : "Выключить звук");
    }
    function setMini(value) {
        if (!attached && value) return;
        minimized = !!value;
        section.classList.toggle("is-mini", minimized);
        if (!minimized && attached) section.scrollIntoView(true);
    }
    function recordHistory(completed, refresh) {
        if (!session || !currentVideo || (player.currentTime || 0) < 1) return;
        var token = session, server = serverId;
        history[currentVideo.id] = {id: currentVideo.id, title: currentVideo.title, channel: currentVideo.channel,
            channel_id: currentVideo.channel_id || "", duration: currentVideo.duration, position: player.currentTime || 0,
            completed: !!completed || !!(history[currentVideo.id] && history[currentVideo.id].completed)};
        if (filter !== "all") renderCurrent();
        api("POST", "/api/history", {token: token, position: player.currentTime || 0, completed: !!completed}, function (error) {
            if (!error && server === serverId) loadHistory(!!refresh);
        }, 10000);
    }
    function loadHistory(render) {
        var server = serverId, context = settingsGeneration;
        api("GET", "/api/history", null, function (error, data) {
            if (error || server !== serverId || context !== settingsGeneration || data.session_id !== serverId) return;
            historyItems = data.items || []; history = {};
            historyItems.forEach(function (item) { history[item.id] = item; });
            if (render || view === "history" || filter !== "all") renderCurrent();
        }, 10000);
    }
    function loading(text, mode) {
        el("loading-panel").hidden = false; el("loading-panel").setAttribute("data-mode", mode); el("loading-text").textContent = text || "Подготавливаем видео…";
        el("loading-spinner").hidden = mode !== "busy";
        el("loading-action").hidden = mode === "busy";
        el("loading-action").textContent = mode === "error" ? "Повторить" : "▶";
        el("loading-action").setAttribute("data-mode", mode); el("loading-action").setAttribute("aria-label", mode === "error" ? "Повторить загрузку" : "Воспроизвести видео");
        el("loading-cancel").textContent = mode === "busy" ? "Отмена" : "Закрыть";
    }
    function clearPlayer() {
        cancelUpgrade(); resumeAt = null; relatedVideo = null; el("related-panel").classList.remove("is-loading");
        clearTimeout(directTimer); directTimer = null; deliveryMode = null; deliveryFallback = false;
        el("force-hls").hidden = true;
        attached = false; playbackError = false; duration = 0; currentVideo = null; currentQualityInfo = ""; audioTracks = [];
        el("loading-panel").hidden = true;
        minimized = false; section.classList.remove("is-mini");
        if (hls) { var old = hls; hls = null; old.destroy(); }
        player.pause(); player.removeAttribute("src"); player.load(); section.hidden = true;
        relatedItems = []; relatedCursor = null; relatedBusy = false;
        el("related").textContent = ""; el("more-related").hidden = true; draw();
    }
    function stopSession(save, notify) {
        if (save !== false) recordHistory(false, true);
        epoch++; preparing = false; el("open").disabled = false;
        if (timer !== null) clearInterval(timer);
        timer = null; polling = false;
        var old = session; session = null; clearPlayer();
        if (old && notify !== false) api("POST", "/api/jobs/" + old + "/stop", null, function () {});
    }
    function play() {
        if (!attached || resumeAt !== null || (preview && preview.held)) return;
        el("loading-panel").hidden = true;
        var promise, playingEpoch = epoch;
        try { promise = player.play(); } catch (e) { loading("Нажми ▶ для просмотра.", "ready"); return; }
        if (promise && promise.catch) promise.catch(function (error) {
            if (!attached || playingEpoch !== epoch || error.name === "AbortError") return;
            loading("Нажми ▶, чтобы начать просмотр.", "ready");
            message(error.name === "NotAllowedError" ? "Нажми ▶ ещё раз." : "Ошибка запуска: " + error.message, true);
        });
    }
    function fallbackToHls() {
        if (!session || deliveryFallback || deliveryMode !== "mp4") return;
        deliveryFallback = true; clearTimeout(directTimer); directTimer = null;
        var token = session, generation = epoch;
        attached = false; player.pause(); player.removeAttribute("src"); player.load();
        el("force-hls").hidden = true; loading("Переключаемся на HLS…", "busy");
        api("POST", "/api/jobs/" + token + "/hls", null, function (error) {
            if (generation !== epoch || token !== session) return;
            if (error) { loading(error, "error"); message(error, true); return; }
            deliveryMode = "hls"; poll();
        });
    }
    function queuePrefetch(item, node) {
        clearTimeout(prefetchTimer);
        if (!el("prefetch-enabled").checked || preparing || !online) return;
        var context = settingsGeneration, id = item.id, limit = quality;
        prefetchTimer = setTimeout(function () {
            if (context !== settingsGeneration || preparing || !online || !document.documentElement.contains(node) || !el("prefetch-enabled").checked || document.hidden) return;
            var key = id + ":" + limit + ":" + context;
            if ((key === prefetchKey && Date.now() - prefetchAt < 120000) || Date.now() - prefetchAt < 10000) return;
            prefetchKey = key; prefetchAt = Date.now();
            api("POST", "/api/prefetch", {video_id: id, quality: limit, settings_generation: context}, function (error, data) {
                if (error || !data || data.status !== "scheduled") { if (prefetchKey === key) prefetchKey = ""; }
            }, 7000);
        }, 650);
    }
    function attach(data) {
        deliveryMode = data.mode || "hls";
        audioTracks = data.audio_tracks || [];
        paintAudioOptions();
        el("audio-notice").textContent = [data.audio_language ? "Озвучка: " + data.audio_language : "", data.audio_warning || ""].filter(Boolean).join(" · ");
        attached = true; section.hidden = false; section.classList.remove("is-mini");
        currentVideo = {id: data.video_id, title: data.title, duration: data.duration, channel: data.channel || "", channel_id: data.channel_id || ""};
        el("title").textContent = data.title || "Видео"; el("mini-title").textContent = data.title || "LightTube";
        el("channel").textContent = data.channel || "Канал не указан";
        el("channel").disabled = !/^UC[A-Za-z0-9_-]{22}$/.test(data.channel_id || "");
        el("channel").onclick = function () { openChannel(data.channel_id, data.channel); };
        el("watch-meta").textContent = [data.views, data.published].filter(Boolean).join(" · ");
        el("description").textContent = data.description || "Описание отсутствует.";
        el("quality").textContent = data.source_quality || data.quality || "";
        currentQualityInfo = [data.source_details || "", data.quality_note || "", (data.available_qualities || []).length ? "Доступные H.264-потоки: " + data.available_qualities.join(", ") : ""].filter(Boolean).join(" · ");
        el("video-quality-notice").textContent = [data.source_details, data.quality_note].filter(Boolean).join(" · ");
        el("video-quality-info").textContent = currentQualityInfo;
        section.scrollIntoView(true);
        if (data.startup_low && !upgrading) { preview = {token: session, remaining: 3000, since: null, held: false}; changeQuality(data.target_quality, data.audio_preference || audioPreference, true); }
        if (deliveryMode === "mp4") {
            el("force-hls").hidden = false;
            player.src = data.stream; player.load();
            directTimer = setTimeout(function () { if (deliveryMode === "mp4" && player.readyState < 2) fallbackToHls(); }, 12000);
            play(); restorePosition(); draw(); if (relatedVideo !== data.video_id) loadRelated(data.video_id); return;
        }
        if (window.Hls && Hls.isSupported()) {
            var attempts = 0, generation = epoch;
            var instance = new Hls({startPosition: resumeAt === null ? 0 : resumeAt, maxBufferLength: 30, maxMaxBufferLength: 60, backBufferLength: 30});
            hls = instance;
            function active() { return hls === instance && epoch === generation; }
            instance.once(Hls.Events.MEDIA_ATTACHED, function () { if (active()) instance.loadSource(data.stream); });
            instance.on(Hls.Events.MANIFEST_PARSED, function () { if (active() && player.paused) { play(); message("Видео подготовлено.", false); } });
            instance.on(Hls.Events.BUFFER_APPENDED, function () { if (active()) { restorePosition(); draw(); } });
            instance.on(Hls.Events.ERROR, function (event, error) {
                if (!active()) return;
                console.error("LightTube HLS:", error.type, error.details, "fatal=" + error.fatal, error.error ? error.error.message : "");
                if (!error.fatal) return;
                if (error.type === Hls.ErrorTypes.MEDIA_ERROR && attempts < 2) {
                    attempts++; message("Восстанавливаем плеер… " + attempts + "/2", false); instance.recoverMediaError(); return;
                }
                playbackError = true; loading("Ошибка HLS: " + error.details, "error"); message("Ошибка HLS: " + error.details, true);
            });
            instance.attachMedia(player);
        } else if (player.canPlayType("application/vnd.apple.mpegurl")) {
            player.src = data.stream; player.load(); play(); restorePosition(); message("Видео подготовлено.", false);
        } else { attached = false; loading("Нет поддержки HLS. Проверь static/hls.min.js.", "error"); message("Нет поддержки HLS. Проверь static/hls.min.js.", true); }
        draw(); if (relatedVideo !== data.video_id) loadRelated(data.video_id);
    }
    function poll() {
        if (!session || polling) return;
        polling = true; var token = session, generation = epoch;
        api("GET", "/api/jobs/" + token + "?t=" + Date.now(), null, function (error, data) {
            if (token !== session || generation !== epoch) return;
            polling = false;
            if (data && data.title && data.video_id && relatedVideo !== data.video_id) loadRelated(data.video_id);
            if (error) { loading(error, "error"); message(error, true); return; }
            if (deliveryFallback && data.mode === "mp4") return;
            if (data.duration > 0) duration = data.duration;
            var lines = ["Длительность: " + (duration ? time(duration) : "—"), "Режим: " + (data.mode === "mp4" ? "MP4 через ПК · без FFmpeg" : "HLS")];
            lines.push("Адреса из кэша: " + (data.cache_hit ? "да" : "нет"));
            if (data.format_id) lines.push("Формат: " + data.format_id);
            if (data.video_codec) lines.push("Видео: " + data.video_codec + (data.fps ? " · " + data.fps + " fps" : ""));
            if (data.audio_codec) lines.push("Исходный звук: " + data.audio_codec);
            if (data.video_bitrate_kbps) lines.push("Битрейт видео: " + Math.round(data.video_bitrate_kbps) + " кбит/с");
            else if (data.total_bitrate_kbps) lines.push("Суммарный битрейт источника: " + Math.round(data.total_bitrate_kbps) + " кбит/с");
            if (firstFrameSeconds !== null) lines.push("От нажатия до старта плеера: " + firstFrameSeconds + " с");
            if (data.fallback_reason) lines.push(data.fallback_reason);
            if (typeof data.extraction_seconds === "number") lines.push("Получение адресов: " + data.extraction_seconds + " с");
            if (typeof data.startup_seconds === "number") lines.push((data.mode === "mp4" ? "Подготовка MP4-адреса: " : "Первые фрагменты: ") + data.startup_seconds + " с");
            if (data.width && data.height) lines.push("Фактический поток: " + data.width + " × " + data.height);
            if (data.buffered > 0) lines.push("Подготовлено на сервере: " + time(data.buffered) + " · не проверка целостности звука");
            if (data.mode !== "mp4") lines.push("BETA · Папка: " + data.folder, "Лог: " + data.log);
            el("details").textContent = lines.join("\n"); draw();
            if (data.stage === "error" || data.stage === "stopped") {
                if (!relatedBusy) el("related-panel").classList.remove("is-loading");
                loading(data.message || "Не удалось подготовить видео", "error"); message(data.message, true); clearInterval(timer); timer = null; return;
            }
            if (data.ready && !attached) attach(data);
            else if (!attached) { loading(data.message || "Подготавливаем первые фрагменты…", "busy"); message(data.message, false); }
        }, 10000);
    }
    function openVideo(url, fullQuality) {
        var item = feedItems.concat(searchItems, relatedItems, historyItems, channelItems).filter(function (v) { return v.id === url; })[0];
        clearTimeout(prefetchTimer); openedAt = Date.now(); firstFrameSeconds = null;
        stopSession(true); retryFullQuality = false; audioTracks = []; el("audio-notice").textContent = ""; loadingUrl = url; endedFor = null; preparing = true;
        var generation = epoch;
        section.hidden = false; section.classList.remove("is-mini");
        el("title").textContent = item ? item.title : "Открываем видео…";
        el("channel").textContent = item ? item.channel || "" : "";
        el("quality").textContent = ""; el("video-quality-notice").textContent = ""; currentQualityInfo = ""; el("video-quality-info").textContent = ""; el("description").textContent = ""; el("watch-meta").textContent = ""; el("channel").disabled = true;
        el("related-panel").open = true;
        el("related-panel").classList.add("is-loading"); el("retry-related").hidden = true;
        el("related-status").textContent = "Рекомендации к ролику появятся здесь. Сначала получаем адреса видео…";
        loading("Получаем адреса видео и звука…", "busy"); section.scrollIntoView(true);
        el("open").disabled = true; message("Получаем видео…", false); el("details").textContent = "";
        api("POST", "/api/prepare", {url: url, quality: quality, mode: el("playback-mode").value, start_low: el("start-low").checked && !fullQuality, audio: audioPreference}, function (error, data) {
            if (generation !== epoch) {
                if (!error && data.id) api("POST", "/api/jobs/" + data.id + "/stop", null, function () {});
                return;
            }
            preparing = false; el("open").disabled = false;
            if (error) { el("related-panel").classList.remove("is-loading"); loading(error, "error"); message(error, true); return; }
            session = data.id; lastHistorySave = Date.now(); timer = setInterval(poll, 1000); poll();
        });
    }
    function merge(items, extra) {
        var ids = {}; items.forEach(function (item) { ids[item.id] = true; });
        extra.forEach(function (item) { if (!ids[item.id]) { items.push(item); ids[item.id] = true; } });
        return items;
    }
    function renderCards(items, root, useFilter) {
        root.textContent = "";
        var visible = items.filter(function (item) {
            return !useFilter || filter === "all" || (filter === "watched" ? isSeen(item) : !isSeen(item));
        });
        visible.forEach(function (item) {
            var card = document.createElement("article"); card.tabIndex = 0; card.className = "card";
            card.setAttribute("aria-label", "Смотреть: " + item.title);
            var thumbnail = document.createElement("div"); thumbnail.className = "thumbnail-wrap";
            var image = document.createElement("img"); image.alt = ""; image.loading = "lazy"; image.src = "/api/thumbnail/" + item.id;
            image.onerror = function () {
                this.style.display = "none"; var fallback = document.createElement("span");
                fallback.className = "thumbnail-fallback"; fallback.textContent = "Обложка недоступна"; thumbnail.appendChild(fallback);
            };
            thumbnail.appendChild(image);
            if (typeof item.duration === "number") {
                var badge = document.createElement("span"); badge.className = "duration-badge"; badge.textContent = time(item.duration); thumbnail.appendChild(badge);
            }
            var seen = history[item.id];
            if (seen && seen.duration > 0) {
                var progress = document.createElement("span"); progress.className = "history-progress";
                progress.style.width = Math.min(100, seen.position / seen.duration * 100) + "%"; thumbnail.appendChild(progress);
            }
            var body = document.createElement("div"); body.className = "card-body";
            var avatar = document.createElement("span"); avatar.className = "channel-avatar"; avatar.setAttribute("aria-hidden", "true");
            avatar.textContent = (item.channel || "LT").slice(0, 1).toUpperCase();
            if (item.avatar && item.avatar.indexOf("/api/images/") === 0) {
                var avatarImage = document.createElement("img"); avatarImage.className = "avatar-image"; avatarImage.alt = "";
                avatarImage.loading = "lazy"; avatarImage.src = item.avatar; avatarImage.onerror = function () { this.remove(); }; avatar.appendChild(avatarImage);
            }
            var info = document.createElement("div"); info.className = "card-info";
            var title = document.createElement("span"); title.className = "card-title"; title.textContent = item.title;
            var meta = document.createElement("span"); meta.className = "card-meta"; meta.textContent = [item.views, item.published].filter(Boolean).join(" · ");
            var channelButton = document.createElement("button"); channelButton.className = "channel-link"; channelButton.type = "button";
            channelButton.textContent = item.channel || "Канал не указан"; channelButton.disabled = !/^UC[A-Za-z0-9_-]{22}$/.test(item.channel_id || "");
            channelButton.onclick = function (event) { event.stopPropagation(); openChannel(item.channel_id, item.channel); };
            info.appendChild(title); info.appendChild(channelButton); info.appendChild(meta);
            if (seen || item.is_watched) {
                var label = document.createElement("span"); label.className = "card-resume";
                label.textContent = !seen ? "Просмотрено на YouTube" : seen.completed ? "Просмотрено · в истории сеанса" : "В истории · остановлено на " + time(seen.position);
                info.appendChild(label);
            }
            body.appendChild(avatar); body.appendChild(info); card.appendChild(thumbnail); card.appendChild(body);
            card.onmouseenter = function () { queuePrefetch(item, card); };
            card.onmouseleave = function () { clearTimeout(prefetchTimer); };
            card.onfocus = function () { queuePrefetch(item, card); };
            card.onblur = function () { clearTimeout(prefetchTimer); };
            card.onclick = function () { openVideo(item.id); };
            card.onkeydown = function (event) { if (event.target === card && (event.keyCode === 13 || event.keyCode === 32)) { event.preventDefault(); openVideo(item.id); } }; root.appendChild(card);
        });
        return visible.length;
    }
    function renderCurrent() {
        var items = view === "history" ? historyItems : view === "search" ? searchItems : view === "channel" ? channelItems : feedItems;
        var busy = view === "search" ? searchBusy : view === "channel" ? channelBusy : view === "home" ? feedBusy : false;
        el("feed").hidden = busy; el("empty-state").classList.toggle("is-loading", busy); paintFilter();
        el("search-reset").hidden = !lastQuery; el("search-form").classList.toggle("has-query", !!lastQuery);
        var count = renderCards(items, el("feed"), true);
        el("empty-state").hidden = !busy && count > 0;
        el("empty-text").textContent = busy ? "Ищем видео…" : items.length && !count ? "В этом фильтре нет видео. Выбери «Все»." : view === "history" ? "Здесь появятся начатые просмотры. История очистится после перезапуска сервера." : "Попробуй поиск, обновление или открой ссылку в диагностике.";
        el("load-more").hidden = view === "history" || (busy || !(view === "search" ? searchCursor : view === "channel" ? channelCursor : feedCursor));
    }
    function browserName() {
        var option = el("settings-browser").querySelector('option[value="' + browser + '"]');
        return option ? option.textContent : browser;
    }
    function setView(next) {
        if (next !== view) {
            filter = "all";
            Array.prototype.forEach.call(document.querySelectorAll("[data-filter]"), function (b) { b.className = "chip" + (b.getAttribute("data-filter") === filter ? " active" : ""); });
        }
        if (attached) { setMini(true); recordHistory(false, next === "history"); }
        view = next;
        el("nav-home").className = "nav-item" + (next === "home" ? " active" : "");
        el("nav-history").className = "nav-item" + (next === "history" ? " active" : "");
        el("feed-heading").textContent = next === "history" ? "История сеанса" : next === "search" ? "Результаты поиска" : next === "channel" ? "Канал" : "Рекомендации";
        el("feed-source").textContent = next === "history" ? "В памяти сервера · до перезапуска" : next === "search" ? "Поиск YouTube" : "Сессия: " + browserName();
        el("feed-status").className = "feed-status";
        if (next === "history") { el("feed-status").textContent = "История общая для устройств этого сервера. После его перезапуска она исчезнет."; loadHistory(true); }
        if (next === "home") { el("feed-status").textContent = feedNotice || "Выбери видео."; el("feed-status").className = "feed-status" + (feedError ? " error" : ""); }
        renderCurrent(); rememberUI(false);
    }
    function refreshFeed(force, afterWatch) {
        if (feedBusy) return;
        feedBusy = true; el("refresh-feed").disabled = true; if (view === "home") renderCurrent();
        if (view === "home") el("feed-status").textContent = afterWatch ? "Проверяем рекомендации после просмотра…" : "Загружаем рекомендации…";
        var server = serverId, context = settingsGeneration;
        api("GET", "/api/feed?refresh=" + (force ? "true" : "false"), null, function (error, data) {
            if (server !== serverId || context !== settingsGeneration) return;
            feedBusy = false; el("refresh-feed").disabled = false;
            if (error) { feedNotice = error; feedError = true; }
            else {
                var items = data.items || [], ids = feedItems.map(function (item) { return item.id; });
                var hasNew = items.some(function (item) { return ids.indexOf(item.id) < 0; });
                if (!feedLoaded || !feedItems.length) {
                    feedItems = items; feedCursor = data.cursor || null; feedLoaded = true;
                    if (view === "home") renderCurrent();
                } else if (hasNew) {
                    pendingFeed = {items: items, cursor: data.cursor || null}; el("apply-feed").hidden = false;
                } else if (!data.cached) { pendingFeed = null; el("apply-feed").hidden = true; }
                feedNotice = data.warning || (pendingFeed ? "Есть новые рекомендации. Покажи их, когда будет удобно." : "Лента обновлена.");
                feedError = !!data.warning;
            }
            if (view === "home") { renderCurrent(); el("feed-status").textContent = feedNotice; el("feed-status").className = "feed-status" + (feedError ? " error" : ""); }
        });
    }
    function loadRelated(id) {
        var generation = epoch; relatedVideo = id;
        el("related-panel").classList.add("is-loading"); el("retry-related").hidden = true;
        relatedBusy = true; relatedItems = []; relatedCursor = null;
        el("related-status").textContent = "Получаем рекомендации со страницы этого ролика…";
        api("GET", "/api/related/" + id, null, function (error, data) {
            if (generation !== epoch || relatedVideo !== id) return;
            el("related-panel").classList.remove("is-loading");
            relatedBusy = false;
            relatedItems = error ? [] : data.items || []; relatedCursor = error ? null : data.cursor || null;
            renderCards(relatedItems, el("related"), false);
            el("related-status").textContent = error || data.warning || "Блок «Далее» со страницы YouTube. Он может отличаться от открытой вкладки браузера.";
            el("more-related").hidden = !relatedCursor;
            el("retry-related").hidden = !error && relatedItems.length > 0;
            if (!error && !relatedItems.length) el("related-status").textContent = data.warning || "YouTube не вернул рекомендации к этому ролику. Можно повторить загрузку.";
        });
    }
    function loadMore(isRelated) {
        var key = isRelated ? relatedCursor : view === "search" ? searchCursor : view === "channel" ? channelCursor : feedCursor;
        if (!key || (isRelated ? relatedBusy : moreBusy)) return;
        var button = el(isRelated ? "more-related" : "load-more"), generation = epoch, targetView = view, context = settingsGeneration;
        button.disabled = true;
        if (isRelated) relatedBusy = true; else moreBusy = true;
        api("GET", "/api/more?cursor=" + encodeURIComponent(key), null, function (error, data) {
            if (context !== settingsGeneration) return;
            button.disabled = false;
            if (isRelated) relatedBusy = false; else moreBusy = false;
            if (isRelated && generation !== epoch) return;
            if (!isRelated && targetView !== view) return;
            var notice = el(isRelated ? "related-status" : "feed-status");
            if (error) { notice.textContent = error; return; }
            if (isRelated) {
                merge(relatedItems, data.items || []); relatedCursor = data.cursor || null;
                renderCards(relatedItems, el("related"), false); button.hidden = !relatedCursor;
            } else {
                if (view === "channel") { merge(channelItems, data.items || []); channelCursor = data.cursor || null; }
                else if (view === "search") { merge(searchItems, data.items || []); searchCursor = data.cursor || null; }
                else { merge(feedItems, data.items || []); feedCursor = data.cursor || null; }
                renderCurrent();
            }
            notice.textContent = data.warning || ((data.items || []).length ? "Добавлены следующие видео." : "Новых карточек в этой странице нет.");
        });
    }
    function loadProfiles() {
        var requestedBrowser = el("settings-browser").value, version = ++profileVersion;
        var select = el("settings-profile"); select.textContent = ""; select.disabled = true;
        var auto = document.createElement("option"); auto.value = "auto"; auto.textContent = requestedBrowser === "none" ? "Без профиля" : "Автоматически"; select.appendChild(auto);
        el("profiles-status").textContent = "Ищем профили на сервере…";
        el("settings-save").disabled = true; el("settings-restart").disabled = true;
        api("GET", "/api/profiles?browser=" + encodeURIComponent(requestedBrowser), null, function (error, data) {
            if (version !== profileVersion) return;
            var items = error ? [] : data.items || [];
            items.forEach(function (item) { var option = document.createElement("option"); option.value = item.id; option.textContent = item.label; select.appendChild(option); });
            select.disabled = requestedBrowser === "none"; el("settings-save").disabled = settingsBusy; el("settings-restart").disabled = settingsBusy;
            select.value = requestedBrowser === browser ? selectedProfile : "auto";
            if (!select.value) select.value = "auto";
            el("profiles-status").textContent = error || (items.length ? "Найдено профилей: " + items.length + ". Почта скрыта. Выбор не гарантирует доступ к cookies Chrome." : "Профили не найдены. Доступен автоматический выбор; нестандартный путь можно задать на сервере.");
        }, 10000);
    }
    function showSettings(kind) {
        settingsView = typeof kind === "string" ? kind : "profile";
        el("settings-modal").setAttribute("data-view", settingsView);
        el("settings-title").textContent = settingsView === "profile" ? "Профиль YouTube" : settingsView === "quality" ? "Качество и озвучка" : "Настройки воспроизведения";
        paintAudioOptions();
        el("video-quality-info").textContent = currentQualityInfo || "Параметры исходного потока появятся после подготовки видео.";
        priorFocus = document.activeElement;
        el("settings-save").textContent = settingsView === "quality" && currentVideo ? "Сохранить для следующих видео" : "Готово";
        el("settings-modal").hidden = false; el("settings-quality").value = String(quality);
        el("settings-browser").value = browser;
        el("settings-restart").hidden = !currentVideo || settingsView === "profile"; el("restart-note").hidden = !currentVideo || settingsView === "profile";
        el("settings-status").textContent = ""; el("ask-profile").checked = askProfile;
        el("remember-profile").checked = true;
        if (settingsView === "profile") { loadProfiles(); el("settings-browser").focus(); } else { el("settings-save").disabled = settingsBusy; el("settings-quality").focus(); }
    }
    function closeSettings() {
        el("settings-modal").hidden = true;
        if (priorFocus && priorFocus.focus) priorFocus.focus();
    }
    function saveSettings(restart) {
        if (settingsBusy) return;
        settingsBusy = true; el("settings-save").disabled = true; el("settings-restart").disabled = true;
        var video = currentVideo ? currentVideo.id : null;
        api("POST", "/api/settings", {browser: settingsView === "profile" ? el("settings-browser").value : browser, profile: settingsView === "profile" ? el("settings-profile").value || "auto" : selectedProfile, ask_profile: settingsView === "profile" ? el("ask-profile").checked : askProfile, quality: Number(el("settings-quality").value), audio: el("settings-audio").value || audioPreference}, function (error, data) {
            settingsBusy = false; el("settings-save").disabled = false; el("settings-restart").disabled = false;
            if (error) { el("settings-status").textContent = error; return; }
            browser = data.browser; quality = data.quality; audioPreference = data.audio || el("settings-audio").value || "auto"; selectedProfile = data.profile || "auto"; askProfile = data.ask_profile !== false; settingsGeneration = data.settings_generation; el("quality-select").value = String(quality);
            el("sidebar-browser").textContent = "Сессия: " + browserName();
            if (data.browser_changed) {
                stopSession(false); feedBusy = false; searchBusy = false; moreBusy = false;
                feedItems = []; searchItems = []; feedCursor = searchCursor = null; feedLoaded = false;
                pendingFeed = null; el("apply-feed").hidden = true; historyItems = []; history = {};
                channelItems = []; channelCursor = null; activeChannel = null; lastQuery = ""; prefetchKey = ""; clearTimeout(prefetchTimer); el("search-query").value = "";
                renderCurrent(); refreshFeed(false, false);
            }
            if (settingsView === "profile") rememberProfile();
            rememberUI(true); el("settings-status").textContent = "Профиль и настройки сохранены."; closeSettings();
            if (!feedLoaded && !data.browser_changed) refreshFeed(false, false);
            if (restart && video && !data.browser_changed) changeQuality(quality, audioPreference);
        });
    }
    function disconnected() {
        if (!online) return;
        online = false; stopSession(false, false);
        history = {}; historyItems = []; feedItems = []; searchItems = []; relatedItems = [];
        feedCursor = searchCursor = relatedCursor = null; pendingFeed = null; feedLoaded = false;
        el("apply-feed").hidden = true; renderCurrent();
        message("Связь с сервером потеряна. История сеанса очищена на экране.", true);
        document.querySelector(".connection").classList.add("offline");
    }
    function bootstrap(data) {
        var changed = serverId !== data.session_id || settingsGeneration !== data.settings_generation;
        serverId = data.session_id; browser = data.browser; quality = data.quality; audioPreference = data.audio || "auto"; paintAudioOptions(); online = true;
        selectedProfile = data.profile || "auto"; askProfile = data.ask_profile !== false; settingsGeneration = data.settings_generation;
        document.querySelector(".connection").classList.remove("offline");
        var select = el("settings-browser"); select.textContent = "";
        (data.browsers || []).forEach(function (item) {
            var option = document.createElement("option"); option.value = item.id; option.textContent = item.name; select.appendChild(option);
        });
        select.value = browser; el("settings-quality").value = String(quality); el("quality-select").value = String(quality);
        el("sidebar-browser").textContent = "Сессия: " + browserName();
        if (changed) {
            stopSession(false, false); feedBusy = false; searchBusy = false; history = {}; historyItems = []; feedItems = []; searchItems = [];
            feedCursor = searchCursor = null; pendingFeed = null; feedLoaded = false; el("apply-feed").hidden = true;
            loadHistory(true);
            var saved = readUI(), valid = saved && saved.server === serverId && saved.browser === browser && saved.profile === selectedProfile;
            var device = rememberedProfile();
            var trusted = device && device.browser === browser && device.profile === selectedProfile;
            var prompt = askProfile && !(valid && saved.confirmed) && !trusted;
            if (!valid) { try { localStorage.removeItem("lighttube-ui"); } catch (e) {} }
            restoringUI = true;
            if (valid) {
                el("playback-mode").value = saved.playbackMode === "hls" ? "hls" : "auto"; el("prefetch-enabled").checked = saved.prefetch !== false; el("start-low").checked = saved.startLow !== false;
                lastQuery = typeof saved.query === "string" ? saved.query.slice(0, 160) : ""; el("search-query").value = lastQuery;
                filter = ["all", "unwatched", "watched"].indexOf(saved.filter) >= 0 ? saved.filter : "all";
            }
            if (prompt) showSettings();
            else if (valid && saved.view === "search" && lastQuery) { view = "search"; el("search-form").dispatchEvent(submitEvent()); }
            else if (valid && saved.view === "channel" && saved.channel) openChannel(saved.channel.id, saved.channel.name);
            else if (valid && saved.view === "history") setView("history");
            else refreshFeed(false, false);
            restoringUI = false; renderCurrent();
            message(prompt ? "Выбери профиль для просмотра." : "Сервер готов. Выбери видео.", false);
        }
    }
    function heartbeat() {
        if (heartbeatBusy) return;
        heartbeatBusy = true;
        api("GET", "/api/session", null, function (error, data) {
            heartbeatBusy = false; el("page-loading").hidden = true;
            if (error) { disconnected(); if (!serverId) message(error, true); return; }
            if (data.session_id !== serverId || !online || data.settings_generation !== settingsGeneration) bootstrap(data);
        }, 7000);
    }
    function seek(target) {
        if (!attached || !isFinite(target)) return;
        for (var i = 0; i < player.seekable.length; i++) {
            if (target >= player.seekable.start(i) && target < player.seekable.end(i)) { player.currentTime = target; return; }
        }
        message("Этот участок пока не подготовлен для перемотки.", false);
    }
    ["inside-track", "test-track"].forEach(function (id) {
        el(id).onclick = function (event) {
            var r = this.getBoundingClientRect();
            if (duration > 0 && r.width) seek(Math.max(0, Math.min(1, (event.clientX - r.left) / r.width)) * duration);
        };
        el(id).onkeydown = function (event) {
            if (event.keyCode === 37 || event.keyCode === 39) { event.preventDefault(); seek(Math.max(0, player.currentTime + (event.keyCode === 39 ? 10 : -10))); }
        };
    });
    el("force-hls").onclick = fallbackToHls;
    el("playback-mode").onchange = function () { rememberUI(false); };
    el("prefetch-enabled").onchange = function () { clearTimeout(prefetchTimer); rememberUI(false); };
    player.addEventListener("loadeddata", function () { clearTimeout(directTimer); directTimer = null; });
    el("form").onsubmit = function (event) { event.preventDefault(); if (el("url").value.trim()) openVideo(el("url").value.trim()); };
    el("toggle").onclick = function () { if (attached) { if (player.paused) play(); else player.pause(); } };
    function stop() { stopSession(true); message("Просмотр остановлен. Ролик добавлен в историю сеанса.", false); }
    el("close").onclick = stop; el("stop").onclick = stop; el("mini-close").onclick = stop;
    el("mute").onclick = function () { player.muted = !player.muted; draw(); };
    el("minimize").onclick = function () { setMini(true); };
    el("mini-restore").onclick = function () { setMini(false); };
    el("fullscreen").onclick = function () {
        var frame = el("video-frame"), fn, target;
        if (document.fullscreenElement || document.webkitFullscreenElement) { fn = document.exitFullscreen || document.webkitExitFullscreen; target = document; }
        else { setMini(false); fn = frame.requestFullscreen || frame.webkitRequestFullscreen; target = frame; }
        if (!fn) { message("Полный экран недоступен.", true); return; }
        var p = fn.call(target); if (p && p.catch) p.catch(function () { message("Браузер отклонил полный экран.", true); });
    };
    el("refresh-feed").onclick = function () { setView("home"); refreshFeed(true, false); };
    el("apply-feed").onclick = function () {
        if (pendingFeed) { feedItems = pendingFeed.items; feedCursor = pendingFeed.cursor; pendingFeed = null; setView("home"); }
        this.hidden = true; el("feed-status").textContent = "Лента обновлена.";
    };
    el("load-more").onclick = function () { loadMore(false); };
    el("more-related").onclick = function () { loadMore(true); };
    var searchInput = el("search-query"), suggestions = el("search-suggestions");
    var suggestTimer = null, suggestVersion = 0, suggestItems = [], suggestIndex = -1, composing = false;
    function hideSuggestions() {
        clearTimeout(suggestTimer); suggestVersion++;
        suggestions.hidden = true; suggestIndex = -1;
        searchInput.setAttribute("aria-expanded", "false");
        searchInput.removeAttribute("aria-activedescendant");
    }
    function selectSuggestion(index) {
        suggestIndex = index;
        Array.prototype.forEach.call(suggestions.children, function (row, i) {
            row.setAttribute("aria-selected", String(i === index));
        });
        if (index >= 0) {
            searchInput.setAttribute("aria-activedescendant", "suggestion-" + index);
            suggestions.children[index].scrollIntoView({block: "nearest"});
        } else searchInput.removeAttribute("aria-activedescendant");
    }
    function submitEvent() { var event = document.createEvent("Event"); event.initEvent("submit", true, true); return event; }
    function chooseSuggestion(index) {
        searchInput.value = suggestItems[index]; hideSuggestions();
        el("search-form").dispatchEvent(submitEvent());
    }
    function queueSuggestions() {
        hideSuggestions();
        var query = searchInput.value.trim(), version = suggestVersion;
        if (composing || query.length < 2 || /^https?:/i.test(query)) return;
        suggestTimer = setTimeout(function () {
            api("GET", "/api/suggest?q=" + encodeURIComponent(query), null, function (error, data) {
                if (version !== suggestVersion || document.activeElement !== searchInput || searchInput.value.trim() !== query) return;
                suggestions.textContent = "";
                suggestItems = error ? [] : (data.items || []).filter(function (s) { return typeof s === "string"; }).slice(0, 8);
                suggestItems.forEach(function (text, index) {
                    var row = document.createElement("div"), label = document.createElement("span");
                    row.className = "suggestion"; row.id = "suggestion-" + index;
                    row.setAttribute("role", "option"); row.setAttribute("aria-selected", "false");
                    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
                    svg.setAttribute("aria-hidden", "true");
                    var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
                    use.setAttribute("href", "#i-search"); svg.appendChild(use); row.appendChild(svg);
                    label.textContent = text; row.appendChild(label);
                    row.onmousedown = function (event) { event.preventDefault(); };
                    row.onclick = function () { chooseSuggestion(index); };
                    suggestions.appendChild(row);
                });
                suggestions.hidden = !suggestItems.length;
                searchInput.setAttribute("aria-expanded", String(suggestItems.length > 0));
            }, 7000);
        }, 300);
    }
    searchInput.addEventListener("input", queueSuggestions);
    searchInput.addEventListener("focus", queueSuggestions);
    searchInput.addEventListener("compositionstart", function () { composing = true; hideSuggestions(); });
    searchInput.addEventListener("compositionend", function () { composing = false; queueSuggestions(); });
    searchInput.addEventListener("keydown", function (event) {
        if (composing || event.isComposing) return;
        if (event.keyCode === 27) { hideSuggestions(); return; }
        if (event.keyCode === 9) { hideSuggestions(); return; }
        if (suggestions.hidden) return;
        if (event.keyCode === 38 || event.keyCode === 40) {
            event.preventDefault();
            selectSuggestion(suggestIndex < 0 ? (event.keyCode === 40 ? 0 : suggestItems.length - 1) :
                (suggestIndex + (event.keyCode === 40 ? 1 : suggestItems.length - 1)) % suggestItems.length);
        } else if (event.keyCode === 13 && suggestIndex >= 0) {
            event.preventDefault(); chooseSuggestion(suggestIndex);
        }
    });
    document.addEventListener("click", function (event) { if (!el("search-form").contains(event.target)) hideSuggestions(); });
    el("search-form").addEventListener("focusout", function (event) {
        if (!this.contains(event.relatedTarget)) hideSuggestions();
    });
    el("search-form").onsubmit = function (event) {
        hideSuggestions();
        event.preventDefault(); var query = el("search-query").value.trim(); if (!query || searchBusy) return;
        if (/^https:\/\//i.test(query)) { openVideo(query); return; }
        lastQuery = query; searchItems = []; searchCursor = null;
        searchBusy = true; var context = settingsGeneration, button = this.querySelector("button"); button.disabled = true;
        setView("search"); rememberUI(false); el("feed-status").textContent = "Ищем «" + query + "»…";
        api("GET", "/api/search?q=" + encodeURIComponent(query), null, function (error, data) {
            button.disabled = false; if (context !== settingsGeneration) return;
            searchBusy = false; if (view !== "search") return;
            if (error) { renderCurrent(); el("feed-status").textContent = error; return; }
            searchItems = data.items || []; searchCursor = data.cursor || null; renderCurrent();
            el("feed-status").textContent = data.warning || "Найдено видео: " + searchItems.length;
        });
    };
    el("brand-home").onclick = function (event) { event.preventDefault(); setView("home"); if (!feedLoaded) refreshFeed(false, false); };
    el("search-reset").onclick = function () { lastQuery = ""; el("search-query").value = ""; searchItems = []; searchCursor = null; hideSuggestions(); setView("home"); rememberUI(false); if (!feedLoaded) refreshFeed(false, false); el("search-query").focus(); };
    el("nav-home").onclick = function () { setView("home"); if (!feedLoaded) refreshFeed(false, false); };
    el("nav-history").onclick = function () { setView("history"); };
    el("nav-diagnostics").onclick = function () { var panel = el("diagnostic-panel"); panel.open = !panel.open; if (panel.open) panel.scrollIntoView(true); };
    el("loading-cancel").onclick = function () { stopSession(true); message("Подготовка остановлена.", false); };
    el("loading-action").onclick = function () { if (this.getAttribute("data-mode") === "error") openVideo(loadingUrl, retryFullQuality); else play(); };
    el("account-profile").onclick = function () { showSettings("profile"); };
    el("retry-related").onclick = function () { if (relatedVideo) loadRelated(relatedVideo); };
    el("settings-browser").onchange = loadProfiles;
    el("global-settings").onclick = function () { showSettings("general"); }; el("player-settings").onclick = function () { showSettings("quality"); }; el("nav-settings").onclick = function () { showSettings("general"); };
    el("settings-close").onclick = closeSettings;
    el("settings-modal").onclick = function (event) { if (event.target === this) closeSettings(); };
    el("settings-save").onclick = function () { saveSettings(false); };
    el("settings-restart").onclick = function () { saveSettings(true); };
    el("quality-select").onchange = function () {
        quality = Number(this.value); el("settings-quality").value = String(quality);
        var context = settingsGeneration;
        api("POST", "/api/settings", {browser: browser, profile: selectedProfile, ask_profile: askProfile, quality: quality, audio: audioPreference}, function (error) {
            if (context !== settingsGeneration) return;
            message(error || "Качество сохранено для следующих видео.", !!error);
        });
    };
    el("menu-toggle").onclick = function () { document.body.classList.toggle("sidebar-collapsed"); };
    Array.prototype.forEach.call(document.querySelectorAll("[data-filter]"), function (button) {
        button.onclick = function () {
            filter = this.getAttribute("data-filter");
            Array.prototype.forEach.call(document.querySelectorAll("[data-filter]"), function (b) { b.className = "chip" + (b.getAttribute("data-filter") === filter ? " active" : ""); });
            recordHistory(false, true); loadHistory(true); renderCurrent(); rememberUI(false);
        };
    });
    player.addEventListener("playing", function () {
        if (!attached) return;
        if (preview && preview.held) { player.pause(); return; }
        previewPlaying();
        if (firstFrameSeconds === null && openedAt) firstFrameSeconds = Math.round((Date.now() - openedAt) / 10) / 100;
        clearTimeout(directTimer); directTimer = null; el("loading-panel").hidden = true; playbackError = false;
        message("Воспроизведение через LightTube.", false);
    });
    player.addEventListener("pause", previewStopped);
    ["loadedmetadata", "progress", "canplay"].forEach(function (name) { player.addEventListener(name, restorePosition); });
    player.addEventListener("waiting", function () { previewStopped(); if (attached && !playbackError) { loading(preview && preview.held ? "Загружаем выбранное качество…" : "Буферизация…", "busy"); message("Буферизация…", false); } });
    player.addEventListener("error", function () { if (attached && player.error) { if (deliveryMode === "mp4" && !deliveryFallback) { fallbackToHls(); return; } playbackError = true; message("Ошибка плеера " + player.error.code + ": " + player.error.message, true); } });
    player.addEventListener("timeupdate", function () {
        if (preview && !preview.held && player.currentTime >= 3) holdPreview();
        if (attached && (Date.now() - lastHistorySave > 15000 || (currentVideo && !history[currentVideo.id] && player.currentTime >= 1 && Date.now() - lastHistorySave > 1000))) { lastHistorySave = Date.now(); recordHistory(false, false); }
    });
    player.addEventListener("ended", function () {
        if (!session || endedFor === session) return;
        endedFor = session; recordHistory(true, true); message("Просмотр завершён. Ролик сохранён в истории сеанса.", false); refreshFeed(true, true);
    });
    ["timeupdate", "progress", "loadedmetadata", "seeking", "seeked", "emptied", "pause", "play", "volumechange"].forEach(function (name) { player.addEventListener(name, draw); });
    document.addEventListener("keydown", function (event) {
        if (!attached || !el("settings-modal").hidden || event.ctrlKey || event.altKey || event.metaKey || event.defaultPrevented) return;
        var tag = (event.target.tagName || "").toLowerCase();
        if (["input", "textarea", "select"].indexOf(tag) >= 0 || event.target.isContentEditable) return;
        var key = (event.key || "").toLowerCase(), code = event.keyCode;
        if (key === "f" || code === 70) { event.preventDefault(); el("fullscreen").click(); }
        else if (key === "m" || code === 77) { event.preventDefault(); el("mute").click(); }
        else if (key === "k" || code === 75 || (code === 32 && tag !== "button") || (code === 13 && event.target === player)) { event.preventDefault(); el("toggle").click(); }
        else if (key === "i" || code === 73) { event.preventDefault(); setMini(!minimized); }
        else if (key === "j" || code === 74 || key === "l" || code === 76 || ((code === 37 || code === 39) && el("video-frame").contains(event.target) && !event.target.classList.contains("track"))) {
            event.preventDefault(); seek(Math.max(0, player.currentTime + ((key === "j" || code === 74 || code === 37) ? -10 : 10)));
        } else if ((code === 38 || code === 40) && el("video-frame").contains(event.target)) {
            event.preventDefault(); player.volume = Math.max(0, Math.min(1, player.volume + (code === 38 ? .05 : -.05)));
        }
    });
    document.addEventListener("keydown", function (event) {
        if (el("settings-modal").hidden) return;
        if (event.keyCode === 27) { closeSettings(); return; }
        if (event.keyCode === 9) {
            var nodes = Array.prototype.slice.call(el("settings-modal").querySelectorAll("button, select, input")).filter(function (n) { return !n.disabled && !n.hidden && window.getComputedStyle(n).display !== "none" && !((settingsView !== "profile") && el("profile-settings").contains(n)) && !((settingsView === "profile") && el("quality-settings").contains(n)) && !((settingsView !== "general") && el("general-settings").contains(n)); });
            if (!nodes.length) return;
            var first = nodes[0], last = nodes[nodes.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        }
    });
    ["feed", "related"].forEach(function (id) {
        el(id).addEventListener("keydown", function (event) {
            var buttons = Array.prototype.slice.call(this.querySelectorAll(".card")), i = buttons.indexOf(document.activeElement);
            if (i < 0 || [37, 38, 39, 40].indexOf(event.keyCode) < 0) return;
            var columns = buttons.filter(function (b) { return b.offsetTop === buttons[0].offsetTop; }).length || 1;
            var delta = event.keyCode === 37 ? -1 : event.keyCode === 39 ? 1 : event.keyCode === 38 ? -columns : columns;
            if (buttons[i + delta]) { event.preventDefault(); buttons[i + delta].focus(); }
        });
    });
    window.addEventListener("pagehide", function () {
        rememberUI(false);
        if (!session || !navigator.sendBeacon) return;
        if (currentVideo && player.currentTime >= 1) {
            var blob = new Blob([JSON.stringify({token: session, position: player.currentTime, completed: player.ended})], {type: "application/json"});
            navigator.sendBeacon("/api/history", blob);
        }
        navigator.sendBeacon("/api/jobs/" + session + "/stop", "");
    });
    draw(); heartbeat(); setInterval(heartbeat, 15000);
}());
