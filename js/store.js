// Estado local leve (localStorage). NÃO guarda dados sensíveis: apenas o ID da
// planilha conectada por este usuário/dispositivo. O ID da planilha não é
// identificador de paciente.
import { CONFIG } from './config.js';

const K_SHEET = 'rs_sheet_id';

export const store = {
  getSheetId() {
    return localStorage.getItem(K_SHEET) || CONFIG.SHEET_ID || '';
  },
  setSheetId(id) {
    if (id) localStorage.setItem(K_SHEET, id);
  },
  clearSheetId() {
    localStorage.removeItem(K_SHEET);
  },
};
