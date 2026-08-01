// Acesso ao Google Sheets (REST v4) usando o access token do GIS.
// Trata 403/429 com backoff exponencial (cota/limite).
import { getToken, ensureToken } from './auth.js';
import { store } from './store.js';
import {
  SHEET_LOTES, SHEET_INBOX, SHEET_CONFIG, LOTES_HEADER, INBOX_HEADER,
  COL, INBOX_COL, TIPOS_IDS, colLetter, idFromLink,
} from './model.js';

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';

async function fetchWithBackoff(url, opts, tentativas = 4) {
  let espera = 500;
  for (let i = 0; i < tentativas; i++) {
    const res = await fetch(url, opts);
    if (res.ok) return res;
    if ((res.status === 403 || res.status === 429) && i < tentativas - 1) {
      await new Promise((r) => setTimeout(r, espera));
      espera *= 2; // 0.5s, 1s, 2s, 4s
      continue;
    }
    const txt = await res.text().catch(() => '');
    throw new Error(`Sheets ${res.status}: ${txt.slice(0, 200)}`);
  }
}

async function api(path, opts = {}) {
  await ensureToken();
  const res = await fetchWithBackoff(`${BASE}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  return res.status === 204 ? {} : res.json();
}

function sid() {
  const id = store.getSheetId();
  if (!id) throw new Error('SEM_PLANILHA');
  return id;
}

// ---- leitura / escrita de valores ----------------------------------------

export async function getValues(range) {
  const data = await api(`/${sid()}/values/${encodeURIComponent(range)}`);
  return data.values || [];
}

export async function appendRow(sheetName, row) {
  return api(
    `/${sid()}/values/${encodeURIComponent(sheetName + '!A1')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: [row] }) },
  );
}

export async function updateRange(range, values) {
  return api(
    `/${sid()}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    { method: 'PUT', body: JSON.stringify({ values }) },
  );
}

async function getMeta() {
  return api(`/${sid()}?fields=sheets.properties(title)`);
}

async function batchUpdate(requests) {
  return api(`/${sid()}:batchUpdate`, { method: 'POST', body: JSON.stringify({ requests }) });
}

// Garante que as abas Lotes/Inbox/Config existam com cabeçalho. Idempotente.
export async function ensureSheets() {
  const meta = await getMeta();
  const titles = (meta.sheets || []).map((s) => s.properties.title);
  const reqs = [];
  if (!titles.includes(SHEET_LOTES)) reqs.push({ addSheet: { properties: { title: SHEET_LOTES } } });
  if (!titles.includes(SHEET_INBOX)) reqs.push({ addSheet: { properties: { title: SHEET_INBOX } } });
  const criarConfig = !titles.includes(SHEET_CONFIG);
  if (criarConfig) reqs.push({ addSheet: { properties: { title: SHEET_CONFIG } } });
  if (reqs.length) await batchUpdate(reqs);

  // Cabeçalhos das abas de dados (sobrescreve a linha 1 — barato e consistente).
  await updateRange(`${SHEET_LOTES}!A1:${colLetter(LOTES_HEADER.length - 1)}1`, [LOTES_HEADER]);
  await updateRange(`${SHEET_INBOX}!A1:${colLetter(INBOX_HEADER.length - 1)}1`, [INBOX_HEADER]);

  // Config: semeia SÓ na criação, para não apagar a lista que você mantém lá.
  if (criarConfig) {
    await updateRange(`${SHEET_CONFIG}!A1:A4`, [
      ['prestador'], ['Clínica A'], ['Terapeuta B'], ['Fono C'],
    ]);
  }
}

// Lê a lista de prestadores da aba Config (coluna A, ignorando o cabeçalho).
export async function lerPrestadores() {
  const rows = await getValues(`${SHEET_CONFIG}!A2:A`);
  return rows.map((r) => (r[0] || '').trim()).filter(Boolean);
}

// ---- Inbox ----------------------------------------------------------------

export async function lerInbox() {
  const rows = await getValues(`${SHEET_INBOX}!A2:E`);
  return rows.map((r, i) => ({
    linha: i + 2,
    fileId: r[INBOX_COL.fileId] || '',
    nome: r[INBOX_COL.nome] || '',
    data_adocao: r[INBOX_COL.data_adocao] || '',
    status: r[INBOX_COL.status] || 'pendente',
    lote: r[INBOX_COL.lote] || '',
  })).filter((x) => x.fileId);
}

export async function adotarArquivos(docs) {
  // Evita duplicar fileId já presente.
  const existentes = new Set((await lerInbox()).map((x) => x.fileId));
  const novos = docs.filter((d) => !existentes.has(d.id));
  const hoje = new Date().toISOString().slice(0, 10);
  for (const d of novos) {
    await appendRow(SHEET_INBOX, [d.id, d.name || '', hoje, 'pendente', '']);
  }
  return novos.length;
}

export async function marcarInboxTriado(linha, loteLabel) {
  await updateRange(`${SHEET_INBOX}!D${linha}:E${linha}`, [['triado', loteLabel]]);
}

// Volta um item da Inbox para "pendente" (reaparece na fila).
export async function marcarInboxPendente(linha) {
  await updateRange(`${SHEET_INBOX}!D${linha}:E${linha}`, [['pendente', '']]);
}

// ---- Lotes ----------------------------------------------------------------

export async function lerLotes() {
  const rows = await getValues(`${SHEET_LOTES}!A2:L`);
  return rows.map((r, i) => ({ linha: i + 2, cols: r }))
    .filter((x) => (x.cols[COL.prestador] || '').trim());
}

// Encontra a linha do lote (prestador × mês) ou devolve null.
function acharLote(lotes, prestador, mes) {
  return lotes.find((l) => l.cols[COL.prestador] === prestador && l.cols[COL.mes] === mes) || null;
}

// Confirma a triagem de UM arquivo: marca os tipos (slots) na linha do lote,
// guardando o link do arquivo em cada slot. Cria o lote se não existir.
// tiposIds: ['NF','Relatorio',...]  link: URL de view do arquivo.
export async function confirmarTriagem({ prestador, mes, tiposIds, link, dataLimite }) {
  const lotes = await lerLotes();
  let alvo = acharLote(lotes, prestador, mes);

  if (!alvo) {
    // Nova linha com slots vazios.
    const row = new Array(LOTES_HEADER.length).fill('');
    row[COL.prestador] = prestador;
    row[COL.mes] = mes;
    row[COL.data_limite] = dataLimite || '';
    row[COL.status] = 'Aguardando';
    for (const t of tiposIds) row[COL[t]] = link;
    await appendRow(SHEET_LOTES, row);
    return;
  }

  // Lote existente: acrescenta o link em cada slot selecionado (sem apagar o que já tinha).
  const row = alvo.cols.slice();
  while (row.length < LOTES_HEADER.length) row.push('');
  for (const t of tiposIds) {
    const atual = (row[COL[t]] || '').trim();
    row[COL[t]] = atual ? (atual.includes(link) ? atual : `${atual} | ${link}`) : link;
  }
  if (!row[COL.data_limite] && dataLimite) row[COL.data_limite] = dataLimite;
  await updateRange(`${SHEET_LOTES}!A${alvo.linha}:L${alvo.linha}`, [row]);
}

// Atualiza campos avulsos de um lote (status, postagem, prazo, valor).
export async function atualizarLote(linha, patch) {
  const rows = await getValues(`${SHEET_LOTES}!A${linha}:L${linha}`);
  const row = (rows[0] || []).slice();
  while (row.length < LOTES_HEADER.length) row.push('');
  for (const [k, v] of Object.entries(patch)) {
    if (COL[k] !== undefined) row[COL[k]] = v;
  }
  await updateRange(`${SHEET_LOTES}!A${linha}:L${linha}`, [row]);
}

// ---- Reclassificação ------------------------------------------------------

const slots = (cell) => String(cell || '').split('|').map((s) => s.trim()).filter(Boolean);
const slotTemArquivo = (cell, fileId) => slots(cell).some((x) => idFromLink(x) === fileId);
const removerDoSlot = (cell, fileId) => slots(cell).filter((x) => idFromLink(x) !== fileId).join(' | ');

// Descobre a classificação atual de um arquivo (procura o link nos slots dos lotes).
// Retorna { prestador, mes, tipos:[...] } ou null.
export async function classificacaoDoArquivo(fileId) {
  const lotes = await lerLotes();
  for (const l of lotes) {
    const tipos = TIPOS_IDS.filter((t) => slotTemArquivo(l.cols[COL[t]], fileId));
    if (tipos.length) return { linha: l.linha, prestador: l.cols[COL.prestador], mes: l.cols[COL.mes], tipos };
  }
  return null;
}

// Remove o link de um arquivo de TODOS os slots. Um arquivo vive em um único lote,
// então paramos ao tratá-lo. Se o lote ficar sem nenhum link e sem dados de envio,
// a linha é apagada (evita lote fantasma).
export async function removerArquivoDeTodosLotes(fileId) {
  const lotes = await lerLotes();
  for (const l of lotes) {
    const row = l.cols.slice();
    while (row.length < LOTES_HEADER.length) row.push('');
    let mudou = false;
    for (const t of TIPOS_IDS) {
      if (slotTemArquivo(row[COL[t]], fileId)) { row[COL[t]] = removerDoSlot(row[COL[t]], fileId); mudou = true; }
    }
    if (!mudou) continue;

    const aindaTemLink = TIPOS_IDS.some((t) => (row[COL[t]] || '').trim());
    const temEnvio = (row[COL.status] || 'Aguardando') !== 'Aguardando'
      || (row[COL.data_postagem] || '') || (row[COL.rastreio] || '') || (row[COL.valor] || '');

    if (!aindaTemLink && !temEnvio) await deletarLinhaLote(l.linha);
    else await updateRange(`${SHEET_LOTES}!A${l.linha}:L${l.linha}`, [row]);
    return; // achou o lote do arquivo; encerra
  }
}

async function gidDaAba(titulo) {
  const meta = await api(`/${sid()}?fields=sheets.properties(sheetId,title)`);
  const s = (meta.sheets || []).find((x) => x.properties.title === titulo);
  return s ? s.properties.sheetId : null;
}

async function deletarLinhaLote(linha1) {
  const gid = await gidDaAba(SHEET_LOTES);
  if (gid == null) return;
  await batchUpdate([{
    deleteDimension: { range: { sheetId: gid, dimension: 'ROWS', startIndex: linha1 - 1, endIndex: linha1 } },
  }]);
}
