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
    { id: 'Laudo',       label: 'Laudo' },
    { id: 'Comprovante', label: 'Comprovante' },
    { id: 'Relatorio',   label: 'Relatório' },
    { id: 'Presenca',    label: 'Presença' },
  ],

  // Tipos que são UM POR ESPECIALIDADE (terapia) quando o prestador tem
  // especialidades na Config. Os demais (NF, Laudo, Comprovante) são
  // compartilhados: um para o lote inteiro.
  PER_ESPECIALIDADE: ['Relatorio', 'Presenca'],

  // Sugestão de prazo: fim do mês de referência + N dias (você edita por lote).
  PRAZO_DIAS_APOS_MES: 90,

  // Quantos dias antes do prazo o lote acende como "prazo próximo".
  ALERTA_PRAZO_DIAS: 7,

  // ---------------------------------------------------------------------------
  //  Escopo OAuth — SÓ drive.file (NÃO-sensível → sem aviso "app não verificado").
  //  A API do Sheets funciona com drive.file na planilha apontada pelo Picker.
  //  NÃO adicione "spreadsheets" nem "drive" completo: viram escopo sensível e
  //  voltam o aviso do Google.
  // ---------------------------------------------------------------------------
  SCOPES: 'https://www.googleapis.com/auth/drive.file',
};
