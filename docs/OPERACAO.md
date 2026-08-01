# Operação — Triagem de Reembolso (runbook)

Guia prático do dia a dia: colocar em produção, dar acesso a pessoas, manter os
automatismos e resolver problemas. Para **setup inicial detalhado** veja o
**[../README.md](../README.md)**; para o **porquê** das escolhas, **[DECISOES.md](DECISOES.md)**.

- **App:** https://fernandoapparecido-oss.github.io/reembolso-saude/
- **Conta base (dona da planilha/arquivos/scripts):** `reembolsofamilia@gmail.com`
- **Origem OAuth registrada:** `https://fernandoapparecido-oss.github.io`

---

## 1. Colocar/estar em produção

Checklist de "pronto para produção":

1. **Publicar o app OAuth** — Console → *Tela de permissão OAuth* → **PUBLICAR
   APLICATIVO**. Com escopos **não-sensíveis** (`openid email profile drive.file`)
   **não precisa de verificação**. Sem publicar, só "test users" entram.
2. **Restrições das chaves** (proteção real, pois são públicas):
   - **API key** → *Sites (referrer)* = `https://fernandoapparecido-oss.github.io/*`;
     *Restrições de API* = **Google Picker API** (e Drive).
   - **OAuth Client** → *Origens JavaScript* = `https://fernandoapparecido-oss.github.io`.
3. **APIs habilitadas:** Google Drive, Google Sheets, Google Picker.
4. **2FA** na conta dedicada.

## 2. Onboarding de um novo usuário (operador)

Para cada pessoa que vai operar:

1. **Compartilhe** com o e-mail Google dela (permissão **Editor**):
   - a **planilha** de controle;
   - a pasta **`Reembolso Inbox`** (anexos de e-mail);
   - a pasta **`Reembolso PDFs`** (PDFs de impressão).
2. Nos Apps Scripts (na conta `reembolsofamilia`), adicione o e-mail dela em:
   - **`COMPARTILHAR_COM`** (inbox-email.gs e/ou merge-lote.gs) — para ver anexos/PDFs;
   - **`REMETENTES_PERMITIDOS`** (inbox-email.gs) — se ela também mandar documentos por e-mail.
3. A pessoa: abre o app com a **conta dela**, faz login **uma vez** e **aponta a
   planilha** pelo Picker (uma vez por dispositivo). Pronto — passa a ver/gravar os
   mesmos lotes.

> App **publicado** → qualquer conta autorizada entra (não precisa ser "test user").

## 3. Instalar como app (PWA) — Android/Chrome

- Abrir o site no **Chrome** → menu ⋮ → **Instalar app / Adicionar à tela inicial**.
- Abre em tela cheia, com ícone próprio. O **rodapé** mostra a versão.
- No Android, o PWA **compartilha a sessão** do Chrome → login persistente.

## 4. Automatismos (Apps Scripts) — na conta `reembolsofamilia`

Abra a planilha → **Extensões → Apps Script**. Os três `.gs` convivem no mesmo
projeto. Preencha as listas de e-mail no topo de cada um.

| Script | Função | Gatilho (⏰ Time-driven) |
|---|---|---|
| `inbox-email.gs` | Anexos de e-mail (PDF/JPG/PNG) entram no Inbox | `importarAnexos` — a cada **5–10 min** |
| `merge-lote.gs` | Junta o lote num PDF único p/ imprimir | `gerarPdfsPendentes` — a cada **1–5 min** |
| `aviso-prazo.gs` | E-mail de prazo (opcional) | `avisarPrazos` — **diário** (ex.: 7h) |

Ao instalar/atualizar, rode a função uma vez **na mão** para **autorizar**
(Gmail + Drive + Sheets; o merge pede também "acesso externo" para baixar o pdf-lib).

## 5. Fluxo diário

1. **Entra sozinho por e-mail:** mande/encaminhe documentos para
   `reembolsofamilia@gmail.com` (de um remetente reconhecido). Em minutos aparecem no
   **Inbox** (badge com o contador). Para WhatsApp/scan, use **＋ Apontar arquivos** (Picker).
2. **Triagem:** toque no arquivo → **preview** → escolha **Prestador**, **Mês** e
   marque **os tipos** que existem nele; se for clínica com especialidades, marque a(s)
   **especialidade(s)** (ou **Todas**) → **Confirmar**.
3. **Lotes:** acompanhe `Aguardando/Completo/Enviado/Reembolsado`, filtre por
   *Faltando / Prontos / Prazo desta semana*.
4. **Imprimir:** no lote, **Gerar PDF para impressão** → em ~1–2 min vira **🖨 Imprimir**
   (um PDF único, uma impressão). Poste nos Correios.
5. **Registrar envio:** no lote, **Registrar envio** (data de postagem, rastreio, valor);
   depois **Marcar Reembolsado**.
6. **Corrigir:** Inbox → aba **Categorizados** (✎) para **reclassificar** ou **remover**
   do lote.

## 6. Manter a aba `Config`

`Config` (colunas): `prestador | tipos | especialidades`.

- **tipos** = o que o prestador exige (`NF, Laudo, Comprovante, Relatorio, Presenca`).
  Vazio = todos os 5.
- **especialidades** = terapias (`Fono, TO, ABA`). Preenchido → Relatório/Presença viram
  exigência **por especialidade**. Vazio = sem terapias.
- Exemplos: clínica `NF, Comprovante, Relatorio, Presenca` / `Fono, TO, ABA`;
  médico `NF, Comprovante` / (vazio); fornecedor único (vazio) / (vazio).

## 7. Solução de problemas

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| **"App não verificado / não confiável"** | Escopo sensível | Já corrigido (só `drive.file`+perfil). Se voltar, confira que `SCOPES` não tem `spreadsheets`/`drive`. |
| **Pede login toda vez** | App não publicado / iOS | Publicar em produção. Alvo é Android/Chrome; iOS isola sessão (fora de escopo). |
| **Pede para escolher a conta toda vez** | Sem dica de conta | Já corrigido (`login_hint`). Garanta o deploy novo (rodapé com versão atual). |
| **Pede a planilha de novo** | `localStorage` limpo / outro device/anônima | Normal em device novo (1×). Não limpe "dados do site". |
| **"Perdi o acesso à planilha"** | Compartilhamento/token | O app pede para reconectar (Picker). Confirme que a planilha está compartilhada com a conta. |
| **Página em branco no PDF** | Comprovante criptografado | Já tratado (RC4). Se for **AES**, mande o comprovante **como imagem**. |
| **Anexo de e-mail não entrou** | Remetente fora da lista / imagem inline | Adicione o remetente em `REMETENTES_PERMITIDOS`; mande foto como **anexo**, não colada no corpo. |
| **Preview "sem acesso" p/ outra pessoa** | Pasta não compartilhada | Compartilhe `Reembolso Inbox`/`Reembolso PDFs` com o e-mail dela (ou `COMPARTILHAR_COM`). |
| **Erro "já declarado" no Apps Script** | Nomes repetidos entre `.gs` | Use as versões do repo (merge-lote tem prefixo `PDF_`). |
| **Atualização não aparece** | Cache | Cache-busting já resolve; confira a **versão no rodapé**. Em último caso, aba anônima. |

## 8. Cotas e limites

- Volume baixo (dezenas de chamadas/sessão). Drive/Sheets: ~12k req/min por usuário,
  grátis. Chamadas ao Sheets tratam **403/429 com backoff** (`sheets.js`).
- Apps Script: limite de ~6 min por execução (merge de poucos arquivos é rápido).

## 9. Publicar mudanças / versão

- `git push` na branch `main` → o workflow do GitHub Actions **carimba a versão** e
  publica no Pages sozinho (~1 min).
- Confirme pelo **selo de versão no rodapé** (é o hash curto do commit).

## 10. Estrutura de arquivos (referência rápida)

```
index.html · css/app.css · manifest.webmanifest · sw.js · icons/
js/ config.js auth.js picker.js sheets.js model.js catalog.js
    inbox.js triage.js lotes.js ui.js store.js version.js app.js
apps-script/ inbox-email.gs  merge-lote.gs  aviso-prazo.gs
docs/ DECISOES.md  OPERACAO.md
.github/workflows/deploy.yml
```

Detalhe de cada arquivo e do modelo de dados: **[../README.md](../README.md)**.
