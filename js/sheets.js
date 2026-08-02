// Acesso ao Google Sheets (REST v4) usando o access token do GIS.
// Trata 403/429 com backoff exponencial (cota/limite).
import { getToken, ensureToken } from './auth.js';
import { store } from './store.js';
import { CONFIG } from './config.js';
import {
  SHEET_LOTES, SHEET_INBOX, SHEET_CONFIG, SHEET_REFERENCIA, LOTES_HEADER, INBOX_HEADER,
  REF_HEADER, REF_COL, COL, INBOX_COL, TIPOS_IDS, colLetter, idFromLink,
  parseSlot, buildSlot, tipoCanonico,
} from './model.js';

const BASE = 'https://sheets.googleapis.com/v4/spreadsheets';
const COL_FIM = colLetter(LOTES_HEADER.length - 1); // última coluna dos Lotes (ex.: "N")
const rangeLote = (linha) => `${SHEET_LOTES}!A${linha}:${COL_FIM}${linha}`;

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
  let res;
  try {
    res = await fetchWithBackoff(`${BASE}${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${getToken()}`,
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    });
  } catch (e) {
    // 401/403/404 = perdeu acesso à planilha (ou ID inválido) → sinaliza p/ reconectar.
    if (/\b(401|403|404)\b/.test(e.message || '')) throw new Error('SEM_ACESSO');
    throw e;
  }
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
  if (!titles.includes(SHEET_REFERENCIA)) reqs.push({ addSheet: { properties: { title: SHEET_REFERENCIA } } });
  if (reqs.length) await batchUpdate(reqs);

  // Cabeçalhos das abas de dados (sobrescreve a linha 1 — barato e consistente).
  await updateRange(`${SHEET_LOTES}!A1:${colLetter(LOTES_HEADER.length - 1)}1`, [LOTES_HEADER]);
  await updateRange(`${SHEET_INBOX}!A1:${colLetter(INBOX_HEADER.length - 1)}1`, [INBOX_HEADER]);
  await updateRange(`${SHEET_REFERENCIA}!A1:${colLetter(REF_HEADER.length - 1)}1`, [REF_HEADER]);

  // Config: cabeçalho de 3 colunas (não apaga dados). Exemplos só na criação.
  await updateRange(`${SHEET_CONFIG}!A1:C1`, [['prestador', 'tipos', 'especialidades']]);
  if (criarConfig) {
    await updateRange(`${SHEET_CONFIG}!A2:C4`, [
      ['Clínica A', 'NF, Comprovante, Relatorio, Presenca', 'Fono, TO, ABA'],
      ['Terapeuta B', 'NF, Comprovante, Relatorio, Presenca', ''],
      ['Consultório Médico C', 'NF, Comprovante', ''],
    ]);
  }
}

// Lê os PERFIS de prestador da aba Config:
//   A = prestador | B = tipos exigidos (csv) | C = especialidades (csv)
// tipos vazio  -> exige todos os 5 (fornecedor único). especialidades vazio -> sem terapias.
export async function lerPerfis() {
  const rows = await getValues(`${SHEET_CONFIG}!A2:C`);
  return rows.map((r) => {
    const tipos = String(r[1] || '').split(',').map(tipoCanonico).filter(Boolean);
    return {
      prestador: (r[0] || '').trim(),
      tipos: tipos.length ? tipos : TIPOS_IDS.slice(),
      especialidades: String(r[2] || '').split(',').map((s) => s.trim()).filter(Boolean),
    };
  }).filter((p) => p.prestador);
}

// Compat: só os nomes de prestador.
export async function lerPrestadores() {
  return (await lerPerfis()).map((p) => p.prestador);
}

// ---- Referência (laudos/avaliações anuais, com versões) -------------------

export async function lerReferencia() {
  const rows = await getValues(`${SHEET_REFERENCIA}!A2:F`);
  return rows.map((r, i) => ({
    linha: i + 2,
    tipo: r[REF_COL.tipo] || '',
    prestador: r[REF_COL.prestador] || '',
    especialidade: r[REF_COL.especialidade] || '',
    data_emissao: r[REF_COL.data_emissao] || '',
    link: r[REF_COL.link] || '',
    vigente: (r[REF_COL.vigente] || '').toLowerCase() === 'sim',
  })).filter((x) => x.link);
}

const mesmaChaveRef = (a, tipo, prestador, esp) => a.tipo === tipo && a.prestador === prestador && (a.especialidade || '') === (esp || '');

// Adiciona um documento de referência. Se o tipo tem VIGÊNCIA, arquiva o vigente
// anterior (mesma chave) e marca este como vigente. Se é só ARQUIVO, apenas acumula.
export async function adicionarReferencia({ tipo, prestador, especialidade, data_emissao, link }) {
  const temVigencia = CONFIG.REF_VIGENCIA.includes(tipo);
  if (temVigencia) {
    const todas = await lerReferencia();
    for (const r of todas) {
      if (r.vigente && mesmaChaveRef(r, tipo, prestador, especialidade)) {
        await updateRange(`${SHEET_REFERENCIA}!F${r.linha}`, [['']]);
      }
    }
  }
  await appendRow(SHEET_REFERENCIA, [tipo, prestador, especialidade || '', data_emissao || '', link, temVigencia ? 'sim' : '']);
}

// Torna uma versão específica a vigente (e arquiva as outras da mesma chave).
export async function tornarVigente(linha) {
  const todas = await lerReferencia();
  const alvo = todas.find((r) => r.linha === linha);
  if (!alvo) return;
  for (const r of todas) {
    if (mesmaChaveRef(r, alvo.tipo, alvo.prestador, alvo.especialidade)) {
      await updateRange(`${SHEET_REFERENCIA}!F${r.linha}`, [[r.linha === linha ? 'sim' : '']]);
    }
  }
}

// Link do documento VIGENTE para uma chave (ou '' se não houver).
export function vigenteDe(referencias, tipo, prestador, especialidade) {
  const r = referencias.find((x) => x.vigente && mesmaChaveRef(x, tipo, prestador, especialidade));
  return r ? r.link : '';
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
  const rows = await getValues(`${SHEET_LOTES}!A2:${COL_FIM}`);
  return rows.map((r, i) => ({ linha: i + 2, cols: r }))
    .filter((x) => (x.cols[COL.prestador] || '').trim());
}

// Encontra a linha do lote (prestador × mês) ou devolve null.
function acharLote(lotes, prestador, mes) {
  return lotes.find((l) => l.cols[COL.prestador] === prestador && l.cols[COL.mes] === mes) || null;
}

// Acrescenta um link a um slot. Para tipos por-especialidade, cria UMA entrada
// rotulada por especialidade marcada (um arquivo pode cobrir várias). Para tipos
// compartilhados, uma entrada sem rótulo. Nunca duplica (mesmo rótulo + arquivo).
function marcarSlot(cell, tipo, link, fileId, especialidades) {
  const entries = parseSlot(cell);
  const add = (label) => { if (!entries.some((e) => e.label === label && e.id === fileId)) entries.push({ label, link, id: fileId }); };
  const porEsp = CONFIG.PER_ESPECIALIDADE.includes(tipo) && especialidades && especialidades.length;
  if (porEsp) especialidades.forEach((esp) => add(esp));
  else add('');
  return buildSlot(entries);
}

// Confirma a triagem de UM arquivo: marca os tipos (slots) na linha do lote,
// guardando o link (rotulado por especialidade quando for o caso). Cria o lote se não existir.
// tiposIds: ['NF','Relatorio',...]  especialidades: ['Fono','ABA'] (p/ tipos por-especialidade).
export async function confirmarTriagem({ prestador, mes, tiposIds, especialidades, link, dataLimite }) {
  const fileId = idFromLink(link);
  const lotes = await lerLotes();
  const alvo = acharLote(lotes, prestador, mes);

  const row = alvo ? alvo.cols.slice() : new Array(LOTES_HEADER.length).fill('');
  while (row.length < LOTES_HEADER.length) row.push('');
  if (!alvo) {
    row[COL.prestador] = prestador;
    row[COL.mes] = mes;
    row[COL.status] = 'Aguardando';
  }
  for (const t of tiposIds) row[COL[t]] = marcarSlot(row[COL[t]], t, link, fileId, especialidades);
  if (!row[COL.data_limite] && dataLimite) row[COL.data_limite] = dataLimite;

  if (!alvo) await appendRow(SHEET_LOTES, row);
  else await updateRange(rangeLote(alvo.linha), [row]);
}

// Atualiza campos avulsos de um lote (status, postagem, prazo, valor).
export async function atualizarLote(linha, patch) {
  const rows = await getValues(rangeLote(linha));
  const row = (rows[0] || []).slice();
  while (row.length < LOTES_HEADER.length) row.push('');
  for (const [k, v] of Object.entries(patch)) {
    if (COL[k] !== undefined) row[COL[k]] = v;
  }
  await updateRange(rangeLote(linha), [row]);
}

// Pede a geração do PDF único do lote (o Apps Script junta e devolve o link).
export async function pedirPdfLote(linha) {
  await atualizarLote(linha, { pedido_pdf: new Date().toISOString(), pdf_lote: '' });
}

// ---- Reclassificação ------------------------------------------------------

const slotTemArquivo = (cell, fileId) => parseSlot(cell).some((e) => e.id === fileId);
const removerDoSlot = (cell, fileId) => buildSlot(parseSlot(cell).filter((e) => e.id !== fileId));

// Descobre a classificação atual de um arquivo (procura o link nos slots dos lotes).
// Retorna { prestador, mes, tipos:[...], especialidades:[...] } ou null.
export async function classificacaoDoArquivo(fileId) {
  const lotes = await lerLotes();
  for (const l of lotes) {
    const tipos = [];
    const especialidades = new Set();
    for (const t of TIPOS_IDS) {
      const matches = parseSlot(l.cols[COL[t]]).filter((e) => e.id === fileId);
      if (matches.length) {
        tipos.push(t);
        matches.forEach((m) => { if (m.label) especialidades.add(m.label); });
      }
    }
    if (tipos.length) return { linha: l.linha, prestador: l.cols[COL.prestador], mes: l.cols[COL.mes], tipos, especialidades: [...especialidades] };
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
    else await updateRange(rangeLote(l.linha), [row]);
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
