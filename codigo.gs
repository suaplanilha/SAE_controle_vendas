/** SAE Controle de Vendas — backend Google Apps Script V8. */
const CONFIG = Object.freeze({
  SPREADSHEET_ID: '1b6EtE3NHfsO3BgcX6OwB8vj90QzgtYPLJt4rXgoZ8z0',
  SHEET_NAME: 'Leo_bd',
  TIMEZONE: 'America/Sao_Paulo',
  HEADERS: ['UUID', 'data', 'horario_inicio', 'horario_fim', 'valor', 'pedido'],
  PAGE_SIZE: 20
});

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('SAE — Controle de Vendas')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function getSpreadsheet_() {
  const id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID') || CONFIG.SPREADSHEET_ID;
  return SpreadsheetApp.openById(id);
}

function getSheet_() {
  const sheet = getSpreadsheet_().getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) throw new Error('A aba "' + CONFIG.SHEET_NAME + '" não foi encontrada.');
  const actual = sheet.getRange(1, 1, 1, CONFIG.HEADERS.length).getDisplayValues()[0];
  if (actual.join('|').toLowerCase() !== CONFIG.HEADERS.join('|').toLowerCase()) {
    throw new Error('Cabeçalho inválido em ' + CONFIG.SHEET_NAME + '. Esperado: ' + CONFIG.HEADERS.join(' | '));
  }
  return sheet;
}

function ok_(data, meta) { return { ok: true, data: data, meta: meta || {} }; }
function fail_(code, message, details) { return { ok: false, error: { code: code, message: message, details: details || null } }; }

function safeCall_(fn) {
  try { return fn(); }
  catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return fail_('SERVER_ERROR', 'Não foi possível concluir a operação. Tente novamente.');
  }
}

function isoDate_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, CONFIG.TIMEZONE, 'yyyy-MM-dd');
  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  return isNaN(parsed.getTime()) ? '' : Utilities.formatDate(parsed, CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

function timeText_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return Utilities.formatDate(value, CONFIG.TIMEZONE, 'HH:mm');
  const text = String(value || '').trim();
  const match = text.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return '';
  return String(Number(match[1])).padStart(2, '0') + ':' + match[2];
}

function normalizeOrder_(input, requireUuid) {
  input = input || {};
  const order = {
    uuid: String(input.uuid || '').trim(),
    data: isoDate_(input.data),
    horario_inicio: timeText_(input.horario_inicio),
    horario_fim: timeText_(input.horario_fim),
    valor: Number(String(input.valor == null ? '' : input.valor).replace(',', '.')),
    pedido: String(input.pedido == null ? '' : input.pedido).trim().replace(/\s+/g, ' '),
    confirmDuplicate: input.confirmDuplicate === true
  };
  const errors = {};
  if (requireUuid && !order.uuid) errors.uuid = 'UUID obrigatório.';
  if (!order.data) errors.data = 'Informe uma data válida.';
  if (!order.horario_inicio) errors.horario_inicio = 'Informe a hora inicial.';
  if (!order.horario_fim) errors.horario_fim = 'Informe a hora final.';
  if (order.horario_inicio && order.horario_fim && order.horario_inicio >= order.horario_fim) errors.horario_fim = 'A hora final deve ser posterior à inicial.';
  if (!Number.isFinite(order.valor) || order.valor < 0) errors.valor = 'Informe um valor válido maior ou igual a zero.';
  if (!order.pedido) errors.pedido = 'Informe o número do pedido.';
  if (Object.keys(errors).length) return { valid: false, errors: errors };
  return { valid: true, order: order };
}

function readOrders_() {
  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, CONFIG.HEADERS.length).getValues().map(function(row, index) {
    return {
      uuid: String(row[0] || ''), data: isoDate_(row[1]), horario_inicio: timeText_(row[2]),
      horario_fim: timeText_(row[3]), valor: Number(row[4]) || 0, pedido: row[5] == null ? '' : String(row[5]),
      _row: index + 2
    };
  }).filter(function(item) { return item.uuid && item.data; });
}

function distinctCount_(rows) {
  return new Set(rows.map(function(row) { return row.pedido.trim().toLocaleUpperCase('pt-BR'); })
    .filter(function(pedido) { return pedido !== ''; })).size;
}
function sum_(rows) { return rows.reduce(function(total, row) { return total + row.valor; }, 0); }
function monthOf_(date) { return date.slice(0, 7); }
function yearOf_(date) { return date.slice(0, 4); }
function slotOf_(row) { return row.horario_inicio + ' – ' + row.horario_fim; }
function addDays_(iso, days) {
  const parts = iso.split('-').map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + days, 12));
  return Utilities.formatDate(date, 'UTC', 'yyyy-MM-dd');
}
function nowIso_() { return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'yyyy-MM-dd'); }
function nowTime_() { return Utilities.formatDate(new Date(), CONFIG.TIMEZONE, 'HH:mm'); }
function hasSlot_(row, slot) { return !slot || slot === 'ALL' || slotOf_(row) === slot; }

function group_(rows, keyFn) {
  const map = {};
  rows.forEach(function(row) {
    const key = keyFn(row);
    if (!map[key]) map[key] = [];
    map[key].push(row);
  });
  return map;
}
function series_(map, type) {
  return Object.keys(map).sort().map(function(key) {
    return { label: key, value: type === 'revenue' ? sum_(map[key]) : distinctCount_(map[key]) };
  });
}
function lastMonths_(contextMonth) {
  const parts = contextMonth.split('-').map(Number);
  const result = [];
  for (let offset = 11; offset >= 0; offset--) {
    const d = new Date(Date.UTC(parts[0], parts[1] - 1 - offset, 1));
    result.push(Utilities.formatDate(d, 'UTC', 'yyyy-MM'));
  }
  return result;
}
function fillMonths_(rows, months, type) {
  const grouped = group_(rows, function(row) { return monthOf_(row.data); });
  return months.filter(function(month) { return Boolean(grouped[month]); }).map(function(month) {
    return { label: month, value: type === 'revenue' ? sum_(grouped[month]) : distinctCount_(grouped[month]) };
  });
}

function buildDashboard_(orders, filters) {
  const today = nowIso_();
  const selectedDate = isoDate_(filters.day) || today;
  const selectedMonth = /^\d{4}-\d{2}$/.test(String(filters.month || '')) ? filters.month : monthOf_(selectedDate);
  const selectedYear = selectedMonth.slice(0, 4);
  const slot = String(filters.period || 'ALL');
  const slotRows = orders.filter(function(row) { return hasSlot_(row, slot); });
  const dayRows = slotRows.filter(function(row) { return row.data === selectedDate; });
  const monthRows = slotRows.filter(function(row) { return monthOf_(row.data) === selectedMonth; });
  const yearRows = slotRows.filter(function(row) { return yearOf_(row.data) === selectedYear; });
  const months = lastMonths_(selectedMonth);
  const rangeRows = slotRows.filter(function(row) { return months.indexOf(monthOf_(row.data)) >= 0; });
  const periods = Array.from(new Set(orders.map(slotOf_))).sort();
  return {
    context: { today: today, now: nowTime_(), selectedDate: selectedDate, selectedMonth: selectedMonth, selectedYear: selectedYear, period: slot },
    periods: periods,
    kpis: {
      revenue: { day: sum_(dayRows), month: sum_(monthRows), year: sum_(yearRows) },
      orders: { day: distinctCount_(dayRows), month: distinctCount_(monthRows), year: distinctCount_(yearRows) }
    },
    charts: {
      revenueMonths: fillMonths_(rangeRows, months, 'revenue'),
      orderMonths: fillMonths_(rangeRows, months, 'orders'),
      revenueDays: series_(group_(monthRows, function(row) { return row.data; }), 'revenue'),
      orderDays: series_(group_(monthRows, function(row) { return row.data; }), 'orders'),
      revenueHours: series_(group_(dayRows, slotOf_), 'revenue'),
      orderHours: series_(group_(dayRows, slotOf_), 'orders')
    }
  };
}

function buildComparator_(orders, requestedDate) {
  const today = nowIso_();
  const selected = isoDate_(requestedDate) || today;
  const reference = addDays_(selected, -7);
  const relevant = orders.filter(function(row) { return row.data === selected || row.data === reference; });
  const slots = Array.from(new Set(relevant.map(slotOf_))).sort();
  const rows = slots.map(function(slot) {
    const currentRows = relevant.filter(function(row) { return row.data === selected && slotOf_(row) === slot; });
    const referenceRows = relevant.filter(function(row) { return row.data === reference && slotOf_(row) === slot; });
    const current = distinctCount_(currentRows), target = distinctCount_(referenceRows), diff = current - target;
    return { slot: slot, current: current, target: target, needed: Math.max(target - current, 0), diff: diff,
      status: target === 0 ? 'no-base' : diff > 0 ? 'above' : diff === 0 ? 'equal' : 'below',
      future: selected === today && slot.slice(0, 5) > nowTime_() };
  });
  return { selectedDate: selected, referenceDate: reference, isToday: selected === today, rows: rows,
    totals: { current: distinctCount_(relevant.filter(function(row) { return row.data === selected; })), target: distinctCount_(relevant.filter(function(row) { return row.data === reference; })) } };
}

function getAppBootstrap(filters) {
  return safeCall_(function() {
    const orders = readOrders_();
    filters = filters || {};
    return ok_({ dashboard: buildDashboard_(orders, filters), comparator: buildComparator_(orders, filters.compareDate) });
  });
}

function getDashboard(filters) { return getAppBootstrap(filters); }

function listOrders(query) {
  return safeCall_(function() {
    query = query || {};
    const page = Math.max(1, Number(query.page) || 1);
    const search = String(query.search || '').trim().toLocaleLowerCase('pt-BR');
    let rows = readOrders_().sort(function(a, b) { return b._row - a._row; });
    if (search) rows = rows.filter(function(row) { return [row.uuid, row.data, row.pedido, slotOf_(row)].join(' ').toLocaleLowerCase('pt-BR').indexOf(search) >= 0; });
    const total = rows.length, pages = Math.max(1, Math.ceil(total / CONFIG.PAGE_SIZE));
    const safePage = Math.min(page, pages);
    const items = rows.slice((safePage - 1) * CONFIG.PAGE_SIZE, safePage * CONFIG.PAGE_SIZE).map(function(row) { delete row._row; return row; });
    return ok_(items, { page: safePage, pageSize: CONFIG.PAGE_SIZE, total: total, pages: pages });
  });
}

function listMonthlySummary(month) {
  return safeCall_(function() {
    const selectedMonth = /^\d{4}-\d{2}$/.test(String(month || '')) ? month : monthOf_(nowIso_());
    const grouped = group_(readOrders_().filter(function(row) { return monthOf_(row.data) === selectedMonth; }), slotOf_);
    const items = Object.keys(grouped).sort().map(function(slot) {
      return { slot: slot, orders: distinctCount_(grouped[slot]), revenue: sum_(grouped[slot]) };
    });
    return ok_(items, { month: selectedMonth, periods: items.length });
  });
}

function findDuplicates_(orders, order, currentUuid) {
  return orders.filter(function(row) { return row.uuid !== currentUuid && row.pedido.toLocaleUpperCase('pt-BR') === order.pedido.toLocaleUpperCase('pt-BR'); });
}
function duplicateResponse_(duplicates, order) {
  const exact = duplicates.filter(function(row) { return row.data === order.data && row.horario_inicio === order.horario_inicio && row.horario_fim === order.horario_fim; });
  if (!exact.length) return fail_('ORDER_NOT_UNIQUE', 'Este número de pedido já existe em outra data ou período e deve ser globalmente único.', { matches: duplicates.length });
  return fail_('DUPLICATE_CONFIRMATION_REQUIRED', 'Já existe o mesmo pedido nesta data e período. Confirme para somar os lançamentos.', { matches: exact.length, existingValue: sum_(exact) });
}

function createOrder(input) {
  return safeCall_(function() {
    const parsed = normalizeOrder_(input, false);
    if (!parsed.valid) return fail_('VALIDATION_ERROR', 'Revise os campos informados.', parsed.errors);
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      const orders = readOrders_(), order = parsed.order, duplicates = findDuplicates_(orders, order, '');
      if (duplicates.length && !order.confirmDuplicate) return duplicateResponse_(duplicates, order);
      if (duplicates.length && order.confirmDuplicate && !duplicates.some(function(row) { return row.data === order.data && row.horario_inicio === order.horario_inicio && row.horario_fim === order.horario_fim; })) return duplicateResponse_(duplicates, order);
      order.uuid = Utilities.getUuid();
      getSheet_().appendRow([order.uuid, order.data, order.horario_inicio, order.horario_fim, order.valor, order.pedido]);
      delete order.confirmDuplicate;
      return ok_(order);
    } finally { lock.releaseLock(); }
  });
}

function updateOrder(input) {
  return safeCall_(function() {
    const parsed = normalizeOrder_(input, true);
    if (!parsed.valid) return fail_('VALIDATION_ERROR', 'Revise os campos informados.', parsed.errors);
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      const orders = readOrders_(), order = parsed.order;
      const current = orders.find(function(row) { return row.uuid === order.uuid; });
      if (!current) return fail_('NOT_FOUND', 'Lançamento não encontrado.');
      const duplicates = findDuplicates_(orders, order, order.uuid);
      if (duplicates.length && !order.confirmDuplicate) return duplicateResponse_(duplicates, order);
      if (duplicates.length && order.confirmDuplicate && !duplicates.some(function(row) { return row.data === order.data && row.horario_inicio === order.horario_inicio && row.horario_fim === order.horario_fim; })) return duplicateResponse_(duplicates, order);
      getSheet_().getRange(current._row, 2, 1, 5).setValues([[order.data, order.horario_inicio, order.horario_fim, order.valor, order.pedido]]);
      delete order.confirmDuplicate;
      return ok_(order);
    } finally { lock.releaseLock(); }
  });
}

function deleteOrder(uuid) {
  return safeCall_(function() {
    uuid = String(uuid || '').trim();
    if (!uuid) return fail_('VALIDATION_ERROR', 'UUID obrigatório.');
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      const current = readOrders_().find(function(row) { return row.uuid === uuid; });
      if (!current) return fail_('NOT_FOUND', 'Lançamento não encontrado.');
      getSheet_().deleteRow(current._row);
      return ok_({ uuid: uuid });
    } finally { lock.releaseLock(); }
  });
}
