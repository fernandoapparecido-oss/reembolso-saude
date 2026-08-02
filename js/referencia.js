// Tela REFERÊNCIA: documentos anuais (laudo/avaliação) por prestador/especialidade,
// com o VIGENTE em destaque e o HISTÓRICO de versões. Novas versões entram pela
// triagem (Inbox → modo "Referência").
import { CONFIG } from './config.js';
import { el, clear, toast } from './ui.js';
import { fileViewLink, idFromLink } from './model.js';
import { lerReferencia, tornarVigente } from './sheets.js';

const labelDe = (id) => (CONFIG.TIPOS.find((t) => t.id === id) || { label: id }).label;

export async function renderReferencia() {
  const root = document.getElementById('view-referencia');
  clear(root);
  root.appendChild(el('div', { class: 'view-head' }, [el('h1', { text: 'Referência' })]));
  root.appendChild(el('p', { class: 'muted', text: 'Laudos e avaliações (anuais). Para adicionar/atualizar, categorize o arquivo no Inbox como “Referência”.' }));

  const lista = el('div', { class: 'lista' });
  root.appendChild(lista);
  lista.appendChild(el('p', { class: 'muted', text: 'Carregando…' }));

  try {
    const refs = await lerReferencia();
    clear(lista);
    if (!refs.length) {
      lista.appendChild(el('div', { class: 'vazio' }, [el('p', { text: 'Nenhum documento de referência ainda.' })]));
      return;
    }
    // Agrupa por (tipo, prestador, especialidade).
    const grupos = new Map();
    for (const r of refs) {
      const k = `${r.tipo}||${r.prestador}||${r.especialidade}`;
      if (!grupos.has(k)) grupos.set(k, []);
      grupos.get(k).push(r);
    }
    for (const versoes of grupos.values()) {
      versoes.sort((a, b) => (b.data_emissao || '').localeCompare(a.data_emissao || ''));
      lista.appendChild(cardGrupo(versoes));
    }
  } catch (e) {
    clear(lista);
    if ((e.message || '') === 'SEM_ACESSO') throw e;
    lista.appendChild(el('div', { class: 'vazio' }, [el('p', { text: 'Erro ao carregar.' }), el('p', { class: 'muted', text: e.message })]));
  }
}

function cardGrupo(versoes) {
  const r0 = versoes[0];
  const temVigencia = CONFIG.REF_VIGENCIA.includes(r0.tipo);
  const titulo = `${labelDe(r0.tipo)} — ${r0.prestador}${r0.especialidade ? ' · ' + r0.especialidade : ''}`;
  const card = el('div', { class: 'card card-lote' });

  // Tipos de ARQUIVO (sem vigência): só uma lista dos documentos guardados.
  if (!temVigencia) {
    card.appendChild(el('div', { class: 'lote-top' }, [
      el('strong', { text: titulo }),
      el('span', { class: 'pill pill-enviado', text: `${versoes.length} arquivo(s)` }),
    ]));
    for (const v of versoes) {
      card.appendChild(el('div', { class: 'esp-linha' }, [el('span', { text: `${v.data_emissao || '—'} ` }), linkAbrir(v.link)]));
    }
    return card;
  }

  // Tipos COM vigência: vigente em destaque + histórico.
  const vig = versoes.find((v) => v.vigente);
  card.appendChild(el('div', { class: 'lote-top' }, [
    el('strong', { text: titulo }),
    vig ? el('span', { class: 'pill pill-reembolsado', text: 'vigente' }) : el('span', { class: 'pill pill-aguardando', text: 'sem vigente' }),
  ]));
  if (vig) {
    card.appendChild(el('div', { class: 'resumo-ok' }, [el('span', { text: `Vigente: emitido ${vig.data_emissao || '—'} ` }), linkAbrir(vig.link)]));
  }
  const antigas = versoes.filter((v) => !v.vigente);
  if (antigas.length) {
    card.appendChild(el('div', { class: 'muted', text: 'Histórico:' }));
    for (const v of antigas) {
      card.appendChild(el('div', { class: 'esp-linha' }, [
        el('span', { text: `${v.data_emissao || '—'} ` }),
        linkAbrir(v.link),
        el('button', { class: 'btn btn-ghost', onclick: () => promover(v.linha) }, 'Tornar vigente'),
      ]));
    }
  }
  return card;
}

function linkAbrir(link) {
  return el('a', { class: 'slot-link', href: fileViewLink(idFromLink(link)), target: '_blank', rel: 'noopener', text: '↗ abrir' });
}

async function promover(linha) {
  try { await tornarVigente(linha); toast('Versão marcada como vigente.', 'ok'); renderReferencia(); }
  catch (e) { toast('Falha ao atualizar.', 'err'); console.warn(e.message); }
}
