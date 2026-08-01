# Triagem de Reembolso 📮

App **estático** (GitHub Pages, sem backend) para **triar por toque** os documentos
de reembolso de plano de saúde e controlar **o que falta por prestador × mês** sem
perder prazo. Arquivos ficam no **Google Drive**; o controle, numa **planilha
Google**. Login com a conta Google de cada pessoa (multiusuário).

- **Um arquivo, uma ação, marca vários requisitos.** Um PDF com NF + Relatório +
  Presença marca os três slots do lote de uma vez — sem dividir o PDF.
- **Zero digitação livre** na triagem: prestador (lista), mês (seletor) e conteúdo
  (multi-seleção).
- Escopo OAuth mínimo: **`drive.file`** (o app só vê o que ele criou ou o que você
  apontou a ele pelo Picker) + `spreadsheets`.

---

## Como o Picker resolve a "adoção" dos arquivos

Com `drive.file`, o app **não enxerga** arquivos que caíram no Drive por fora dele
(scan, WhatsApp, e-mail). O **Google Picker** roda numa janela do próprio Google:
quando você seleciona um arquivo lá, o Google **concede ao app** acesso `drive.file`
**àquele item específico**. Só então o app lê/prevê/registra o arquivo. O ID vai para
a aba **Inbox** da planilha, e é assim que a fila "lembra" dele nas próximas sessões —
tudo isso **sem** o escopo `drive` completo (que exigiria a verificação pesada do Google).

A mesma lógica vale para a **planilha**: cada pessoa a "conecta" uma vez pelo Picker
(botão **Conectar planilha**). Por isso a planilha precisa estar **compartilhada** com a
conta Google de cada usuário — o compartilhamento faz ela aparecer no Picker; o Picker
concede o `drive.file` daquele arquivo ao app.

---

## Estrutura

```
index.html            Shell do app
css/app.css           Estilo (mobile-first, "por toque")
js/config.js          ⬅️ ÚNICO arquivo que VOCÊ edita (client_id, api_key, listas)
js/auth.js            Login Google (GIS token client)
js/picker.js          Google Picker (adoção de arquivos e da planilha)
js/sheets.js          Leitura/gravação na planilha + backoff 403/429
js/model.js           Formato das abas Lotes/Inbox (fonte da verdade)
js/inbox.js           Tela INBOX (fila de pendências + badge)
js/triage.js          Tela TRIAGEM (preview + categorização)
js/lotes.js           Tela LOTES (status, prazos, registro de envio)
js/app.js             Orquestrador (login, roteamento)
apps-script/aviso-prazo.gs   (opcional) e-mail de prazo, sem o app aberto
```

### Modelo de dados (planilha)

Aba **`Lotes`** — **uma linha por lote (prestador × mês)**:

| prestador | mes_referencia | NF | Laudo | Comprovante | Relatorio | Presenca | data_limite | status | data_postagem | rastreio | valor |
|-----------|----------------|----|-------|-------------|-----------|----------|-------------|--------|---------------|----------|-------|

Cada célula de tipo guarda **o link do arquivo** que preencheu aquele slot (vários links
separados por ` | ` se vierem de arquivos diferentes). `status` ∈ `Aguardando`,
`Completo`, `Enviado`, `Reembolsado`.

Aba **`Inbox`** — arquivos apontados ao app e se já foram triados:

| fileId | nome | data_adocao | status | lote |

> As duas abas e os cabeçalhos são **criados automaticamente** pelo app ao conectar a
> planilha (`ensureSheets`). Você não precisa montá-las à mão.

---

## Passo a passo (você faz uma vez — console/GUI)

> **Sua origem do GitHub Pages será:** `https://fernandoapparecido-oss.github.io`
> (o app fica em `https://fernandoapparecido-oss.github.io/reembolso-saude/`, mas o que
> se registra no OAuth é a **origem** = esquema + host, **sem caminho e sem barra final**).

### 1. Conta Gmail dedicada
Crie uma conta **@gmail.com** só para este projeto. Ative **verificação em 2 etapas (2FA)**.
Use **codinome** no lugar do nome do paciente em tudo (inclusive na lista de prestadores,
se quiser).

### 2. Projeto no Google Cloud Console
1. Acesse <https://console.cloud.google.com> logado na conta dedicada.
2. **Create Project** → nome ex. `reembolso-triagem` → **Create**.
3. Anote o **Project number** (Dashboard) — vai em `APP_ID` do `config.js`.

### 3. Habilitar as APIs
Em **APIs & Services → Library**, habilite (Enable) as três:
- **Google Drive API**
- **Google Sheets API**
- **Google Picker API**

### 4. Tela de consentimento OAuth
1. **APIs & Services → OAuth consent screen**.
2. **User type: External** → Create.
3. Preencha nome do app, e-mail de suporte e de contato.
4. **Scopes**: adicione exatamente
   - `.../auth/drive.file`
   - `.../auth/spreadsheets`
   (**não** adicione o `drive` completo.)
5. **Test users**: adicione o e-mail de **cada pessoa** que vai usar o app (enquanto
   ficar em modo *Testing*). Isso basta — não precisa publicar/verificar para uso próprio.

### 5. OAuth Client ID (Web application)
1. **APIs & Services → Credentials → Create Credentials → OAuth client ID**.
2. **Application type: Web application**.
3. **Authorized JavaScript origins** → **ADD URI** →
   `https://fernandoapparecido-oss.github.io`
   *(idêntico: `https://`, minúsculas, **sem** `/reembolso-saude`, **sem** barra final).*
   - Para testar local, adicione também `http://localhost:5173` (ou a porta que usar).
4. **Authorized redirect URIs**: pode deixar vazio (o token client usa postMessage).
5. Create → copie o **Client ID** → cole em `CLIENT_ID` no `js/config.js`.

### 6. API key (para o Picker)
1. **Credentials → Create Credentials → API key** → copie a chave → `API_KEY` no `config.js`.
2. **Edit** a chave → **Application restrictions: Websites (HTTP referrers)** → adicione:
   - `https://fernandoapparecido-oss.github.io/*`
   - `http://localhost:5173/*` (se for testar local)
3. **API restrictions**: restrinja a **Google Picker API** (e Drive/Sheets se quiser).

### 7. Planilha de controle
1. Na conta dedicada, crie uma **planilha Google** em branco (ex. `Reembolsos`).
2. **Compartilhe** com a conta Google de **cada pessoa** (Editor).
3. (Opcional) copie o **ID** da planilha (trecho entre `/d/` e `/edit` na URL) para
   `SHEET_ID` no `config.js`. Mesmo assim, cada pessoa fará **Conectar planilha** uma vez.

### 8. Preencher o `js/config.js`
Abra `js/config.js` e preencha `CLIENT_ID`, `API_KEY`, `APP_ID` (Project number), e ajuste
as listas `PRESTADORES` e `TIPOS`. Faça commit.

### 9. Deploy no GitHub Pages
1. **Settings → Pages** → *Build and deployment* → **Source: GitHub Actions**.
   (Já existe `.github/workflows/deploy.yml`; ao dar push na `main`, publica sozinho.)
2. Aguarde o workflow e acesse `https://fernandoapparecido-oss.github.io/reembolso-saude/`.

### 10. Cloudflare como DNS/CDN puro (opcional)
Se for usar domínio próprio via Cloudflare **na frente do Pages**:
- Registro **CNAME** do seu host → `fernandoapparecido-oss.github.io`.
- **Proxy pode ficar ligado** (nuvem laranja) para CDN/DNS, **mas não** ative nada que
  **transforme/reescreva a origem** (ex.: *Rewrite*, *Workers* que troquem o Host, páginas
  intermediárias). O OAuth exige que a **origem na barra de endereço bata exatamente** com
  a origem registrada no passo 5. Se usar domínio próprio, **registre essa nova origem**
  (ex.: `https://reembolso.seudominio.com`) no OAuth Client **e** na API key.

---

## Uso no dia a dia

1. **Inbox** → **Apontar arquivos** (Picker) → selecione os PDFs que chegaram. Eles entram
   na fila; o **badge** mostra quantos faltam categorizar.
2. Toque num arquivo → **preview** ao lado → escolha **Prestador**, **Mês** e marque
   **todos os tipos** que existem dentro dele → **Confirmar**. Um toque marca vários slots.
3. **Lotes** → veja `Aguardando/Completo/Enviado/Reembolsado`, filtre por
   *Faltando docs / Prontos p/ enviar / Prazo desta semana*, e **Registrar envio**
   (data de postagem, rastreio, valor) quando postar nos Correios.

## Multiusuário
Qualquer pessoa **em Test users** (passo 4.5) e com a planilha **compartilhada** (passo 7.2)
faz login com a **própria conta Google**, conecta a planilha uma vez e passa a ver/gravar os
mesmos lotes. Não é preciso ser o dono do projeto.

## Privacidade
- **Codinome** no lugar do nome do paciente (inclusive em `PRESTADORES`, se quiser).
- O app **não loga** token nem dados sensíveis. Identificadores ficam claros no código:
  o ID da planilha (não sensível) em `js/store.js`; o token vive **só em memória** em
  `js/auth.js`.
- `CLIENT_ID` e `API_KEY` são **públicos por natureza** no fluxo browser — a proteção é a
  **restrição por origem/referrer** (passos 5 e 6). Nada que seja segredo de verdade fica no
  front.

## Cota
Volume baixo (dezenas de chamadas/sessão). As chamadas ao Sheets/Drive tratam **403/429**
com **backoff exponencial** (`js/sheets.js`).
