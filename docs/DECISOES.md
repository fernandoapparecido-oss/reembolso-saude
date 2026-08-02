# Decisões de Arquitetura (ADR) — Triagem de Reembolso

Este documento registra **o que foi decidido e por quê**, incluindo alternativas
descartadas e como a arquitetura **evoluiu** durante o desenvolvimento. É a
referência para entender o "porquê" por trás do código.

> Complementos: **[../README.md](../README.md)** (setup passo a passo e modelo de
> dados) e **[OPERACAO.md](OPERACAO.md)** (runbook de operação e troubleshooting).

---

## 1. Problema e objetivos

Enviar, por **correio**, documentos de reembolso de plano de saúde (terapias) com
**prazo**. Os documentos chegam por **canais misturados** (WhatsApp, e-mail, papel),
cada prestador do seu jeito, e **um único PDF pode conter vários tipos** (NF +
relatório + presença). Necessidades centrais:

- Ver **de relance o que falta** por prestador/mês e **não perder prazo**.
- **Multiusuário** (mais de uma pessoa opera).
- **Minimizar tempo manual** (o toque humano fica só no "o que tem dentro").

Tipos de documento: **NF, Laudo, Comprovante, Relatório, Presença**.

## 2. Princípios que guiaram as escolhas

1. **Sem backend próprio.** Nada de servidor para manter. Tudo roda no browser +
   serviços gratuitos do Google.
2. **Privilégio mínimo.** Escopos OAuth só o necessário; nada sensível quando dá
   para evitar.
3. **Privacidade primeiro.** Dados de saúde: codinome no lugar do nome do paciente;
   nada sensível no repositório; token só em memória.
4. **Ecossistema Google gratuito**, conta `@gmail` dedicada, GitHub Pages.
5. **Toque humano onde importa** (o que existe dentro do arquivo); automação no
   resto (entrada, controle, junção para impressão).

---

## 3. Arquitetura (visão de componentes)

```
Navegador (Android/Chrome)                Conta Google dedicada (reembolsofamilia)
┌───────────────────────────┐            ┌──────────────────────────────────────┐
│ App estático (GitHub Pages)│  Sheets API│ Google Sheets (banco/controle)        │
│  - HTML/CSS/JS vanilla     │◀──────────▶│   abas: Lotes | Inbox | Config        │
│  - GIS token client (OAuth)│            │ Google Drive (arquivos)               │
│  - Google Picker           │  Picker    │   pastas: Reembolso Inbox | PDFs      │
│  - Preview via iframe Drive │◀──────────▶│                                       │
└───────────────────────────┘            │ Apps Scripts (automação, sem servidor)│
        ▲  PWA instalável                 │   inbox-email.gs  (e-mail → Inbox)    │
        │                                 │   merge-lote.gs   (PDF único p/ print)│
   Cloudflare (DNS/CDN puro, opcional)    │   aviso-prazo.gs  (e-mail de prazo)   │
                                          └──────────────────────────────────────┘
```

Fluxo de telas: **Inbox** (fila + badge) → **Triagem** (preview + seleção) →
**Lotes** (status, prazos, impressão, envio).

---

## 4. Decisões

Formato: **Contexto → Decisão → Porquê → Consequências.**

### D1. Repositório separado
- **Decisão:** criar `reembolso-saude`, sem misturar com outros projetos.
- **Porquê:** app sem relação com outros; evita bagunçar deploy, README e base path.
- **Consequências:** deploy e Pages próprios; escopo de OAuth próprio.

### D2. Front-end estático, vanilla (sem build)
- **Decisão:** HTML/CSS/JS puro (ES modules), servido direto pelo GitHub Pages.
- **Porquê:** zero passo de build; OAuth mais simples (origem única, sem `dist`);
  manutenção mínima. A especificação pedia site estático.
- **Consequências:** sem framework; DOM manipulado por um helper (`ui.js`).
  Atualização de assets exige **cache-busting** (ver D16).

### D3. Sem backend — OAuth no browser (GIS token client)
- **Decisão:** autenticação com **Google Identity Services** (token client), OAuth
  no navegador. Token de acesso vive **só em memória**.
- **Porquê:** elimina servidor para manter. `client_id`/`API key` são **públicos por
  natureza** nesse fluxo — a proteção real é **restrição por origem/referrer**.
- **Consequências:** **não há refresh token** no browser → sem login "eterno" sem
  backend (mitigado por login silencioso + produção, ver D8). Token expira em ~1h.

### D4. Google Sheets como banco/controlador
- **Decisão:** a planilha é o "banco". Uma linha por **lote** (ver D9).
- **Porquê:** gratuito, compartilhável, editável à mão, sem infra. Cota folgada
  (~12k req/min por usuário).
- **Consequências:** operações são chamadas REST ao Sheets API; erros 403/429 com
  **backoff exponencial** (`sheets.js`).

### D5. Google Drive como repositório de arquivos
- **Decisão:** os PDFs/imagens ficam no Drive; o app guarda **links** (com ID).
- **Porquê:** já é onde os arquivos caem (scan, WhatsApp, e-mail); preview nativo.
- **Consequências:** preview via **iframe** `drive.google.com/file/d/{ID}/preview`
  (usa a sessão do navegador, não a API — ver D13).

### D6. Escopo OAuth — evolução até `drive.file` + perfil
- **Contexto:** começou com `drive.file` **+ `spreadsheets`**.
- **Problema descoberto:** `spreadsheets` é **escopo sensível** → em produção
  dispara o aviso **"app não verificado"** e/ou exige verificação do Google.
- **Decisão final:** usar **apenas escopos NÃO-sensíveis**:
  `openid email profile` **+ `drive.file`**.
- **Porquê:** a **API do Sheets aceita `drive.file`** para planilhas que o app
  abriu via Picker. Assim o app lê/grava a planilha **sem** o escopo sensível →
  **sem aviso e sem verificação**. `openid/email/profile` servem para saber a conta
  logada e reusá-la em silêncio (ver D8).
- **Consequências:** **não** dá para "trazer a planilha por SHEET_ID fixo" sem
  Picker (isso exigiria `spreadsheets`). Aceitamos o **Picker uma vez por device**
  como preço de uma produção limpa. (Ver "Alternativas descartadas".)

### D7. Google Picker para "adoção" de arquivos
- **Decisão:** o app aponta arquivos/planilha via **Google Picker**.
- **Porquê:** com `drive.file`, o app **não enxerga** arquivos criados por fora
  (scan, WhatsApp, e-mail). Ao selecionar no Picker, o Google **concede** ao app
  acesso `drive.file` àquele item. É o ponto de atrito conhecido do `drive.file`,
  resolvido pelo Picker.
- **Consequências:** cada pessoa **aponta a planilha uma vez por dispositivo**; o ID
  fica no `localStorage` e não é pedido de novo. A entrada por e-mail (D11) contorna
  o Picker para os anexos.

### D8. Login persistente sem backend
- **Decisão:** (a) **login silencioso** no carregamento (`prompt:''`); (b)
  **`login_hint`** com o e-mail salvo para reusar a conta sem o seletor; (c)
  **publicar o app em produção** para a autorização ser lembrada.
- **Porquê:** sem refresh token, a melhor persistência possível é o GIS renovar o
  token em silêncio quando há sessão Google ativa. O `hint` evita o seletor de conta.
- **Alvo:** **Android + Chrome** (o PWA instalado **compartilha a sessão** do Chrome
  → silencioso funciona). **iOS está fora de escopo** (isola a sessão; login a cada
  abertura). Resultado obtido: login **uma vez**, depois entra direto.
- **Consequências:** se um dia o alvo incluir iOS ou exigir login realmente
  permanente, a única saída é um **backend leve** só para guardar o refresh token.

### D9. Modelo de dados — 1 linha por lote (prestador × mês)
- **Decisão:** a unidade é o **lote = prestador × mês de referência** (o "envelope"
  postal). Colunas de tipo guardam **links**; vários links no mesmo slot separados
  por ` | `.
- **Porquê:** o envio é um envelope por prestador/mês; agrupar por lote reflete a
  realidade. "Um arquivo, uma ação, marca vários requisitos."
- **Consequências:** `Lotes` tem colunas
  `prestador | mes | NF | Laudo | Comprovante | Relatorio | Presenca | data_limite |
  status | data_postagem | rastreio | valor | pedido_pdf | pdf_lote`.

### D10. Perfil por prestador + especialidades (na Config)
- **Contexto:** casos diferentes — médico (só NF+Comprovante), fornecedor único (1
  de cada), **clínica multi-terapia** (1 NF cobre tudo, mas **relatório e presença
  são um por terapia**: Fono, TO, ABA…).
- **Decisão:** a aba **`Config`** define, por prestador, os **tipos exigidos** e as
  **especialidades**. Tipos "por especialidade" (`Relatorio`, `Presenca`, em
  `PER_ESPECIALIDADE`) são guardados **rotulados** no slot: `Fono::link | ABA::link`.
  NF/Laudo/Comprovante são **compartilhados** (um para o lote).
- **Porquê:** o mesmo mecanismo cobre os três casos sem quebrar o modelo de 1 linha
  por lote. A completude ("o que falta") passa a ser **precisa por terapia**.
- **Consequências:** triagem mostra só os tipos exigidos; pede especialidade(s)
  quando aplicável (**multi-seleção + "Todas"** — um anexo pode cobrir várias
  terapias). Painel de Lotes mostra a **matriz** por especialidade.

### D11. Entrada por e-mail (Apps Script)
- **Decisão:** `inbox-email.gs` (na conta dona) varre o Gmail, salva anexos (PDF,
  JPG, PNG) numa pasta do Drive e **escreve na aba `Inbox`** — os arquivos aparecem
  sozinhos no app, **sem Picker**.
- **Porquê:** maior economia de tempo; a caixa de entrada vira o hub. Só processa
  **remetentes reconhecidos** (`REMETENTES_PERMITIDOS`), ignora imagens inline e
  minúsculas (assinaturas) e não reprocessa (rótulo `reembolso-processado`).
- **Chave técnica:** funciona **sem `drive.file` no anexo** porque o app **não chama
  a API do Drive no arquivo** — ele lê a aba `Inbox` e faz **preview por iframe**
  (sessão do navegador). Basta a conta logada **enxergar** o arquivo (a pasta é
  compartilhada com as contas via `COMPARTILHAR_COM`).

### D12. Impressão — PDF único do lote (Apps Script + pdf-lib)
- **Decisão:** botão **"Gerar PDF para impressão"** no lote. O app grava um pedido
  na planilha (`pedido_pdf`); `merge-lote.gs` junta **todos os documentos do lote
  num PDF só** (ordem: NF, Comprovante, Laudo e depois Relatório+Presença por
  especialidade; junta **PDFs e imagens**) e devolve o link em `pdf_lote`. O botão
  vira **🖨 Imprimir**.
- **Porquê da divisão de trabalho:** o app **não lê os bytes** dos anexos (só
  `drive.file`/preview). Quem lê tudo é o Apps Script na **conta dona**. A
  comunicação **via planilha** (assíncrona) evita CORS de Web App.
- **"Um clique = uma impressão":** o navegador **não** imprime direto na impressora
  (trava de segurança); o ganho vem do **PDF único** (um Ctrl+P).
- **Ver D15** para a descriptografia que isso exigiu.

### D13. Preview por iframe (não por renderizador próprio)
- **Decisão:** preview via `.../preview` em `<iframe>`.
- **Porquê:** zero dependência; usa a sessão autenticada do navegador; funciona para
  PDF e imagem. Reforça por que o app não precisa de acesso de API ao arquivo.

### D14. Config na planilha, não no código
- **Decisão:** prestadores/tipos/especialidades vivem na aba **`Config`**, não em
  `config.js`.
- **Porquê:** **privacidade** (não expor nomes de clínicas no repo público) e
  **edição sem commit** (todos veem a mesma lista). O app cria a aba com exemplos.

### D15. Descriptografia de PDF (RC4) para impressão
- **Contexto:** comprovantes (Mercado Pago, bancos) vêm **criptografados** (RC4,
  V2/R3, senha de usuário vazia). O `pdf-lib` com `ignoreEncryption` **não
  descriptografa** → página **em branco** (erro `zlib: incorrect header check`).
- **Decisão:** implementar um **descriptografador RC4 em Apps Script** (MD5 via
  `Utilities`, RC4 e parser de PDF em arrays), rodando **antes** do merge; neutraliza
  o `/Encrypt`.
- **Porquê:** é a única forma de juntar esses comprovantes **sem enviar dado de
  saúde a serviço externo** (roda dentro da conta).
- **Consequências:** **AES (V≥4)** não é suportado (raro) → nesse caso o app avisa e
  o usuário manda o comprovante **como imagem** (que sempre funciona). Cada PDF é
  ainda **normalizado** (load+save) antes de copiar, para evitar fluxos malformados.

### D16. Cache-busting + selo de versão
- **Decisão:** no deploy, carimbar o **hash do commit** em `index.html`, nos imports
  dos módulos, em `version.js` e no `sw.js`. Rodapé mostra a **versão**.
- **Porquê:** o GitHub Pages cacheia assets (~10 min); sem isso, atualizações
  "somem". Com o carimbo, cada versão tem URLs novas → o navegador baixa o novo
  sozinho. O selo permite saber qual versão está carregada.
- **Consequências:** o carimbo é só no artefato publicado; o código-fonte fica limpo.

### D17. PWA instalável
- **Decisão:** `manifest.webmanifest`, ícones (gerados) e **service worker** simples.
- **Porquê:** "Adicionar à tela inicial", abrir em tela cheia, cara de app.
- **Regra do SW:** só intercepta **GET do mesmo domínio**; **HTML network-first**,
  assets versionados **cache-first**; **nunca** intercepta Google (login/Sheets/
  Drive/iframe). Cache versionado por build (limpa o antigo no `activate`).

### D18. Privacidade e segurança
- **Codinome** no lugar do nome do paciente (inclusive nos prestadores, se quiser).
- **Nada sensível no repositório:** dados só no Drive/Sheets. `client_id`/`API key`
  são identificadores **públicos por natureza** — protegidos por **restrição de
  origem/referrer** no Console (essa é a fronteira de segurança real).
- **Token só em memória** (`auth.js`); o e-mail e o ID da planilha ficam em
  `localStorage` (não sensíveis, fora do repo).
- **App em produção com escopos não-sensíveis** → consentimento limpo, sem aviso.

### D19. Repositório público
- **Decisão:** repo **público**.
- **Porquê:** GitHub Pages grátis só publica de repo público. Seguro aqui porque
  não há segredo nem dado de paciente no código.

### D20. Cloudflare só como DNS/CDN
- **Decisão (quando/se usar domínio próprio):** Cloudflare **não** deve transformar/
  mascarar a origem.
- **Porquê:** o OAuth exige que a **origem na barra de endereço** bata **exatamente**
  com a registrada no Console. Transformar origem quebra o login. Se usar domínio
  próprio, **registrar a nova origem** no OAuth Client e na API key.

### D21. Documentos de referência (anuais) — laudo/avaliação com versões
- **Contexto:** o **laudo médico** e o **relatório de avaliação por terapia** não são
  mensais — são **anuais**, emitidos após avaliação, e reaproveitados em vários meses.
  O modelo tratava `Laudo` como slot mensal (errado).
- **Decisão:** criar a aba **`Referencia`** (uma linha **por versão**:
  `tipo | prestador | especialidade | data_emissao | link | vigente`). Tipos de
  referência em `REF_TIPOS = ['Laudo', 'Avaliacao']` (`Avaliacao` é por especialidade).
  Uma nova versão **arquiva** a anterior e vira **vigente** (histórico preservado).
- **Escopo (revisado):** laudo e avaliação são **documentos de suporte à parte** —
  **NÃO** entram na completude do lote **nem** no PDF de impressão. Ficam só no
  repositório (aba/tela Referência); o usuário **abre/imprime quando a operadora pedir**.
  `Laudo` saiu dos tipos mensais; mensais por terapia continuam **Relatório + Presença**.
  *(Cogitou-se integrar o vigente ao lote/PDF, mas o laudo costuma ser de um prestador
  diferente do lote e a avaliação é documento de suporte — então ficam separados.)*
- **Dois tipos de referência:** **com vigência** (`REF_VIGENCIA`: Laudo, Avaliação —
  versões que se substituem, com "vigente" + histórico) e **arquivo sem vigência**
  (Exame, Pedido médico, Encaminhamento — só acumulam numa lista, para controle).
- **UI:** modo **Referência** na triagem (tipo + prestador + especialidade + data) e uma
  **tela Referência** (agrupa por tipo/prestador; vigente+histórico ou lista de arquivo).

---

## 5. Alternativas descartadas (e por quê)

| Alternativa | Por que não |
|---|---|
| **App nativo / AppSheet** | Manutenção de backend — justo o que se quer evitar. |
| **Google Form como porta de entrada** | Salvar no celular + abrir form + achar anexo mata a produtividade. |
| **Convenção de nome no arquivo** (`2026-07_Clinica_NF.pdf`) | Exige decorar sintaxe; terceiros erram; um typo quebra tudo. |
| **Escopo `spreadsheets` ou `drive` completo** | Sensível/restrito → aviso "app não verificado" e/ou verificação. `drive.file` resolve. |
| **SHEET_ID fixo no repo (sem Picker)** | Exigiria `spreadsheets` (sensível) e exporia o ID no repo público. Optou-se por Picker (1×/device). |
| **OCR/IA para classificar o conteúdo** | O "o que tem dentro" é um toque humano — mais confiável para prazo. |
| **Verificação do Google agora** | Adiada. Custo = trabalho (política + homepage + domínio + revisão), **R$0**. Só necessária para tirar a tela de consentimento genérica / usar escopo sensível. |
| **Backend para refresh token (login eterno)** | Desnecessário no alvo Android/Chrome (login persiste). Reservado para o futuro se preciso. |
| **Merge de PDF no navegador** | O app não lê os bytes dos anexos (`drive.file`); o merge tem de ser na conta dona (Apps Script). |
| **Serviço externo de PDF** | Dado de saúde não pode sair para terceiros; RC4 é feito dentro da conta. |

---

## 6. Armadilhas técnicas resolvidas

- **`drive.file` não enxerga arquivos de fora** → Google Picker para adoção (D7).
- **Sheets API aceita `drive.file`** → permitiu remover o escopo sensível (D6).
- **Apps Script compartilha escopo global entre os `.gs`** → nomes com prefixo
  (`PDF_`, `pdf...`) em `merge-lote.gs` para não colidir com os outros scripts.
- **`pdf-lib` no Apps Script** → shim de `setTimeout/clearTimeout` (não existem lá).
- **Página em branco no PDF** → causada por **PDF criptografado (RC4)**; resolvido
  com descriptografia própria (D15). PDFs "normais" e imagens nunca falharam.
- **Seletor de conta a cada login** → `login_hint` com o e-mail salvo (D8).
- **Atualizações "não apareciam"** → cache do Pages; resolvido com cache-busting (D16).
- **PWA no iOS pede login sempre** → limitação de isolamento de sessão do iOS; fora
  de escopo (alvo é Android/Chrome).

---

## 7. Limitações conhecidas

- **iOS não é alvo** (login a cada abertura no PWA por isolamento de sessão).
- **AES em PDFs** não é descriptografado (raro) → usar imagem do comprovante.
- **Sem login "eterno"** sem backend (mitigado; ver D8).
- **Tela de consentimento genérica** permanece até (se) fazer a verificação do
  Google — não bloqueia o uso.
- **Um anexo = uma especialidade por vez para conteúdo distinto**: se um único PDF
  tiver relatórios de terapias diferentes, marca-se as especialidades que ele cobre;
  a reclassificação ajusta depois.

---

## 8. Linha do tempo (evolução)

Resumo do que mudou ao longo do desenvolvimento (ver `git log` para detalhe):

1. App base (estático, Drive/Sheets/Picker).
2. Prestadores movidos para a aba `Config` (privacidade).
3. Entrada por e-mail (Apps Script) + imagens (JPG/PNG) + filtro por remetente.
4. Reclassificação de itens já triados.
5. Perfil por prestador + especialidades (completude por terapia) + multi-seleção +
   "Todas".
6. Cache-busting + selo de versão.
7. Impressão: PDF único (pdf-lib) → correções (colisão de nomes, `setTimeout`,
   normalização) → **descriptografia RC4** de comprovantes.
8. PWA instalável + login silencioso.
9. Produção: **escopo reduzido a não-sensível** (fim do aviso) + **`login_hint`**
   (fim do seletor de conta) + auto-recuperação de acesso à planilha.
