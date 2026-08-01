/**
 * INBOX POR E-MAIL — anexos que chegam por e-mail aparecem sozinhos no app.
 *
 * O que faz: varre o Gmail da conta, salva os anexos (PDF, JPG e PNG) numa pasta
 * do Drive e registra cada um na aba "Inbox" da planilha (status "pendente").
 * Como o app lê essa aba, os arquivos surgem no Inbox sem você usar o Picker.
 *
 * ONDE RODAR: na conta que RECEBE os e-mails e é dona da planilha
 * (ex.: reembolsofamilia@gmail.com). Assim o GmailApp lê a caixa certa e o
 * SpreadsheetApp.getActive() aponta a planilha.
 *
 * INSTALAÇÃO:
 *  1. Abra a planilha de controle NA CONTA do app (reembolsofamilia@gmail.com).
 *  2. Extensões → Apps Script. Cole este arquivo (pode conviver com aviso-prazo.gs).
 *  3. Preencha COMPARTILHAR_COM abaixo com os e-mails das contas PESSOAIS que usam
 *     o app (a sua e a da outra pessoa) — assim o preview funciona para elas.
 *  4. Rode "importarAnexos" uma vez e autorize (Gmail + Drive + Sheets).
 *  5. Gatilho de tempo: relógio (⏰) → Add Trigger → importarAnexos →
 *     "Time-driven" → "Minutes timer" → a cada 5 ou 10 min. Pronto.
 *
 * Se mudar COMPARTILHAR_COM depois, rode "compartilharPasta" uma vez.
 */

// ---- Configuração --------------------------------------------------------

// Contas PESSOAIS que usam o app e precisam VER os anexos no preview.
// A pasta é compartilhada com estes e-mails; os arquivos herdam o acesso.
const COMPARTILHAR_COM = [
  // 'sua.conta.pessoal@gmail.com',
  // 'outra.pessoa@gmail.com',
];

const PASTA_DRIVE = 'Reembolso Inbox';   // pasta onde os anexos são salvos
const LABEL_OK = 'reembolso-processado'; // rótulo p/ não reprocessar o mesmo e-mail
const BUSCA = 'has:attachment -label:reembolso-processado newer_than:60d';
const ABA_INBOX = 'Inbox';
const MAX_THREADS = 50;                  // por execução (volume baixo)
const MIN_IMAGEM_BYTES = 10 * 1024;      // ignora imagens minúsculas (ícones/logos)

// ---- Rotina principal ----------------------------------------------------

function importarAnexos() {
  const threads = GmailApp.search(BUSCA, 0, MAX_THREADS);
  if (!threads.length) return;

  const label = GmailApp.getUserLabelByName(LABEL_OK) || GmailApp.createLabel(LABEL_OK);
  const pasta = pegarOuCriarPasta_(PASTA_DRIVE);
  const sh = SpreadsheetApp.getActive().getSheetByName(ABA_INBOX);
  if (!sh) throw new Error('Aba "Inbox" não encontrada — abra o app e "Conectar planilha" uma vez para criá-la.');

  const existentes = idsExistentes_(sh);
  const hoje = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  threads.forEach((th) => {
    th.getMessages().forEach((msg) => {
      // includeInlineImages:false evita logos de assinatura virarem "documentos".
      msg.getAttachments({ includeInlineImages: false }).forEach((att) => {
        if (!aceita_(att)) return;
        const arq = pasta.createFile(att.copyBlob()).setName(att.getName());
        const id = arq.getId();
        if (!existentes.has(id)) {
          sh.appendRow([id, att.getName(), hoje, 'pendente', '']);
          existentes.add(id);
        }
      });
    });
    th.addLabel(label); // marca o e-mail como processado (mesmo sem anexo válido)
  });
}

// Aceita PDF, JPG e PNG. Imagens muito pequenas são descartadas (assinaturas).
function aceita_(att) {
  const ct = att.getContentType() || '';
  const nome = att.getName() || '';
  if (ct === 'application/pdf' || /\.pdf$/i.test(nome)) return true;
  const ehImg = ct === 'image/jpeg' || ct === 'image/png' || /\.(jpe?g|png)$/i.test(nome);
  if (!ehImg) return false;
  return att.getSize() >= MIN_IMAGEM_BYTES;
}

// ---- Compartilhamento da pasta (para o preview funcionar em outras contas) --

function compartilharPasta() {
  garantirCompartilhamento_(pegarOuCriarPasta_(PASTA_DRIVE));
}

function garantirCompartilhamento_(pasta) {
  COMPARTILHAR_COM.filter(Boolean).forEach((email) => {
    try { pasta.addViewer(email); } catch (e) { /* já compartilhado ou e-mail inválido */ }
  });
}

// ---- Helpers -------------------------------------------------------------

function idsExistentes_(sh) {
  const set = new Set();
  const last = sh.getLastRow();
  if (last < 2) return set;
  sh.getRange(2, 1, last - 1, 1).getValues().forEach((r) => { if (r[0]) set.add(String(r[0])); });
  return set;
}

function pegarOuCriarPasta_(nome) {
  const it = DriveApp.getFoldersByName(nome);
  if (it.hasNext()) return it.next();
  const pasta = DriveApp.createFolder(nome);
  garantirCompartilhamento_(pasta); // compartilha na criação
  return pasta;
}
