// Tela INBOX: fila de pendentes + aba de já categorizados (para reclassificar).
import { el, clear, toast } from './ui.js';
import { lerInbox, adotarArquivos, classificacaoDoArquivo, marcarInboxIgnorado } from './sheets.js';
import { apontarArquivos } from './picker.js';
import { abrirTriagem } from './triage.js';

let cachePendentes = [];
let cacheTriados = [];
let abaAtual = 'pendentes'; // 'pendentes' | 'categorizados'

export function pendentesCount() { return cachePendentes.length; }

export async function renderInbox(onBadge) {
  const root = document.getElementById('view-inbox');
  clear(root);
  root.appendChild(el('div', { class: 'view-head' }, [
    el('h1', { text: 'Inbox' }),
    el('button', { class: 'btn btn-primary', onclick: () => onApontar(onBadge) }, '＋ Apontar arquivos'),
  ]));

  const abas = el('div', { class: 'filtros' });
  root.appendChild(abas);

  const lista = el('div', { class: 'lista', id: 'inbox-lista' });
  root.appendChild(lista);
  lista.appendChild(el('p', { class: 'muted', text: 'Carregando…' }));

  try {
    const inbox = await lerInbox();
    cachePendentes = inbox.filter((x) => x.status !== 'triado' && x.status !== 'ignorado');
    cacheTriados = inbox.filter((x) => x.status === 'triado');
    if (onBadge) onBadge(cachePendentes.length);

    clear(abas);
    abas.appendChild(abaBtn('pendentes', `Pendentes (${cachePendentes.length})`, onBadge));
    abas.appendChild(abaBtn('categorizados', `Categorizados (${cacheTriados.length})`, onBadge));

    desenharLista(lista, onBadge);
  } catch (e) {
    if ((e.message || '') === 'SEM_ACESSO') throw e; // app trata (reconectar)
    clear(lista);
    lista.appendChild(erroBox(e));
  }
}

function abaBtn(id, label, onBadge) {
  return el('button', {
    class: `filtro ${abaAtual === id ? 'on' : ''}`, 'data-aba': id,
    onclick: () => {
      abaAtual = id;
      document.querySelectorAll('#view-inbox .filtro').forEach((b) => b.classList.toggle('on', b.getAttribute('data-aba') === id));
      desenharLista(document.getElementById('inbox-lista'), onBadge);
    },
  }, label);
}

function desenharLista(lista, onBadge) {
  clear(lista);
  const itens = abaAtual === 'pendentes' ? cachePendentes : cacheTriados;

  if (itens.length === 0) {
    lista.appendChild(el('div', { class: 'vazio' }, [
      el('p', { text: abaAtual === 'pendentes' ? '✅ Nada a categorizar.' : 'Nada categorizado ainda.' }),
      abaAtual === 'pendentes'
        ? el('p', { class: 'muted', text: 'Chega por e-mail sozinho, ou toque em “Apontar arquivos”.' })
        : el('p', { class: 'muted', text: 'Aqui aparecem os arquivos já triados, para reclassificar se precisar.' }),
    ]));
    return;
  }

  for (const item of itens) {
    const filhos = [
      el('span', { class: 'file-ico', text: '📄' }),
      el('span', { class: 'file-nome', text: item.nome || item.fileId }),
    ];
    if (abaAtual === 'categorizados' && item.lote) {
      filhos.push(el('span', { class: 'file-lote muted', text: item.lote }));
    }
    filhos.push(el('span', { class: 'chevron', text: abaAtual === 'categorizados' ? '✎' : '›' }));

    const abrir = () => (abaAtual === 'pendentes'
      ? abrirTriagem(item, () => renderInbox(onBadge))
      : onReclassificar(item, onBadge));

    if (abaAtual === 'pendentes') {
      // Área clicável (triagem) + botão Ignorar (sai da fila).
      const main = el('button', { class: 'file-main', onclick: abrir }, filhos);
      const ign = el('button', { class: 'file-ign', title: 'Ignorar (sai da fila)', onclick: () => onIgnorar(item, onBadge) }, '✕');
      lista.appendChild(el('div', { class: 'card card-file' }, [main, ign]));
    } else {
      lista.appendChild(el('button', { class: 'card card-file', onclick: abrir }, filhos));
    }
  }
}

async function onIgnorar(item, onBadge) {
  const nome = item.nome || item.fileId;
  if (!window.confirm(`Ignorar “${nome}”?\nSai da fila e não volta. O arquivo continua no Drive.`)) return;
  try {
    await marcarInboxIgnorado(item.linha);
    toast('Arquivo ignorado (saiu da fila).', 'ok');
    await renderInbox(onBadge);
  } catch (e) {
    toast('Falha ao ignorar.', 'err');
    console.warn(e.message);
  }
}

async function onReclassificar(item, onBadge) {
  try {
    const pre = await classificacaoDoArquivo(item.fileId); // {prestador,mes,tipos} ou null
    abrirTriagem(item, () => renderInbox(onBadge), { reclassify: true, preselecao: pre });
  } catch (e) {
    toast('Não foi possível abrir para reclassificar.', 'err');
    console.warn(e.message);
  }
}

async function onApontar(onBadge) {
  try {
    const docs = await apontarArquivos();
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
