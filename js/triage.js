// Tela TRIAGEM: preview + categorização por seleção (zero digitação).
// Dois modos: MENSAL (lote: NF/Comprovante/Relatório/Presença) e REFERÊNCIA
// (laudo/avaliação anuais, com versões). Também serve para RECLASSIFICAR (mensal).
import { CONFIG } from './config.js';
import { el, clear, toast, mostrarView } from './ui.js';
import { filePreviewLink, fileViewLink, mesesRecentes, sugerirDataLimite, hojeISO } from './model.js';
import {
  confirmarTriagem, marcarInboxTriado, marcarInboxPendente, removerArquivoDeTodosLotes,
  adicionarReferencia,
} from './sheets.js';
import { getPerfis, getPerfil } from './catalog.js';

const labelDe = (id) => (CONFIG.TIPOS.find((t) => t.id === id) || { label: id }).label;
const ehRef = (id) => CONFIG.REF_TIPOS.includes(id);

// opts: { reclassify?:boolean, preselecao?:{prestador,mes,tipos:[],especialidades} }
export async function abrirTriagem(item, onDone, opts = {}) {
  const reclass = !!opts.reclassify;
  const pre = opts.preselecao || null;

  mostrarView('triage');
  const root = document.getElementById('view-triage');
  clear(root);
  root.appendChild(el('p', { class: 'muted', text: 'Carregando…' }));

  let prestadores = [];
  try {
    prestadores = (await getPerfis()).map((p) => p.prestador);
  } catch (e) {
    clear(root);
    root.appendChild(el('div', { class: 'vazio' }, [
      el('button', { class: 'btn btn-ghost', onclick: () => { mostrarView('inbox'); if (onDone) onDone(); } }, '‹ Voltar'),
      el('p', { text: 'Não foi possível ler a Config (prestadores).' }),
      el('p', { class: 'muted', text: e.message }),
    ]));
    return;
  }
  clear(root);

  const sel = {
    modo: 'mensal', // 'mensal' | 'referencia'
    prestador: pre ? pre.prestador : '',
    mes: pre ? pre.mes : '',
    tipos: new Set(pre ? pre.tipos : []),
    especialidades: new Set(pre ? (pre.especialidades || []) : []),
    // referência:
    refTipo: '',
    refEsp: '',
    refData: hojeISO(),
  };
  let perfil = sel.prestador ? await getPerfil(sel.prestador) : null;

  root.appendChild(el('div', { class: 'view-head' }, [
    el('button', { class: 'btn btn-ghost', onclick: () => { mostrarView('inbox'); if (onDone) onDone(); } }, '‹ Voltar'),
    el('h1', { text: reclass ? 'Reclassificar' : 'Categorizar' }),
    el('span', {}),
  ]));
  if (reclass) root.appendChild(el('p', { class: 'muted reclass-hint', text: 'Corrija prestador, mês, tipos ou especialidade. Salvar refaz a marcação deste arquivo.' }));

  const grid = el('div', { class: 'triage-grid' });
  root.appendChild(grid);

  grid.appendChild(el('div', { class: 'preview' }, [
    el('iframe', { src: filePreviewLink(item.fileId), title: 'Pré-visualização', allow: 'autoplay' }),
    el('div', { class: 'preview-nome muted', text: item.nome || item.fileId }),
  ]));

  const form = el('div', { class: 'form' });
  grid.appendChild(form);

  // Alternador de modo (escondido na reclassificação, que é sempre mensal).
  const modoBox = el('div', { class: 'campo' });
  if (!reclass) form.appendChild(modoBox);

  // Prestador (comum aos dois modos)
  form.appendChild(el('label', { class: 'campo' }, [
    el('span', { text: 'Prestador' }),
    prestadores.length
      ? selectDe(prestadores.map((p) => ({ id: p, label: p })), sel.prestador, async (v) => {
        sel.prestador = v; sel.tipos.clear(); sel.especialidades.clear(); sel.refTipo = ''; sel.refEsp = '';
        perfil = v ? await getPerfil(v) : null;
        renderModo(); renderMensal(); renderRef(); validar();
      })
      : el('span', { class: 'muted', text: 'Nenhum prestador na aba Config.' }),
  ]));

  const mensalBox = el('div', {});
  const refBox = el('div', {});
  form.appendChild(mensalBox);
  form.appendChild(refBox);

  const btn = el('button', { class: 'btn btn-primary btn-lg' }, reclass ? 'Salvar correção' : 'Confirmar');
  form.appendChild(btn);

  let btnRemover = null;
  if (reclass) {
    btnRemover = el('button', { class: 'btn btn-ghost btn-lg btn-danger-text' }, 'Remover do lote e voltar à fila');
    form.appendChild(btnRemover);
  }

  // ---- Modo ----
  function renderModo() {
    clear(modoBox);
    if (reclass) return;
    modoBox.appendChild(el('span', { text: 'Tipo de documento' }));
    const chips = el('div', { class: 'chips' });
    for (const [id, txt] of [['mensal', 'Mensal (lote)'], ['referencia', 'Referência (laudo/avaliação)']]) {
      chips.appendChild(el('button', {
        class: `chip ${sel.modo === id ? 'on' : ''}`, type: 'button',
        onclick: () => { sel.modo = id; renderModo(); atualizarVisibilidade(); validar(); },
      }, txt));
    }
    modoBox.appendChild(chips);
  }
  function atualizarVisibilidade() {
    mensalBox.hidden = sel.modo !== 'mensal';
    refBox.hidden = sel.modo !== 'referencia';
  }

  // ---- Mensal ----
  function renderMensal() {
    clear(mensalBox);
    // Mês
    mensalBox.appendChild(el('label', { class: 'campo' }, [
      el('span', { text: 'Mês de referência' }),
      selectDe(mesesRecentes(18), sel.mes, (v) => { sel.mes = v; validar(); }),
    ]));
    // Conteúdo (só tipos MENSAIS exigidos)
    const contBox = el('div', { class: 'campo' });
    mensalBox.appendChild(contBox);
    const espBox = el('div', { class: 'campo' });
    mensalBox.appendChild(espBox);

    const renderEsp = () => {
      clear(espBox);
      const precisa = perfil && perfil.especialidades.length && [...sel.tipos].some((t) => CONFIG.PER_ESPECIALIDADE.includes(t));
      espBox.hidden = !precisa;
      if (!precisa) return;
      const perEsp = [...sel.tipos].filter((t) => CONFIG.PER_ESPECIALIDADE.includes(t)).map(labelDe).join(' e ');
      espBox.appendChild(el('span', { text: `Especialidade(s) para ${perEsp} (pode marcar mais de uma)` }));
      const chips = el('div', { class: 'chips' });
      const todas = perfil.especialidades;
      if (todas.length >= 2) {
        const on = todas.every((e) => sel.especialidades.has(e));
        chips.appendChild(el('button', { class: `chip chip-todas ${on ? 'on' : ''}`, type: 'button', onclick: () => { if (on) sel.especialidades.clear(); else todas.forEach((e) => sel.especialidades.add(e)); renderEsp(); validar(); } }, 'Todas'));
      }
      for (const esp of todas) {
        chips.appendChild(el('button', { class: `chip ${sel.especialidades.has(esp) ? 'on' : ''}`, type: 'button', onclick: () => { if (sel.especialidades.has(esp)) sel.especialidades.delete(esp); else sel.especialidades.add(esp); renderEsp(); validar(); } }, esp));
      }
      espBox.appendChild(chips);
    };

    clear(contBox);
    if (!perfil) { contBox.appendChild(el('span', { class: 'muted', text: 'Escolha o prestador.' })); return; }
    const mensais = perfil.tipos.filter((t) => !ehRef(t));
    contBox.appendChild(el('span', { text: 'Conteúdo do arquivo (marque todos os que existem)' }));
    const chips = el('div', { class: 'chips' });
    for (const id of mensais) {
      chips.appendChild(el('button', {
        class: `chip ${sel.tipos.has(id) ? 'on' : ''}`, type: 'button',
        onclick: (ev) => { const b = ev.currentTarget; if (sel.tipos.has(id)) { sel.tipos.delete(id); b.classList.remove('on'); } else { sel.tipos.add(id); b.classList.add('on'); } renderEsp(); validar(); },
      }, labelDe(id)));
    }
    contBox.appendChild(chips);
    renderEsp();
  }

  // ---- Referência ----
  function renderRef() {
    clear(refBox);
    if (!perfil) { refBox.appendChild(el('p', { class: 'campo muted', text: 'Escolha o prestador.' })); return; }
    // tipo de referência (Laudo/Avaliação) — os exigidos, senão todos
    const refExigidos = perfil.tipos.filter((t) => ehRef(t));
    const opcoes = (refExigidos.length ? refExigidos : CONFIG.REF_TIPOS).map((t) => ({ id: t, label: labelDe(t) }));
    refBox.appendChild(el('label', { class: 'campo' }, [
      el('span', { text: 'Documento de referência' }),
      selectDe(opcoes, sel.refTipo, (v) => { sel.refTipo = v; renderRefEsp(); validar(); }),
    ]));
    const refEspBox = el('div', { class: 'campo' });
    refBox.appendChild(refEspBox);
    refBox.appendChild(el('label', { class: 'campo' }, [
      el('span', { text: 'Data de emissão' }),
      dateInput(sel.refData, (v) => { sel.refData = v; validar(); }),
    ]));

    function renderRefEsp() {
      clear(refEspBox);
      const precisa = sel.refTipo && CONFIG.PER_ESPECIALIDADE.includes(sel.refTipo) && perfil.especialidades.length;
      refEspBox.hidden = !precisa;
      if (!precisa) { sel.refEsp = ''; return; }
      refEspBox.appendChild(el('span', { text: 'Especialidade (terapia)' }));
      refEspBox.appendChild(selectDe(perfil.especialidades.map((e) => ({ id: e, label: e })), sel.refEsp, (v) => { sel.refEsp = v; validar(); }));
    }
    renderRefEsp();
  }

  function validar() {
    let ok;
    if (sel.modo === 'mensal') {
      const precisaEsp = perfil && perfil.especialidades.length && [...sel.tipos].some((t) => CONFIG.PER_ESPECIALIDADE.includes(t));
      ok = sel.prestador && sel.mes && sel.tipos.size > 0 && (!precisaEsp || sel.especialidades.size > 0);
    } else {
      const precisaEsp = sel.refTipo && CONFIG.PER_ESPECIALIDADE.includes(sel.refTipo) && perfil && perfil.especialidades.length;
      ok = sel.prestador && sel.refTipo && sel.refData && (!precisaEsp || sel.refEsp);
    }
    btn.disabled = !ok;
  }

  renderModo(); renderMensal(); renderRef(); atualizarVisibilidade(); validar();

  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = 'Gravando…';
    if (btnRemover) btnRemover.disabled = true;
    try {
      if (sel.modo === 'referencia') {
        await adicionarReferencia({ tipo: sel.refTipo, prestador: sel.prestador, especialidade: sel.refEsp, data_emissao: sel.refData, link: fileViewLink(item.fileId) });
        await marcarInboxTriado(item.linha, `${labelDe(sel.refTipo)} · ${sel.prestador}${sel.refEsp ? ' · ' + sel.refEsp : ''}`);
        toast('Referência salva (vigente).', 'ok');
      } else {
        if (reclass) await removerArquivoDeTodosLotes(item.fileId);
        await confirmarTriagem({ prestador: sel.prestador, mes: sel.mes, tiposIds: [...sel.tipos], especialidades: [...sel.especialidades], link: fileViewLink(item.fileId), dataLimite: sugerirDataLimite(sel.mes, CONFIG.PRAZO_DIAS_APOS_MES) });
        await marcarInboxTriado(item.linha, `${sel.prestador} · ${sel.mes}`);
        toast(reclass ? 'Reclassificado.' : 'Categorizado.', 'ok');
      }
      mostrarView('inbox');
      if (onDone) onDone();
    } catch (e) {
      toast('Falha ao gravar. Tente de novo.', 'err');
      console.warn(e.message);
      btn.textContent = reclass ? 'Salvar correção' : 'Confirmar';
      if (btnRemover) btnRemover.disabled = false;
      validar();
    }
  });

  if (btnRemover) {
    btnRemover.addEventListener('click', async () => {
      btn.disabled = true; btnRemover.disabled = true; btnRemover.textContent = 'Removendo…';
      try {
        await removerArquivoDeTodosLotes(item.fileId);
        await marcarInboxPendente(item.linha);
        toast('Arquivo removido do lote e devolvido à fila.', 'ok');
        mostrarView('inbox');
        if (onDone) onDone();
      } catch (e) {
        toast('Falha ao remover. Tente de novo.', 'err');
        console.warn(e.message);
        btnRemover.disabled = false; btnRemover.textContent = 'Remover do lote e voltar à fila';
        validar();
      }
    });
  }
}

function selectDe(opcoes, selecionado, onChange) {
  const s = el('select');
  s.appendChild(el('option', { value: '', text: '— selecione —' }));
  for (const o of opcoes) s.appendChild(el('option', { value: o.id, text: o.label }));
  if (selecionado) s.value = selecionado;
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

function dateInput(valor, onChange) {
  const i = el('input', { type: 'date', value: valor || '' });
  i.addEventListener('change', () => onChange(i.value));
  return i;
}
