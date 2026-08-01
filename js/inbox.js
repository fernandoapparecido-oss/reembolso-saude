// Tela INBOX: arquivos apontados ao app que ainda NÃO foram categorizados.
import { el, clear, toast } from './ui.js';
import { lerInbox, adotarArquivos } from './sheets.js';
import { apontarPdfs } from './picker.js';
import { abrirTriagem } from './triage.js';

let cachePendentes = [];

export function pendentesCount() { return cachePendentes.length; }

function atualizarBadge(onBadge) {
  if (onBadge) onBadge(cachePendentes.length);
}

export async function renderInbox(onBadge) {
  const root = document.getElementById('view-inbox');
  clear(root);
  root.appendChild(el('div', { class: 'view-head' }, [
    el('h1', { text: 'Inbox' }),
    el('button', { class: 'btn btn-primary', onclick: () => onApontar(onBadge) }, '＋ Apontar arquivos'),
  ]));

  const lista = el('div', { class: 'lista', id: 'inbox-lista' });
  root.appendChild(lista);
  lista.appendChild(el('p', { class: 'muted', text: 'Carregando…' }));

  try {
    const inbox = await lerInbox();
    cachePendentes = inbox.filter((x) => x.status !== 'triado');
    atualizarBadge(onBadge);
    clear(lista);

    if (cachePendentes.length === 0) {
      lista.appendChild(el('div', { class: 'vazio' }, [
        el('p', { text: '✅ Nada a categorizar.' }),
        el('p', { class: 'muted', text: 'Toque em “Apontar arquivos” quando algo novo chegar por WhatsApp, e-mail ou scan.' }),
      ]));
      return;
    }

    for (const item of cachePendentes) {
      lista.appendChild(el('button', {
        class: 'card card-file',
        onclick: () => abrirTriagem(item, () => renderInbox(onBadge)),
      }, [
        el('span', { class: 'file-ico', text: '📄' }),
        el('span', { class: 'file-nome', text: item.nome || item.fileId }),
        el('span', { class: 'chevron', text: '›' }),
      ]));
    }
  } catch (e) {
    clear(lista);
    lista.appendChild(erroBox(e));
  }
}

async function onApontar(onBadge) {
  try {
    const docs = await apontarPdfs();
    if (!docs.length) return;
    const n = await adotarArquivos(docs);
    toast(n ? `${n} arquivo(s) adicionado(s) à fila.` : 'Nenhum novo (já estavam na fila).', 'ok');
    await renderInbox(onBadge);
  } catch (e) {
    toast('Não foi possível apontar os arquivos.', 'err');
    console.warn(e.message);
  }
}

function erroBox(e) {
  if ((e.message || '').includes('SEM_PLANILHA')) {
    return el('div', { class: 'vazio' }, [
      el('p', { text: '🔌 Conecte a planilha de controle primeiro.' }),
      el('p', { class: 'muted', text: 'Use o botão “Conectar planilha” no topo.' }),
    ]);
  }
  return el('div', { class: 'vazio' }, [el('p', { text: 'Erro ao carregar a fila.' }), el('p', { class: 'muted', text: e.message })]);
}
