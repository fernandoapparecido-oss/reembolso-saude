/**
 * INBOX POR E-MAIL — anexos que chegam por e-mail aparecem sozinhos no app.
 *
 * O que faz: varre o Gmail da conta, salva os anexos PDF numa pasta do Drive e
 * registra cada um na aba "Inbox" da planilha (status "pendente"). Como o app lê
 * essa aba, os arquivos surgem no Inbox sem você usar o Picker.
 *
 * IMPORTANTE — em qual conta rodar:
 *  Rode este script na conta que RECEBE os e-mails (ex.: reembolsofamilia@gmail.com),
 *  que deve ser dona (ou ter acesso de edição) da planilha de controle. Assim o
 *  GmailApp lê a caixa certa e o SpreadsheetApp.getActive() aponta a planilha.
 *
 * Como instalar:
 *  1. Abra a planilha de controle NA CONTA reembolsofamilia@gmail.com.
 *  2. Extensões → Apps Script. Cole este arquivo (pode conviver com aviso-prazo.gs).
 *  3. Rode "importarAnexos" uma vez e autorize (Gmail + Drive + Sheets).
 *  4. Gatilho de tempo: relógio (⏰) → Add Trigger → importarAnexos →
 *     "Time-driven" → "Minutes timer" → a cada 5 ou 10 min. Pronto.
 *
 * Previews para outras pessoas (multiusuário):
 *  Os anexos ficam na pasta PASTA_DRIVE, criada nesta conta. Para quem usa o app
 *  com OUTRA conta ver o preview, COMPARTILHE essa pasta com os e-mails delas
 *  (Drive → pasta "Reembolso Inbox" → Compartilhar). Quem usa esta mesma conta
 *  não precisa fazer nada.
 */

const PASTA_DRIVE = 'Reembolso Inbox';   // pasta onde os anexos são salvos
const LABEL_OK = 'reembolso-processado'; // rótulo p/ não reprocessar o mesmo e-mail
const BUSCA = 'has:attachment -label:reembolso-processado newer_than:60d';
const ABA_INBOX = 'Inbox';
const MAX_THREADS = 50;                  // por execução (volume baixo)

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
      msg.getAttachments().forEach((att) => {
        if (!ehPdf_(att)) return;
        const arq = pasta.createFile(att.copyBlob()).setName(att.getName());
        const id = arq.getId();
        if (!existentes.has(id)) {
          sh.appendRow([id, att.getName(), hoje, 'pendente', '']);
          existentes.add(id);
        }
      });
    });
    th.addLabel(label); // marca o e-mail como processado (mesmo sem PDF), evita revarrer
  });
}

function ehPdf_(att) {
  return att.getContentType() === 'application/pdf' || /\.pdf$/i.test(att.getName() || '');
}

function idsExistentes_(sh) {
  const set = new Set();
  const last = sh.getLastRow();
  if (last < 2) return set;
  sh.getRange(2, 1, last - 1, 1).getValues().forEach((r) => { if (r[0]) set.add(String(r[0])); });
  return set;
}

function pegarOuCriarPasta_(nome) {
  const it = DriveApp.getFoldersByName(nome);
  return it.hasNext() ? it.next() : DriveApp.createFolder(nome);
}
