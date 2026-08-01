// Tela TRIAGEM: preview + categorização por seleção (zero digitação).
// Dirigida pela Config: só mostra os tipos que o prestador EXIGE; e, quando o
// prestador tem especialidades, pede a especialidade dos docs por-terapia
// (Relatório/Presença). Também serve para RECLASSIFICAR.
import { CONFIG } from './config.js';
import { el, clear, toast, mostrarView } from './ui.js';
import { filePreviewLink, fileViewLink, mesesRecentes, sugerirDataLimite } from './model.js';
import {
  confirmarTriagem, marcarInboxTriado, marcarInboxPendente, removerArquivoDeTodosLotes,
} from './sheets.js';
import { getPerfis, getPerfil } from './catalog.js';

const labelDe = (id) => (CONFIG.TIPOS.find((t) => t.id === id) || { label: id }).label;

// opts: { reclassify?:boolean, preselecao?:{prestador,mes,tipos:[],especialidade} }
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
    prestador: pre ? pre.prestador : '',
    mes: pre ? pre.mes : '',
    tipos: new Set(pre ? pre.tipos : []),
    especialidades: new Set(pre ? (pre.especialidades || []) : []),
  };
  let perfil = sel.prestador ? await getPerfil(sel.prestador) : null;

  root.appendChild(el('div', { class: 'view-head' }, [
    el('button', { class: 'btn btn-ghost', onclick: () => { mostrarView('inbox'); if (onDone) onDone(); } }, '‹ Voltar'),
    el('h1', { text: reclass ? 'Reclassificar' : 'Categorizar' }),
    el('span', {}),
  ]));
  if (reclass) {
    root.appendChild(el('p', { class: 'muted reclass-hint', text: 'Corrija prestador, mês, tipos ou especialidade. Salvar refaz a marcação deste arquivo.' }));
  }

  const grid = el('div', { class: 'triage-grid' });
  root.appendChild(grid);

  grid.appendChild(el('div', { class: 'preview' }, [
    el('iframe', { src: filePreviewLink(item.fileId), title: 'Pré-visualização', allow: 'autoplay' }),
    el('div', { class: 'preview-nome muted', text: item.nome || item.fileId }),
  ]));

  const form = el('div', { class: 'form' });
  grid.appendChild(form);

  // Prestador
  form.appendChild(el('label', { class: 'campo' }, [
    el('span', { text: 'Prestador' }),
    prestadores.length
      ? selectDe(prestadores.map((p) => ({ id: p, label: p })), sel.prestador, async (v) => {
        sel.prestador = v; sel.tipos.clear(); sel.especialidades.clear();
        perfil = v ? await getPerfil(v) : null;
        renderConteudo(); renderEspecialidade(); validar();
      })
      : el('span', { class: 'muted', text: 'Nenhum prestador na aba Config.' }),
  ]));

  // Mês
  form.appendChild(el('label', { class: 'campo' }, [
    el('span', { text: 'Mês de referência' }),
    selectDe(mesesRecentes(18), sel.mes, (v) => { sel.mes = v; validar(); }),
  ]));

  // Conteúdo (chips) — depende do prestador
  const contBox = el('div', { class: 'campo' });
  form.appendChild(contBox);

  // Especialidade — depende do prestador e dos tipos marcados
  const espBox = el('div', { class: 'campo' });
  form.appendChild(espBox);

  const btn = el('button', { class: 'btn btn-primary btn-lg' }, reclass ? 'Salvar correção' : 'Confirmar');
  form.appendChild(btn);

  let btnRemover = null;
  if (reclass) {
    btnRemover = el('button', { class: 'btn btn-ghost btn-lg btn-danger-text' }, 'Remover do lote e voltar à fila');
    form.appendChild(btnRemover);
  }

  function precisaEspecialidade() {
    return !!(perfil && perfil.especialidades.length && [...sel.tipos].some((t) => CONFIG.PER_ESPECIALIDADE.includes(t)));
  }

  function renderConteudo() {
    clear(contBox);
    if (!perfil) { contBox.appendChild(el('span', { class: 'muted', text: 'Escolha o prestador para ver os tipos.' })); return; }
    contBox.appendChild(el('span', { text: 'Conteúdo do arquivo (marque todos os que existem)' }));
    const chips = el('div', { class: 'chips' });
    for (const id of perfil.tipos) {
      const ligado = sel.tipos.has(id);
      const b = el('button', {
        class: `chip ${ligado ? 'on' : ''}`, type: 'button',
        onclick: () => {
          if (sel.tipos.has(id)) { sel.tipos.delete(id); b.classList.remove('on'); }
          else { sel.tipos.add(id); b.classList.add('on'); }
          renderEspecialidade(); validar();
        },
      }, labelDe(id));
      chips.appendChild(b);
    }
    contBox.appendChild(chips);
  }

  function renderEspecialidade() {
    clear(espBox);
    if (!precisaEspecialidade()) { espBox.hidden = true; return; }
    espBox.hidden = false;
    const perEsp = [...sel.tipos].filter((t) => CONFIG.PER_ESPECIALIDADE.includes(t)).map(labelDe).join(' e ');
    espBox.appendChild(el('span', { text: `Especialidade(s) que este arquivo cobre — para ${perEsp} (pode marcar mais de uma)` }));
    const chips = el('div', { class: 'chips' });
    const todas = perfil.especialidades;

    // Atalho "Todas" (só quando há 2+ especialidades).
    if (todas.length >= 2) {
      const todasOn = todas.every((e) => sel.especialidades.has(e));
      chips.appendChild(el('button', {
        class: `chip chip-todas ${todasOn ? 'on' : ''}`, type: 'button',
        onclick: () => {
          if (todasOn) sel.especialidades.clear();
          else todas.forEach((e) => sel.especialidades.add(e));
          renderEspecialidade(); validar();
        },
      }, 'Todas'));
    }

    for (const esp of todas) {
      const ligado = sel.especialidades.has(esp);
      chips.appendChild(el('button', {
        class: `chip ${ligado ? 'on' : ''}`, type: 'button',
        onclick: () => {
          if (sel.especialidades.has(esp)) sel.especialidades.delete(esp);
          else sel.especialidades.add(esp);
          renderEspecialidade(); validar();
        },
      }, esp));
    }
    espBox.appendChild(chips);
  }

  function validar() {
    const ok = sel.prestador && sel.mes && sel.tipos.size > 0 && (!precisaEspecialidade() || sel.especialidades.size > 0);
    btn.disabled = !ok;
  }

  renderConteudo(); renderEspecialidade(); validar();

  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = 'Gravando…';
    if (btnRemover) btnRemover.disabled = true;
    try {
      if (reclass) await removerArquivoDeTodosLotes(item.fileId);
      await confirmarTriagem({
        prestador: sel.prestador,
        mes: sel.mes,
        tiposIds: [...sel.tipos],
        especialidades: [...sel.especialidades],
        link: fileViewLink(item.fileId),
        dataLimite: sugerirDataLimite(sel.mes, CONFIG.PRAZO_DIAS_APOS_MES),
      });
      await marcarInboxTriado(item.linha, rotuloLote(sel));
      toast(reclass ? 'Reclassificado.' : 'Categorizado.', 'ok');
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

function rotuloLote(sel) {
  const esp = sel.especialidades.size ? ` · ${[...sel.especialidades].join('+')}` : '';
  return `${sel.prestador} · ${sel.mes}${esp}`;
}

function selectDe(opcoes, selecionado, onChange) {
  const s = el('select');
  s.appendChild(el('option', { value: '', text: '— selecione —' }));
  for (const o of opcoes) s.appendChild(el('option', { value: o.id, text: o.label }));
  if (selecionado) s.value = selecionado;
  s.addEventListener('change', () => onChange(s.value));
  return s;
}
