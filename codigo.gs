/**
 * PROJETO SAE - CONTROLE DE VENDAS (PLANILHA LEO)
 * Backend em Google Apps Script (codigo.gs)
 * 
 * Estrutura do Banco de Dados na Aba: "Leo_bd"
 * Cabeçalhos: UUID | data | horario_inicio | horario_fim | valor | pedido
 */

// Nome exato da aba do banco de dados na planilha Google
const SHEET_NAME = 'Leo_bd';

// IDs e Cabeçalhos Esperados
const HEADERS = ['UUID', 'data', 'horario_inicio', 'horario_fim', 'valor', 'pedido'];

/**
 * Retorna a referência ativa da planilha e garante que a aba Leo_bd existe.
 * Se não existir, cria a aba e insere os cabeçalhos padrão.
 */
function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length)
         .setFontWeight('bold')
         .setBackground('#132013')
         .setFontColor('#2ecc71');
    sheet.setFrozenRows(1);
  }
  
  return sheet;
}

/**
 * Ponto de entrada GET do Web App GAS.
 * - Serve a interface web HTML (index.html) se acessado via navegador.
 * - Retorna JSON de vendas se parâmetro ?action=getSales for passado.
 */
function doGet(e) {
  try {
    const action = e && e.parameter ? e.parameter.action : null;
    
    // Se for uma requisição de API via Query Parameter
    if (action === 'getSales') {
      const sales = getSalesData();
      return ContentService.createTextOutput(JSON.stringify({ status: 'success', data: sales }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Servir a aplicação Web Front-end
    return HtmlService.createTemplateFromFile('index')
      .evaluate()
      .setTitle('SAE - Controle de Vendas | Planilha LEO')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
      
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({ status: 'error', message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Ponto de entrada POST para requisições externas (API REST/Webhooks JSON).
 * Suporta as ações: 'create', 'update', 'delete', 'getAll'.
 */
function doPost(e) {
  try {
    let payload = {};
    if (e.postData && e.postData.contents) {
      payload = JSON.parse(e.postData.contents);
    } else if (e.parameter) {
      payload = e.parameter;
    }

    const action = payload.action;

    switch (action) {
      case 'create':
        const created = addSaleRecord(payload.data);
        return responseJSON({ status: 'success', record: created });

      case 'update':
        const updated = updateSaleRecord(payload.data);
        return responseJSON({ status: 'success', record: updated });

      case 'delete':
        const deleted = deleteSaleRecord(payload.uuid);
        return responseJSON({ status: 'success', deletedUuid: deleted });

      case 'getAll':
      default:
        const sales = getSalesData();
        return responseJSON({ status: 'success', data: sales });
    }
  } catch (err) {
    return responseJSON({ status: 'error', message: err.toString() });
  }
}

/**
 * Helper para formatação de respostas JSON da API REST
 */
function responseJSON(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/**
 * LER (Read): Busca todos os registros da aba Leo_bd e os formata como Array de Objetos JSON.
 * @returns {Array<Object>} Lista de registros de vendas
 */
function getSalesData() {
  const sheet = getOrCreateSheet();
  const lastRow = sheet.getLastRow();

  if (lastRow <= 1) {
    return []; // Apenas cabeçalhos existentes
  }

  // Pega todos os dados omitindo a linha do cabeçalho
  const data = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();

  return data.map(row => {
    let dateFormatted = '';
    if (row[1] instanceof Date) {
      dateFormatted = Utilities.formatDate(row[1], Session.getScriptTimeZone(), 'yyyy-MM-dd');
    } else {
      dateFormatted = String(row[1]);
    }

    return {
      uuid: String(row[0] || ''),
      data: dateFormatted,
      horario_inicio: String(row[2] || ''),
      horario_fim: String(row[3] || ''),
      valor: parseFloat(row[4]) || 0,
      pedido: String(row[5] || '')
    };
  });
}

/**
 * CRIAR (Create): Adiciona um novo lançamento de venda na planilha Leo_bd.
 * Regra: Mantém a modal de cadastro liberada para novos envios.
 * @param {Object} record - Objeto de dados recebido do formulário
 * @returns {Object} Registro inserido com UUID gerado
 */
function addSaleRecord(record) {
  const sheet = getOrCreateSheet();

  // Gerar UUID caso não seja fornecido
  const uuid = record.uuid || ('UUID-' + Math.random().toString(36).substr(2, 8).toUpperCase());
  const dataVal = record.data || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const hInicio = record.horario_inicio || '08:00';
  const hFim = record.horario_fim || '09:00';
  const valor = parseFloat(record.valor) || 0;
  const pedido = record.pedido || ('PED-' + Math.floor(1000 + Math.random() * 9000));

  // Adiciona a nova linha
  sheet.appendRow([uuid, dataVal, hInicio, hFim, valor, pedido]);

  return {
    uuid: uuid,
    data: dataVal,
    horario_inicio: hInicio,
    horario_fim: hFim,
    valor: valor,
    pedido: pedido
  };
}

/**
 * ATUALIZAR (Update): Altera um lançamento existente localizando seu UUID na planilha.
 * @param {Object} record - Objeto com os dados atualizados contendo o UUID
 * @returns {Object} Registro alterado
 */
function updateSaleRecord(record) {
  if (!record || !record.uuid) {
    throw new Error('UUID obrigatório para alteração de registro.');
  }

  const sheet = getOrCreateSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) throw new Error('Nenhum dado encontrado para atualizar.');

  const uuids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  let rowIndex = -1;

  for (let i = 0; i < uuids.length; i++) {
    if (String(uuids[i][0]).trim() === String(record.uuid).trim()) {
      rowIndex = i + 2; // +2 compensa índice zero e linha do cabeçalho
      break;
    }
  }

  if (rowIndex === -1) {
    throw new Error('Registro com o UUID especificado não foi encontrado.');
  }

  // Atualiza a linha correspondente
  sheet.getRange(rowIndex, 2).setValue(record.data);
  sheet.getRange(rowIndex, 3).setValue(record.horario_inicio);
  sheet.getRange(rowIndex, 4).setValue(record.horario_fim);
  sheet.getRange(rowIndex, 5).setValue(parseFloat(record.valor) || 0);
  sheet.getRange(rowIndex, 6).setValue(record.pedido);

  return record;
}

/**
 * EXCLUIR (Delete): Remove a linha do lançamento baseado no UUID.
 * @param {string} uuid - Identificador único do lançamento
 * @returns {string} UUID excluído
 */
function deleteSaleRecord(uuid) {
  if (!uuid) throw new Error('UUID não informado para exclusão.');

  const sheet = getOrCreateSheet();
  const lastRow = sheet.getLastRow();
  if (lastRow <= 1) return uuid;

  const uuids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();

  for (let i = 0; i < uuids.length; i++) {
    if (String(uuids[i][0]).trim() === String(uuid).trim()) {
      sheet.deleteRow(i + 2);
      break;
    }
  }

  return uuid;
}

/**
 * Função utilitária para inicializar a planilha com dados de teste (opcional)
 */
function seedDatabaseTest() {
  const sheet = getOrCreateSheet();
  if (sheet.getLastRow() > 1) return; // Não sobrescreve se já houver dados

  const sampleRows = [
    ['UUID-8X2A11', '2026-08-29', '10:00', '11:00', 120.00, 'PED-0829-1'],
    ['UUID-8X2A12', '2026-08-29', '10:00', '11:00', 145.50, 'PED-0829-2'],
    ['UUID-9Y3B21', '2026-09-05', '10:00', '11:00', 130.00, 'PED-0905-1'],
    ['UUID-9Y3B22', '2026-09-05', '11:00', '12:00', 210.00, 'PED-0905-2']
  ];

  sampleRows.forEach(row => sheet.appendRow(row));
}
