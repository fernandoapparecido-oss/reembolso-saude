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
// "Já saiu" do fluxo de documentação: enviado, em análise no plano ou reembolsado.
const enviadoOuPago = (st) => st === STATUS.ENVIADO || st === STATUS.EM_ANALISE || st === STATUS.REEMBOLSADO;
const aguardandoReembolso = (st) => st === STATUS.ENVIADO || st === STATUS.EM_ANALISE;
// "Em análise" -> "em-analise" (para classes CSS).
const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, '-');
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Atalhos de situação (chips). Combinam com os filtros detalhados abaixo.
const SITUACOES = {
  todos: { label: 'Todos', fn: () => true },
  faltando: { label: 'Faltando docs', fn: (a) => !a.completo && !enviadoOuPago(a.statusReal) },
  prontos: { label: 'Prontos p/ enviar', fn: (a) => a.completo && !enviadoOuPago(a.statusReal) },
  semana: { label: 'Prazo desta semana', fn: (a) => { const d = diasAte(a.data_limite); return d != null && d <= CONFIG.ALERTA_PRAZO_DIAS && !enviadoOuPago(a.statusReal); } },
  reembolso: { label: 'Aguardando reembolso', fn: (a) => aguardandoReembolso(a.statusReal) },
};

const STATUS_OPCOES = [STATUS.AGUARDANDO, STATUS.COMPLETO, STATUS.ENVIADO, STATUS.EM_ANALISE, STATUS.REEMBOLSADO];

// Qual data o filtro de período usa.
const CAMPOS_DATA = {
  mes: { label: 'Mês de referência', get: (a) => a.mes },
  postagem: { label: 'Data de postagem', get: (a) => a.data_postagem },
  prazo: { label: 'Prazo', get: (a) => a.data_limite },
};

const ORDENS = {
  recentes: { label: 'Mês: mais recente', fn: (x, y) => y.mes.localeCompare(x.mes) || x.prestador.localeCompare(y.prestador) },
  antigos: { label: 'Mês: mais antigo', fn: (x, y) => x.mes.localeCompare(y.mes) || x.prestador.localeCompare(y.prestador) },
  prazo: { label: 'Prazo mais próximo', fn: (x, y) => (x.data_limite || '9999').localeCompare(y.data_limite || '9999') },
  prestador: { label: 'Prestador (A–Z)', fn: (x, y) => x.prestador.localeCompare(y.prestador, 'pt-BR') || y.mes.localeCompare(x.mes) },
};

const FILTRO_PADRAO = { situacao: 'todos', busca: '', prestador: '', status: '', campoData: 'mes', de: '', ate: '', ordem: 'recentes' };
const K_FILTRO = 'lotes_filtros';

// Os filtros ficam guardados neste dispositivo (conveniência; nada vai para a planilha).
function carregarFiltro() {
  try { return { ...FILTRO_PADRAO, ...JSON.parse(localStorage.getItem(K_FILTRO) || '{}') }; }
  catch { return { ...FILTRO_PADRAO }; }
}
function salvarFiltro() { try { localStorage.setItem(K_FILTRO, JSON.stringify(filtro)); } catch { /* sem storage */ } }

let filtro = carregarFiltro();
if (!SITUACOES[filtro.situacao]) filtro.situacao = 'todos';
if (!ORDENS[filtro.ordem]) filtro.ordem = 'recentes';
if (!CAMPOS_DATA[filtro.campoData]) filtro.campoData = 'mes';

let analises = []; // último carregamento (filtrar não relê a planilha)

// Quantos filtros detalhados (fora situação/ordem) estão ativos.
const nAtivos = () => ['busca', 'prestador', 'status', 'de', 'ate'].filter((k) => filtro[k]).length;

function passaFiltro(a) {
  if (!SITUACOES[filtro.situacao].fn(a)) return false;
  if (filtro.prestador && a.prestador !== filtro.prestador) return false;
  if (filtro.status && a.statusMostra !== filtro.status) return false;
  if (filtro.de || filtro.ate) {
    const v = String(CAMPOS_DATA[filtro.campoData].get(a) || '').slice(0, 7); // YYYY-MM
    if (!v) return false;
    if (filtro.de && v < filtro.de) return false;
    if (filtro.ate && v > filtro.ate) return false;
  }
  if (filtro.busca) {
    const alvo = semAcento([a.prestador, a.mes, a.rastreio, a.protocolo, a.valor, a.statusMostra].join(' '));
    if (!semAcento(filtro.busca).split(/\s+/).every((t) => alvo.includes(t))) return false;
  }
  return true;
}

export async function renderLotes() {
  const root = document.getElementById('view-lotes');
  clear(root);
  root.appendChild(el('div', { class: 'view-head' }, [el('h1', { text: 'Lotes' })]));

  const controles = el('div', { class: 'filtros-box' });
  const contador = el('div', { class: 'filtro-contador muted' });
  const lista = el('div', { class: 'lista' });
  root.appendChild(controles);
  root.appendChild(contador);
  root.appendChild(lista);
  lista.appendChild(el('p', { class: 'muted', text: 'Carregando…' }));

  try {
    const [brutos, perfis] = await Promise.all([lerLotes(), getPerfis()]);
    const perfilDe = (nome) => perfis.find((p) => p.prestador === nome) || null;
    analises = brutos.map((b) => analisar(b, perfilDe(b.cols[COL.prestador])));

    montarControles(controles, () => desenharLista(lista, contador));
    desenharLista(lista, contador);

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

function desenharLista(lista, contador) {
  clear(lista);
  const filtrados = analises.filter(passaFiltro).sort(ORDENS[filtro.ordem].fn);
  contador.textContent = analises.length ? `${filtrados.length} de ${analises.length} lote(s)` : '';
  if (!filtrados.length) {
    lista.appendChild(el('div', { class: 'vazio' }, [
      el('p', { text: analises.length ? 'Nenhum lote com estes filtros.' : 'Nenhum lote ainda.' }),
    ]));
    return;
  }
  for (const a of filtrados) lista.appendChild(cardLote(a));
}

// Barra de filtros: busca + chips de situação + painel recolhível com o resto.
function montarControles(box, aplicar) {
  clear(box);
  const mudou = () => { salvarFiltro(); atualizarResumo(); aplicar(); };

  // Busca livre (prestador, mês, rastreio, protocolo, valor, status).
  const busca = el('input', { type: 'search', class: 'filtro-busca', placeholder: '🔎 Buscar prestador, rastreio, protocolo…' });
  busca.value = filtro.busca;
  busca.addEventListener('input', () => { filtro.busca = busca.value.trim(); mudou(); });
  box.appendChild(busca);

  // Chips de situação.
  const chips = el('div', { class: 'filtros' });
  const desenharChips = () => {
    clear(chips);
    for (const [k, f] of Object.entries(SITUACOES)) {
      chips.appendChild(el('button', {
        class: `filtro ${filtro.situacao === k ? 'on' : ''}`,
        onclick: () => { filtro.situacao = k; desenharChips(); mudou(); },
      }, f.label));
    }
  };
  desenharChips();
  box.appendChild(chips);

  // Painel com filtros detalhados.
  const mais = el('details', { class: 'filtros-mais' });
  if (nAtivos() > (filtro.busca ? 1 : 0)) mais.open = true;
  const resumo = el('summary');
  mais.appendChild(resumo);
  const atualizarResumo = () => {
    const n = nAtivos();
    resumo.textContent = n ? `Mais filtros e ordem · ${n} ativo(s)` : 'Mais filtros e ordem';
    limpar.hidden = !n && filtro.situacao === 'todos' && filtro.ordem === 'recentes';
  };

  const prestadores = [...new Set(analises.map((a) => a.prestador))].sort((x, y) => x.localeCompare(y, 'pt-BR'));
  const selPrest = selectDe([['', 'Todos'], ...prestadores.map((p) => [p, p])], filtro.prestador, (v) => { filtro.prestador = v; mudou(); });
  const selStatus = selectDe([['', 'Todos'], ...STATUS_OPCOES.map((s) => [s, s])], filtro.status, (v) => { filtro.status = v; mudou(); });
  const selCampo = selectDe(Object.entries(CAMPOS_DATA).map(([k, c]) => [k, c.label]), filtro.campoData, (v) => { filtro.campoData = v; mudou(); });
  const de = el('input', { type: 'month' }); de.value = filtro.de;
  de.addEventListener('change', () => { filtro.de = de.value; mudou(); });
  const ate = el('input', { type: 'month' }); ate.value = filtro.ate;
  ate.addEventListener('change', () => { filtro.ate = ate.value; mudou(); });
  const selOrdem = selectDe(Object.entries(ORDENS).map(([k, o]) => [k, o.label]), filtro.ordem, (v) => { filtro.ordem = v; mudou(); });

  const grade = el('div', { class: 'filtros-grade' }, [
    campoF('Prestador', selPrest),
    campoF('Status', selStatus),
    campoF('Período por', selCampo),
    el('div', { class: 'filtro-periodo' }, [campoF('De (mês)', de), campoF('Até (mês)', ate)]),
    campoF('Ordenar por', selOrdem),
  ]);
  mais.appendChild(grade);

  const limpar = btn('Limpar filtros', 'ghost', () => { filtro = { ...FILTRO_PADRAO }; salvarFiltro(); montarControles(box, aplicar); aplicar(); });
  mais.appendChild(el('div', { class: 'acoes' }, [limpar]));
  box.appendChild(mais);
  atualizarResumo();
}

function selectDe(opcoes, atual, onChange) {
  const s = el('select');
  for (const [v, label] of opcoes) {
    const o = el('option', { value: v, text: label });
    if (v === atual) o.selected = true;
    s.appendChild(o);
  }
  s.addEventListener('change', () => onChange(s.value));
  return s;
}
function campoF(label, input) { return el('label', { class: 'campo campo-filtro' }, [el('span', { text: label }), input]); }

// Analisa um lote contra o perfil do prestador: o que é compartilhado, a matriz
// por especialidade, o que falta e se está completo.
function analisar(b, perfil) {
  const cols = b.cols;
  const slot = (t) => parseSlot(cols[COL[t]] || '');
  // Laudo/Avaliação são REFERÊNCIA (documentos à parte) — não entram no lote.
  const tipos = (perfil ? perfil.tipos : TIPOS_IDS).filter((t) => !CONFIG.REF_TIPOS.includes(t));
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
  const protocolo = cols[COL.protocolo] || '';
  let statusReal = cols[COL.status] || STATUS.AGUARDANDO;
  // Enviado + protocolo (mesmo se digitado direto na planilha) = Em análise.
  if (statusReal === STATUS.ENVIADO && protocolo.trim()) statusReal = STATUS.EM_ANALISE;
  const statusMostra = enviadoOuPago(statusReal) ? statusReal : (completo ? STATUS.COMPLETO : STATUS.AGUARDANDO);

  return {
    linha: b.linha,
    prestador: cols[COL.prestador] || '', mes: cols[COL.mes] || '',
    data_limite: cols[COL.data_limite] || '',
    data_postagem: cols[COL.data_postagem] || '', rastreio: cols[COL.rastreio] || '', valor: cols[COL.valor] || '',
    pedido_pdf: cols[COL.pedido_pdf] || '', pdf_lote: cols[COL.pdf_lote] || '', protocolo,
    statusReal, statusMostra, completo, faltando, linhaShared, matriz,
  };
}

function cardLote(a) {
  const d = diasAte(a.data_limite);
  const enviado = enviadoOuPago(a.statusReal);
  let prazoCls = 'prazo';
  if (!enviado && d != null) { if (d < 0) prazoCls += ' prazo-vencido'; else if (d <= CONFIG.ALERTA_PRAZO_DIAS) prazoCls += ' prazo-proximo'; }

  const card = el('div', { class: `card card-lote status-${slug(a.statusMostra)}` });

  card.appendChild(el('div', { class: 'lote-top' }, [
    el('div', {}, [el('strong', { text: a.prestador }), el('span', { class: 'muted', text: ` · ${a.mes}` })]),
    el('span', { class: `pill pill-${slug(a.statusMostra)}`, text: a.statusMostra }),
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
  } else if (aguardandoReembolso(a.statusReal)) {
    box.appendChild(infoEnvio(a, '📮'));
    box.appendChild(btn('Marcar Reembolsado', 'ok', () => save(a, { status: STATUS.REEMBOLSADO })));
    box.appendChild(btn(a.protocolo ? 'Editar envio' : 'Editar envio / protocolo', 'ghost', () => abrirEnvio(a, box)));
  } else {
    box.appendChild(infoEnvio(a, '✅'));
  }
  return box;
}

function infoEnvio(a, ico) {
  return el('div', { class: 'envio-info muted' }, [
    el('span', { text: `${ico} ${a.data_postagem || '—'}` }),
    a.rastreio ? el('span', { text: ` · Rastreio ${a.rastreio}` }) : null,
    a.protocolo ? el('span', { text: ` · Protocolo ${a.protocolo}` }) : null,
    a.valor ? el('span', { text: ` · ${fmtBRL(a.valor)}` }) : null,
  ]);
}

function abrirEnvio(a, box) {
  if (box.querySelector('.envio-form')) return; // já aberto
  const painel = el('form', { class: 'envio-form' });
  const dPost = el('input', { type: 'date', value: a.data_postagem || hojeISO() });
  const rast = el('input', { type: 'text', placeholder: 'Código de rastreio', value: a.rastreio || '' });
  const proto = el('input', { type: 'text', placeholder: 'Nº do protocolo no plano', value: a.protocolo || '' });
  const val = el('input', { type: 'text', inputmode: 'decimal', placeholder: 'Valor (R$)', value: a.valor || '' });
  const prazo = el('input', { type: 'date', value: a.data_limite || '' });

  painel.appendChild(campo('Data de postagem', dPost));
  painel.appendChild(campo('Rastreio (Correios)', rast));
  painel.appendChild(campo('Protocolo (plano)', proto));
  painel.appendChild(campo('Valor', val));
  painel.appendChild(campo('Prazo (editável)', prazo));
  painel.appendChild(el('p', { class: 'muted envio-dica', text: 'Com protocolo preenchido, o lote fica "Em análise".' }));

  if (!a.completo) painel.appendChild(el('div', { class: 'resumo-falta', text: `Atenção: ainda faltando ${a.faltando.join(', ')}` }));

  painel.appendChild(btn('Salvar envio', 'primary', async (ev) => {
    ev.preventDefault();
    const protocolo = proto.value.trim();
    await save(a, {
      status: protocolo ? STATUS.EM_ANALISE : STATUS.ENVIADO,
      data_postagem: dPost.value, rastreio: rast.value.trim(), protocolo,
      valor: val.value.trim(), data_limite: prazo.value,
    });
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
