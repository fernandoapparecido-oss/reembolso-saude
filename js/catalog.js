// Cache em memória dos PERFIS de prestador (lidos da aba Config da planilha):
// { prestador, tipos:[ids exigidos], especialidades:[...] }.
import { lerPerfis } from './sheets.js';

let cache = null;

export async function getPerfis(forcar = false) {
  if (!cache || forcar) cache = await lerPerfis();
  return cache;
}

export async function getPrestadores(forcar = false) {
  return (await getPerfis(forcar)).map((p) => p.prestador);
}

export async function getPerfil(prestador) {
  return (await getPerfis()).find((p) => p.prestador === prestador) || null;
}

export function invalidarPrestadores() { cache = null; }
