/** SAE Controle de Vendas — backend Google Apps Script V8. */
const CONFIG = Object.freeze({
  SPREADSHEET_ID: '1nhN1q2NEkwJ5YZVuUMQVAofMEgBGixKKDEQORwHuAuc',
  SHEET_NAME: 'Leo_bd',
  TIMEZONE: 'America/Sao_Paulo',
  HEADERS: ['UUID', 'data', 'horario_inicio', 'horario_fim', 'valor', 'pedido'],
  PAGE_SIZE: 20
});
let _salesSheetCache = null;
const _capitalSheetCache = {};

function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('SAE — Controle de Vendas')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

function getSpreadsheet_() {
  return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
}

function getSheet_() {
  if (_salesSheetCache) return _salesSheetCache;
  const sheet = getSpreadsheet_().getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) throw new Error('A aba "' + CONFIG.SHEET_NAME + '" não foi encontrada.');
  const actual = sheet.getRange(1, 1, 1, CONFIG.HEADERS.length).getDisplayValues()[0];
  if (actual.join('|').toLowerCase() !== CONFIG.HEADERS.join('|').toLowerCase()) {
    throw new Error('Cabeçalho inválido em ' + CONFIG.SHEET_NAME + '. Esperado: ' + CONFIG.HEADERS.join(' | '));
  }
  _salesSheetCache = sheet;
  return _salesSheetCache;
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
    pedido: Number(String(input.pedido == null ? '' : input.pedido).replace(',', '.'))
  };
  const errors = {};
  if (requireUuid && !order.uuid) errors.uuid = 'UUID obrigatório.';
  if (!order.data) errors.data = 'Informe uma data válida.';
  if (!order.horario_inicio) errors.horario_inicio = 'Informe a hora inicial.';
  if (!order.horario_fim) errors.horario_fim = 'Informe a hora final.';
  if (order.horario_inicio && order.horario_fim && order.horario_inicio >= order.horario_fim) errors.horario_fim = 'A hora final deve ser posterior à inicial.';
  if (!Number.isFinite(order.valor) || order.valor < 0) errors.valor = 'Informe um valor válido maior ou igual a zero.';
  if (!Number.isInteger(order.pedido) || order.pedido < 0) errors.pedido = 'Informe uma quantidade inteira de pedidos, maior ou igual a zero.';
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
      horario_fim: timeText_(row[3]), valor: Number(row[4]) || 0, pedido: Number(row[5]) || 0,
      _row: index + 2
    };
  }).filter(function(item) { return item.uuid && item.data; });
}

function orderTotal_(rows) {
  return rows.reduce(function(total, row) { return total + (Number(row.pedido) || 0); }, 0);
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
function dateTimeIso_(value) {
  if (!(value instanceof Date) || isNaN(value.getTime())) return value ? String(value) : '';
  return Utilities.formatDate(value, CONFIG.TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}
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
    return { label: key, value: type === 'revenue' ? sum_(map[key]) : orderTotal_(map[key]) };
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
    return { label: month, value: type === 'revenue' ? sum_(grouped[month]) : orderTotal_(grouped[month]) };
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
      orders: { day: orderTotal_(dayRows), month: orderTotal_(monthRows), year: orderTotal_(yearRows) }
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
    const current = orderTotal_(currentRows), target = orderTotal_(referenceRows), diff = current - target;
    return { slot: slot, current: current, target: target, needed: Math.max(target - current, 0), diff: diff,
      status: target === 0 ? 'no-base' : diff > 0 ? 'above' : diff === 0 ? 'equal' : 'below',
      future: selected === today && slot.slice(0, 5) > nowTime_() };
  });
  return { selectedDate: selected, referenceDate: reference, isToday: selected === today, rows: rows,
    totals: { current: orderTotal_(relevant.filter(function(row) { return row.data === selected; })), target: orderTotal_(relevant.filter(function(row) { return row.data === reference; })) } };
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
      return { slot: slot, orders: orderTotal_(grouped[slot]), revenue: sum_(grouped[slot]) };
    });
    return ok_(items, { month: selectedMonth, periods: items.length });
  });
}

function createOrder(input) {
  return safeCall_(function() {
    const parsed = normalizeOrder_(input, false);
    if (!parsed.valid) return fail_('VALIDATION_ERROR', 'Revise os campos informados.', parsed.errors);
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      const order = parsed.order;
      order.uuid = Utilities.getUuid();
      getSheet_().appendRow([order.uuid, order.data, order.horario_inicio, order.horario_fim, order.valor, order.pedido]);
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
      getSheet_().getRange(current._row, 2, 1, 5).setValues([[order.data, order.horario_inicio, order.horario_fim, order.valor, order.pedido]]);
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

/* ========================= DIVISÃO DO CAPITAL ========================= */
const CAPITAL = Object.freeze({
  CONFIG_SHEET: 'Capital_Config',
  TRANSFERS_SHEET: 'Capital_Repasses',
  ITEMS_SHEET: 'Capital_Repasse_Itens',
  CONFIG_HEADERS: ['UUID', 'nome', 'slug', 'percentual', 'tipo', 'ordem', 'ativo', 'atualizado_em'],
  TRANSFER_HEADERS: ['UUID', 'data', 'repasse_semanal', 'total_despesas', 'lucro_liquido', 'reserva', 'pro_labore', 'config_versao', 'criado_em', 'atualizado_em', 'excluido', 'excluido_em'],
  ITEM_HEADERS: ['UUID', 'repasse_UUID', 'variavel_UUID', 'nome_snapshot', 'tipo_snapshot', 'percentual_snapshot', 'base_calculo', 'valor_calculado', 'ordem_snapshot']
});

function setupCapitalModule() {
  return safeCall_(function() {
    const lock = LockService.getScriptLock(); lock.waitLock(30000);
    try {
      const ss = getSpreadsheet_();
      const definitions = [
        [CAPITAL.CONFIG_SHEET, CAPITAL.CONFIG_HEADERS],
        [CAPITAL.TRANSFERS_SHEET, CAPITAL.TRANSFER_HEADERS],
        [CAPITAL.ITEMS_SHEET, CAPITAL.ITEM_HEADERS]
      ];
      definitions.forEach(function(def) { ensureEntitySheet_(ss, def[0], def[1]); });
      const configSheet = ss.getSheetByName(CAPITAL.CONFIG_SHEET);
      if (configSheet.getLastRow() === 1) seedCapitalConfig_(configSheet);
      applyCapitalFormats_(ss);
      return ok_({ sheets: definitions.map(function(def) { return def[0]; }), spreadsheetId: ss.getId() });
    } finally { lock.releaseLock(); }
  });
}

function ensureEntitySheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  const actual = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  if (actual.join('|') !== headers.join('|')) throw new Error('Cabeçalho incompatível na aba ' + name + '.');
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#132013').setFontColor('#2ecc71');
  return sheet;
}

function seedCapitalConfig_(sheet) {
  const now = new Date();
  const seeds = [
    ['CMV', 'cmv', 'DESPESA', 1], ['Custo fixo', 'custo_fixo', 'DESPESA', 2],
    ['Custo variável', 'custo_variavel', 'DESPESA', 3], ['Capital de giro', 'capital_giro', 'DESPESA', 4],
    ['Crescimento', 'crescimento', 'DESPESA', 5], ['Reserva', 'reserva', 'RESERVA', 6]
  ];
  sheet.getRange(2, 1, seeds.length, CAPITAL.CONFIG_HEADERS.length).setValues(seeds.map(function(seed) {
    return [Utilities.getUuid(), seed[0], seed[1], 0, seed[2], seed[3], true, now];
  }));
}

function applyCapitalFormats_(ss) {
  const config = ss.getSheetByName(CAPITAL.CONFIG_SHEET), transfers = ss.getSheetByName(CAPITAL.TRANSFERS_SHEET), items = ss.getSheetByName(CAPITAL.ITEMS_SHEET);
  config.getRange('D2:D').setNumberFormat('0.00"%"');
  transfers.getRange('C2:G').setNumberFormat('R$ #,##0.00');
  items.getRange('F2:F').setNumberFormat('0.00"%"');
  items.getRange('G2:H').setNumberFormat('R$ #,##0.00');
}

function capitalSheet_(name, headers) {
  if (_capitalSheetCache[name]) return _capitalSheetCache[name];
  const sheet = getSpreadsheet_().getSheetByName(name);
  if (!sheet) throw new Error('Execute setupCapitalModule antes de usar Divisão do Capital.');
  const actual = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  if (actual.join('|') !== headers.join('|')) throw new Error('Cabeçalho incompatível na aba ' + name + '.');
  _capitalSheetCache[name] = sheet;
  return _capitalSheetCache[name];
}

function readCapitalVariables_(onlyActive) {
  const sheet = capitalSheet_(CAPITAL.CONFIG_SHEET, CAPITAL.CONFIG_HEADERS);
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, CAPITAL.CONFIG_HEADERS.length).getValues().map(function(row, i) {
    return { uuid: String(row[0]), nome: String(row[1]), slug: String(row[2]), percentual: Number(row[3]) || 0,
      tipo: String(row[4]), ordem: Number(row[5]) || 0, ativo: row[6] === true, atualizado_em: row[7], _row: i + 2 };
  }).filter(function(v) { return !onlyActive || v.ativo; }).sort(function(a, b) { return a.ordem - b.ordem; });
}

function slugify_(text) {
  return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}
function normalizeCapitalVariable_(input, requireUuid) {
  input = input || {};
  const variable = { uuid: String(input.uuid || ''), nome: String(input.nome || '').trim(),
    percentual: Number(String(input.percentual == null ? '' : input.percentual).replace(',', '.')),
    tipo: String(input.tipo || 'DESPESA').toUpperCase(), ordem: Number(input.ordem) || 0, ativo: input.ativo !== false };
  const errors = {};
  if (requireUuid && !variable.uuid) errors.uuid = 'UUID obrigatório.';
  if (!variable.nome) errors.nome = 'Informe o nome.';
  if (!Number.isFinite(variable.percentual) || variable.percentual < 0 || variable.percentual > 100) errors.percentual = 'Use percentual entre 0 e 100.';
  if (['DESPESA', 'RESERVA'].indexOf(variable.tipo) < 0) errors.tipo = 'Tipo inválido.';
  return Object.keys(errors).length ? { valid: false, errors: errors } : { valid: true, variable: variable };
}

function saveCapitalVariable(input) {
  return safeCall_(function() {
    const parsed = normalizeCapitalVariable_(input, Boolean(input && input.uuid));
    if (!parsed.valid) return fail_('VALIDATION_ERROR', 'Revise a variável.', parsed.errors);
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      const variable = parsed.variable, all = readCapitalVariables_(false);
      if (all.some(function(v) { return v.uuid !== variable.uuid && v.ativo && v.nome.toLowerCase() === variable.nome.toLowerCase(); })) return fail_('DUPLICATE_NAME', 'Já existe uma variável ativa com este nome.');
      if (variable.tipo === 'RESERVA' && all.some(function(v) { return v.uuid !== variable.uuid && v.ativo && v.tipo === 'RESERVA'; })) return fail_('RESERVE_EXISTS', 'Somente uma variável Reserva pode ficar ativa.');
      const sheet = capitalSheet_(CAPITAL.CONFIG_SHEET, CAPITAL.CONFIG_HEADERS), now = new Date();
      if (variable.uuid) {
        const current = all.find(function(v) { return v.uuid === variable.uuid; });
        if (!current) return fail_('NOT_FOUND', 'Variável não encontrada.');
        variable.slug = current.slug;
        sheet.getRange(current._row, 2, 1, 7).setValues([[variable.nome, variable.slug, variable.percentual, variable.tipo, variable.ordem, variable.ativo, now]]);
      } else {
        variable.uuid = Utilities.getUuid(); variable.slug = slugify_(variable.nome) || variable.uuid;
        variable.ordem = variable.ordem > 0 ? variable.ordem : all.length + 1;
        sheet.appendRow([variable.uuid, variable.nome, variable.slug, variable.percentual, variable.tipo, variable.ordem, variable.ativo, now]);
      }
      return ok_(variable, { expensePercent: readCapitalVariables_(true).filter(function(v) { return v.tipo === 'DESPESA'; }).reduce(function(t, v) { return t + v.percentual; }, 0) });
    } finally { lock.releaseLock(); }
  });
}

function setCapitalVariableStatus(input) {
  return safeCall_(function() {
    input = input || {};
    const current = readCapitalVariables_(false).find(function(variable) { return variable.uuid === String(input.uuid || ''); });
    if (!current) return fail_('NOT_FOUND', 'Variável não encontrada.');
    return saveCapitalVariable({
      uuid: current.uuid, nome: current.nome, percentual: current.percentual,
      tipo: current.tipo, ordem: current.ordem, ativo: input.ativo === true
    });
  });
}

function readCapitalTransfers_() {
  const transferSheet = capitalSheet_(CAPITAL.TRANSFERS_SHEET, CAPITAL.TRANSFER_HEADERS);
  const itemSheet = capitalSheet_(CAPITAL.ITEMS_SHEET, CAPITAL.ITEM_HEADERS);
  const transfers = transferSheet.getLastRow() < 2 ? [] : transferSheet.getRange(2, 1, transferSheet.getLastRow() - 1, CAPITAL.TRANSFER_HEADERS.length).getValues().map(function(r, i) {
    return { uuid: String(r[0]), data: isoDate_(r[1]), repasse_semanal: Number(r[2]) || 0, total_despesas: Number(r[3]) || 0,
      lucro_liquido: Number(r[4]) || 0, reserva: Number(r[5]) || 0, pro_labore: Number(r[6]) || 0,
      config_versao: String(r[7]), criado_em: r[8], atualizado_em: r[9], excluido: r[10] === true, excluido_em: r[11], _row: i + 2, items: [] };
  }).filter(function(r) { return r.uuid && !r.excluido; });
  const byId = {}; transfers.forEach(function(t) { byId[t.uuid] = t; });
  if (itemSheet.getLastRow() >= 2) itemSheet.getRange(2, 1, itemSheet.getLastRow() - 1, CAPITAL.ITEM_HEADERS.length).getValues().forEach(function(r, i) {
    if (byId[String(r[1])]) byId[String(r[1])].items.push({ uuid: String(r[0]), repasse_uuid: String(r[1]), variavel_uuid: String(r[2]), nome: String(r[3]), tipo: String(r[4]), percentual: Number(r[5]) || 0, base: Number(r[6]) || 0, valor: Number(r[7]) || 0, ordem: Number(r[8]) || 0, _row: i + 2 });
  });
  transfers.forEach(function(t) { t.items.sort(function(a, b) { return a.ordem - b.ordem; }); });
  return transfers;
}

function calculateCapital_(repasse, variables, overrides) {
  overrides = overrides || {};
  const expenses = variables.filter(function(v) { return v.tipo === 'DESPESA'; }).map(function(v) {
    const percentual = Object.prototype.hasOwnProperty.call(overrides, v.uuid) ? Number(overrides[v.uuid]) : v.percentual;
    if (!Number.isFinite(percentual) || percentual < 0 || percentual > 100) throw new Error('Percentual inválido para ' + v.nome + '.');
    return { variavel_uuid: v.uuid, nome: v.nome, tipo: v.tipo, percentual: percentual, base: repasse, valor: repasse * percentual / 100, ordem: v.ordem };
  });
  const total = expenses.reduce(function(t, i) { return t + i.valor; }, 0), lucro = repasse - total;
  const reserveVariable = variables.find(function(v) { return v.tipo === 'RESERVA'; });
  if (!reserveVariable) throw new Error('Configure uma variável Reserva ativa.');
  const reservePercent = Object.prototype.hasOwnProperty.call(overrides, reserveVariable.uuid) ? Number(overrides[reserveVariable.uuid]) : reserveVariable.percentual;
  if (!Number.isFinite(reservePercent) || reservePercent < 0 || reservePercent > 100) throw new Error('Percentual inválido para Reserva.');
  const reserve = { variavel_uuid: reserveVariable.uuid, nome: reserveVariable.nome, tipo: 'RESERVA', percentual: reservePercent, base: lucro, valor: lucro * reservePercent / 100, ordem: reserveVariable.ordem };
  return { repasse_semanal: repasse, total_despesas: total, lucro_liquido: lucro, reserva: reserve.valor, pro_labore: lucro - reserve.valor,
    items: expenses.concat([reserve]), expensePercent: expenses.reduce(function(t, i) { return t + i.percentual; }, 0) };
}

function normalizeCapitalTransfer_(input, requireUuid) {
  input = input || {};
  const transfer = { uuid: String(input.uuid || ''), data: isoDate_(input.data), repasse: Number(String(input.repasse == null ? input.repasse_semanal : input.repasse).replace(',', '.')), overrides: input.overrides || {} };
  const errors = {};
  if (requireUuid && !transfer.uuid) errors.uuid = 'UUID obrigatório.';
  if (!transfer.data) errors.data = 'Informe uma data válida.';
  if (!Number.isFinite(transfer.repasse) || transfer.repasse < 0) errors.repasse = 'Informe um repasse válido.';
  return Object.keys(errors).length ? { valid: false, errors: errors } : { valid: true, transfer: transfer };
}

function createCapitalTransfer(input) { return saveCapitalTransfer_(input, false); }
function updateCapitalTransfer(input) { return saveCapitalTransfer_(input, true); }
function saveCapitalTransfer_(input, updating) {
  return safeCall_(function() {
    const parsed = normalizeCapitalTransfer_(input, updating);
    if (!parsed.valid) return fail_('VALIDATION_ERROR', 'Revise o repasse.', parsed.errors);
    const lock = LockService.getScriptLock(); lock.waitLock(30000);
    try {
      const transfer = parsed.transfer, transferSheet = capitalSheet_(CAPITAL.TRANSFERS_SHEET, CAPITAL.TRANSFER_HEADERS), itemSheet = capitalSheet_(CAPITAL.ITEMS_SHEET, CAPITAL.ITEM_HEADERS);
      let variables, current;
      if (updating) {
        current = readCapitalTransfers_().find(function(t) { return t.uuid === transfer.uuid; });
        if (!current) return fail_('NOT_FOUND', 'Repasse não encontrado.');
        variables = current.items.map(function(i) { return { uuid: i.variavel_uuid, nome: i.nome, tipo: i.tipo, percentual: i.percentual, ordem: i.ordem }; });
      } else variables = readCapitalVariables_(true);
      if (!variables.length) return fail_('CONFIG_REQUIRED', 'Cadastre as variáveis antes do repasse.');
      let calc;
      try {
        calc = calculateCapital_(transfer.repasse, variables, transfer.overrides);
      } catch (calcError) {
        return fail_('CALC_ERROR', calcError.message || 'Não foi possível calcular a divisão do capital.');
      }
      const now = new Date();
      const version = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(calc.items.map(function(i) { return [i.variavel_uuid, i.percentual]; })))).slice(0, 16);
      if (updating) {
        transferSheet.getRange(current._row, 2, 1, 9).setValues([[transfer.data, calc.repasse_semanal, calc.total_despesas, calc.lucro_liquido, calc.reserva, calc.pro_labore, version, current.criado_em, now]]);
        const oldRows = current.items.map(function(i) { return i._row; }).sort(function(a, b) { return b - a; });
        oldRows.forEach(function(row) { itemSheet.deleteRow(row); });
      } else {
        transfer.uuid = Utilities.getUuid();
        transferSheet.appendRow([transfer.uuid, transfer.data, calc.repasse_semanal, calc.total_despesas, calc.lucro_liquido, calc.reserva, calc.pro_labore, version, now, now, false, '']);
      }
      if (calc.items.length) itemSheet.getRange(itemSheet.getLastRow() + 1, 1, calc.items.length, CAPITAL.ITEM_HEADERS.length).setValues(calc.items.map(function(i) {
        return [Utilities.getUuid(), transfer.uuid, i.variavel_uuid, i.nome, i.tipo, i.percentual, i.base, i.valor, i.ordem];
      }));
      return ok_(Object.assign({ uuid: transfer.uuid, data: transfer.data }, calc), { warning: calc.expensePercent > 100 ? 'Os percentuais de despesas ultrapassam 100%.' : '' });
    } finally { lock.releaseLock(); }
  });
}

function deleteCapitalTransfer(uuid) {
  return safeCall_(function() {
    const lock = LockService.getScriptLock(); lock.waitLock(20000);
    try {
      const current = readCapitalTransfers_().find(function(t) { return t.uuid === String(uuid || ''); });
      if (!current) return fail_('NOT_FOUND', 'Repasse não encontrado.');
      capitalSheet_(CAPITAL.TRANSFERS_SHEET, CAPITAL.TRANSFER_HEADERS).getRange(current._row, 11, 1, 2).setValues([[true, new Date()]]);
      return ok_({ uuid: current.uuid });
    } finally { lock.releaseLock(); }
  });
}

function capitalVariation_(current, previous) {
  if (previous === 0) return { value: null, label: current === 0 ? 'Sem alteração' : 'Sem base' };
  const value = (current - previous) / Math.abs(previous) * 100;
  return { value: value, label: (value >= 0 ? 'Aumentou ' : 'Reduziu ') + Math.abs(value).toFixed(2).replace('.', ',') + '%' };
}
function getCapitalBootstrap(filters) {
  return safeCall_(function() {
    filters = filters || {};
    const transfers = readCapitalTransfers_().sort(function(a, b) { return b.data.localeCompare(a.data) || b._row - a._row; });
    const today = nowIso_(), month = /^\d{4}-\d{2}$/.test(String(filters.month || '')) ? filters.month : monthOf_(today), year = month.slice(0, 4);
    const previousMonth = lastMonths_(month).slice(-2, -1)[0], previousYear = String(Number(year) - 1);
    function total(rows, key) { return rows.reduce(function(t, r) { return t + r[key]; }, 0); }
    const monthRows = transfers.filter(function(t) { return monthOf_(t.data) === month; }), yearRows = transfers.filter(function(t) { return yearOf_(t.data) === year; });
    const prevMonthRows = transfers.filter(function(t) { return monthOf_(t.data) === previousMonth; }), prevYearRows = transfers.filter(function(t) { return yearOf_(t.data) === previousYear; });
    const variables = readCapitalVariables_(false), expensePercent = variables.filter(function(v) { return v.ativo && v.tipo === 'DESPESA'; }).reduce(function(t, v) { return t + v.percentual; }, 0);
    const publicVariables = variables.map(function(v) {
      return { uuid: v.uuid, nome: v.nome, slug: v.slug, percentual: v.percentual,
        tipo: v.tipo, ordem: v.ordem, ativo: v.ativo, atualizado_em: dateTimeIso_(v.atualizado_em) };
    });
    const publicTransfers = transfers.map(function(t) {
      return { uuid: t.uuid, data: t.data, repasse_semanal: t.repasse_semanal,
        total_despesas: t.total_despesas, lucro_liquido: t.lucro_liquido,
        reserva: t.reserva, pro_labore: t.pro_labore, config_versao: t.config_versao,
        criado_em: dateTimeIso_(t.criado_em), atualizado_em: dateTimeIso_(t.atualizado_em),
        items: t.items.map(function(i) {
          return { uuid: i.uuid, repasse_uuid: i.repasse_uuid, variavel_uuid: i.variavel_uuid,
            nome: i.nome, tipo: i.tipo, percentual: i.percentual, base: i.base,
            valor: i.valor, ordem: i.ordem };
        }) };
    });
    return ok_({ variables: publicVariables, transfers: publicTransfers, context: { today: today, month: month }, expensePercent: expensePercent,
      kpis: { proLaboreMonth: total(monthRows, 'pro_labore'), proLaboreYear: total(yearRows, 'pro_labore'), expensesMonth: total(monthRows, 'total_despesas'), expensesYear: total(yearRows, 'total_despesas'),
        proLaboreMonthVariation: capitalVariation_(total(monthRows, 'pro_labore'), total(prevMonthRows, 'pro_labore')), expensesMonthVariation: capitalVariation_(total(monthRows, 'total_despesas'), total(prevMonthRows, 'total_despesas')),
        proLaboreYearVariation: capitalVariation_(total(yearRows, 'pro_labore'), total(prevYearRows, 'pro_labore')), expensesYearVariation: capitalVariation_(total(yearRows, 'total_despesas'), total(prevYearRows, 'total_despesas')) } });
  });
}

/* ========================= FINANCEIRO ========================= */
const FIN=Object.freeze({
 CATS:'Financeiro_Categorias',SUBS:'Financeiro_Subcategorias',ITEMS:'Financeiro_Itens',ENTRIES:'Financeiro_Lancamentos',RECUR:'Financeiro_Recorrencias',
 CAT_H:['UUID','data_cadastro','fonte','tipo_custo','nome','ativo','atualizado_em'],
 SUB_H:['UUID','data_cadastro','categoria_UUID','nome','ativo','atualizado_em'],
 ITEM_H:['UUID','data_cadastro','subcategoria_UUID','nome','descricao','ativo','atualizado_em'],
 ENTRY_H:['UUID','data_cadastro','data_movimento','fonte','tipo_custo_snapshot','categoria_UUID','categoria_snapshot','subcategoria_UUID','subcategoria_snapshot','item_UUID','nome_snapshot','descricao','valor','data_vencimento','pago','pago_em','recorrencia_UUID','ocorrencia_chave','excluido','excluido_em','atualizado_em'],
 RECUR_H:['UUID','lancamento_origem_UUID','dia_vencimento','ativa','criado_em','encerrado_em']
});
const _finSheets={};
function finSheet_(name,headers){if(_finSheets[name])return _finSheets[name];const s=getSpreadsheet_().getSheetByName(name);if(!s)throw new Error('Execute setupFinanceModule antes de usar Financeiro.');const h=s.getRange(1,1,1,headers.length).getDisplayValues()[0];if(h.join('|')!==headers.join('|'))throw new Error('Cabeçalho incompatível em '+name+'.');return _finSheets[name]=s;}
function setupFinanceModule(){return safeCall_(function(){const lock=LockService.getScriptLock();lock.waitLock(30000);try{const ss=getSpreadsheet_(),defs=[[FIN.CATS,FIN.CAT_H],[FIN.SUBS,FIN.SUB_H],[FIN.ITEMS,FIN.ITEM_H],[FIN.ENTRIES,FIN.ENTRY_H],[FIN.RECUR,FIN.RECUR_H]];defs.forEach(d=>ensureEntitySheet_(ss,d[0],d[1]));const cat=ss.getSheetByName(FIN.CATS);if(cat.getLastRow()===1){const now=new Date(),names=['SALÁRIOS FREELANCER','CUSTOS DE FUNCIONAMENTO','LANCHE FUNCIONÁRIO','MOTOBOYS','CUSTOS GERAIS','PRÓ-LABORE','EMPRÉSTIMOS','TAXAS GERAIS','IMPOSTO'];cat.getRange(2,1,names.length,FIN.CAT_H.length).setValues(names.map((n,i)=>[Utilities.getUuid(),now,'DESPESA','FIXO',n,true,now]));}ss.getSheetByName(FIN.ENTRIES).getRange('M2:M').setNumberFormat('R$ #,##0.00');installFinanceTrigger_();return ok_({sheets:defs.map(d=>d[0]),recurrenceMonths:12});}finally{lock.releaseLock();}});}
function installFinanceTrigger_(){const exists=ScriptApp.getProjectTriggers().some(t=>t.getHandlerFunction()==='materializeRecurringExpenses');if(!exists)ScriptApp.newTrigger('materializeRecurringExpenses').timeBased().everyDays(1).atHour(2).create();}
function readRows_(sheet,headers){if(sheet.getLastRow()<2)return[];return sheet.getRange(2,1,sheet.getLastRow()-1,headers.length).getValues();}
function readFinanceCatalog_(){const cats=readRows_(finSheet_(FIN.CATS,FIN.CAT_H),FIN.CAT_H).map((r,i)=>({uuid:String(r[0]),data_cadastro:dateTimeIso_(r[1]),fonte:String(r[2]),tipo_custo:String(r[3]),nome:String(r[4]),ativo:r[5]===true,atualizado_em:dateTimeIso_(r[6]),_row:i+2}));const subs=readRows_(finSheet_(FIN.SUBS,FIN.SUB_H),FIN.SUB_H).map((r,i)=>({uuid:String(r[0]),data_cadastro:dateTimeIso_(r[1]),categoria_uuid:String(r[2]),nome:String(r[3]),ativo:r[4]===true,atualizado_em:dateTimeIso_(r[5]),_row:i+2}));const items=readRows_(finSheet_(FIN.ITEMS,FIN.ITEM_H),FIN.ITEM_H).map((r,i)=>({uuid:String(r[0]),data_cadastro:dateTimeIso_(r[1]),subcategoria_uuid:String(r[2]),nome:String(r[3]),descricao:String(r[4]),ativo:r[5]===true,atualizado_em:dateTimeIso_(r[6]),_row:i+2}));return{categories:cats,subcategories:subs,items};}
function saveFinanceCatalog(input){return safeCall_(function(){input=input||{};const entity=String(input.entity||''),name=String(input.nome||'').trim(),now=new Date();if(!name)return fail_('VALIDATION_ERROR','Informe o nome.');const lock=LockService.getScriptLock();lock.waitLock(20000);try{const all=readFinanceCatalog_();let list,sheet,headers,row;if(entity==='CATEGORY'){list=all.categories;sheet=finSheet_(FIN.CATS,FIN.CAT_H);const fonte=String(input.fonte||'');if(!['RECEITA','DESPESA'].includes(fonte))return fail_('VALIDATION_ERROR','Selecione a fonte.');const tipo=fonte==='DESPESA'?String(input.tipo_custo||''):'';if(fonte==='DESPESA'&&!['FIXO','VARIAVEL'].includes(tipo))return fail_('VALIDATION_ERROR','Selecione Fixo ou Variável.');row=[input.uuid||Utilities.getUuid(),now,fonte,tipo,name,input.ativo!==false,now];headers=FIN.CAT_H;}else if(entity==='SUBCATEGORY'){list=all.subcategories;sheet=finSheet_(FIN.SUBS,FIN.SUB_H);if(!all.categories.some(x=>x.uuid===input.parent_uuid))return fail_('VALIDATION_ERROR','Categoria inválida.');row=[input.uuid||Utilities.getUuid(),now,input.parent_uuid,name,input.ativo!==false,now];headers=FIN.SUB_H;}else if(entity==='ITEM'){list=all.items;sheet=finSheet_(FIN.ITEMS,FIN.ITEM_H);if(!all.subcategories.some(x=>x.uuid===input.parent_uuid))return fail_('VALIDATION_ERROR','Subcategoria inválida.');row=[input.uuid||Utilities.getUuid(),now,input.parent_uuid,name,String(input.descricao||''),input.ativo!==false,now];headers=FIN.ITEM_H;}else return fail_('VALIDATION_ERROR','Entidade inválida.');const current=list.find(x=>x.uuid===String(input.uuid||''));if(list.some(x=>x.uuid!==String(input.uuid||'')&&x.nome.toLowerCase()===name.toLowerCase()&&x.ativo))return fail_('DUPLICATE_NAME','Nome já cadastrado neste nível.');if(current){row[1]=new Date(current.data_cadastro);sheet.getRange(current._row,1,1,headers.length).setValues([row]);}else sheet.appendRow(row);return ok_({uuid:row[0]});}finally{lock.releaseLock();}});}
function setFinanceCatalogStatus(input){return safeCall_(function(){const all=readFinanceCatalog_(),maps={CATEGORY:[all.categories,FIN.CATS,FIN.CAT_H,6],SUBCATEGORY:[all.subcategories,FIN.SUBS,FIN.SUB_H,5],ITEM:[all.items,FIN.ITEMS,FIN.ITEM_H,6]},m=maps[input.entity],cur=m&&m[0].find(x=>x.uuid===input.uuid);if(!cur)return fail_('NOT_FOUND','Cadastro não encontrado.');finSheet_(m[1],m[2]).getRange(cur._row,m[3],1,2).setValues([[input.ativo===true,new Date()]]);return ok_({uuid:cur.uuid,ativo:input.ativo===true});});}
function readFinanceEntries_(){return readRows_(finSheet_(FIN.ENTRIES,FIN.ENTRY_H),FIN.ENTRY_H).map((r,i)=>({uuid:String(r[0]),data_cadastro:dateTimeIso_(r[1]),data_movimento:isoDate_(r[2]),fonte:String(r[3]),tipo_custo:String(r[4]),categoria_uuid:String(r[5]),categoria:String(r[6]),subcategoria_uuid:String(r[7]),subcategoria:String(r[8]),item_uuid:String(r[9]),nome:String(r[10]),descricao:String(r[11]),valor:Number(r[12])||0,data_vencimento:isoDate_(r[13]),pago:r[14]===true,pago_em:dateTimeIso_(r[15]),recorrencia_uuid:String(r[16]),ocorrencia_chave:String(r[17]),excluido:r[18]===true,excluido_em:dateTimeIso_(r[19]),atualizado_em:dateTimeIso_(r[20]),_row:i+2})).filter(x=>x.uuid&&!x.excluido);}
function financeSnapshot_(input,catalog){const cat=catalog.categories.find(x=>x.uuid===input.categoria_uuid&&x.ativo),sub=catalog.subcategories.find(x=>x.uuid===input.subcategoria_uuid&&x.ativo&&x.categoria_uuid===input.categoria_uuid),item=catalog.items.find(x=>x.uuid===input.item_uuid&&x.ativo&&x.subcategoria_uuid===input.subcategoria_uuid);if(!cat||!sub||!item)throw new Error('Categoria, subcategoria ou item inválido/inativo.');if(cat.fonte!==input.fonte)throw new Error('Categoria incompatível com a fonte.');return{cat,sub,item};}
function normalizeFinanceEntry_(input,edit){input=input||{};const e={uuid:String(input.uuid||''),data_movimento:isoDate_(input.data_movimento),fonte:String(input.fonte||''),categoria_uuid:String(input.categoria_uuid||''),subcategoria_uuid:String(input.subcategoria_uuid||''),item_uuid:String(input.item_uuid||''),descricao:String(input.descricao||''),valor:Number(String(input.valor==null?'':input.valor).replace(',','.')),data_vencimento:isoDate_(input.data_vencimento),pago:input.pago===true,recorrente:input.recorrente===true};const er={};if(edit&&!e.uuid)er.uuid='UUID obrigatório.';if(!e.data_movimento)er.data_movimento='Data obrigatória.';if(!['RECEITA','DESPESA'].includes(e.fonte))er.fonte='Fonte inválida.';if(!Number.isFinite(e.valor)||e.valor<0)er.valor='Valor inválido.';if(e.fonte==='DESPESA'&&!e.data_vencimento)er.data_vencimento='Vencimento obrigatório.';return Object.keys(er).length?{valid:false,errors:er}:{valid:true,entry:e};}
function createFinanceEntry(input){return saveFinanceEntry_(input,false);}
function updateFinanceEntry(input){return saveFinanceEntry_(input,true);}
function saveFinanceEntry_(input,edit){return safeCall_(function(){const parsed=normalizeFinanceEntry_(input,edit);if(!parsed.valid)return fail_('VALIDATION_ERROR','Revise o lançamento.',parsed.errors);const lock=LockService.getScriptLock();lock.waitLock(30000);try{const e=parsed.entry,sheet=finSheet_(FIN.ENTRIES,FIN.ENTRY_H),all=readFinanceEntries_(),current=edit&&all.find(x=>x.uuid===e.uuid);if(edit&&!current)return fail_('NOT_FOUND','Lançamento não encontrado.');let snap;if(edit&&current.categoria_uuid===e.categoria_uuid&&current.subcategoria_uuid===e.subcategoria_uuid&&current.item_uuid===e.item_uuid)snap={cat:{uuid:current.categoria_uuid,nome:current.categoria,tipo_custo:current.tipo_custo},sub:{uuid:current.subcategoria_uuid,nome:current.subcategoria},item:{uuid:current.item_uuid,nome:current.nome}};else try{snap=financeSnapshot_(e,readFinanceCatalog_());}catch(err){return fail_('CLASSIFICATION_ERROR',err.message);}const now=new Date(),paid=e.fonte==='RECEITA'?true:e.pago,paidAt=paid?(current&&current.pago_em?new Date(current.pago_em):now):'';let recur=current?current.recorrencia_uuid:'';if(!edit&&e.fonte==='DESPESA'&&e.recorrente){recur=Utilities.getUuid();finSheet_(FIN.RECUR,FIN.RECUR_H).appendRow([recur,'',Number(e.data_vencimento.slice(8,10)),true,now,'']);}const uuid=e.uuid||Utilities.getUuid(),created=current?new Date(current.data_cadastro):now,row=[uuid,created,e.data_movimento,e.fonte,snap.cat.tipo_custo||'',snap.cat.uuid,snap.cat.nome,snap.sub.uuid,snap.sub.nome,snap.item.uuid,snap.item.nome,e.descricao,e.valor,e.fonte==='DESPESA'?e.data_vencimento:'',paid,paidAt,recur,current?current.ocorrencia_chave:'',false,'',now];if(current)sheet.getRange(current._row,1,1,FIN.ENTRY_H.length).setValues([row]);else sheet.appendRow(row);if(recur&&!edit){const rs=finSheet_(FIN.RECUR,FIN.RECUR_H),rr=readRows_(rs,FIN.RECUR_H).findIndex(r=>String(r[0])===recur);if(rr>=0)rs.getRange(rr+2,2).setValue(uuid);materializeRecurrence_(recur,12);}return ok_({uuid});}finally{lock.releaseLock();}});}
function endOfMonthDate_(iso,offset){const p=iso.split('-').map(Number),day=p[2],d=new Date(Date.UTC(p[0],p[1]-1+offset,1)),last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();return Utilities.formatDate(new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),Math.min(day,last),12)),'UTC','yyyy-MM-dd');}
function materializeRecurrence_(uuid,months){const entries=readFinanceEntries_(),origin=entries.find(x=>x.recorrencia_uuid===uuid&&!x.ocorrencia_chave),sheet=finSheet_(FIN.ENTRIES,FIN.ENTRY_H);if(!origin)return;const keys=new Set(entries.map(x=>x.ocorrencia_chave));const rows=[];for(let n=1;n<=months;n++){const due=endOfMonthDate_(origin.data_vencimento,n),key=uuid+'|'+due;if(keys.has(key))continue;const now=new Date();rows.push([Utilities.getUuid(),now,due,'DESPESA',origin.tipo_custo,origin.categoria_uuid,origin.categoria,origin.subcategoria_uuid,origin.subcategoria,origin.item_uuid,origin.nome,origin.descricao,origin.valor,due,false,'',uuid,key,false,'',now]);}if(rows.length)sheet.getRange(sheet.getLastRow()+1,1,rows.length,FIN.ENTRY_H.length).setValues(rows);}
function materializeRecurringExpenses(){const lock=LockService.getScriptLock();lock.waitLock(30000);try{const rec=readRows_(finSheet_(FIN.RECUR,FIN.RECUR_H),FIN.RECUR_H);rec.filter(r=>r[3]===true).forEach(r=>materializeRecurrence_(String(r[0]),12));}finally{lock.releaseLock();}}
function setFinanceEntryPaid(input){return safeCall_(function(){const lock=LockService.getScriptLock();lock.waitLock(20000);try{const e=readFinanceEntries_().find(x=>x.uuid===String(input.uuid||''));if(!e)return fail_('NOT_FOUND','Lançamento não encontrado.');const paid=input.pago===true;finSheet_(FIN.ENTRIES,FIN.ENTRY_H).getRange(e._row,15,1,2).setValues([[paid,paid?new Date():'']]);return ok_({uuid:e.uuid,pago:paid});}finally{lock.releaseLock();}});}
function deleteFinanceEntry(uuid){return safeCall_(function(){const lock=LockService.getScriptLock();lock.waitLock(20000);try{const e=readFinanceEntries_().find(x=>x.uuid===String(uuid||''));if(!e)return fail_('NOT_FOUND','Lançamento não encontrado.');finSheet_(FIN.ENTRIES,FIN.ENTRY_H).getRange(e._row,19,1,2).setValues([[true,new Date()]]);return ok_({uuid:e.uuid});}finally{lock.releaseLock();}});}
function getFinanceBootstrap(filters) {
  return safeCall_(function () {
    filters = filters || {};
    materializeRecurringExpenses();
    const cat = readFinanceCatalog_();
    const entries = readFinanceEntries_().sort((a, b) =>
      (a.data_vencimento || a.data_movimento).localeCompare(b.data_vencimento || b.data_movimento));
    const recurrenceStatus = new Map(readRows_(finSheet_(FIN.RECUR, FIN.RECUR_H), FIN.RECUR_H)
      .map(row => [String(row[0]), row[3] === true]));
    const today = nowIso_();
    const month = /^\d{4}-\d{2}$/.test(filters.month) ? filters.month : monthOf_(today);
    const monthEntries = entries.filter(entry => monthOf_(entry.data_vencimento || entry.data_movimento) === month);
    const expenses = monthEntries.filter(entry => entry.fonte === 'DESPESA');
    const revenues = monthEntries.filter(entry => entry.fonte === 'RECEITA');
    const sum = rows => rows.reduce((total, entry) => total + entry.valor, 0);
    const unpaid = expenses.filter(entry => !entry.pago);
    const paid = expenses.filter(entry => entry.pago);
    const tomorrow = addDays_(today, 1), d2 = addDays_(today, 2), d7 = addDays_(today, 7);
    const categoryMap = {};
    expenses.forEach(entry => categoryMap[entry.categoria] = (categoryMap[entry.categoria] || 0) + entry.valor);
    const categoryTotals = Object.keys(categoryMap)
      .map(name => ({ name: name, value: categoryMap[name] }))
      .sort((a, b) => b.value - a.value);
    entries.forEach(entry => entry.recorrente_ativa = entry.recorrencia_uuid
      ? recurrenceStatus.get(entry.recorrencia_uuid) === true : false);
    function clean(entry) { const result = Object.assign({}, entry); delete result._row; return result; }
    return ok_({
      catalog: { categories: cat.categories.map(clean), subcategories: cat.subcategories.map(clean), items: cat.items.map(clean) },
      entries: entries.map(clean), context: { today: today, month: month }, categoryTotals: categoryTotals,
      kpis: { revenue: sum(revenues), expenses: sum(expenses), balance: sum(revenues) - sum(expenses), payable: sum(unpaid), paid: sum(paid), payableCount: unpaid.length, paidCount: paid.length },
      bills: { overdue: unpaid.filter(x => x.data_vencimento < today).map(clean), today: unpaid.filter(x => x.data_vencimento === today).map(clean), tomorrow: unpaid.filter(x => x.data_vencimento === tomorrow).map(clean), next7: unpaid.filter(x => x.data_vencimento >= d2 && x.data_vencimento <= d7).map(clean) }
    });
  });
}
function setFinanceRecurrenceStatus(input){return safeCall_(function(){const lock=LockService.getScriptLock();lock.waitLock(20000);try{const sheet=finSheet_(FIN.RECUR,FIN.RECUR_H),rows=readRows_(sheet,FIN.RECUR_H),idx=rows.findIndex(r=>String(r[0])===String(input.uuid||''));if(idx<0)return fail_('NOT_FOUND','Recorrência não encontrada.');const active=input.ativa===true;sheet.getRange(idx+2,4,1,3).setValues([[active,rows[idx][4],active?'':new Date()]]);return ok_({uuid:String(input.uuid),ativa:active});}finally{lock.releaseLock();}});}
