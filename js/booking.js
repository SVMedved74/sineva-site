/* Онлайн-запись без сервера: клиент выбирает услугу, день и время,
   а заявка открывается готовым сообщением в Telegram или WhatsApp мастера.
   Всё, что нужно поменять под Анну, — в блоке НАСТРОЙКИ. */
(function () {
  'use strict';

  /* ===== НАСТРОЙКИ ===== */
  var CONFIG = {
    telegram: '',            // ник без @, например 'anna_brows'. Пусто — кнопка покажет пометку черновика
    whatsapp: '',            // номер только цифрами, например '79001234567'
    workDays: [1, 2, 3, 4, 5, 6], // 0 — вс, 1 — пн … 6 — сб
    open: '10:00',
    close: '20:00',
    step: 30,                // шаг сетки времени, минут
    daysAhead: 21,           // на сколько дней вперёд открыта запись
    minLeadMinutes: 120,     // не раньше чем через 2 часа от текущего момента
    closedDates: [],         // выходные и отпуск: ['2026-10-12', '2026-10-13']
    busy: {}                 // занятые окна: { '2026-10-07': ['10:00', '13:30'] }
  };

  // Услуги: цены и длительность — ЗАГЛУШКА, уточнить у Анны
  var SERVICES = [
    { id: 'arch', name: 'Архитектура бровей', note: 'коррекция формы + окрашивание', min: 60, price: 2000 },
    { id: 'lam', name: 'Ламинирование бровей', note: 'с окрашиванием и коррекцией', min: 75, price: 2800 },
    { id: 'corr', name: 'Коррекция формы', note: 'воск или пинцет', min: 40, price: 1200 },
    { id: 'lash', name: 'Ламинирование ресниц', note: 'с окрашиванием и ботоксом', min: 75, price: 2500 },
    { id: 'tint', name: 'Окрашивание ресниц', note: 'краска', min: 20, price: 700 },
    { id: 'combo', name: 'Комплекс «брови + ресницы»', note: 'ламинирование того и другого', min: 120, price: 4800 }
  ];
  /* ===================== */

  var $ = function (id) { return document.getElementById(id); };
  var WD = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  var MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
  var MON_FULL = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
  var WD_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

  var state = { service: null, date: null, time: null };

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function key(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function toMin(t) { var p = t.split(':'); return +p[0] * 60 + +p[1]; }
  function toTime(m) { return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  function rub(n) { return n.toLocaleString('ru-RU') + ' ₽'; }
  function dur(m) { var h = Math.floor(m / 60), r = m % 60; return (h ? h + ' ч' : '') + (h && r ? ' ' : '') + (r ? r + ' мин' : ''); }

  function option(name, value, html, disabled) {
    var label = document.createElement('label');
    label.className = 'opt';
    var input = document.createElement('input');
    input.type = 'radio';
    input.name = name;
    input.value = value;
    input.disabled = !!disabled;
    var box = document.createElement('span');
    box.className = 'opt__box';
    box.innerHTML = html;
    label.appendChild(input);
    label.appendChild(box);
    return label;
  }

  /* ---------- Прайс в блоке «Услуги» (из того же списка) ---------- */
  var priceList = $('price-list');
  SERVICES.forEach(function (s) {
    var li = document.createElement('li');
    li.innerHTML = '<span class="price__name"></span><span class="price__dots"></span><span class="price__cost"></span>';
    li.children[0].textContent = s.name;
    var small = document.createElement('small');
    small.textContent = s.note + ' · ' + dur(s.min);
    li.children[0].appendChild(small);
    li.children[2].textContent = rub(s.price);
    priceList.appendChild(li);
  });

  /* ---------- Шаг 1: услуга ---------- */
  var svcBox = $('b-services');
  SERVICES.forEach(function (s) {
    var html = '<span class="svc__name"></span><span class="svc__meta"><span>' + dur(s.min) + '</span><span class="svc__price">' + rub(s.price) + '</span></span>';
    var opt = option('service', s.id, html);
    opt.querySelector('.svc__name').textContent = s.name;
    svcBox.appendChild(opt);
  });
  svcBox.addEventListener('change', function (e) {
    state.service = SERVICES.filter(function (s) { return s.id === e.target.value; })[0];
    $('step-date').disabled = false;
    renderDays();
    renderTimes();
    update();
  });

  /* ---------- Шаг 2: день ---------- */
  function freeSlots(dateKey) {
    if (!state.service) return [];
    var d = new Date(dateKey + 'T00:00:00');
    if (CONFIG.workDays.indexOf(d.getDay()) === -1 || CONFIG.closedDates.indexOf(dateKey) !== -1) return [];
    var now = new Date();
    var earliest = now.getTime() + CONFIG.minLeadMinutes * 60000;
    var busy = (CONFIG.busy[dateKey] || []).map(toMin);
    var out = [];
    for (var m = toMin(CONFIG.open); m + state.service.min <= toMin(CONFIG.close); m += CONFIG.step) {
      var start = new Date(d.getTime() + m * 60000);
      if (start.getTime() < earliest) continue;
      // занятое окно считаем длиной в шаг сетки и не даём новой записи на него наложиться
      var clash = busy.some(function (b) { return m < b + CONFIG.step && b < m + state.service.min; });
      if (!clash) out.push(toTime(m));
    }
    return out;
  }

  function renderDays() {
    var box = $('b-days');
    box.textContent = '';
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    var keepSelected = false;
    for (var i = 0; i < CONFIG.daysAhead; i++) {
      var d = new Date(today);
      d.setDate(today.getDate() + i);
      var k = key(d);
      var has = freeSlots(k).length > 0;
      var label = i === 0 ? 'сегодня' : i === 1 ? 'завтра' : WD[d.getDay()];
      var opt = option('day', k, '<span class="day__wd">' + label + '</span><span class="day__num">' + d.getDate() + '</span><span class="day__mon">' + MON[d.getMonth()] + '</span>', !has);
      if (k === state.date && has) { opt.querySelector('input').checked = true; keepSelected = true; }
      box.appendChild(opt);
    }
    if (!keepSelected) state.date = null;
  }
  $('b-days').addEventListener('change', function (e) {
    state.date = e.target.value;
    state.time = null;
    renderTimes();
    update();
  });

  /* ---------- Шаг 3: время ---------- */
  function renderTimes() {
    var box = $('b-times');
    box.textContent = '';
    $('step-time').disabled = !state.date;
    if (!state.date) {
      box.innerHTML = '<p class="muted">Сначала выберите день.</p>';
      state.time = null;
      return;
    }
    var slots = freeSlots(state.date);
    if (slots.indexOf(state.time) === -1) state.time = null;
    slots.forEach(function (t) {
      var opt = option('time', t, t);
      if (t === state.time) opt.querySelector('input').checked = true;
      box.appendChild(opt);
    });
  }
  $('b-times').addEventListener('change', function (e) {
    state.time = e.target.value;
    $('step-name').disabled = false;
    update();
  });

  /* ---------- Шаг 4 и итог ---------- */
  $('b-name').addEventListener('input', update);
  $('b-comment').addEventListener('input', update);

  function dateText(k) {
    var d = new Date(k + 'T00:00:00');
    return d.getDate() + ' ' + MON_FULL[d.getMonth()] + ', ' + WD_FULL[d.getDay()];
  }

  function message() {
    var s = state.service;
    var lines = ['Здравствуйте, Анна! Хочу записаться:',
      s.name + ' (' + rub(s.price) + ', ' + dur(s.min) + ')',
      dateText(state.date) + ', ' + state.time,
      'Имя: ' + $('b-name').value.trim()];
    var c = $('b-comment').value.trim();
    if (c) lines.push('Комментарий: ' + c);
    return lines.join('\n');
  }

  function ready() { return state.service && state.date && state.time && $('b-name').value.trim(); }

  function update() {
    var text = $('b-summary-text');
    var ok = ready();
    $('b-tg').disabled = !ok;
    $('b-wa').disabled = !ok;
    $('step-name').disabled = !state.time;
    if (!state.service) {
      text.textContent = 'Выберите услугу, день и время — здесь появится ваша запись.';
      return;
    }
    text.innerHTML = '';
    var b = document.createElement('b');
    b.textContent = state.service.name;
    text.appendChild(b);
    var rest = ' · ' + rub(state.service.price);
    if (state.date) rest += ' · ' + dateText(state.date);
    if (state.time) rest += ', ' + state.time;
    text.appendChild(document.createTextNode(rest));
    if (state.time && !$('b-name').value.trim()) text.appendChild(document.createTextNode('. Осталось указать имя.'));
  }

  function notConnected() {
    var note = $('b-note');
    note.classList.add('is-warn');
    note.textContent = 'Черновик: мессенджеры Анны ещё не подключены. Так будет выглядеть заявка — «' + message().replace(/\n/g, ' · ') + '»';
  }

  $('b-tg').addEventListener('click', function () {
    if (!ready()) return;
    if (!CONFIG.telegram) return notConnected();
    window.open('https://t.me/' + CONFIG.telegram + '?text=' + encodeURIComponent(message()), '_blank', 'noopener');
  });
  $('b-wa').addEventListener('click', function () {
    if (!ready()) return;
    if (!CONFIG.whatsapp) return notConnected();
    window.open('https://wa.me/' + CONFIG.whatsapp + '?text=' + encodeURIComponent(message()), '_blank', 'noopener');
  });

  document.querySelectorAll('.todo-link').forEach(function (a) {
    a.addEventListener('click', function (e) { e.preventDefault(); });
  });

  // Если выбор услуги сохранился после перезагрузки страницы
  var pre = svcBox.querySelector('input:checked');
  if (pre) pre.dispatchEvent(new Event('change', { bubbles: true }));
  renderDays();
})();
