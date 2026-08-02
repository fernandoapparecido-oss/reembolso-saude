/**
 * PDF ÚNICO DO LOTE (para imprimir uma vez só).
 *
 * O app, ao tocar "Gerar PDF para impressão", escreve um pedido na coluna
 * `pedido_pdf` do lote. Este script (na conta dona dos arquivos) junta todos os
 * documentos daquele lote num PDF só, salva no Drive e devolve o link na coluna
 * `pdf_lote` — aí o botão no app vira "Imprimir".
 *
 * Ordem das páginas: NF, Comprovante, Laudo (compartilhados) e depois, por
 * especialidade, Relatório + Presença de cada terapia (Fono, TO, ABA…).
 * Junta PDFs e imagens (JPG/PNG viram página A4).
 *
 * OBS.: no Apps Script todos os .gs dividem o MESMO escopo. Por isso os nomes
 * aqui têm prefixo PDF_/pdf para não colidir com inbox-email.gs / aviso-prazo.gs.
 *
 * INSTALAÇÃO (na conta reembolsofamilia@gmail.com, dona da planilha/arquivos):
 *  1. Abra a planilha → Extensões → Apps Script (pode ficar junto dos outros .gs).
 *  2. Preencha PDF_COMPARTILHAR_COM (contas que vão IMPRIMIR). Se você já
 *     preencheu COMPARTILHAR_COM no inbox-email.gs, pode DEIXAR VAZIO aqui — o
 *     script reaproveita aquela lista automaticamente.
 *  3. Rode "gerarPdfsPendentes" uma vez e autorize (Drive + Sheets + acesso externo
 *     para baixar a biblioteca pdf-lib).
 *  4. Gatilho de tempo: ⏰ → Add Trigger → gerarPdfsPendentes → Time-driven →
 *     Minutes timer → a cada 1 ou 5 minutos.
 */

// Contas que vão abrir/imprimir o PDF. Deixe vazio se já preencheu COMPARTILHAR_COM
// no inbox-email.gs (será reaproveitado).
const PDF_COMPARTILHAR_COM = [
  // 'sua.conta.pessoal@gmail.com',
  // 'outra.pessoa@gmail.com',
];

const PDF_ABA_LOTES = 'Lotes';
const PDF_ABA_CONFIG = 'Config';
const PDF_ABA_REFERENCIA = 'Referencia';
const PDF_PASTA = 'Reembolso PDFs';
const PDF_LIB_URL = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';

// Colunas (0-based) — devem bater com js/model.js
const PDFC = { prestador: 0, mes: 1, NF: 2, Laudo: 3, Comprovante: 4, Relatorio: 5, Presenca: 6, pedido: 12, pdf: 13 };

function pdfEmailsCompartilhar_() {
  if (typeof COMPARTILHAR_COM !== 'undefined' && COMPARTILHAR_COM.filter(Boolean).length) return COMPARTILHAR_COM;
  return PDF_COMPARTILHAR_COM;
}

async function gerarPdfsPendentes() {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(PDF_ABA_LOTES);
  if (!sh) return;
  const vals = sh.getDataRange().getValues();
  const esps = pdfEspecialidades_(ss);
  const vigentes = pdfVigentes_(ss); // laudo/avaliação vigentes (referência)

  for (let i = 1; i < vals.length; i++) {
    const row = vals[i];
    if (!String(row[PDFC.pedido] || '').trim()) continue;   // sem pedido
    const linha = i + 1;
    try {
      pdfCarregarLib_();
      const ids = pdfColetarIds_(row, esps[String(row[PDFC.prestador] || '').trim()] || [], vigentes);
      if (!ids.length) throw new Error('lote sem documentos');
      const nome = `${row[PDFC.prestador]} ${row[PDFC.mes]}`.replace(/[\\/:*?"<>|]/g, '-').trim();
      const url = pdfSalvar_(await pdfMontar_(ids), nome);
      pdfEscrever_(sh, linha, url, '');            // pdf_lote = link, limpa pedido
    } catch (e) {
      pdfEscrever_(sh, linha, `ERRO: ${e.message}`, ''); // some o "Gerando", mostra o erro no app
    }
  }
}

function pdfEscrever_(sh, linha, pdf, pedido) {
  sh.getRange(linha, PDFC.pdf + 1).setValue(pdf);
  sh.getRange(linha, PDFC.pedido + 1).setValue(pedido);
}

// Monta o PDF único (pdf-lib). Retorna Uint8Array.
async function pdfMontar_(ids) {
  const { PDFDocument } = PDFLib;
  const out = await PDFDocument.create();
  const A4 = [595.28, 841.89];
  const margem = 28;

  for (const id of ids) {
    const file = DriveApp.getFileById(id);
    const mime = file.getMimeType();
    const raw = file.getBlob().getBytes(); // bytes assinados do Drive
    try {
      if (mime === 'application/pdf') {
        const claro = pdfDescriptografar_(raw); // remove criptografia RC4, se houver
        const src = await pdfNormalizar_(new Uint8Array(claro)); // re-escreve fluxos
        const pgs = await out.copyPages(src, src.getPageIndices());
        pgs.forEach((p) => out.addPage(p));
      } else if (mime === 'image/jpeg' || mime === 'image/png') {
        const bytes = new Uint8Array(raw);
        const img = mime === 'image/jpeg' ? await out.embedJpg(bytes) : await out.embedPng(bytes);
        const page = out.addPage(A4);
        const maxW = A4[0] - 2 * margem; const maxH = A4[1] - 2 * margem;
        const s = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = img.width * s; const h = img.height * s;
        page.drawImage(img, { x: (A4[0] - w) / 2, y: (A4[1] - h) / 2, width: w, height: h });
      }
      // outros tipos: ignora silenciosamente
    } catch (e) {
      throw new Error(`"${file.getName()}": ${e.message}`);
    }
  }
  return out.save({ useObjectStreams: false });
}

// Carrega um PDF e o re-salva uma vez, para normalizar fluxos malformados
// (ex.: stream rotulado FlateDecode mas com bytes inconsistentes → página branca).
async function pdfNormalizar_(bytes) {
  const { PDFDocument } = PDFLib;
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, throwOnInvalidObject: false });
  const re = await doc.save({ useObjectStreams: false });
  return PDFDocument.load(re, { ignoreEncryption: true });
}

function pdfSalvar_(pdfBytes, nome) {
  const pasta = pdfPasta_(PDF_PASTA);
  const it = pasta.getFilesByName(`${nome}.pdf`);
  while (it.hasNext()) it.next().setTrashed(true); // remove versão anterior
  const arq = pasta.createFile(Utilities.newBlob(pdfBytes, 'application/pdf', `${nome}.pdf`));
  pdfEmailsCompartilhar_().filter(Boolean).forEach((email) => { try { arq.addViewer(email); } catch (e) { /* ok */ } });
  return arq.getUrl();
}

// ---- ordem e leitura de slots --------------------------------------------

function pdfColetarIds_(row, especialidades, vigentes) {
  const ids = []; const seen = {};
  const push = (id) => { if (id && !seen[id]) { seen[id] = 1; ids.push(id); } };
  const slot = (idx) => pdfParseSlot_(row[idx]);
  const prestador = String(row[PDFC.prestador] || '').trim();
  const vig = (tipo, esp) => (vigentes || {})[`${tipo}||${prestador}||${esp || ''}`];

  // Compartilhados: NF, Comprovante (do lote) + Laudo (referência vigente).
  [PDFC.NF, PDFC.Comprovante].forEach((idx) => slot(idx).forEach((e) => push(e.id)));
  push(vig('Laudo', ''));

  // Por especialidade: Relatório, Presença (do lote) + Avaliação (referência vigente).
  if (especialidades.length) {
    especialidades.forEach((esp) => {
      [PDFC.Relatorio, PDFC.Presenca].forEach((idx) => slot(idx).filter((e) => e.label === esp).forEach((e) => push(e.id)));
      push(vig('Avaliacao', esp));
    });
    [PDFC.Relatorio, PDFC.Presenca].forEach((idx) => slot(idx).filter((e) => !e.label).forEach((e) => push(e.id))); // legado sem rótulo
  } else {
    [PDFC.Relatorio, PDFC.Presenca].forEach((idx) => slot(idx).forEach((e) => push(e.id)));
    push(vig('Avaliacao', ''));
  }
  return ids;
}

// Mapa dos documentos de referência VIGENTES: "tipo||prestador||esp" -> fileId.
function pdfVigentes_(ss) {
  const sh = ss.getSheetByName(PDF_ABA_REFERENCIA); const map = {};
  if (!sh) return map;
  const v = sh.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) {
    if (String(v[i][5] || '').toLowerCase() !== 'sim') continue; // só vigente
    const m = String(v[i][4] || '').match(/\/d\/([^/]+)/);
    if (m) map[`${String(v[i][0] || '').trim()}||${String(v[i][1] || '').trim()}||${String(v[i][2] || '').trim()}`] = m[1];
  }
  return map;
}

function pdfParseSlot_(cell) {
  return String(cell || '').split('|').map((s) => s.trim()).filter(String).map((entry) => {
    const i = entry.indexOf('::');
    const link = i > 0 ? entry.slice(i + 2).trim() : entry;
    const label = i > 0 ? entry.slice(0, i).trim() : '';
    const m = link.match(/\/d\/([^/]+)/);
    return { label, link, id: m ? m[1] : link };
  });
}

function pdfEspecialidades_(ss) {
  const sh = ss.getSheetByName(PDF_ABA_CONFIG); const map = {};
  if (!sh) return map;
  const v = sh.getDataRange().getValues();
  for (let i = 1; i < v.length; i++) {
    const nome = String(v[i][0] || '').trim();
    if (nome) map[nome] = String(v[i][2] || '').split(',').map((s) => s.trim()).filter(String);
  }
  return map;
}

// ---- infra ---------------------------------------------------------------

function pdfCarregarLib_() {
  if (typeof PDFLib !== 'undefined') return;
  // O Apps Script não tem setTimeout/clearTimeout, mas o pdf-lib usa. Shim síncrono
  // (executa o callback na hora — não há I/O real, só agendamento de microtask).
  if (typeof setTimeout === 'undefined') {
    globalThis.setTimeout = function (fn) { if (typeof fn === 'function') fn(); return 0; };
    globalThis.clearTimeout = function () {};
  }
  eval(UrlFetchApp.fetch(PDF_LIB_URL).getContentText()); // define PDFLib no escopo global
}

function pdfPasta_(nome) {
  const it = DriveApp.getFoldersByName(nome);
  if (it.hasNext()) return it.next();
  const pasta = DriveApp.createFolder(nome);
  pdfEmailsCompartilhar_().filter(Boolean).forEach((email) => { try { pasta.addViewer(email); } catch (e) { /* ok */ } });
  return pasta;
}

// ---- Descriptografia de PDF (RC4 / senha de usuário vazia) ----------------
// Muitos comprovantes (Mercado Pago, bancos) vêm criptografados. O pdf-lib não
// descriptografa e gera página em branco. Aqui deciframos os streams (RC4, V2/R2-R3)
// e neutralizamos o /Encrypt. PDFs com AES (V>=4) não são suportados — nesses casos,
// envie o comprovante como imagem (JPG/PNG), que sempre funciona.

const PDF_PAD = [0x28, 0xBF, 0x4E, 0x5E, 0x4E, 0x75, 0x8A, 0x41, 0x64, 0x00, 0x4E, 0x56, 0xFF, 0xFA, 0x01, 0x08,
  0x2E, 0x2E, 0x00, 0xB6, 0xD0, 0x68, 0x3E, 0x80, 0x2F, 0x0C, 0xA9, 0xFE, 0x64, 0x53, 0x69, 0x7A];

function pdfMd5_(arr) {
  const signed = arr.map((x) => ((x & 0xff) > 127 ? (x & 0xff) - 256 : (x & 0xff)));
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, signed).map((x) => x & 0xff);
}

function pdfRc4_(key, data) {
  const S = []; for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) { j = (j + S[i] + key[i % key.length]) & 255; const t = S[i]; S[i] = S[j]; S[j] = t; }
  const out = new Array(data.length); let a = 0; let b = 0;
  for (let k = 0; k < data.length; k++) { a = (a + 1) & 255; b = (b + S[a]) & 255; const t = S[a]; S[a] = S[b]; S[b] = t; out[k] = data[k] ^ S[(S[a] + S[b]) & 255]; }
  return out;
}

function pdfLatin1_(b) {
  let s = '';
  for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.slice(i, i + 8192));
  return s;
}

function pdfParseStr_(b, i) { // i aponta para '(' (literal) ou '<' (hex)
  if (b[i] === 0x3C) {
    let j = i + 1; let hex = '';
    while (b[j] !== 0x3E) { const c = String.fromCharCode(b[j]); if (/[0-9a-fA-F]/.test(c)) hex += c; j++; }
    if (hex.length % 2) hex += '0';
    const out = []; for (let k = 0; k < hex.length; k += 2) out.push(parseInt(hex.substr(k, 2), 16));
    return out;
  }
  let j = i + 1; let depth = 1; const out = []; const map = { 110: 10, 114: 13, 116: 9, 98: 8, 102: 12, 40: 40, 41: 41, 92: 92 };
  while (depth > 0) {
    const c = b[j];
    if (c === 0x5C) {
      const n = b[j + 1];
      if (n >= 0x30 && n <= 0x37) { let oct = ''; let k = j + 1; while (k < j + 4 && b[k] >= 0x30 && b[k] <= 0x37) { oct += String.fromCharCode(b[k]); k++; } out.push(parseInt(oct, 8) & 255); j = k; }
      else if (map[n] !== undefined) { out.push(map[n]); j += 2; }
      else { out.push(n); j += 2; }
    } else if (c === 0x28) { depth++; out.push(c); j++; }
    else if (c === 0x29) { depth--; if (depth > 0) out.push(c); j++; }
    else { out.push(c); j++; }
  }
  return out;
}

// Recebe bytes (assinados ou não) do PDF; devolve array de bytes decifrado, ou os
// bytes originais se não estiver criptografado. Lança erro se for AES (não suportado).
function pdfDescriptografar_(bytes) {
  const b = bytes.map((x) => x & 0xff);
  const txt = pdfLatin1_(b);
  const encRef = /\/Encrypt\s+(\d+)\s+(\d+)\s+R/.exec(txt);
  if (!encRef) return bytes; // não criptografado
  const encNum = encRef[1];
  const em = new RegExp(`${encNum}\\s+0\\s+obj`).exec(txt);
  if (!em) return bytes;
  const encStart = em.index; const encEnd = txt.indexOf('endobj', encStart);
  const er = txt.slice(encStart, encEnd);
  const V = +(/\/V\s+(\d+)/.exec(er) || [0, 0])[1];
  const R = +(/\/R\s+(\d+)/.exec(er) || [0, 0])[1];
  const Length = +((/\/Length\s+(\d+)/.exec(er) || [0, 40])[1]);
  const P = parseInt((/\/P\s+(-?\d+)/.exec(er) || [0, 0])[1], 10);
  if (V >= 4 || R >= 5) throw new Error('PDF criptografado com AES (não suportado — envie como imagem)');

  const grab = (name) => { const idx = er.indexOf(name); let k = encStart + idx + name.length; while (b[k] === 0x20 || b[k] === 0x0A || b[k] === 0x0D) k++; return pdfParseStr_(b, k); };
  const O = grab('/O');
  const idm = /\/ID\s*\[\s*/.exec(txt); let ID0 = [];
  if (idm) ID0 = pdfParseStr_(b, idm.index + idm[0].length);

  const n = Length / 8;
  const pbuf = [P & 255, (P >> 8) & 255, (P >> 16) & 255, (P >> 24) & 255];
  let key = pdfMd5_(PDF_PAD.concat(O.slice(0, 32), pbuf, ID0));
  if (R >= 3) { for (let i = 0; i < 50; i++) key = pdfMd5_(key.slice(0, n)); }
  key = key.slice(0, n);

  const objRe = /(\d+)\s+(\d+)\s+obj/g; let m; let count = 0;
  while ((m = objRe.exec(txt))) {
    const num = +m[1]; const gen = +m[2]; const after = m.index + m[0].length;
    const si = txt.indexOf('stream', after); const oi = txt.indexOf('endobj', after);
    if (si < 0 || (oi >= 0 && si > oi)) continue;
    const dict = txt.slice(after, si);
    if (/\/Type\s*\/XRef/.test(dict) || num === +encNum) continue; // xref/encrypt não se decifram
    let ds = si + 6; if (b[ds] === 0x0D) ds++; if (b[ds] === 0x0A) ds++;
    const de = txt.indexOf('endstream', ds); let dataEnd = de; if (b[dataEnd - 1] === 0x0A) dataEnd--; if (b[dataEnd - 1] === 0x0D) dataEnd--;
    const objkey = pdfMd5_(key.concat([num & 255, (num >> 8) & 255, (num >> 16) & 255, gen & 255, (gen >> 8) & 255])).slice(0, Math.min(n + 5, 16));
    const dec = pdfRc4_(objkey, b.slice(ds, dataEnd));
    for (let k = 0; k < dec.length; k++) b[ds + k] = dec[k];
    count++;
  }
  const et = `/Encrypt ${encNum} 0 R`; const ti = txt.indexOf(et);
  if (ti >= 0) for (let k = 0; k < et.length; k++) b[ti + k] = 0x20; // neutraliza /Encrypt (mesmo tamanho)
  return b;
}
