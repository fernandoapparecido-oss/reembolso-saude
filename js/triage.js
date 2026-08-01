// Tela TRIAGEM: preview do PDF + categorização por seleção (zero digitação).
// Regra central: UM arquivo, UMA ação, marca VÁRIOS requisitos (slots).
import { CONFIG } from './config.js';
import { el, clear, toast, mostrarView } from './ui.js';
import { filePreviewLink, fileViewLink, mesesRecentes, sugerirDataLimite } from './model.js';
import { confirmarTriagem, marcarInboxTriado } from './sheets.js';
import { getPrestadores } from './catalog.js';

export async function abrirTriagem(item, onDone) {
  mostrarView('triage');
  const root = document.getElementById('view-triage');
  clear(root);
  root.appendChild(el('p', { class: 'muted', text: 'Carregando…' }));

  let prestadores = [];
  try {
    prestadores = await getPrestadores();
  } catch (e) {
    clear(root);
    root.appendChild(el('div', { class: 'vazio' }, [
      el('button', { class: 'btn btn-ghost', onclick: () => { mostrarView('inbox'); if (onDone) onDone(); } }, '‹ Voltar'),
      el('p', { text: 'Não foi possível ler a lista de prestadores (aba Config).' }),
      el('p', { class: 'muted', text: e.message }),
    ]));
    return;
  }
  clear(root);

  const sel = { prestador: '', mes: '', tipos: new Set() };

  root.appendChild(el('div', { class: 'view-head' }, [
    el('button', { class: 'btn btn-ghost', onclick: () => { mostrarView('inbox'); if (onDone) onDone(); } }, '‹ Voltar'),
    el('h1', { text: 'Categorizar' }),
    el('span', {}),
  ]));

  const grid = el('div', { class: 'triage-grid' });
  root.appendChild(grid);

  // --- Preview (iframe do Drive) ---
  grid.appendChild(el('div', { class: 'preview' }, [
    el('iframe', {
      src: filePreviewLink(item.fileId),
      title: 'Pré-visualização',
      allow: 'autoplay',
    }),
    el('div', { class: 'preview-nome muted', text: item.nome || item.fileId }),
  ]));

  // --- Formulário de categorização ---
  const form = el('div', { class: 'form' });
  grid.appendChild(form);

  // Prestador (lista vinda da aba Config da planilha)
  form.appendChild(el('label', { class: 'campo' }, [
    el('span', { text: 'Prestador' }),
    prestadores.length
      ? selectDe(prestadores.map((p) => ({ id: p, label: p })), (v) => { sel.prestador = v; validar(); })
      : el('span', { class: 'muted', text: 'Nenhum prestador na aba Config da planilha — adicione na coluna A.' }),
  ]));

  // Mês de referência
  form.appendChild(el('label', { class: 'campo' }, [
    el('span', { text: 'Mês de referência' }),
    selectDe(mesesRecentes(18), (v) => { sel.mes = v; validar(); }),
  ]));

  // Conteúdo (multi-seleção)
  const chips = el('div', { class: 'chips' });
  for (const t of CONFIG.TIPOS) {
    const b = el('button', {
      class: 'chip', type: 'button',
      onclick: () => {
        if (sel.tipos.has(t.id)) { sel.tipos.delete(t.id); b.classList.remove('on'); }
        else { sel.tipos.add(t.id); b.classList.add('on'); }
        validar();
      },
    }, t.label);
    chips.appendChild(b);
  }
  form.appendChild(el('div', { class: 'campo' }, [
    el('span', { text: 'Conteúdo do arquivo (marque todos os que existem)' }),
    chips,
  ]));

  const btn = el('button', { class: 'btn btn-primary btn-lg', disabled: true }, 'Confirmar');
  form.appendChild(btn);

  function validar() {
    btn.disabled = !(sel.prestador && sel.mes && sel.tipos.size > 0);
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true; btn.textContent = 'Gravando…';
    try {
      const dataLimite = sugerirDataLimite(sel.mes, CONFIG.PRAZO_DIAS_APOS_MES);
      await confirmarTriagem({
        prestador: sel.prestador,
        mes: sel.mes,
        tiposIds: [...sel.tipos],
        link: fileViewLink(item.fileId),
        dataLimite,
      });
      await marcarInboxTriado(item.linha, `${sel.prestador} · ${sel.mes}`);
      toast('Categorizado. Slots marcados no lote.', 'ok');
      mostrarView('inbox');
      if (onDone) onDone();
    } catch (e) {
      toast('Falha ao gravar. Tente de novo.', 'err');
      console.warn(e.message);
      btn.disabled = false; btn.textContent = 'Confirmar';
    }
  });
}

function selectDe(opcoes, onChange) {
  const s = el('select');
  s.appendChild(el('option', { value: '', text: '— selecione —' }));
  for (const o of opcoes) s.appendChild(el('option', { value: o.id, text: o.label }));
  s.addEventListener('change', () => onChange(s.value));
  return s;
}
