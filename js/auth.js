// Autenticação via Google Identity Services (GIS) — token client, OAuth no
// browser. Sem backend, sem refresh token. O access token vive só em memória.
//
// PRIVACIDADE: nunca logamos o token nem dados de paciente.
import { CONFIG } from './config.js';

let tokenClient = null;
let accessToken = null;
let tokenExpiry = 0;
let pendingResolve = null;
let pendingFail = null;
const listeners = [];
const K_RETORNANTE = 'rs_ja_logou'; // marca que este dispositivo já concedeu acesso

export function jaLogouAntes() { return localStorage.getItem(K_RETORNANTE) === '1'; }

export function onAuthChange(fn) { listeners.push(fn); }
function emit() { const s = isSignedIn(); listeners.forEach((f) => f(s)); }

export function isSignedIn() { return !!accessToken && Date.now() < tokenExpiry; }
export function getToken() { return accessToken; }

export function initAuth() {
  if (tokenClient) return;
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CONFIG.CLIENT_ID,
    scope: CONFIG.SCOPES,
    callback: (resp) => {
      if (resp.error) {
        console.warn('Autenticação não concluída.');
        const f = pendingFail; pendingFail = null; pendingResolve = null;
        if (f) f();
        emit();
        return;
      }
      accessToken = resp.access_token;
      // expires_in vem em segundos; renovamos 60s antes por segurança.
      tokenExpiry = Date.now() + (Number(resp.expires_in || 3600) - 60) * 1000;
      localStorage.setItem(K_RETORNANTE, '1'); // já concedeu acesso neste dispositivo
      emit();
      const r = pendingResolve; pendingResolve = null; pendingFail = null;
      if (r) r();
    },
    error_callback: () => { // popup fechado / falha silenciosa
      const f = pendingFail; pendingFail = null; pendingResolve = null;
      if (f) f();
      emit();
    },
  });
}

// Tenta obter um token SEM interação (para quem já concedeu antes).
// Resolve true se conseguiu, false se precisaria de clique.
export function signInSilent() {
  return new Promise((resolve) => {
    initAuth();
    pendingResolve = () => resolve(true);
    pendingFail = () => resolve(false);
    try { tokenClient.requestAccessToken({ prompt: '' }); } catch (_) { resolve(false); }
  });
}

export function signIn() {
  initAuth();
  // Só pede consentimento na primeira vez da sessão; depois, silencioso.
  tokenClient.requestAccessToken({ prompt: accessToken ? '' : 'consent' });
}

// Garante um token válido antes de uma chamada de API.
export function ensureToken() {
  return new Promise((resolve) => {
    if (isSignedIn()) return resolve();
    pendingResolve = resolve;
    signIn();
  });
}

export function signOut() {
  if (accessToken) {
    try { google.accounts.oauth2.revoke(accessToken, () => {}); } catch (_) {}
  }
  accessToken = null;
  tokenExpiry = 0;
  emit();
}
