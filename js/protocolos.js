// Tela PROTOCOLOS: registra protocolos/chamados com o plano de saúde.
// Campos: protocolo, título, descrição e prazo (com destaque) + status Aberto/Resolvido.
import { CONFIG } from './config.js';
import { el, clear, toast } from './ui.js';
import { diasAte, hojeISO } from './model.js';
import { lerProtocolos, adicionarProtocolo, atualizarProtocolo } from './sheets.js';

const FILTROS = {
  abertos: { label: 'Abertos', fn: (p) => p.status !== 'Resolvido' },
  resolvidos: { label: 'Resolvidos', fn: (p) => p.status === 'Resolvido' },
  todos: { label: 'Todos', fn: () => true },
};
let filtroAtual = 'abertos';

export async function renderProtocolos() {
  const root = document.getElementById('view-protocolos');
  clear(root);
  root.appendChild(el('div', { class: 'view-head' }, [
    el('h1', { text: 'Protocolos' }),
    el('button', { class: 'btn btn-primary', onclick: () => abrirForm(null) }, '＋ Novo protocolo'),
  ]));

  const formHost = el('div', { id: 'proto-form' });
  root.appendChild(formHost);

  const barra = el('div', { class: 'filtros' });
  for (const [k, f] of Object.entries(FILTROS)) {
    barra.appendChild(el('button', { class: `filtro ${filtroAtual === k ? 'on' : ''}`, onclick: () => { filtroAtual = k; renderProtocolos(); } }, f.label));
  }
  root.appendChild(barra);

  const lista = el('div', { class: 'lista' });
  root.appendChild(lista);
  lista.appendChild(el('p', { class: 'muted', text: 'Carregando…' }));

  try {
    const protos = await lerProtocolos();
    clear(lista);
    const filtrados = protos.filter(FILTROS[filtroAtual].fn)
      .sort((a, b) => (a.prazo || '9999').localeCompare(b.prazo || '9999'));
    if (!filtrados.length) {
      lista.appendChild(el('div', { class: 'vazio' }, [el('p', { text: 'Nenhum protocolo neste filtro.' })]));
      return;
    }
    for (const p of filtrados) lista.appendChild(card(p));
  } catch (e) {
    if ((e.message || '') === 'SEM_ACESSO') throw e;
    clear(lista);
    lista.appendChild(el('div', { class: 'vazio' }, [el('p', { text: 'Erro ao carregar.' }), el('p', { class: 'muted', text: e.message })]));
  }
}

function card(p) {
  const resolvido = p.status === 'Resolvido';
  const d = diasAte(p.prazo);
  let prazoCls = 'prazo';
  if (!resolvido && d != null) { if (d < 0) prazoCls += ' prazo-vencido'; else if (d <= CONFIG.ALERTA_PRAZO_DIAS) prazoCls += ' prazo-proximo'; }

  const c = el('div', { class: 'card card-lote' });
  c.appendChild(el('div', { class: 'lote-top' }, [
    el('strong', { text: p.titulo || '(sem título)' }),
    el('span', { class: `pill ${resolvido ? 'pill-reembolsado' : 'pill-aguardando'}`, text: p.status }),
  ]));
  if (p.protocolo) c.appendChild(el('div', { class: 'muted', text: `Protocolo: ${p.protocolo}` }));
  if (p.prazo) {
    c.appendChild(el('div', { class: prazoCls }, [
      el('span', { text: '⏱ Prazo: ' }), el('span', { text: p.prazo }),
      !resolvido && d != null ? el('span', { class: 'prazo-dias', text: d < 0 ? `  (vencido há ${-d}d)` : `  (faltam ${d}d)` }) : null,
    ]));
  }
  if (p.descricao) c.appendChild(el('div', { class: 'proto-desc', text: p.descricao }));

  const acoes = el('div', { class: 'acoes' });
  if (!resolvido) acoes.appendChild(btn('Marcar resolvido', 'ok', () => salvar(p.linha, { status: 'Resolvido' })));
  else acoes.appendChild(btn('Reabrir', 'ghost', () => salvar(p.linha, { status: 'Aberto' })));
  acoes.appendChild(btn('Editar', 'ghost', () => abrirForm(p)));
  c.appendChild(acoes);
  return c;
}

// Formulário (novo ou edição). p = null para novo.
function abrirForm(p) {
  const host = document.getElementById('proto-form');
  clear(host);
  const f = el('form', { class: 'card envio-form' });

  const iTitulo = campoTexto('Título', p ? p.titulo : '');
  const iProto = campoTexto('Protocolo (número)', p ? p.protocolo : '');
  const iPrazo = campoData('Prazo', p ? p.prazo : '');
  const iDesc = campoArea('Descrição', p ? p.descricao : '');

  f.appendChild(el('strong', { text: p ? 'Editar protocolo' : 'Novo protocolo' }));
  f.appendChild(iTitulo.wrap);
  f.appendChild(iProto.wrap);
  f.appendChild(iPrazo.wrap);
  f.appendChild(iDesc.wrap);

  const salvarBtn = btn(p ? 'Salvar' : 'Adicionar', 'primary', async (ev) => {
    ev.preventDefault();
    if (!iTitulo.input.value.trim()) { toast('Informe o título.', 'err'); return; }
    const dados = { titulo: iTitulo.input.value.trim(), protocolo: iProto.input.value.trim(), prazo: iPrazo.input.value, descricao: iDesc.input.value.trim() };
    try {
      if (p) await atualizarProtocolo(p.linha, dados);
      else await adicionarProtocolo({ ...dados, data_abertura: hojeISO() });
      toast('Protocolo salvo.', 'ok');
      clear(host);
      renderProtocolos();
    } catch (e) { toast('Falha ao salvar.', 'err'); console.warn(e.message); }
  });
  f.appendChild(salvarBtn);
  f.appendChild(btn('Cancelar', 'ghost', (ev) => { ev.preventDefault(); clear(host); }));
  host.appendChild(f);
  iTitulo.input.focus();
}

async function salvar(linha, patch) {
  try { await atualizarProtocolo(linha, patch); toast('Protocolo atualizado.', 'ok'); renderProtocolos(); }
  catch (e) { toast('Falha ao salvar.', 'err'); console.warn(e.message); }
}

// helpers de campo
function campoTexto(label, val) { const input = el('input', { type: 'text' }); input.value = val || ''; return { wrap: wrap(label, input), input }; }
function campoData(label, val) { const input = el('input', { type: 'date' }); input.value = val || ''; return { wrap: wrap(label, input), input }; }
function campoArea(label, val) { const input = el('textarea', { rows: '3' }); input.value = val || ''; return { wrap: wrap(label, input), input }; }
function wrap(label, input) { return el('label', { class: 'campo' }, [el('span', { text: label }), input]); }
function btn(txt, tipo, onclick) { return el('button', { class: `btn btn-${tipo}`, onclick }, txt); }
