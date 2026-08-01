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

  // ID da planilha de controle. PREENCHA para a planilha vir por padrão, sem o
  // Picker: todos que tiverem acesso a ela (compartilhada) já entram direto.
  // O ID é o trecho entre /d/ e /edit na URL da planilha. Ex.: "1AbC...xyz".
  // (Se ficar vazio, o app cai no fluxo antigo de "Conectar planilha" pelo Picker.)
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
  //  Escopos OAuth — privilégio mínimo. NÃO troque por "drive" completo.
  //  drive.file  -> só arquivos criados/apontados ao app (via Picker).
  //  spreadsheets-> ler/gravar a planilha de controle.
  // ---------------------------------------------------------------------------
  SCOPES: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets',
};
