// Helpers de UI mínimos (sem framework).

export function el(tag, attrs = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, '');
    else if (v !== false && v != null) n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

let toastTimer = null;
export function toast(msg, tipo = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `toast toast-${tipo}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

// Mostra uma das telas e esconde as outras.
export function mostrarView(nome) {
  for (const v of document.querySelectorAll('.view')) {
    v.hidden = v.id !== `view-${nome}`;
  }
  for (const tab of document.querySelectorAll('.tab')) {
    tab.classList.toggle('active', tab.dataset.view === nome);
  }
}

export function fmtBRL(v) {
  const n = Number(String(v).replace(/[^\d,.-]/g, '').replace('.', '').replace(',', '.'));
  if (!isFinite(n)) return v || '';
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
