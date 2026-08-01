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

  for (let i = 1; i < vals.length; i++) {
    const row = vals[i];
    if (!String(row[PDFC.pedido] || '').trim()) continue;   // sem pedido
    const linha = i + 1;
    try {
      pdfCarregarLib_();
      const ids = pdfColetarIds_(row, esps[String(row[PDFC.prestador] || '').trim()] || []);
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
    const bytes = new Uint8Array(file.getBlob().getBytes());
    if (mime === 'application/pdf') {
      const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
      const pgs = await out.copyPages(src, src.getPageIndices());
      pgs.forEach((p) => out.addPage(p));
    } else if (mime === 'image/jpeg' || mime === 'image/png') {
      const img = mime === 'image/jpeg' ? await out.embedJpg(bytes) : await out.embedPng(bytes);
      const page = out.addPage(A4);
      const maxW = A4[0] - 2 * margem; const maxH = A4[1] - 2 * margem;
      const s = Math.min(maxW / img.width, maxH / img.height, 1);
      const w = img.width * s; const h = img.height * s;
      page.drawImage(img, { x: (A4[0] - w) / 2, y: (A4[1] - h) / 2, width: w, height: h });
    }
    // outros tipos: ignora silenciosamente
  }
  return out.save();
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

function pdfColetarIds_(row, especialidades) {
  const ids = []; const seen = {};
  const push = (id) => { if (id && !seen[id]) { seen[id] = 1; ids.push(id); } };
  const slot = (idx) => pdfParseSlot_(row[idx]);

  [PDFC.NF, PDFC.Comprovante, PDFC.Laudo].forEach((idx) => slot(idx).forEach((e) => push(e.id)));
  if (especialidades.length) {
    especialidades.forEach((esp) => [PDFC.Relatorio, PDFC.Presenca].forEach((idx) => slot(idx).filter((e) => e.label === esp).forEach((e) => push(e.id))));
    [PDFC.Relatorio, PDFC.Presenca].forEach((idx) => slot(idx).filter((e) => !e.label).forEach((e) => push(e.id))); // legado sem rótulo
  } else {
    [PDFC.Relatorio, PDFC.Presenca].forEach((idx) => slot(idx).forEach((e) => push(e.id)));
  }
  return ids;
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
  eval(UrlFetchApp.fetch(PDF_LIB_URL).getContentText()); // define PDFLib no escopo global
}

function pdfPasta_(nome) {
  const it = DriveApp.getFoldersByName(nome);
  if (it.hasNext()) return it.next();
  const pasta = DriveApp.createFolder(nome);
  pdfEmailsCompartilhar_().filter(Boolean).forEach((email) => { try { pasta.addViewer(email); } catch (e) { /* ok */ } });
  return pasta;
}
