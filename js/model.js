// Modelo de dados da planilha de controle (uma linha por LOTE = prestador × mês).
// Este arquivo é a "fonte da verdade" do formato — mexa aqui se mudar colunas.

export const SHEET_LOTES = 'Lotes';
export const SHEET_INBOX = 'Inbox';
export const SHEET_CONFIG = 'Config'; // prestadores (coluna A) — fora do repo público
export const SHEET_REFERENCIA = 'Referencia'; // laudos/avaliações anuais, com versões

// Aba "Referencia": uma linha por VERSÃO de documento anual (laudo/avaliação).
export const REF_HEADER = ['tipo', 'prestador', 'especialidade', 'data_emissao', 'link', 'vigente'];
export const REF_COL = { tipo: 0, prestador: 1, especialidade: 2, data_emissao: 3, link: 4, vigente: 5 };

export const SHEET_PROTOCOLOS = 'Protocolos'; // protocolos/chamados com o plano de saúde
export const PROTO_HEADER = ['data_abertura', 'protocolo', 'titulo', 'descricao', 'prazo', 'status'];
export const PROTO_COL = { data_abertura: 0, protocolo: 1, titulo: 2, descricao: 3, prazo: 4, status: 5 };

// Ordem das colunas da aba "Lotes" (0-indexado). Também é o cabeçalho.
export const LOTES_HEADER = [
  'prestador',      // 0
  'mes_referencia', // 1  (YYYY-MM)
  'NF',             // 2  link(s)
  'Laudo',          // 3  link(s)
  'Comprovante',    // 4  link(s)
  'Relatorio',      // 5  link(s)
  'Presenca',       // 6  link(s)
  'data_limite',    // 7  (YYYY-MM-DD)
  'status',         // 8  Aguardando | Completo | Enviado | Reembolsado
  'data_postagem',  // 9  (YYYY-MM-DD)
  'rastreio',       // 10
  'valor',          // 11
  'pedido_pdf',     // 12  timestamp do pedido de PDF (app escreve; Apps Script limpa)
  'pdf_lote',       // 13  link do PDF único juntado (Apps Script escreve)
];

export const COL = {
  prestador: 0, mes: 1,
  NF: 2, Laudo: 3, Comprovante: 4, Relatorio: 5, Presenca: 6,
  data_limite: 7, status: 8, data_postagem: 9, rastreio: 10, valor: 11,
  pedido_pdf: 12, pdf_lote: 13,
};

// Tipos (slots de documento) na ordem das colunas — independentes dos rótulos do config.
export const TIPOS_IDS = ['NF', 'Laudo', 'Comprovante', 'Relatorio', 'Presenca'];

// Aba "Inbox": rastreia arquivos APONTADOS ao app (via Picker) e se já foram triados.
export const INBOX_HEADER = ['fileId', 'nome', 'data_adocao', 'status', 'lote'];
export const INBOX_COL = { fileId: 0, nome: 1, data_adocao: 2, status: 3, lote: 4 };

export const STATUS = {
  AGUARDANDO: 'Aguardando',
  COMPLETO: 'Completo',
  ENVIADO: 'Enviado',
  REEMBOLSADO: 'Reembolsado',
};

// A1 helper: índice de coluna (0-based) -> letra ("A", "B", ... "AA").
export function colLetter(i) {
  let s = '';
  i += 1;
  while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); }
  return s;
}

// Link canônico de visualização a partir do ID do arquivo do Drive.
export function fileViewLink(id) { return `https://drive.google.com/file/d/${id}/view`; }
export function filePreviewLink(id) { return `https://drive.google.com/file/d/${id}/preview`; }

// Extrai o ID do arquivo de um link do Drive (ou devolve o próprio texto).
export function idFromLink(link) {
  const m = String(link || '').match(/\/d\/([^/]+)/);
  return m ? m[1] : link;
}

// ---- Slots com rótulo de especialidade -----------------------------------
// Uma célula guarda entradas separadas por " | ". Cada entrada pode ser um link
// simples (compartilhado) ou rotulada por especialidade: "Fono::<link>".
export const SLOT_SEP = ' | ';

export function parseSlot(cell) {
  return String(cell || '').split('|').map((s) => s.trim()).filter(Boolean).map((entry) => {
    const i = entry.indexOf('::');
    const label = i > 0 ? entry.slice(0, i).trim() : '';
    const link = i > 0 ? entry.slice(i + 2).trim() : entry;
    return { label, link, id: idFromLink(link) };
  });
}

export function buildSlot(entries) {
  return entries.map((e) => (e.label ? `${e.label}::${e.link}` : e.link)).join(SLOT_SEP);
}

// Normaliza um texto de tipo (aceita rótulo/acentos) para o id canônico ou null.
export function tipoCanonico(txt) {
  const s = String(txt || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const map = { nf: 'NF', laudo: 'Laudo', comprovante: 'Comprovante', relatorio: 'Relatorio', presenca: 'Presenca' };
  return map[s] || null;
}

// Lista de meses (YYYY-MM) dos últimos N meses, com rótulo pt-BR.
export function mesesRecentes(n = 18) {
  const out = [];
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' });
  for (let k = 0; k < n; k++) {
    const d = new Date(now.getFullYear(), now.getMonth() - k, 1);
    const id = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ id, label: fmt.format(d) });
  }
  return out;
}

// Sugestão de data-limite = último dia do mês de referência + PRAZO_DIAS_APOS_MES.
export function sugerirDataLimite(mesRef, prazoDias) {
  const [y, m] = mesRef.split('-').map(Number);
  const fimMes = new Date(y, m, 0); // dia 0 do mês seguinte = último dia do mês
  fimMes.setDate(fimMes.getDate() + Number(prazoDias || 0));
  return isoDate(fimMes);
}

export function isoDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function hojeISO() { return isoDate(new Date()); }

// Dias até a data (negativo = vencido). null se sem data.
export function diasAte(iso) {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const alvo = new Date(y, m - 1, d);
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  return Math.round((alvo - hoje) / 86400000);
}
