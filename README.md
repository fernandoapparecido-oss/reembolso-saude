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
js/config.js          ⬅️ ÚNICO arquivo que VOCÊ edita (client_id, api_key, app_id, tipos)
js/auth.js            Login Google (GIS token client)
js/picker.js          Google Picker (adoção de arquivos e da planilha)
js/sheets.js          Leitura/gravação na planilha + backoff 403/429
js/model.js           Formato das abas Lotes/Inbox/Config (fonte da verdade)
js/catalog.js         Cache da lista de prestadores (lida da aba Config)
js/inbox.js           Tela INBOX (fila de pendências + badge)
js/triage.js          Tela TRIAGEM (preview + categorização)
js/lotes.js           Tela LOTES (status, prazos, registro de envio)
js/app.js             Orquestrador (login, roteamento)
apps-script/aviso-prazo.gs   (opcional) e-mail de prazo, sem o app aberto
apps-script/inbox-email.gs   (opcional) anexos de e-mail entram sozinhos no Inbox
apps-script/merge-lote.gs    (opcional) junta os docs do lote num PDF único p/ imprimir
```

### Modelo de dados (planilha)

Aba **`Lotes`** — **uma linha por lote (prestador × mês)**:

| prestador | mes_referencia | NF | Laudo | Comprovante | Relatorio | Presenca | data_limite | status | data_postagem | rastreio | valor | pedido_pdf | pdf_lote |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

As duas últimas colunas são da **impressão**: o app escreve `pedido_pdf` ao pedir o PDF único;
o `merge-lote.gs` devolve o link do PDF juntado em `pdf_lote`.

Cada célula de tipo guarda **o link do arquivo** que preencheu aquele slot (vários links
separados por ` | ` se vierem de arquivos diferentes). `status` ∈ `Aguardando`,
`Completo`, `Enviado`, `Reembolsado`.

Aba **`Inbox`** — arquivos apontados ao app e se já foram triados:

| fileId | nome | data_adocao | status | lote |

Aba **`Config`** — **perfil de cada prestador** (fica na planilha, não no código, para não
expor nomes num repositório público). Três colunas:

| prestador | tipos | especialidades |
|-----------|-------|----------------|
| Clínica A | `NF, Comprovante, Relatorio, Presenca` | `Fono, TO, ABA` |
| Terapeuta B | `NF, Laudo, Comprovante, Relatorio, Presenca` | *(vazio)* |
| Consultório Médico C | `NF, Comprovante` | *(vazio)* |

- **tipos** = o que aquele prestador **exige** (subconjunto de `NF, Laudo, Comprovante,
  Relatorio, Presenca`). Vazio = exige **todos os 5**. Aceita com/sem acento.
- **especialidades** = terapias do prestador (ex.: `Fono, TO, ABA`). Quando preenchido,
  **Relatório e Presença passam a ser exigidos por especialidade** (um de cada por terapia);
  NF, Laudo e Comprovante continuam **compartilhados** (um para o lote). Vazio = sem terapias.

> Assim o mesmo mecanismo cobre **médico** (só NF+Comprovante), **fornecedor único** (um de
> cada) e **clínica multi-terapia** (NF/Comprovante compartilhados + Relatório/Presença por
> Fono/TO/ABA). Quais tipos são “por especialidade” fica em `PER_ESPECIALIDADE` no
> `js/config.js` (padrão: Relatório e Presença).

> As três abas e os cabeçalhos são **criados automaticamente** pelo app ao conectar a
> planilha (`ensureSheets`) — a `Config` já vem com os 3 exemplos acima, que você substitui.

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
Abra `js/config.js` e preencha `CLIENT_ID`, `API_KEY`, `APP_ID` (Project number). Se quiser,
ajuste a lista `TIPOS` (genérica). **Os prestadores NÃO ficam aqui** — você os edita na aba
`Config` da planilha (coluna A), depois de conectar. Faça commit do `config.js`.

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
   Se o prestador tiver **especialidades** e você marcar Relatório/Presença, o app pede a(s)
   **especialidade(s)** (Fono/TO/ABA) daquele arquivo — **pode marcar mais de uma** quando um
   anexo cobre várias (ex.: uma lista de presença de Fono **e** ABA marca as duas). Só aparecem
   os tipos que o prestador exige.
3. **Lotes** → veja `Aguardando/Completo/Enviado/Reembolsado`, filtre por
   *Faltando docs / Prontos p/ enviar / Prazo desta semana*, e **Registrar envio**
   (data de postagem, rastreio, valor) quando postar nos Correios.

### Imprimir o lote (PDF único)
No card do lote, **Gerar PDF para impressão** → o app registra o pedido na planilha e o
`apps-script/merge-lote.gs` (na conta dona) junta **todos os documentos do lote num PDF só**
(ordem: NF, Comprovante, Laudo e depois Relatório+Presença por especialidade; PDFs e imagens).
Em ~1–2 min o botão vira **🖨 Imprimir** — você abre o PDF e imprime **uma vez só**.
Instalação do script está no cabeçalho dele.

> Por que não juntar no próprio app: com `drive.file` o app não lê os bytes dos anexos (só os
> pré-visualiza pela sua sessão). Quem lê tudo é o Apps Script na conta dona — por isso a junção
> acontece lá. Navegador nenhum imprime direto na impressora sem diálogo; o "uma impressão" vem
> do **PDF único**.

### Reclassificar (corrigir um erro)
Na **Inbox**, aba **Categorizados**, toque no arquivo (ícone ✎). A tela abre já com o que
estava marcado; corrija **prestador, mês ou tipos** e **Salvar correção** — o app remove a
marcação anterior e aplica a nova (se o lote antigo ficar vazio, ele some sozinho). Ou use
**Remover do lote e voltar à fila** para desfazer e triar de novo depois.

## Entrada por e-mail (opcional, recomendado)
Para não usar o Picker a cada arquivo: mande os documentos por e-mail para a conta do app
(ex.: `reembolsofamilia@gmail.com`) e deixe o script **`apps-script/inbox-email.gs`** salvar
os anexos (**PDF, JPG e PNG**) numa pasta do Drive e registrá-los na aba `Inbox` — eles
**aparecem sozinhos** no app. O script **só processa e-mails de remetentes reconhecidos**
(`REMETENTES_PERMITIDOS` — evita spam/newsletters com anexo), **compartilha a pasta** com as
contas pessoais (`COMPARTILHAR_COM`) para o preview funcionar, ignora imagens minúsculas
(logos de assinatura) e não reprocessa e-mails. O Picker continua para o que chega por
WhatsApp/scan (também aceitando PDF/JPG/PNG).

> Funciona sem `drive.file` em cada anexo porque o app não chama a API do Drive no arquivo:
> ele lê a aba `Inbox` e mostra o preview por `iframe`, que usa a sessão do navegador. Basta a
> conta logada **enxergar** o arquivo (dona ou via compartilhamento da pasta).

## Multiusuário
Qualquer pessoa **em Test users** (passo 4.5) e com a planilha **compartilhada** (passo 7.2)
faz login com a **própria conta Google**, conecta a planilha uma vez e passa a ver/gravar os
mesmos lotes. Não é preciso ser o dono do projeto.

## Privacidade

**`CLIENT_ID` e `API_KEY` não são segredos.** No OAuth no browser eles **precisam** ser
enviados ao navegador — vale para qualquer app desse tipo, público ou privado. Repo privado
**não** os esconderia (continuam servidos ao browser de quem usa). O Google os trata como
**identificadores públicos, não credenciais**: sozinhos, **não dão acesso a nada**.

O que realmente protege os dados (nada disso está no repositório):
1. **Origem** restrita no OAuth Client (passo 5) — o `client_id` só funciona no seu domínio.
2. **Referrer + API** restritos na API key (passo 6).
3. **Test users** (passo 4.5): mantendo o app em *Testing*, só as contas que você adicionar
   conseguem concluir o login. Um estranho com o `client_id` **não entra**.
4. **Login Google + compartilhamento + escopo `drive.file`**: os dados (com codinome) vivem
   **só no Drive/Sheets**, nunca no repo.

Boas práticas neste app:
- **Codinome** no lugar do nome do paciente — e os **prestadores ficam na aba `Config` da
  planilha**, não no código, para não aparecerem no repositório público.
- O app **não loga** token nem dados sensíveis. O token vive **só em memória** (`js/auth.js`);
  o ID da planilha (não sensível) fica em `localStorage` (`js/store.js`), **não** no repo.
- Mantenha o app em **Testing** com a lista de **Test users** enxuta (mínimo de pessoas) e
  **2FA** na conta.

## Cota
Volume baixo (dezenas de chamadas/sessão). As chamadas ao Sheets/Drive tratam **403/429**
com **backoff exponencial** (`js/sheets.js`).
