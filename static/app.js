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
    var searchKind = "all", relatedMode = "all", authorItems = [], authorCursor = null, authorBusy = false, authorVideo = null, menuPage = "root", queuedSetting = null;
    var settingsView = "profile", relatedVideo = null, upgradeToken = null, upgradeTimer = null, upgrading = false, preview = null, previewTimer = null, resumeAt = null, resumePlaying = true;
    var audioPreference = "auto", audioTracks = [], retryFullQuality = false, currentQualityInfo = "";
    var nextVideoTimer = null, nextVideoCandidate = null, channelTab = "videos",
        resumeWatchActive = false, availableQualities = [], pendingResume = null,
        quality = 720, heartbeatBusy = false, settingsBusy = false, priorFocus = null;
    var localPreferences = {};
    try { localPreferences = JSON.parse(localStorage.getItem("lighttube-preferences") || "{}") || {}; } catch (ignored) {}
    el("autoplay-next").checked = localPreferences.autoplay === true;
    el("developer-mode").checked = localPreferences.developer === true;
    el("ui-language").value = localPreferences.languageRevision === 2 && localPreferences.language === "ru" ? "ru" : "en";
    function localText(ru, en) { return el("ui-language").value === "en" ? en : ru; }
    function updateLocalPreferences() {
        var nickname = (localPreferences.nickname || "LightTube").trim();
        var letters = Array.from(nickname.replace(/\s/g,""));
        el("account-profile").textContent = letters.length ? (letters[0] + (letters.length > 1 ? letters[letters.length - 1] : "")).toUpperCase() : "LT";
        if (!/^#[0-9a-f]{6}$/i.test(localPreferences.avatarColor || "")) {
            var colors = ["#7c3aed","#be185d","#0369a1","#047857","#b45309","#4338ca","#a21caf","#0e7490"];
            localPreferences.avatarColor = colors[Math.floor(Math.random()*colors.length)];
        }
        el("account-profile").style.background = localPreferences.avatarColor;
        el("account-profile").setAttribute("aria-label",nickname);
        el("account-profile").title = localPreferences.nickname || localText("Твой профиль", "Your profile");
        document.body.classList.toggle("developer-mode", el("developer-mode").checked);
        if (!el("developer-mode").checked) el("diagnostic-panel").open = false;
        document.documentElement.lang = el("ui-language").value;
        [["ui-language-label","Язык интерфейса","Interface language"],["autoplay-label","Автоматически включать следующее видео","Play the next video automatically"],["developer-label","Для разработчика","Developer options"],["developer-toggle-label","Показывать диагностику и сведения о сервере","Show diagnostics and server information"]].forEach(function (x) { el(x[0]).textContent = localText(x[1], x[2]); });
        [["nav-home","Главная","Home"],["nav-history","История","History"],["nav-settings","Настройки","Settings"],["nav-diagnostics","Диагностика","Diagnostics"]].forEach(function (x) { el(x[0]).querySelector("span").textContent = localText(x[1], x[2]); });
        [["settings-quality","Максимальное качество","Maximum quality"],["settings-audio","Озвучка / язык звуковой дорожки","Audio language"]].forEach(function (x) { var n = document.querySelector('label[for="' + x[0] + '"]'); if (n) n.textContent = localText(x[1], x[2]); });
        try { localStorage.setItem("lighttube-preferences", JSON.stringify({languageRevision:2,avatarColor:localPreferences.avatarColor,nickname:localPreferences.nickname || "",autoplay:el("autoplay-next").checked,developer:el("developer-mode").checked,language:el("ui-language").value})); } catch (ignored) {}
    }
    el("nickname").value = localPreferences.nickname || "";
    el("nickname").oninput = function () { localPreferences.nickname = this.value.trim().slice(0,40); updateLocalPreferences(); };
    ["autoplay-next","developer-mode","ui-language"].forEach(function (id) { el(id).onchange = updateLocalPreferences; });
    updateLocalPreferences();
    el("offline-retry").onclick = heartbeat;
    var autoplayLabel = document.createElement("label"); autoplayLabel.className = "autoplay-control"; autoplayLabel.title = localText("Автопроигрывание","Autoplay");
    var autoplaySwitch = document.createElement("input"); autoplaySwitch.type = "checkbox"; autoplaySwitch.checked = el("autoplay-next").checked;
    autoplayLabel.appendChild(autoplaySwitch); var switchIcon = document.createElement("span"); switchIcon.textContent = "▶"; autoplayLabel.appendChild(switchIcon); autoplaySwitch.setAttribute("aria-label", "Autoplay");
    el("player-settings").parentNode.insertBefore(autoplayLabel,el("player-settings"));
    autoplaySwitch.onchange = function () { el("autoplay-next").checked = this.checked; switchIcon.textContent = this.checked ? "▶" : "Ⅱ"; autoplayLabel.setAttribute("data-on",this.checked ? "true":"false"); if (!this.checked) cancelNextVideo(); updateLocalPreferences(); };
    switchIcon.textContent = autoplaySwitch.checked ? "▶" : "Ⅱ"; autoplayLabel.setAttribute("data-on",autoplaySwitch.checked ? "true":"false");
    el("autoplay-next").addEventListener("change",function () { autoplaySwitch.checked = this.checked; });
    player.addEventListener("click", function () { if (attached) { if (player.paused) play(); else player.pause(); } });
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
            uploadDate:el("upload-date").value, channel: activeChannel, searchKind: searchKind, playbackMode: el("playback-mode").value, prefetch: el("prefetch-enabled").checked, startLow: el("start-low").checked})); } catch (e) {}
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
            var wasPreview = !!preview; queuedSetting = null; cancelUpgrade();
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
                            api("POST", "/api/jobs/" + original + "/stop", null, function () {
                                if (generation !== epoch || !queuedSetting) return;
                                var chosen = queuedSetting; queuedSetting = null; changeQuality(chosen.quality, chosen.audio);
                            });
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
    var authorProfiles = {};
    function authorPhoto(id, url) {
        var photo = el(id); photo.hidden = !url;
        photo.onerror = function () { this.hidden = true; };
        if (url) photo.src = url; else photo.removeAttribute("src");
    }
    function rememberAuthor(id, profile, fallback) {
        var previous = authorProfiles[id] || {};
        var known = feedItems.concat(searchItems, relatedItems, channelItems).filter(function (item) { return item.channel_id === id && item.avatar; })[0];
        authorProfiles[id] = {title: profile.title || previous.title || fallback || "Канал", avatar: profile.avatar || previous.avatar || (known && known.avatar) || ""};
        return authorProfiles[id];
    }
    function decorateAuthor(items, id, profile) {
        items.forEach(function (item) { item.channel_id = id; item.channel = profile.title || item.channel; item.avatar = item.avatar || profile.avatar; });
    }
    function openChannel(id, name, tab) {
        channelTab = tab || "videos";
        Array.prototype.forEach.call(document.querySelectorAll("[data-channel-tab]"),function(b){b.classList.toggle("active",b.getAttribute("data-channel-tab")===channelTab);});
        if (!/^UC[A-Za-z0-9_-]{22}$/.test(id || "")) { message("YouTube не прислал адрес канала.", true); return; }
        setView("channel"); activeChannel = {id: id, name: name || "Канал"}; channelBusy = true; channelItems = []; channelCursor = null;
        el("feed-heading").textContent = activeChannel.name; el("feed-source").textContent = "Видео канала"; renderCurrent(); rememberUI(false);
        var initial = rememberAuthor(id, {}, name); el("channel-name").textContent = initial.title; authorPhoto("channel-avatar", initial.avatar);
        var context = settingsGeneration, requestedTab = channelTab;
        api("GET", "/api/channels/" + id + "?tab=" + channelTab, null, function (error, data) {
            if (context !== settingsGeneration || requestedTab !== channelTab || !activeChannel || activeChannel.id !== id) return;
            channelBusy = false; channelItems = error ? [] : data.items || [];
            var profile = rememberAuthor(id, error ? {} : data.channel || {}, name); decorateAuthor(channelItems, id, profile);
            el("channel-name").textContent = profile.title; authorPhoto("channel-avatar", profile.avatar);
            channelCursor = error ? null : data.cursor || null;
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
        ["inside-buffer"].forEach(function (id) {
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
        ["inside-played"].forEach(function (id) {
            el(id).style.width = (duration > 0 ? Math.min(100, current / duration * 100) : 0) + "%";
        });
        ["inside-track"].forEach(function (id) {
            el(id).setAttribute("aria-valuemax", String(duration || 0));
            el(id).setAttribute("aria-valuenow", String(Math.floor(current)));
            el(id).setAttribute("aria-valuetext", label);
        });
        icon("toggle", player.paused ? "play" : "pause", player.paused ? "Продолжить" : "Пауза");
        icon("mute", player.muted ? "muted" : "volume", player.muted ? "Включить звук" : "Выключить звук");
    }
    function setMini(value) {
        resumeWatchActive = !value;
        if (!attached && value) return;
        minimized = !!value; closePlayerMenu();
        document.body.classList.toggle("watching", !minimized && (attached || preparing));
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
        el("loading-action").hidden = mode === "busy";
        el("loading-action").textContent = mode === "error" ? "Повторить" : "▶";
        el("loading-action").setAttribute("data-mode", mode); el("loading-action").setAttribute("aria-label", mode === "error" ? "Повторить загрузку" : "Воспроизвести видео");
        el("loading-cancel").textContent = mode === "busy" ? "Отмена" : "Закрыть";
    }
    function clearPlayer() {
        cancelUpgrade(); queuedSetting = null; closePlayerMenu(); document.body.classList.remove("watching"); resumeAt = null; relatedVideo = null; relatedMode = "all"; authorItems = []; authorCursor = null; authorBusy = false; authorVideo = null; el("related-panel").classList.remove("is-loading");
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
        audioTracks = data.audio_tracks || []; availableQualities = data.available_qualities || [];
        paintAudioOptions();
        el("audio-notice").hidden = !data.audio_warning;
        el("audio-notice").textContent = [data.audio_language ? "Озвучка: " + data.audio_language : "", data.audio_warning || ""].filter(Boolean).join(" · ");
        attached = true; if (pendingResume !== null) { resumeAt = pendingResume; resumePlaying = false; pendingResume = null; } document.body.classList.add("watching"); section.hidden = false; section.classList.remove("is-mini");
        currentVideo = {id: data.video_id, title: data.title, duration: data.duration, channel: data.channel || "", channel_id: data.channel_id || ""};
        el("title").textContent = data.title || "Видео"; el("mini-title").textContent = data.title || "LightTube";
        el("channel").textContent = data.channel || "Канал не указан";
        el("channel").disabled = !/^UC[A-Za-z0-9_-]{22}$/.test(data.channel_id || "");
        el("channel").onclick = function () { openChannel(data.channel_id, data.channel); };
        el("open-channel").disabled = el("channel").disabled;
        el("open-channel").onclick = el("channel").onclick;
        el("watch-avatar").setAttribute("role", "button");
        el("watch-avatar").tabIndex = el("channel").disabled ? -1 : 0;
        el("watch-avatar").onclick = function () { if (!el("channel").disabled) el("channel").click(); };
        el("watch-avatar").onkeydown = function (e) { if (e.keyCode === 13 || e.keyCode === 32) { e.preventDefault(); this.click(); } };
        var profile = rememberAuthor(data.channel_id, {}, data.channel); authorPhoto("watch-avatar", profile.avatar);
        el("watch-meta").textContent = [data.views, data.published].filter(Boolean).join(" · ");
        el("description").textContent = data.description || "Описание отсутствует.";
        el("description-box").classList.remove("expanded"); el("description-toggle").textContent = "…ещё";
        el("related-author").textContent = "Автор: " + (data.channel || "канал"); el("related-author").disabled = !data.channel_id;
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
        if (/(?:^|[?&])native_hls=1(?:&|$)/.test(location.search)) {
            if (!player.canPlayType("application/vnd.apple.mpegurl")) {
                attached = false; loading("Браузер не заявляет поддержку встроенного HLS.", "error"); return;
            }
            player.src = data.stream; player.load(); play(); restorePosition(); draw();
            if (relatedVideo !== data.video_id) loadRelated(data.video_id);
            message("Тест: встроенный HLS браузера, без hls.js.", false); return;
        }
        if (window.Hls && Hls.isSupported()) {
            var attempts = 0, generation = epoch;
            var instance = new Hls({startPosition: resumeAt === null ? 0 : resumeAt, maxBufferLength: 20, maxMaxBufferLength: 30, maxBufferSize: 30000000, backBufferLength: 10});
            hls = instance;
            function active() { return hls === instance && epoch === generation; }
            instance.once(Hls.Events.MEDIA_ATTACHED, function () { if (active()) instance.loadSource(data.stream); });
            instance.on(Hls.Events.MANIFEST_PARSED, function () { if (active() && player.paused) { play(); message("Видео подготовлено.", false); } });
            instance.on(Hls.Events.BUFFER_APPENDED, function () { if (active()) { restorePosition(); draw(); } });
            instance.on(Hls.Events.ERROR, function (event, error) {
                if (!active()) return;
                try {
                    var entries = JSON.parse(sessionStorage.getItem("lighttube-hls-errors") || "[]");
                    entries.push({type:error.type,details:error.details,fatal:!!error.fatal,position:Math.round(player.currentTime || 0),mediaErrorCode:player.error ? player.error.code : null});
                    sessionStorage.setItem("lighttube-hls-errors", JSON.stringify(entries.slice(-20)));
                } catch (ignored) {}
                if (error.fatal) console.error("LightTube HLS:", error.type, error.details, error.error ? error.error.message : "");
                else if (el("developer-mode").checked) console.debug("LightTube HLS:", error.type, error.details);
                if (!error.fatal) return;
                if (error.type === Hls.ErrorTypes.MEDIA_ERROR && error.details !== "bufferAppendError" && error.details !== "mediaSourceRequiresReset" && attempts < 1) {
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
            if (data.media_cache_hit) lines.push("Повторный просмотр: готовые HLS-фрагменты из кэша сервера.");
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
        cancelNextVideo();
        var item = feedItems.concat(searchItems, relatedItems, authorItems, historyItems, channelItems).filter(function (v) { return v.id === url; })[0];
        clearTimeout(prefetchTimer); openedAt = Date.now(); firstFrameSeconds = null;
        stopSession(true); retryFullQuality = false; audioTracks = []; el("audio-notice").textContent = ""; loadingUrl = url; endedFor = null; preparing = true;
        var generation = epoch;
        resumeWatchActive = true;
        var idMatch = /(?:v=|youtu.be\/)([A-Za-z0-9_-]{11})/.exec(url);
        var old = history[(item && item.id) || (idMatch && idMatch[1]) || url];
        if (old && !old.completed && old.position > 1) { pendingResume = old.position; }
        section.hidden = false; document.body.classList.add("watching"); section.classList.remove("is-mini");
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
    function renderChannelCard(item, root) {
        var card = document.createElement("article"); card.className = "card channel-result"; card.tabIndex = 0;
        card.setAttribute("aria-label", "Открыть канал: " + item.title);
        var image = document.createElement("img"); image.className = "channel-result-avatar"; image.alt = "";
        if (item.avatar) image.src = item.avatar; else image.hidden = true;
        image.onerror = function () { this.hidden = true; };
        var info = document.createElement("div");
        var title = document.createElement("strong"); title.className = "card-title"; title.textContent = item.title;
        var meta = document.createElement("p"); meta.className = "card-meta"; meta.textContent = [item.handle, item.subscribers].filter(Boolean).join(" · ");
        var description = document.createElement("p"); description.className = "card-meta"; description.textContent = item.description || "";
        var action = document.createElement("button"); action.type = "button"; action.className = "pill-button"; action.textContent = "Открыть канал";
        function open() { openChannel(item.channel_id || item.id, item.title); }
        card.onclick = open; card.onkeydown = function (event) { if (event.target === card && (event.keyCode === 13 || event.keyCode === 32)) { event.preventDefault(); open(); } };
        action.onclick = function (event) { event.stopPropagation(); open(); };
        info.appendChild(title); info.appendChild(meta); info.appendChild(description);
        card.appendChild(image); card.appendChild(info); card.appendChild(action); root.appendChild(card);
    }
    function renderRelated() {
        el("author-header").hidden = relatedMode !== "author";
        var items = relatedMode === "author" ? authorItems : relatedMode === "unwatched" ? relatedItems.filter(function (item) { return !isSeen(item); }) : relatedItems;
        renderCards(items, el("related"), false);
        el("more-related").hidden = !(relatedMode === "author" ? authorCursor : relatedCursor);
        ["all", "author", "unwatched"].forEach(function (name) { el("related-" + name).className = "chip" + (relatedMode === name ? " active" : ""); });
    }
    function selectRelated(mode) {
        relatedMode = mode; renderRelated();
        if (mode !== "author") { el("related-status").textContent = mode === "unwatched" ? "Рекомендации без отметки просмотра." : "Рекомендации к этому ролику."; return; }
        if (!currentVideo || !currentVideo.channel_id || authorBusy) return;
        var knownProfile = rememberAuthor(currentVideo.channel_id, {}, currentVideo.channel);
        el("author-name").textContent = knownProfile.title; authorPhoto("author-avatar", knownProfile.avatar);
        el("author-open-channel").onclick = function () { openChannel(currentVideo.channel_id, currentVideo.channel); };
        el("author-avatar").setAttribute("role", "button"); el("author-avatar").tabIndex = 0;
        el("author-avatar").onclick = el("author-open-channel").onclick;
        el("author-avatar").onkeydown = function (e) { if (e.keyCode === 13 || e.keyCode === 32) { e.preventDefault(); this.click(); } };
        if (authorVideo === currentVideo.channel_id) { el("related-status").textContent = "Видео автора · " + currentVideo.channel; return; }
        authorBusy = true; var generation = epoch, id = currentVideo.channel_id;
        el("related-status").textContent = "Загружаем видео автора…";
        api("GET", "/api/channels/" + id, null, function (error, data) {
            if (generation !== epoch) return;
            authorBusy = false; authorItems = error ? [] : (data.items || []).filter(function (item) { return item.id !== currentVideo.id; }); authorCursor = error ? null : data.cursor;
            if (!error) {
                authorVideo = id; var profile = rememberAuthor(id, data.channel || {}, currentVideo.channel); decorateAuthor(authorItems, id, profile);
                el("author-name").textContent = profile.title; authorPhoto("author-avatar", profile.avatar); authorPhoto("watch-avatar", profile.avatar);
            }
            if (relatedMode === "author") { renderRelated(); el("related-status").textContent = error || data.warning || "Видео автора · " + currentVideo.channel; }
        });
    }
    function cancelNextVideo() {
        if (nextVideoTimer !== null) clearInterval(nextVideoTimer);
        nextVideoTimer = null; nextVideoCandidate = null; el("up-next").hidden = true;
    }
    function playNextVideo() {
        var item = nextVideoCandidate; cancelNextVideo();
        if (item) openVideo("https://www.youtube.com/watch?v=" + item.id);
    }
    function startNextVideo(item) {
        cancelNextVideo(); nextVideoCandidate = item;
        el("loading-panel").hidden = true;
        el("next-title").textContent = item.title || "LightTube";
        el("next-channel").textContent = item.channel || "";
        el("next-thumb").src = "/api/thumbnail/" + item.id; el("next-thumb").hidden = false;
        var seconds = 8;
        function paint() { el("next-countdown").textContent = localText("Следующее видео через ", "Up next in ") + seconds; }
        el("up-next").hidden = false; paint(); el("next-cancel").focus();
        nextVideoTimer = setInterval(function () { seconds--; paint(); if (seconds <= 0) playNextVideo(); },1000);
    }
    el("next-cancel").onclick = cancelNextVideo; el("next-play").onclick = playNextVideo;
    el("filter-toggle").onclick = function () { var open = document.body.classList.toggle("filters-open"); this.setAttribute("aria-expanded",String(open)); el("advanced-filters").hidden = !open; };
    el("filter-channel").onchange = function () { renderCurrent(); };
    el("upload-date").onchange = function () { if (lastQuery && view === "search" && searchKind !== "channels") el("search-form").dispatchEvent(submitEvent()); };
    Array.prototype.forEach.call(document.querySelectorAll("[data-channel-tab]"),function(b){ b.onclick = function () { if (activeChannel) openChannel(activeChannel.id,activeChannel.name,this.getAttribute("data-channel-tab")); }; });
    function closePlayerMenu() { el("player-menu").hidden = true; el("player-settings").setAttribute("aria-expanded", "false"); }
    function applyPlayerChoice(name, value) {
        if (name === "speed") { player.defaultPlaybackRate = Number(value); player.playbackRate = Number(value); closePlayerMenu(); return; }
        var nextQuality = name === "quality" ? Number(value) : quality, nextAudio = name === "audio" ? value : audioPreference;
        var context = settingsGeneration, generation = epoch;
        closePlayerMenu();
        api("POST", "/api/settings", {browser: browser, profile: selectedProfile, ask_profile: askProfile, quality: nextQuality, audio: nextAudio}, function (error, data) {
            if (context !== settingsGeneration) return;
            if (error) { message(error, true); return; }
            quality = data.quality; audioPreference = data.audio || nextAudio;
            el("quality-select").value = String(quality); el("settings-quality").value = String(quality); paintAudioOptions();
            if (generation !== epoch || !session) return;
            if (upgrading) { queuedSetting = {quality: quality, audio: audioPreference}; message("Настройки сохранены. Применим после текущего переключения…", false); }
            else changeQuality(quality, audioPreference);
        });
    }
    function showPlayerMenu(page) {
        if (!attached) return;
        menuPage = page; var menu = el("player-menu"); menu.textContent = ""; menu.hidden = false; el("player-settings").setAttribute("aria-expanded", "true");
        function row(label, value, callback, selected) {
            var button = document.createElement("button"); button.type = "button"; button.className = "player-menu-row"; button.setAttribute("role", "menuitem");
            var title = document.createElement("span"); title.textContent = label;
            var detail = document.createElement("span"); detail.className = "menu-value"; detail.textContent = value || "";
            button.appendChild(title); button.appendChild(detail); if (selected) button.setAttribute("aria-current", "true");
            button.onclick = function (event) { event.stopPropagation(); callback(); }; menu.appendChild(button);
        }
        if (page === "root") {
            row(localText("Качество", "Quality"), (quality === 0 ? "Авто · " : "") + el("quality").textContent + " ›", function () { showPlayerMenu("quality"); });
            var selected = el("settings-audio").querySelector('option[value="' + audioPreference + '"]');
            row(localText("Озвучка", "Audio"), (selected ? selected.textContent : audioPreference) + " ›", function () { showPlayerMenu("audio"); });
            row("Скорость воспроизведения", (player.playbackRate === 1 ? "Обычная" : player.playbackRate + "×") + " ›", function () { showPlayerMenu("speed"); });
        } else {
            row("‹ " + (page === "quality" ? "Качество" : page === "audio" ? "Озвучка" : "Скорость"), "", function () { showPlayerMenu("root"); });
            var choices = page === "quality" ? [{value:0,label:"Авто · до 1080p"},{value:2160,label:"2160p · 4K"},{value:1440,label:"1440p · 2K"},{value:1080,label:"1080p"},{value:720,label:"720p"},{value:480,label:"480p"},{value:360,label:"360p"}] : page === "audio" ? Array.prototype.map.call(el("settings-audio").options, function (o) { return {value:o.value,label:o.textContent}; }) : [0.5,0.75,1,1.25,1.5,2].map(function (rate) { return {value:rate,label:rate === 1 ? "Обычная" : rate + "×"}; });
            if (page === "quality") {
                var seenQuality = {};
                choices = [{value:0,label:localText("Авто · до 1080p","Auto · up to 1080p")}];
                availableQualities.slice().sort(function (a,b) { return parseInt(b,10)-parseInt(a,10); }).forEach(function (q) {
                    var value = parseInt(q,10);
                    if (value > 0 && !seenQuality[value]) { seenQuality[value] = true; choices.push({value:value,label:q}); }
                });
            }
            choices.forEach(function (choice) { var selected = String(choice.value) === String(page === "quality" ? quality : page === "audio" ? audioPreference : player.playbackRate); row(choice.label, selected ? "✓" : "", function () { applyPlayerChoice(page, choice.value); }, selected); });
        }
        menu.querySelector("button").focus();
    }
    function renderCards(items, root, useFilter) {
        root.textContent = "";
        if (root === el("feed")) {
            var channelSelect = el("filter-channel"), previous = channelSelect.value, names = {};
            items.forEach(function (item) { if (item.kind !== "channel" && item.kind !== "playlist" && item.channel) names[item.channel] = true; });
            channelSelect.textContent = ""; var allChannels = document.createElement("option"); allChannels.value = ""; allChannels.textContent = localText("Все каналы", "All channels"); channelSelect.appendChild(allChannels);
            Object.keys(names).sort().forEach(function (name) { var option = document.createElement("option"); option.value=name;option.textContent=name;channelSelect.appendChild(option); });
            channelSelect.value = Object.prototype.hasOwnProperty.call(names,previous) ? previous : "";
        }
        var visible = items.filter(function (item) {
            if (root === el("feed") && el("filter-channel").value && item.channel !== el("filter-channel").value) return false;
            if (item.kind === "channel") return !useFilter || filter === "all";
            return !useFilter || filter === "all" || (filter === "watched" ? isSeen(item) : !isSeen(item));
        });
        visible.forEach(function (item) {
            if (item.kind === "channel") { renderChannelCard(item, root); return; }
            if (item.kind === "playlist") {
                var listCard = document.createElement("button"); listCard.className = "card playlist-card"; listCard.type = "button";
                if (item.thumbnail) { var cover = document.createElement("img"); cover.src = item.thumbnail; cover.alt = ""; listCard.appendChild(cover); }
                var listTitle = document.createElement("strong"); listTitle.textContent = "☷ " + item.title; listCard.appendChild(listTitle);
                listCard.onclick = function () {
                    var context = settingsGeneration, channelId = activeChannel && activeChannel.id;
                    api("GET","/api/playlists/" + item.id,null,function(error,data){
                        if (context !== settingsGeneration || !activeChannel || activeChannel.id !== channelId || channelTab !== "playlists") return;
                        if(error){message(error,true);return;}
                        channelItems=data.items || [];channelCursor=null;renderCurrent();el("feed-heading").textContent=data.title;
                    });
                }; root.appendChild(listCard); return;
            }
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
            avatar.textContent = "👤";
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
        el("channel-tabs").hidden = view !== "channel";
        el("upload-date").disabled = view !== "search" || searchKind === "channels";
        var items = view === "history" ? historyItems : view === "search" ? searchItems : view === "channel" ? channelItems : feedItems;
        var busy = view === "search" ? searchBusy : view === "channel" ? channelBusy : view === "home" ? feedBusy : false;
        el("feed").hidden = busy; el("empty-state").classList.toggle("is-loading", busy); paintFilter();
        el("search-reset").hidden = !lastQuery; el("search-form").classList.toggle("has-query", !!lastQuery);
        var count = renderCards(items, el("feed"), true);
        el("empty-state").hidden = !busy && count > 0;
        el("empty-text").textContent = busy ? "Ищем видео…" : items.length && !count ? "В этом фильтре нет видео. Выбери «Все»." : view === "history" ? "Здесь появятся начатые просмотры. История очистится после перезапуска сервера." : "Попробуй поиск, обновление или открой ссылку в диагностике.";
        el("channel-header").hidden = view !== "channel";
        el("search-tabs").hidden = view !== "search";
        el("video-filters").hidden = view === "search" && searchKind === "channels";
        el("search-all").className = "chip" + (searchKind === "all" ? " active" : "");
        el("search-channels").className = "chip" + (searchKind === "channels" ? " active" : "");
        el("load-more").hidden = view === "history" || (busy || !(view === "search" ? searchCursor : view === "channel" ? channelCursor : feedCursor));
    }
    function browserName() {
        var option = el("settings-browser").querySelector('option[value="' + browser + '"]');
        return option ? option.textContent : browser;
    }
    function setView(next) {
        cancelNextVideo();
        resumeWatchActive = false; try { sessionStorage.removeItem("lighttube-resume"); } catch (ignored) {}
        if (next !== view) {
            filter = "all";
            Array.prototype.forEach.call(document.querySelectorAll("[data-filter]"), function (b) { b.className = "chip" + (b.getAttribute("data-filter") === filter ? " active" : ""); });
        }
        if (attached) { setMini(true); recordHistory(false, next === "history"); }
        view = next;
        el("channel-tabs").hidden = next !== "channel";
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
            if (relatedMode !== "author") el("related-status").textContent = error || data.warning || "Рекомендации к этому видео.";
            renderRelated();
            el("retry-related").hidden = !error && relatedItems.length > 0;
            if (relatedMode !== "author" && !error && !relatedItems.length) el("related-status").textContent = data.warning || "YouTube не вернул рекомендации к этому ролику. Можно повторить загрузку.";
        });
    }
    function loadMore(isRelated) {
        var key = isRelated ? (relatedMode === "author" ? authorCursor : relatedCursor) : view === "search" ? searchCursor : view === "channel" ? channelCursor : feedCursor;
        if (!key || (isRelated ? relatedBusy || authorBusy : moreBusy)) return;
        var button = el(isRelated ? "more-related" : "load-more"), generation = epoch, targetView = view, targetMode = relatedMode, context = settingsGeneration;
        button.disabled = true;
        if (isRelated) relatedBusy = true; else moreBusy = true;
        api("GET", "/api/more?cursor=" + encodeURIComponent(key), null, function (error, data) {
            if (context !== settingsGeneration) return;
            button.disabled = false;
            if (isRelated) relatedBusy = false; else moreBusy = false;
            if (isRelated && (generation !== epoch || targetMode !== relatedMode)) return;
            if (!isRelated && targetView !== view) return;
            var notice = el(isRelated ? "related-status" : "feed-status");
            if (error) { notice.textContent = error; return; }
            if (isRelated) {
                if (targetMode === "author") { merge(authorItems, data.items || []); authorCursor = data.cursor || null; }
                else { merge(relatedItems, data.items || []); relatedCursor = data.cursor || null; }
                renderRelated();
            } else {
                if (view === "channel") { decorateAuthor(data.items || [], activeChannel.id, authorProfiles[activeChannel.id] || {title:activeChannel.name,avatar:""}); merge(channelItems, data.items || []); channelCursor = data.cursor || null; }
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
        document.body.classList.add("dialog-open");
        el("settings-modal").setAttribute("data-view", settingsView);
        el("settings-title").textContent = settingsView === "nickname" ? localText("Твой профиль", "Your profile") : settingsView === "profile" ? localText("Сессия YouTube", "YouTube session") : settingsView === "quality" ? localText("Качество и озвучка", "Quality and audio") : localText("Настройки воспроизведения", "Playback settings");
        paintAudioOptions();
        el("video-quality-info").textContent = currentQualityInfo || "Параметры исходного потока появятся после подготовки видео.";
        priorFocus = document.activeElement;
        el("settings-save").textContent = settingsView === "quality" && currentVideo ? "Сохранить для следующих видео" : "Готово";
        el("settings-modal").hidden = false; el("settings-quality").value = String(quality);
        el("settings-browser").value = browser; if (!el("settings-browser").value) el("settings-browser").value = "firefox";
        el("settings-restart").hidden = !currentVideo || settingsView === "profile" || settingsView === "nickname"; el("restart-note").hidden = !currentVideo || settingsView === "profile" || settingsView === "nickname";
        el("settings-status").textContent = ""; el("ask-profile").checked = askProfile;
        el("remember-profile").checked = true;
        if (settingsView === "nickname") { el("nickname").focus(); } else if (settingsView === "profile") { loadProfiles(); el("settings-browser").focus(); } else { el("settings-save").disabled = settingsBusy; el("settings-quality").focus(); }
    }
    function closeSettings() {
        document.body.classList.remove("dialog-open");
        el("settings-modal").hidden = true;
        if (priorFocus && priorFocus.focus) priorFocus.focus();
    }
    function saveSettings(restart) {
        if (settingsView === "nickname") { localPreferences.nickname = el("nickname").value.trim().slice(0,40); updateLocalPreferences(); closeSettings(); return; }
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
            if (video && settingsView !== "profile" && !data.browser_changed) { if (upgrading) queuedSetting = {quality:quality,audio:audioPreference}; else changeQuality(quality, audioPreference); }
        });
    }
    function disconnected() {
        el("offline-screen").hidden = false;
        if (!online) return;
        online = false; stopSession(false, false);
        history = {}; historyItems = []; feedItems = []; searchItems = []; relatedItems = [];
        feedCursor = searchCursor = relatedCursor = null; pendingFeed = null; feedLoaded = false;
        el("apply-feed").hidden = true; renderCurrent();
        message("Связь с сервером потеряна. История сеанса очищена на экране.", true);
        document.querySelector(".connection").classList.add("offline");
    }
    function bootstrap(data) {
        el("offline-screen").hidden = true;
        var changed = serverId !== data.session_id || settingsGeneration !== data.settings_generation;
        serverId = data.session_id; browser = data.browser; quality = data.quality; audioPreference = data.audio || "auto"; paintAudioOptions(); online = true;
        selectedProfile = data.profile || "auto"; askProfile = data.ask_profile !== false; settingsGeneration = data.settings_generation;
        document.querySelector(".connection").classList.remove("offline");
        var select = el("settings-browser"); select.textContent = "";
        (data.browsers || []).forEach(function (item) {
            var option = document.createElement("option"); option.value = item.id; option.textContent = item.name; select.appendChild(option);
        });
        select.value = browser; if (!select.value) { select.value = "firefox"; } el("settings-quality").value = String(quality); el("quality-select").value = String(quality);
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
                searchKind = saved.searchKind === "channels" ? "channels" : "all";
                el("upload-date").value = ["any","hour","today","week","month","year"].indexOf(saved.uploadDate)>=0 ? saved.uploadDate : "any";
                lastQuery = typeof saved.query === "string" ? saved.query.slice(0, 160) : ""; el("search-query").value = lastQuery;
                filter = ["all", "watched"].indexOf(saved.filter) >= 0 ? saved.filter : "all";
            }
            if (prompt) { refreshFeed(false, false); showSettings(); }
            else if (valid && saved.view === "search" && lastQuery) { view = "search"; el("search-form").dispatchEvent(submitEvent()); }
            else if (valid && saved.view === "channel" && saved.channel) openChannel(saved.channel.id, saved.channel.name);
            else if (valid && saved.view === "history") setView("history");
            else refreshFeed(false, false);
            restoringUI = false; renderCurrent();
            try {
                var resume = JSON.parse(sessionStorage.getItem("lighttube-resume") || "null");
                if (resume && resume.server === serverId && resume.context === settingsGeneration && resume.id) {
                    pendingResume = resume.position || 0;
                    openVideo("https://www.youtube.com/watch?v=" + resume.id, true);
                }
            } catch (ignored) {}
            message(prompt ? "Выбери профиль для просмотра." : "Сервер готов. Выбери видео.", false);
        }
    }
    function heartbeat() {
        if (heartbeatBusy) return;
        heartbeatBusy = true;
        api("GET", "/api/session", null, function (error, data) {
            heartbeatBusy = false;
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
    ["inside-track"].forEach(function (id) {
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
    function stop() { stopSession(true); message("", false); }
    el("close").addEventListener("click", function () { resumeWatchActive = false; sessionStorage.removeItem("lighttube-resume"); });
    el("close").onclick = stop; el("stop").onclick = stop; el("mini-close").onclick = stop;
    el("mute").onclick = function () { player.muted = !player.muted; draw(); };
    el("minimize").onclick = function () { setMini(true); };
    el("mini-restore").onclick = function () { setMini(false); };
    function unlockOrientation() { try { if (screen.orientation && screen.orientation.unlock) screen.orientation.unlock(); } catch (error) {} }
    function requestLandscape() {
        try {
            if (screen.orientation && screen.orientation.lock) {
                var result = screen.orientation.lock("landscape");
                if (result && result.catch) result.catch(function () { message("Поверни телефон горизонтально; проверь автоповорот экрана.", false); });
            }
        } catch (error) {}
    }
    el("fullscreen").onclick = function () {
        var frame = el("video-frame"), fn, target;
        if (document.fullscreenElement || document.webkitFullscreenElement) {
            fn = document.exitFullscreen || document.webkitExitFullscreen;
            if (fn) fn.call(document); unlockOrientation(); return;
        }
        setMini(false); fn = frame.requestFullscreen || frame.webkitRequestFullscreen; target = frame;
        if (!fn && player.webkitEnterFullscreen) { fn = player.webkitEnterFullscreen; target = player; }
        if (!fn) { message("Браузер не поддерживает полный экран. Поверни телефон горизонтально.", true); return; }
        try {
            var result = fn.call(target);
            if (result && result.then) result.then(requestLandscape).catch(function () { message("Браузер отклонил полный экран.", true); });
            else requestLandscape();
        } catch (error) { message("Не удалось открыть полный экран в этом браузере.", true); }
    };
    ["fullscreenchange", "webkitfullscreenchange"].forEach(function (name) {
        document.addEventListener(name, function () { if (!document.fullscreenElement && !document.webkitFullscreenElement) unlockOrientation(); });
    });
    player.addEventListener("webkitendfullscreen", unlockOrientation);
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
        searchBusy = true; var requestedKind = searchKind, context = settingsGeneration, button = this.querySelector("button"); button.disabled = true;
        setView("search"); rememberUI(false); el("feed-status").textContent = "Ищем «" + query + "»…";
        api("GET", "/api/search?q=" + encodeURIComponent(query) + (searchKind === "channels" ? "&type=channels" : "&date=" + el("upload-date").value), null, function (error, data) {
            button.disabled = false; if (context !== settingsGeneration) return;
            searchBusy = false; if (view !== "search" || requestedKind !== searchKind) return;
            if (error) { renderCurrent(); el("feed-status").textContent = error; return; }
            searchItems = data.items || []; searchCursor = data.cursor || null; renderCurrent();
            el("feed-status").textContent = data.warning || (searchKind === "channels" ? "Найдено каналов: " : "Найдено: ") + searchItems.length;
        });
    };
    el("description-toggle").onclick = function () { var expanded = el("description-box").classList.toggle("expanded"); this.textContent = expanded ? "Свернуть" : "…ещё"; };
    ["all", "author", "unwatched"].forEach(function (mode) { el("related-" + mode).onclick = function () { selectRelated(mode); }; });
    ["all", "channels"].forEach(function (kind) { el("search-" + kind).onclick = function () { if (searchBusy || kind === searchKind) return; searchKind = kind; filter = "all"; paintFilter(); el("search-form").dispatchEvent(submitEvent()); }; });
    document.addEventListener("click", function (event) { if (!el("player-menu").contains(event.target) && !el("player-settings").contains(event.target)) closePlayerMenu(); });
    document.addEventListener("keydown", function (event) {
        if (el("player-menu").hidden) return;
        if (event.keyCode === 27) { event.preventDefault(); closePlayerMenu(); el("player-settings").focus(); }
        if (event.keyCode === 38 || event.keyCode === 40) { var nodes = Array.prototype.slice.call(el("player-menu").querySelectorAll("button")), index = nodes.indexOf(document.activeElement); event.preventDefault(); nodes[(index + (event.keyCode === 40 ? 1 : nodes.length - 1)) % nodes.length].focus(); }
    });
    el("brand-home").onclick = function (event) { event.preventDefault(); setView("home"); if (!feedLoaded) refreshFeed(false, false); };
    el("search-reset").onclick = function () { lastQuery = ""; el("search-query").value = ""; searchItems = []; searchCursor = null; hideSuggestions(); setView("home"); rememberUI(false); if (!feedLoaded) refreshFeed(false, false); el("search-query").focus(); };
    el("nav-home").onclick = function () { setView("home"); if (!feedLoaded) refreshFeed(false, false); };
    el("nav-history").onclick = function () { setView("history"); };
    el("nav-diagnostics").onclick = function () { var panel = el("diagnostic-panel"); panel.open = !panel.open; if (panel.open) panel.scrollIntoView(true); };
    el("loading-cancel").onclick = function () { stopSession(true); message("Подготовка остановлена.", false); };
    el("loading-action").onclick = function () { if (this.getAttribute("data-mode") === "error") openVideo(loadingUrl, retryFullQuality); else play(); };
    el("account-profile").onclick = function () { showSettings("nickname"); };
    el("replay-intro").onclick = function () { closeSettings(); if(window.LightTubeWelcome)window.LightTubeWelcome.show(localPreferences.nickname || "viewer"); };
    el("browser-session-settings").onclick = function () { showSettings("profile"); };
    el("retry-related").onclick = function () { if (relatedMode === "author") { authorVideo = null; selectRelated("author"); } else if (relatedVideo) loadRelated(relatedVideo); };
    el("settings-browser").onchange = loadProfiles;
    el("global-settings").onclick = function () { showSettings("general"); }; el("player-settings").onclick = function () { if (el("player-menu").hidden) showPlayerMenu("root"); else closePlayerMenu(); }; el("nav-settings").onclick = function () { showSettings("general"); };
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
    player.addEventListener("error", function () { if (attached && player.error) {
        try { var reports = JSON.parse(sessionStorage.getItem("lighttube-hls-errors") || "[]"); reports.push({type:"mediaElementError",details:/(?:^|[?&])native_hls=1(?:&|$)/.test(location.search) ? "nativePlaybackError" : "playerDecodeError",mode:deliveryMode,mediaErrorCode:player.error.code,position:Math.round(player.currentTime || 0)}); sessionStorage.setItem("lighttube-hls-errors",JSON.stringify(reports.slice(-20))); } catch (ignored) {}
 if (deliveryMode === "mp4" && !deliveryFallback) { fallbackToHls(); return; } playbackError = true; message("Ошибка плеера " + player.error.code + ": " + player.error.message, true); } });
    player.addEventListener("timeupdate", function () {
        if (currentVideo && attached && resumeWatchActive && !minimized) { try { sessionStorage.setItem("lighttube-resume",JSON.stringify({server:serverId,context:settingsGeneration,id:currentVideo.id,position:player.currentTime})); } catch (ignored) {} }
        if (preview && !preview.held && player.currentTime >= 3) holdPreview();
        if (attached && (Date.now() - lastHistorySave > 15000 || (currentVideo && !history[currentVideo.id] && player.currentTime >= 1 && Date.now() - lastHistorySave > 1000))) { lastHistorySave = Date.now(); recordHistory(false, false); }
    });
    player.addEventListener("ended", function () {
        if (!session || endedFor === session) return;
        endedFor = session; recordHistory(true, true);
        if (el("autoplay-next").checked) {
            var next = relatedItems.filter(function (item) { return item.id && currentVideo && item.id !== currentVideo.id && !isSeen(item); })[0];
            if (next) { startNextVideo(next); return; }
        } message("Просмотр завершён. Ролик сохранён в истории сеанса.", false); refreshFeed(true, true);
    });
    ["timeupdate", "progress", "loadedmetadata", "seeking", "seeked", "emptied", "pause", "play", "volumechange"].forEach(function (name) { player.addEventListener(name, draw); });
    document.addEventListener("keydown", function (event) {
        if (event.keyCode === 27 && !el("up-next").hidden) { cancelNextVideo(); return; }
        if (!attached || !el("settings-modal").hidden || !el("player-menu").hidden || event.ctrlKey || event.altKey || event.metaKey || event.defaultPrevented) return;
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
    if (!window.LightTubeWelcome) { el("welcome").hidden = false; setTimeout(function(){el("welcome").hidden=true;},2200); }
    var controlsTimer = null, controlsDragging = false, controlsKeyboard = false;
    function wakeControls() {
        el("video-frame").classList.remove("controls-idle");
        clearTimeout(controlsTimer);
        controlsTimer = setTimeout(function hideControls() {
            if (!attached || player.paused || player.ended || controlsDragging ||
                !el("player-menu").hidden || !el("up-next").hidden || !el("loading-panel").hidden ||
                (controlsKeyboard && el("video-frame").contains(document.activeElement))) {
                controlsTimer = setTimeout(hideControls, 1000); return;
            }
            el("video-frame").classList.add("controls-idle");
        }, 3000);
    }
    ["mousemove","pointerdown","touchstart"].forEach(function(name) {
        el("video-frame").addEventListener(name,function(){controlsKeyboard=false;wakeControls();},{passive:true});
    });
    el("video-frame").addEventListener("pointerdown",function(){controlsDragging=true;});
    window.addEventListener("pointerup",function(){controlsDragging=false;wakeControls();});
    el("video-frame").addEventListener("pointercancel",function(){controlsDragging=false;wakeControls();});
    el("video-frame").addEventListener("keydown",function(){controlsKeyboard=true;wakeControls();});
    ["playing","pause","ended","waiting"].forEach(function(name){player.addEventListener(name,wakeControls);});
    draw(); heartbeat(); setInterval(heartbeat, 15000);
}());
