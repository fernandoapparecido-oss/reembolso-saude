// Tela LOTES: completude dirigida pela Config (compartilhados + por especialidade),
// prazos e registro de envio.
import { CONFIG } from './config.js';
import { el, clear, toast, fmtBRL } from './ui.js';
import {
  COL, STATUS, TIPOS_IDS, parseSlot, idFromLink, fileViewLink, diasAte, hojeISO,
} from './model.js';
import { lerLotes, atualizarLote, pedirPdfLote } from './sheets.js';
import { getPerfis } from './catalog.js';

let timerPoll = null;

const labelDe = (id) => (CONFIG.TIPOS.find((t) => t.id === id) || { label: id }).label;
const enviadoOuPago = (st) => st === STATUS.ENVIADO || st === STATUS.REEMBOLSADO;

const FILTROS = {
  todos: { label: 'Todos', fn: () => true },
  faltando: { label: 'Faltando docs', fn: (a) => !a.completo && !enviadoOuPago(a.statusReal) },
  prontos: { label: 'Prontos p/ enviar', fn: (a) => a.completo && !enviadoOuPago(a.statusReal) },
  semana: { label: 'Prazo desta semana', fn: (a) => { const d = diasAte(a.data_limite); return d != null && d <= CONFIG.ALERTA_PRAZO_DIAS && !enviadoOuPago(a.statusReal); } },
};

let filtroAtual = 'todos';

export async function renderLotes() {
  const root = document.getElementById('view-lotes');
  clear(root);
  root.appendChild(el('div', { class: 'view-head' }, [el('h1', { text: 'Lotes' })]));

  const barra = el('div', { class: 'filtros' });
  for (const [k, f] of Object.entries(FILTROS)) {
    barra.appendChild(el('button', { class: `filtro ${filtroAtual === k ? 'on' : ''}`, onclick: () => { filtroAtual = k; renderLotes(); } }, f.label));
  }
  root.appendChild(barra);

  const lista = el('div', { class: 'lista' });
  root.appendChild(lista);
  lista.appendChild(el('p', { class: 'muted', text: 'Carregando…' }));

  try {
    const [brutos, perfis] = await Promise.all([lerLotes(), getPerfis()]);
    const perfilDe = (nome) => perfis.find((p) => p.prestador === nome) || null;

    const analises = brutos.map((b) => analisar(b, perfilDe(b.cols[COL.prestador])));

    clear(lista);
    const filtrados = analises.filter(FILTROS[filtroAtual].fn);
    if (!filtrados.length) {
      lista.appendChild(el('div', { class: 'vazio' }, [el('p', { text: 'Nenhum lote neste filtro.' })]));
      return;
    }
    for (const a of filtrados) lista.appendChild(cardLote(a));

    // Se houver PDF sendo gerado, atualiza sozinho até ficar pronto.
    clearTimeout(timerPoll);
    if (analises.some((a) => a.pedido_pdf)) timerPoll = setTimeout(renderLotes, 20000);
  } catch (e) {
    if ((e.message || '') === 'SEM_ACESSO') throw e; // app trata (reconectar)
    clear(lista);
    if ((e.message || '').includes('SEM_PLANILHA')) lista.appendChild(el('div', { class: 'vazio' }, [el('p', { text: '🔌 Conecte a planilha no topo primeiro.' })]));
    else lista.appendChild(el('div', { class: 'vazio' }, [el('p', { text: 'Erro ao carregar.' }), el('p', { class: 'muted', text: e.message })]));
  }
}

// Analisa um lote contra o perfil do prestador: o que é compartilhado, a matriz
// por especialidade, o que falta e se está completo.
function analisar(b, perfil) {
  const cols = b.cols;
  const slot = (t) => parseSlot(cols[COL[t]] || '');
  const tipos = perfil ? perfil.tipos : TIPOS_IDS;
  const esps = perfil ? perfil.especialidades : [];
  const perEsp = tipos.filter((t) => CONFIG.PER_ESPECIALIDADE.includes(t));
  const compartilhados = tipos.filter((t) => !CONFIG.PER_ESPECIALIDADE.includes(t));

  const faltando = [];
  const linhaShared = [];
  for (const t of compartilhados) {
    const entradas = slot(t);
    const ok = entradas.length > 0;
    if (!ok) faltando.push(labelDe(t));
    linhaShared.push({ tipo: t, ok, links: entradas.map((e) => e.link) });
  }

  const matriz = [];
  if (esps.length) {
    for (const esp of esps) {
      const itens = perEsp.map((t) => {
        const entrada = slot(t).find((e) => e.label === esp);
        const ok = !!entrada;
        if (!ok) faltando.push(`${esp}/${labelDe(t)}`);
        return { tipo: t, ok, link: entrada ? entrada.link : '' };
      });
      matriz.push({ esp, itens });
    }
  } else {
    for (const t of perEsp) {
      const entradas = slot(t);
      const ok = entradas.length > 0;
      if (!ok) faltando.push(labelDe(t));
      linhaShared.push({ tipo: t, ok, links: entradas.map((e) => e.link) });
    }
  }

  const completo = faltando.length === 0;
  const statusReal = cols[COL.status] || STATUS.AGUARDANDO;
  const statusMostra = enviadoOuPago(statusReal) ? statusReal : (completo ? STATUS.COMPLETO : STATUS.AGUARDANDO);

  return {
    linha: b.linha,
    prestador: cols[COL.prestador] || '', mes: cols[COL.mes] || '',
    data_limite: cols[COL.data_limite] || '',
    data_postagem: cols[COL.data_postagem] || '', rastreio: cols[COL.rastreio] || '', valor: cols[COL.valor] || '',
    pedido_pdf: cols[COL.pedido_pdf] || '', pdf_lote: cols[COL.pdf_lote] || '',
    statusReal, statusMostra, completo, faltando, linhaShared, matriz,
  };
}

function cardLote(a) {
  const d = diasAte(a.data_limite);
  const enviado = enviadoOuPago(a.statusReal);
  let prazoCls = 'prazo';
  if (!enviado && d != null) { if (d < 0) prazoCls += ' prazo-vencido'; else if (d <= CONFIG.ALERTA_PRAZO_DIAS) prazoCls += ' prazo-proximo'; }

  const card = el('div', { class: `card card-lote status-${a.statusMostra.toLowerCase()}` });

  card.appendChild(el('div', { class: 'lote-top' }, [
    el('div', {}, [el('strong', { text: a.prestador }), el('span', { class: 'muted', text: ` · ${a.mes}` })]),
    el('span', { class: `pill pill-${a.statusMostra.toLowerCase()}`, text: a.statusMostra }),
  ]));

  // Resumo de completude
  card.appendChild(a.completo
    ? el('div', { class: 'resumo-ok', text: '✓ Tudo recebido' })
    : el('div', { class: 'resumo-falta' }, [el('span', { text: 'Faltando: ' }), el('span', { text: a.faltando.join(', ') })]));

  // Compartilhados
  if (a.linhaShared.length) {
    const linha = el('div', { class: 'slots' });
    for (const s of a.linhaShared) linha.appendChild(slotChip(labelDe(s.tipo), s.ok, s.links));
    card.appendChild(linha);
  }

  // Matriz por especialidade
  for (const row of a.matriz) {
    const linha = el('div', { class: 'esp-linha' }, [el('span', { class: 'esp-nome', text: row.esp }), el('span', { text: ':' })]);
    for (const it of row.itens) linha.appendChild(slotChip(labelDe(it.tipo), it.ok, it.link ? [it.link] : []));
    card.appendChild(linha);
  }

  card.appendChild(el('div', { class: prazoCls }, [
    el('span', { text: '⏱ Prazo: ' }), el('span', { text: a.data_limite || '—' }),
    d != null && !enviado ? el('span', { class: 'prazo-dias', text: d < 0 ? `  (vencido há ${-d}d)` : `  (faltam ${d}d)` }) : null,
  ]));

  card.appendChild(impressao(a));
  card.appendChild(acoes(a));
  return card;
}

// Faixa de impressão: Gerar PDF → Gerando… → Imprimir (PDF único do lote).
function impressao(a) {
  const box = el('div', { class: 'acoes' });
  const temDoc = a.linhaShared.some((s) => s.ok) || a.matriz.some((r) => r.itens.some((i) => i.ok));

  const pdfOk = /^https?:/i.test(a.pdf_lote);
  if (a.pedido_pdf) {
    box.appendChild(el('span', { class: 'muted', text: '🖨 Gerando PDF do lote… (~1–2 min)' }));
    box.appendChild(btn('Atualizar', 'ghost', () => renderLotes()));
  } else if (pdfOk) {
    box.appendChild(btn('🖨 Imprimir (PDF do lote)', 'primary', () => window.open(a.pdf_lote, '_blank', 'noopener')));
    box.appendChild(btn('Refazer PDF', 'ghost', () => pedir(a)));
  } else if (a.pdf_lote) {
    box.appendChild(el('span', { class: 'resumo-falta', text: `Falha ao gerar: ${a.pdf_lote}` }));
    box.appendChild(btn('Tentar de novo', 'ghost', () => pedir(a)));
  } else if (temDoc) {
    box.appendChild(btn('Gerar PDF para impressão', 'ghost', () => pedir(a)));
  }
  return box;
}

async function pedir(a) {
  try {
    await pedirPdfLote(a.linha);
    toast('PDF solicitado. Fica pronto em ~1–2 min.', 'ok');
    renderLotes();
  } catch (e) { toast('Falha ao solicitar o PDF.', 'err'); console.warn(e.message); }
}

function slotChip(label, ok, links) {
  const chip = el('span', { class: `slot ${ok ? 'slot-on' : 'slot-off'}` }, [
    el('span', { class: 'slot-ico', text: ok ? '✓' : '·' }), el('span', { text: label }),
  ]);
  (links || []).forEach((link, i) => chip.appendChild(el('a', {
    class: 'slot-link', href: fileViewLink(idFromLink(link)), target: '_blank', rel: 'noopener',
    title: 'Abrir arquivo', text: i === 0 ? ' ↗' : ` ↗${i + 1}`,
  })));
  return chip;
}

function acoes(a) {
  const box = el('div', { class: 'acoes' });
  if (!enviadoOuPago(a.statusReal)) {
    box.appendChild(btn('Registrar envio', 'primary', () => abrirEnvio(a, box)));
  } else if (a.statusReal === STATUS.ENVIADO) {
    box.appendChild(el('div', { class: 'envio-info muted' }, [
      el('span', { text: `📮 ${a.data_postagem || '—'}` }),
      a.rastreio ? el('span', { text: ` · ${a.rastreio}` }) : null,
      a.valor ? el('span', { text: ` · ${fmtBRL(a.valor)}` }) : null,
    ]));
    box.appendChild(btn('Marcar Reembolsado', 'ok', () => save(a, { status: STATUS.REEMBOLSADO })));
    box.appendChild(btn('Editar envio', 'ghost', () => abrirEnvio(a, box)));
  } else {
    box.appendChild(el('div', { class: 'envio-info muted', text: `✅ ${a.data_postagem || ''} ${a.rastreio || ''} ${a.valor ? '· ' + fmtBRL(a.valor) : ''}` }));
  }
  return box;
}

function abrirEnvio(a, box) {
  const painel = el('form', { class: 'envio-form' });
  const dPost = el('input', { type: 'date', value: a.data_postagem || hojeISO() });
  const rast = el('input', { type: 'text', placeholder: 'Código de rastreio', value: a.rastreio || '' });
  const val = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'Valor (R$)', value: a.valor || '' });
  const prazo = el('input', { type: 'date', value: a.data_limite || '' });

  painel.appendChild(campo('Data de postagem', dPost));
  painel.appendChild(campo('Rastreio (Correios)', rast));
  painel.appendChild(campo('Valor', val));
  painel.appendChild(campo('Prazo (editável)', prazo));

  if (!a.completo) painel.appendChild(el('div', { class: 'resumo-falta', text: `Atenção: ainda faltando ${a.faltando.join(', ')}` }));

  painel.appendChild(btn('Salvar envio', 'primary', async (ev) => {
    ev.preventDefault();
    await save(a, { status: STATUS.ENVIADO, data_postagem: dPost.value, rastreio: rast.value.trim(), valor: val.value.trim(), data_limite: prazo.value });
  }));
  painel.appendChild(btn('Cancelar', 'ghost', (ev) => { ev.preventDefault(); painel.remove(); }));
  box.appendChild(painel);
}

async function save(a, patch) {
  try { await atualizarLote(a.linha, patch); toast('Lote atualizado.', 'ok'); renderLotes(); }
  catch (e) { toast('Falha ao salvar.', 'err'); console.warn(e.message); }
}

function campo(label, input) { return el('label', { class: 'campo campo-inline' }, [el('span', { text: label }), input]); }
function btn(txt, tipo, onclick) { return el('button', { class: `btn btn-${tipo}`, onclick }, txt); }
