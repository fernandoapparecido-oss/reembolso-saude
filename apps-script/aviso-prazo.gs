/**
 * OPCIONAL — Aviso de prazo por e-mail, sem precisar do app aberto.
 *
 * Como usar:
 *  1. Abra a planilha de controle → Extensões → Apps Script.
 *  2. Cole este arquivo. Ajuste EMAIL_DESTINO e ALERTA_DIAS abaixo.
 *  3. Rode "avisarPrazos" uma vez para autorizar.
 *  4. Gatilho de tempo: relógio (⏰) → Add Trigger → avisarPrazos →
 *     "Time-driven" → "Day timer" → ex.: 7h–8h. Pronto.
 *
 * PRIVACIDADE: o e-mail usa PRESTADOR e MÊS (use codinome no prestador se
 * quiser). Não inclui nome de paciente — não há esse dado na planilha.
 */

const EMAIL_DESTINO = Session.getActiveUser().getEmail(); // ou 'voce@gmail.com'
const ALERTA_DIAS = 7;         // avisa quando faltarem <= N dias
const ABA_LOTES = 'Lotes';

// Índices das colunas (0-based) — devem bater com js/model.js
const C = { prestador: 0, mes: 1, data_limite: 7, status: 8 };

function avisarPrazos() {
  const sh = SpreadsheetApp.getActive().getSheetByName(ABA_LOTES);
  if (!sh) return;
  const dados = sh.getDataRange().getValues().slice(1); // pula cabeçalho

  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const proximos = [];
  const vencidos = [];

  dados.forEach((r) => {
    const status = String(r[C.status] || '').trim();
    if (status === 'Enviado' || status === 'Reembolsado') return;
    const dl = parseData(r[C.data_limite]);
    if (!dl) return;
    const dias = Math.round((dl - hoje) / 86400000);
    const linha = `• ${r[C.prestador]} — ${r[C.mes]} — prazo ${fmt(dl)} (${dias < 0 ? 'VENCIDO' : 'faltam ' + dias + 'd'})`;
    if (dias < 0) vencidos.push(linha);
    else if (dias <= ALERTA_DIAS) proximos.push(linha);
  });

  if (!proximos.length && !vencidos.length) return;

  let corpo = '';
  if (vencidos.length) corpo += 'VENCIDOS:\n' + vencidos.join('\n') + '\n\n';
  if (proximos.length) corpo += 'PRAZO PRÓXIMO:\n' + proximos.join('\n') + '\n';

  MailApp.sendEmail({
    to: EMAIL_DESTINO,
    subject: `⏱ Reembolso: ${vencidos.length} vencido(s), ${proximos.length} próximo(s)`,
    body: corpo + '\n(App: abra a planilha/triagem para completar e postar.)',
  });
}

function parseData(v) {
  if (v instanceof Date) { const d = new Date(v); d.setHours(0, 0, 0, 0); return d; }
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function fmt(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'dd/MM/yyyy');
}
