// Orquestrador: carrega SDKs, cuida do login, conecta a planilha e roteia telas.
import { initAuth, isSignedIn, onAuthChange, signIn, signOut, signInSilent, jaLogouAntes, getEmail } from './auth.js';
import { store } from './store.js';
import { ensureSheets } from './sheets.js';
import { conectarPlanilha } from './picker.js';
import { renderInbox, pendentesCount } from './inbox.js';
import { renderLotes } from './lotes.js';
import { renderReferencia } from './referencia.js';
import { renderProtocolos } from './protocolos.js';
import { mostrarView, toast, el } from './ui.js';
import { buildLabel } from './version.js';

const $ = (id) => document.getElementById(id);
let viewAtual = 'inbox';

// Aguarda os SDKs do Google (carregados com async defer no index.html).
function esperarSDKs() {
  return new Promise((resolve) => {
    const ok = () => window.google?.accounts?.oauth2 && window.gapi;
    if (ok()) return resolve();
    const t = setInterval(() => { if (ok()) { clearInterval(t); resolve(); } }, 100);
  });
}

function atualizarBadge(n = pendentesCount()) {
  const b = $('inbox-badge');
  b.textContent = n;
  b.hidden = !n;
}

async function irPara(view) {
  viewAtual = view;
  mostrarView(view);
  if (!isSignedIn()) return renderLogin();
  if (!store.getSheetId()) return renderConectar();
  try {
    await garantirAbas(); // cria abas Lotes/Inbox/Config/Referencia se faltarem (1x por dispositivo)
    if (view === 'inbox') await renderInbox(atualizarBadge);
    else if (view === 'lotes') await renderLotes();
    else if (view === 'referencia') await renderReferencia();
    else if (view === 'protocolos') await renderProtocolos();
  } catch (e) {
    if ((e.message || '') === 'SEM_ACESSO') {
      store.clearSheetId();
      abasOk = false;
      toast('Perdi o acesso à planilha. Reconecte, por favor.', 'err');
      renderConectar();
    } else throw e;
  }
}

// Garante as abas sem depender do Picker (funciona com o SHEET_ID fixo do config).
let abasOk = false;
async function garantirAbas() {
  if (abasOk) return;
  try { await ensureSheets(); abasOk = true; } catch (e) { console.warn('ensureSheets:', e.message); }
}

function renderLogin() {
  for (const v of ['inbox', 'lotes']) {
    const root = $(`view-${v}`);
    root.innerHTML = '';
    root.appendChild(el('div', { class: 'vazio' }, [
      el('p', { text: '🔐 Entre com sua conta Google para começar.' }),
      el('button', { class: 'btn btn-primary', onclick: () => signIn() }, 'Entrar com Google'),
    ]));
  }
}

function renderConectar() {
  const root = $(`view-${viewAtual}`);
  root.innerHTML = '';
  root.appendChild(el('div', { class: 'vazio' }, [
    el('p', { text: '🔌 Conecte a planilha de controle.' }),
    el('p', { class: 'muted', text: 'Dica: preencha SHEET_ID no config.js para a planilha vir por padrão, sem esta etapa. Senão, aponte-a uma vez (ela precisa estar compartilhada com sua conta).' }),
    el('button', { class: 'btn btn-primary', onclick: onConectar }, 'Conectar planilha'),
  ]));
}

async function onConectar() {
  try {
    const doc = await conectarPlanilha();
    if (!doc) return;
    store.setSheetId(doc.id);
    toast('Planilha conectada. Preparando abas…', 'ok');
    await ensureSheets();
    atualizarTopbar();
    await irPara(viewAtual);
  } catch (e) {
    toast('Não foi possível conectar a planilha.', 'err');
    console.warn(e.message);
  }
}

function atualizarTopbar() {
  const btn = $('btn-auth');
  const hint = $('user-hint');
  const session = document.querySelector('.session');

  // Botão "Conectar planilha" no topo (aparece só quando logado e sem planilha).
  let sheetBtn = $('btn-sheet');
  if (isSignedIn() && !store.getSheetId()) {
    if (!sheetBtn) {
      sheetBtn = el('button', { class: 'btn btn-ghost', id: 'btn-sheet', onclick: onConectar }, 'Conectar planilha');
      session.insertBefore(sheetBtn, btn);
    }
  } else if (sheetBtn) {
    sheetBtn.remove();
  }

  if (isSignedIn()) {
    btn.textContent = 'Sair';
    hint.textContent = getEmail() || (store.getSheetId() ? 'conectado' : '');
  } else {
    btn.textContent = 'Entrar';
    hint.textContent = '';
  }
}

function ligarEventos() {
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => irPara(tab.dataset.view));
  }
  $('btn-auth').addEventListener('click', () => {
    if (isSignedIn()) { signOut(); } else { signIn(); }
  });
  onAuthChange(async (signed) => {
    atualizarTopbar();
    if (signed) {
      if (!store.getSheetId()) renderConectar();
      else await irPara(viewAtual);
    } else {
      renderLogin(); // mantém o ID da planilha em cache para o próximo login
    }
  });
}

function registrarSW() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

async function main() {
  registrarSW();
  const tag = $('build-tag');
  if (tag) tag.textContent = `versão ${buildLabel()}`;
  await esperarSDKs();
  initAuth();
  ligarEventos();

  // Login silencioso para quem já concedeu acesso neste dispositivo (sem popup).
  if (!isSignedIn() && jaLogouAntes()) await signInSilent();
  atualizarTopbar();

  if (isSignedIn()) {
    if (!store.getSheetId()) renderConectar();
    else await irPara('inbox');
  } else {
    renderLogin();
  }
}

main();
