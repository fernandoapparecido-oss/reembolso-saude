// Google Picker — resolve o atrito do escopo drive.file.
//
// Com drive.file o app NÃO enxerga arquivos criados por fora dele (scan,
// WhatsApp, e-mail). Quando o usuário seleciona um arquivo no Picker (janela do
// próprio Google), o Google CONCEDE ao app acesso drive.file àquele item. Só
// então o app pode ler/prever/registrar o arquivo.
import { CONFIG } from './config.js';
import { getToken, ensureToken } from './auth.js';

let pickerPronto = false;

function carregarPicker() {
  return new Promise((resolve, reject) => {
    if (pickerPronto) return resolve();
    if (typeof gapi === 'undefined') return reject(new Error('gapi não carregou'));
    gapi.load('picker', {
      callback: () => { pickerPronto = true; resolve(); },
      onerror: () => reject(new Error('Falha ao carregar o Picker')),
    });
  });
}

function abrirPicker(view, multi) {
  return new Promise((resolve) => {
    const builder = new google.picker.PickerBuilder()
      .setDeveloperKey(CONFIG.API_KEY)
      .setAppId(CONFIG.APP_ID)
      .setOAuthToken(getToken())
      .addView(view)
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED) {
          resolve((data.docs || []).map((d) => ({ id: d.id, name: d.name })));
        } else if (data.action === google.picker.Action.CANCEL) {
          resolve([]);
        }
      });
    if (multi) builder.enableFeature(google.picker.Feature.MULTISELECT_ENABLED);
    builder.build().setVisible(true);
  });
}

// Aponta arquivos (PDF ou imagem) que caíram no Drive por fora do app.
export async function apontarArquivos() {
  await ensureToken();
  await carregarPicker();
  const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
    .setMimeTypes('application/pdf,image/jpeg,image/png')
    .setIncludeFolders(true)
    .setSelectFolderEnabled(false);
  return abrirPicker(view, true);
}

// Conecta a planilha de controle (concede drive.file a ela para este usuário).
export async function conectarPlanilha() {
  await ensureToken();
  await carregarPicker();
  const view = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS)
    .setMimeTypes('application/vnd.google-apps.spreadsheet')
    .setIncludeFolders(true)
    .setSelectFolderEnabled(false);
  const docs = await abrirPicker(view, false);
  return docs[0] || null;
}
