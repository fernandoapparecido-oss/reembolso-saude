// Autenticação via Google Identity Services (GIS) — token client, OAuth no
// browser. Sem backend, sem refresh token. O access token vive só em memória.
//
// PRIVACIDADE: nunca logamos o token nem dados de paciente.
import { CONFIG } from './config.js';

let tokenClient = null;
let accessToken = null;
let tokenExpiry = 0;
let pendingResolve = null;
const listeners = [];

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
        // Não expor detalhes; apenas sinalizar falha.
        console.warn('Autenticação não concluída.');
        emit();
        return;
      }
      accessToken = resp.access_token;
      // expires_in vem em segundos; renovamos 60s antes por segurança.
      tokenExpiry = Date.now() + (Number(resp.expires_in || 3600) - 60) * 1000;
      emit();
      const r = pendingResolve; pendingResolve = null;
      if (r) r();
    },
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
