// Cache em memória da lista de prestadores (lida da aba Config da planilha).
// Evita reler a planilha a cada abertura da triagem.
import { lerPrestadores } from './sheets.js';

let cache = null;

export async function getPrestadores(forcar = false) {
  if (!cache || forcar) cache = await lerPrestadores();
  return cache;
}

export function invalidarPrestadores() { cache = null; }
