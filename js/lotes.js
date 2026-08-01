// Tela LOTES: painel por status, prazos e registro de envio.
import { CONFIG } from './config.js';
import { el, clear, toast, fmtBRL } from './ui.js';
import {
  COL, STATUS, idFromLink, fileViewLink, diasAte, hojeISO,
} from './model.js';
import { lerLotes, atualizarLote } from './sheets.js';

const FILTROS = {
  todos: { label: 'Todos', fn: () => true },
  faltando: { label: 'Faltando docs', fn: (l) => l.status === STATUS.AGUARDANDO },
  prontos: { label: 'Prontos p/ enviar', fn: (l) => l.status === STATUS.COMPLETO },
  semana: { label: 'Prazo desta semana', fn: (l) => { const d = diasAte(l.data_limite); return d != null && d <= CONFIG.ALERTA_PRAZO_DIAS && l.status !== STATUS.ENVIADO && l.status !== STATUS.REEMBOLSADO; } },
};

let filtroAtual = 'todos';

export async function renderLotes() {
  const root = document.getElementById('view-lotes');
  clear(root);
  root.appendChild(el('div', { class: 'view-head' }, [el('h1', { text: 'Lotes' })]));

  const barra = el('div', { class: 'filtros' });
  for (const [k, f] of Object.entries(FILTROS)) {
    barra.appendChild(el('button', {
      class: `filtro ${filtroAtual === k ? 'on' : ''}`,
      onclick: () => { filtroAtual = k; renderLotes(); },
    }, f.label));
  }
  root.appendChild(barra);

  const lista = el('div', { class: 'lista' });
  root.appendChild(lista);
  lista.appendChild(el('p', { class: 'muted', text: 'Carregando…' }));

  try {
    const brutos = await lerLotes();
    const lotes = brutos.map((b) => ({
      linha: b.linha,
      prestador: b.cols[COL.prestador] || '',
      mes: b.cols[COL.mes] || '',
      slots: {
        NF: b.cols[COL.NF] || '', Laudo: b.cols[COL.Laudo] || '', Comprovante: b.cols[COL.Comprovante] || '',
        Relatorio: b.cols[COL.Relatorio] || '', Presenca: b.cols[COL.Presenca] || '',
      },
      data_limite: b.cols[COL.data_limite] || '',
      status: b.cols[COL.status] || STATUS.AGUARDANDO,
      data_postagem: b.cols[COL.data_postagem] || '',
      rastreio: b.cols[COL.rastreio] || '',
      valor: b.cols[COL.valor] || '',
    }));

    clear(lista);
    const filtrados = lotes.filter(FILTROS[filtroAtual].fn);
    if (!filtrados.length) {
      lista.appendChild(el('div', { class: 'vazio' }, [el('p', { text: 'Nenhum lote neste filtro.' })]));
      return;
    }
    for (const l of filtrados) lista.appendChild(cardLote(l));
  } catch (e) {
    clear(lista);
    if ((e.message || '').includes('SEM_PLANILHA')) {
      lista.appendChild(el('div', { class: 'vazio' }, [el('p', { text: '🔌 Conecte a planilha no topo primeiro.' })]));
    } else {
      lista.appendChild(el('div', { class: 'vazio' }, [el('p', { text: 'Erro ao carregar.' }), el('p', { class: 'muted', text: e.message })]));
    }
  }
}

function cardLote(l) {
  const d = diasAte(l.data_limite);
  const enviadoOuPago = l.status === STATUS.ENVIADO || l.status === STATUS.REEMBOLSADO;
  let prazoCls = 'prazo';
  if (!enviadoOuPago && d != null) {
    if (d < 0) prazoCls += ' prazo-vencido';
    else if (d <= CONFIG.ALERTA_PRAZO_DIAS) prazoCls += ' prazo-proximo';
  }

  const card = el('div', { class: `card card-lote status-${l.status.toLowerCase()}` });

  card.appendChild(el('div', { class: 'lote-top' }, [
    el('div', {}, [
      el('strong', { text: l.prestador }),
      el('span', { class: 'muted', text: ` · ${l.mes}` }),
    ]),
    el('span', { class: `pill pill-${l.status.toLowerCase()}`, text: l.status }),
  ]));

  // Slots (tipos), cada um com link se preenchido.
  const slots = el('div', { class: 'slots' });
  for (const t of CONFIG.TIPOS) {
    const val = l.slots[t.id] || '';
    const on = !!val.trim();
    const item = el('div', { class: `slot ${on ? 'slot-on' : 'slot-off'}` }, [
      el('span', { class: 'slot-ico', text: on ? '✓' : '·' }),
      el('span', { text: t.label }),
    ]);
    if (on) {
      // Vários links possíveis, separados por " | ".
      val.split('|').map((s) => s.trim()).filter(Boolean).forEach((link, i) => {
        item.appendChild(el('a', {
          class: 'slot-link', href: fileViewLink(idFromLink(link)), target: '_blank', rel: 'noopener',
          title: 'Abrir arquivo de origem', text: i === 0 ? ' ↗' : ` ↗${i + 1}`,
        }));
      });
    }
    slots.appendChild(item);
  }
  card.appendChild(slots);

  // Prazo
  card.appendChild(el('div', { class: prazoCls }, [
    el('span', { text: '⏱ Prazo: ' }),
    el('span', { text: l.data_limite || '—' }),
    d != null && !enviadoOuPago ? el('span', { class: 'prazo-dias', text: d < 0 ? `  (vencido há ${-d}d)` : `  (faltam ${d}d)` }) : null,
  ]));

  card.appendChild(acoes(l));
  return card;
}

function acoes(l) {
  const box = el('div', { class: 'acoes' });

  if (l.status === STATUS.AGUARDANDO) {
    box.appendChild(btn('Marcar Completo', 'ghost', async () => save(l, { status: STATUS.COMPLETO })));
  }
  if (l.status === STATUS.AGUARDANDO || l.status === STATUS.COMPLETO) {
    box.appendChild(btn('Registrar envio', 'primary', () => abrirEnvio(l, box)));
  }
  if (l.status === STATUS.ENVIADO) {
    box.appendChild(el('div', { class: 'envio-info muted' }, [
      el('span', { text: `📮 ${l.data_postagem || '—'}` }),
      l.rastreio ? el('span', { text: ` · ${l.rastreio}` }) : null,
      l.valor ? el('span', { text: ` · ${fmtBRL(l.valor)}` }) : null,
    ]));
    box.appendChild(btn('Marcar Reembolsado', 'ok', async () => save(l, { status: STATUS.REEMBOLSADO })));
    box.appendChild(btn('Editar envio', 'ghost', () => abrirEnvio(l, box)));
  }
  if (l.status === STATUS.REEMBOLSADO) {
    box.appendChild(el('div', { class: 'envio-info muted', text: `✅ ${l.data_postagem || ''} ${l.rastreio || ''} ${l.valor ? '· ' + fmtBRL(l.valor) : ''}` }));
  }
  return box;
}

function abrirEnvio(l, box) {
  const painel = el('form', { class: 'envio-form' });
  const dPost = el('input', { type: 'date', value: l.data_postagem || hojeISO() });
  const rast = el('input', { type: 'text', placeholder: 'Código de rastreio', value: l.rastreio || '' });
  const val = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'Valor (R$)', value: l.valor || '' });
  const prazo = el('input', { type: 'date', value: l.data_limite || '' });

  painel.appendChild(campo('Data de postagem', dPost));
  painel.appendChild(campo('Rastreio (Correios)', rast));
  painel.appendChild(campo('Valor', val));
  painel.appendChild(campo('Prazo (editável)', prazo));

  const salvar = btn('Salvar envio', 'primary', async (ev) => {
    ev.preventDefault();
    await save(l, {
      status: STATUS.ENVIADO,
      data_postagem: dPost.value,
      rastreio: rast.value.trim(),
      valor: val.value.trim(),
      data_limite: prazo.value,
    });
  });
  painel.appendChild(salvar);
  painel.appendChild(btn('Cancelar', 'ghost', (ev) => { ev.preventDefault(); painel.remove(); }));
  box.appendChild(painel);
}

async function save(l, patch) {
  try {
    await atualizarLote(l.linha, patch);
    toast('Lote atualizado.', 'ok');
    renderLotes();
  } catch (e) {
    toast('Falha ao salvar.', 'err');
    console.warn(e.message);
  }
}

function campo(label, input) {
  return el('label', { class: 'campo campo-inline' }, [el('span', { text: label }), input]);
}
function btn(txt, tipo, onclick) {
  return el('button', { class: `btn btn-${tipo}`, onclick }, txt);
}
