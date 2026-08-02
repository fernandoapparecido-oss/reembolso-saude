// =============================================================================
//  CONFIGURAÇÃO  —  PREENCHA ESTE BLOCO  (é o único arquivo que você edita)
// =============================================================================
//
//  Nada aqui é segredo de verdade: no fluxo OAuth no browser, o CLIENT_ID e a
//  API_KEY são PÚBLICOS por natureza. A segurança vem de RESTRINGIR POR ORIGEM
//  no Google Cloud Console (veja o README, seção "Passo a passo").
//
//  Onde conseguir cada valor está no README.
// =============================================================================

export const CONFIG = {
  // OAuth Client ID (tipo "Web application"). Ex.: "1234-abcd.apps.googleusercontent.com"
  CLIENT_ID: '709069445111-mhoiclvh1t2s1f2krlpp2nvl35s62fpm.apps.googleusercontent.com',

  // API key (para o Google Picker). Restrinja por HTTP referrer no Console.
  API_KEY: 'AIzaSyBUV7Wn55sRA0vSY5GCBqb-sIffhuhXpcM',

  // Número do projeto no Google Cloud (Project number, só dígitos). Usado pelo Picker.
  APP_ID: '709069445111',

  // Com o escopo drive.file, a planilha é apontada pelo Picker uma vez por
  // dispositivo (o app guarda o ID e não pede de novo). Deixe vazio.
  SHEET_ID: '',

  // ---------------------------------------------------------------------------
  //  Listas de seleção (sem digitação livre no app)
  // ---------------------------------------------------------------------------

  // PRESTADORES **não** ficam aqui, de propósito: para não expor nomes de
  // clínicas/terapeutas num repositório público. Eles vivem na aba "Config" da
  // planilha (coluna A) — você edita lá, sem commit, e todos os usuários veem a
  // mesma lista. Use codinome se preferir. O app cria essa aba sozinho.

  // Tipos de documento que podem existir dentro de um arquivo. NÃO renomeie as
  // chaves (id) sem atualizar a planilha; o "label" é só o texto do botão.
  TIPOS: [
    { id: 'NF',          label: 'NF' },
    { id: 'Comprovante', label: 'Comprovante' },
    { id: 'Relatorio',   label: 'Relatório' },
    { id: 'Presenca',    label: 'Presença' },
    { id: 'Laudo',          label: 'Laudo' },          // REFERÊNCIA (com vigência)
    { id: 'Avaliacao',      label: 'Avaliação' },      // REFERÊNCIA (com vigência, por terapia)
    { id: 'Exame',          label: 'Exame' },          // REFERÊNCIA (arquivo, sem vigência)
    { id: 'Pedido',         label: 'Pedido médico' },  // REFERÊNCIA (arquivo, sem vigência)
    { id: 'Encaminhamento', label: 'Encaminhamento' }, // REFERÊNCIA (arquivo, sem vigência)
  ],

  // Tipos de REFERÊNCIA (documentos à parte, fora do lote/impressão).
  REF_TIPOS: ['Laudo', 'Avaliacao', 'Exame', 'Pedido', 'Encaminhamento'],

  // Quais tipos de referência têm VIGÊNCIA (versões que se substituem, com "vigente").
  // Os demais tipos de referência são apenas ARQUIVO (acumulam, sem vigente).
  REF_VIGENCIA: ['Laudo', 'Avaliacao'],

  // Tipos que são UM POR ESPECIALIDADE (terapia): Relatório e Presença (mensais) e
  // Avaliação (referência). Os demais (NF, Comprovante, Laudo) são compartilhados.
  PER_ESPECIALIDADE: ['Relatorio', 'Presenca', 'Avaliacao'],

  // Sugestão de prazo: fim do mês de referência + N dias (você edita por lote).
  PRAZO_DIAS_APOS_MES: 90,

  // Quantos dias antes do prazo o lote acende como "prazo próximo".
  ALERTA_PRAZO_DIAS: 7,

  // ---------------------------------------------------------------------------
  //  Escopos OAuth — todos NÃO-sensíveis (sem aviso "app não verificado").
  //  openid/email/profile: só para saber a conta logada e reusá-la em silêncio
  //  no retorno (login_hint), evitando o seletor de conta toda vez.
  //  drive.file: a planilha apontada pelo Picker (a API do Sheets aceita este escopo).
  //  NÃO adicione "spreadsheets" nem "drive" completo (viram sensível → aviso volta).
  // ---------------------------------------------------------------------------
  SCOPES: 'openid email profile https://www.googleapis.com/auth/drive.file',
};
