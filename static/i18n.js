(function () {
"use strict";
var pairs = [
["Настройки воспроизведения","Playback settings"],["Авто · до 1080p","Auto · up to 1080p"],["Сохранено","Saved"],["Нажми ▶ для просмотра.","Press ▶ to play."],["Главная","Home"],["История","History"],["Настройки","Settings"],["Диагностика","Diagnostics"],["Все","All"],["Просмотренные","Watched"],["Каналы","Channels"],["Рекомендации","Recommendations"],["Видео канала","Channel videos"],
["Сессия YouTube на сервере","YouTube session on the server"],["Браузер на серверном ПК","Browser on the server PC"],["Профиль браузера","Browser profile"],["Автоматически","Automatic"],["Готово","Done"],["Сохранить для следующих видео","Save for future videos"],["Применить к этому видео","Apply to this video"],["Имя профиля LightTube","LightTube nickname"],["Твой никнейм","Your nickname"],["Твой профиль","Your profile"],
["Оригинальная дорожка","Original audio"],["Авто · дорожка YouTube","Auto · YouTube audio"],["Озвучка","Audio"],["Качество","Quality"],["Скорость","Speed"],["Скорость воспроизведения","Playback speed"],["Обычная","Normal"],["Русский","Russian"],
["Быстрый старт с низкого качества","Start with a low-quality preview"],["Спрашивать профиль на незнакомом устройстве","Ask for the browser profile on a new device"],["Запомнить подтверждение на этом устройстве на 30 дней","Remember this device for 30 days"],
["Далее · рекомендации к этому видео","Up next · related videos"],["Автор","Creator"],["Повторить загрузку рекомендаций","Retry related videos"],["Показать ещё","Show more"],["Повторить","Retry"],["Закрыть","Close"],["Свернуть","Show less"],["…ещё","…more"],["Описание отсутствует.","No description available."],["Воспользуйся поиском.","Use search to find videos."],
["Проверить совместимость устройства","Check device compatibility"],["Видео подготовлено.","Video is ready."],["Воспроизведение через LightTube.","Playing with LightTube."],["Сервер готов. Выбери видео.","Server is ready. Choose a video."],["Лента обновлена.","Recommendations updated."],["Получаем адреса видео и звука…","Getting video and audio streams…"],["Буферизация…","Buffering…"],["Открываем видео…","Opening video…"],["Сервер недоступен","Server unavailable"],["Включи LightTube на ПК и проверь подключение к сети.","Start LightTube on your PC and check the network connection."],["Повторить попытку","Try again"],
["Предпочтение применяется ко всем следующим видео, пока ты его не изменишь. Доступны только дорожки, предоставленные YouTube; озвучка не генерируется.","Your preference applies to future videos until changed. Only audio tracks provided by YouTube are available; no dubbing is generated."],
["Браузер, профиль, качество и язык озвучки сохраняются на сервере и используются без повторного выбора. При смене профиля поток останавливается, а общая история LightTube очищается.","Browser session, quality and audio preferences are saved on the server. Changing the browser profile stops playback and clears shared session history."],
["Текущее видео продолжится с той же позиции после подготовки нового качества.","Playback resumes at the same position when the new stream is ready."],
["Параметры исходного потока появятся после подготовки видео.","Stream details appear when the video is ready."],
["Если доступен готовый MP4 до 360p, покажем первые 3 секунды, одновременно готовя выбранное качество. Если основной поток ещё не готов, появится индикатор загрузки. Иначе сразу запустим выбранное качество. Переключение может ненадолго прервать воспроизведение.","When a compatible MP4 preview is available, play up to 3 seconds while preparing the selected quality. Playback may briefly pause during the switch."],
["Выбирается лучший совместимый поток до лимита. Его фактическое разрешение может отличаться из-за обрезки или пропорций ролика; оно видно в диагностике. При применении к видео новый поток готовится в фоне, затем просмотр продолжается с текущей позиции. Возможна короткая пауза.","Select the best compatible stream up to the limit. Actual dimensions depend on the video aspect ratio. Stream changes prepare in the background and resume at the current position."],
["Для чтения сессии YouTube поддерживаем в этой бета-версии Firefox. Войди в YouTube через Firefox на серверном ПК. Сам LightTube можно открывать в любом совместимом браузере, включая Chrome. Чтение cookies Chrome/Edge на Windows исключено из обычного выбора из-за ошибок расшифровки. Работа Firefox также зависит от профиля и ограничений YouTube. Без cookies персональные рекомендации могут быть недоступны.","This beta supports Firefox for reading the YouTube session on the server PC. Open LightTube in any compatible browser, including Chrome. Chrome/Edge cookie extraction is hidden because Windows may prevent decryption. Firefox access also depends on the selected profile and YouTube restrictions. Personalized recommendations may be unavailable without cookies."],
["Если выключить, выбранный профиль будет использоваться по умолчанию. Переключиться можно через значок LT. Выбор общий для устройств сервера; почта в списке не отображается.","When disabled, use the selected browser profile by default. Change it in Settings → YouTube session. This selection is shared by server clients; email addresses are hidden."],
["Сохраняется только браузер и номер профиля. Cookies аккаунта YouTube в этот браузер не передаются.","Only the browser and profile identifier are remembered. YouTube cookies are not sent to this client."],
["Firefox · рекомендуем","Firefox · recommended"],["Без cookies · доступ может быть ограничен","No cookies · access may be limited"],
["Введите запрос","Search videos"],["Поиск видео","Search videos"],["Найти","Search"],["Закрыть настройки","Close settings"],["Выбрать профиль","Your profile"],["Выбрать профиль браузера","Your profile"],["Качество и озвучка","Quality and audio"]
];
pairs = pairs.concat([
["YouTube не вернул данные. Проверь соединение, версию yt-dlp и доступ к ролику в выбранном браузере.","YouTube returned no data. Check your connection, yt-dlp version and access in the selected server browser."],
["Попробуй поиск, обновление или открой ссылку в диагностике.","Try searching, refresh recommendations, or open a video link in Diagnostics."],
["Не удалось прочитать сессию выбранного браузера. Закрой его перед повтором. На Windows Chrome/Edge могут запрещать расшифровку cookies; попробуй Firefox.","Could not read the selected browser session. Close it and retry. Windows may prevent Chrome/Edge cookie decryption; try Firefox."],
["Рекомендации не загружены.","Recommendations have not loaded."],["Нет связи с сервером.","Cannot connect to the server."],
["Не удалось получить рекомендации.","Could not load recommendations."],["Загружаем рекомендации…","Loading recommendations…"],
["Новые рекомендации не появились.","No new recommendations yet."],["Есть новые рекомендации — показать","New recommendations available — show"],
["Авто","Auto"],["Максимальное качество","Maximum quality"],["Канал","Channel"],["Смотреть","Watch"],["Поиск","Search"],
["Найдено профилей: 2. Почта скрыта. Выбор не гарантирует доступ к cookies Chrome.","2 profiles found. Email addresses are hidden. Profile selection does not guarantee cookie access."],

["Фильтры","Filters"],["Видео","Videos"],["Трансляции","Live"],["Плейлисты","Playlists"],["Следующее видео","Up next"],["Отменить","Cancel"],["Продолжить","Continue"],["Отмена","Cancel"],
["Готовим первые фрагменты…","Preparing the first segments…"],["Получаем видео…","Loading video…"],["Подготавливаем видео…","Preparing video…"],["В этом фильтре нет видео. Выбери «Все».","No videos match this filter. Select All."],["Добавлены следующие видео.","More videos loaded."],
["Из сессии браузера на ПК","From the browser session on your PC"],["Рекомендации к ролику появятся здесь. Сначала получаем адреса видео…","Related videos appear here once the video is prepared."],
["Рекомендации к этому ролику.","Related videos."],["Нажми ▶ для просмотра.","Press ▶ to play."],["Нажми «Пуск / Пауза» для просмотра.","Press Play to start."],["Просмотр завершён. Ролик сохранён в истории сеанса.","Playback finished. The video is saved in session history."],
["Подготовка остановлена.","Preparation cancelled."],["Готовый MP4 через ПК. Загружаем первые кадры…","MP4 stream ready. Loading the first frames…"],
["Готовим выбранное качество. Текущее видео продолжает играть…","Preparing the selected stream. Current playback continues…"],["Переключаем качество…","Switching streams…"],
["Качество и озвучка","Quality and audio"],["Открыть канал","Open channel"],["Канал не указан","Unknown channel"],["История сеанса","Session history"],["Результаты поиска","Search results"],["Поиск YouTube","YouTube search"],["В памяти сервера · до перезапуска","Stored in server memory until restart"],
["Выбери видео.","Choose a video."],["Выбери профиль для просмотра.","Choose a browser profile to continue."],["Обложка недоступна","Thumbnail unavailable"],["Профиль и настройки сохранены.","Profile and settings saved."],
["Запросы к YouTube временно приостановлены. Попробуй позже.","YouTube requests are temporarily paused. Try again later."],
["История общая для устройств этого сервера. После его перезапуска она исчезнет.","History is shared by clients of this server and cleared when it restarts."],
["Полная история аккаунта YouTube не загружается.","YouTube account history is not imported."]
]);
pairs=pairs.concat([["Музыка", "Music"], ["Подписки", "Subscriptions"], ["Плейлисты", "Playlists"], ["Видео", "Videos"], ["Фильтры поиска", "Search filters"], ["Тип", "Type"], ["Продолжить просмотр", "Continue watching"], ["Очистить", "Clear"], ["На этом устройстве · до 24 часов", "On this device · up to 24 hours"], ["Фото профиля · до 10 МБ", "Profile photo · up to 10 MB"], ["Удалить фото", "Remove photo"], ["Заставка", "Intro animation"], ["Поиск и логотип", "Search and logo"], ["Плавная анимация", "Gentle animation"], ["Без заставки", "No intro"], ["Звук заставки", "Intro sound"], ["Для звука браузер может потребовать нажатие на заставку.", "Your browser may require a tap on the intro to enable sound."], ["Отмечать досмотренные видео в истории YouTube", "Mark completed videos watched on YouTube"], ["Используется аккаунт выбранного браузера на сервере. Может влиять на рекомендации YouTube; результат зависит от настроек истории аккаунта.", "Uses the account of the selected browser on the server. This may influence YouTube recommendations, depending on the account history settings."], ["Сегодня", "Today"], ["За эту неделю", "This week"], ["За этот месяц", "This month"], ["За этот год", "This year"], ["Дата загрузки", "Upload date"], ["Любая дата", "Any time"]]);
pairs.push(["Цветные точки","Color dots"]);
var ru={},en={};pairs.forEach(function(p){ru[p[0]]=p[1];en[p[1]]=p[0];});
function translate(text,english) { if (typeof text !== "string" || !text) return text; var match=/^(\s*)([\s\S]*?)(\s*)$/.exec(text); if (!match) return text; var value=match[2];return match[1]+((english?ru:en)[value]||value)+match[3]; }
var queued=false;
function apply() {
queued=false;var english=document.documentElement.lang==="en";
var walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT,null),node;
while((node=walker.nextNode())) {
 if (/^(SCRIPT|STYLE)$/.test(node.parentNode.tagName)) continue;
 var value=translate(node.nodeValue,english); if(value!==node.nodeValue)node.nodeValue=value;
}
Array.prototype.forEach.call(document.querySelectorAll("[title],[aria-label],[placeholder]"),function(n){
 ["title","aria-label","placeholder"].forEach(function(a){if(n.hasAttribute(a)){var old=n.getAttribute(a),v=translate(old,english);if(v!==old)n.setAttribute(a,v);}});
});
}
function schedule(){if(!queued){queued=true;setTimeout(apply,0);}}
new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true,characterData:true});
new MutationObserver(schedule).observe(document.documentElement,{attributes:true,attributeFilter:["lang"]});
apply();
}());
