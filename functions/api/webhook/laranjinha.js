// Rota Cloudflare Pages: POST /api/webhook/laranjinha
// Cadastre esta URL em Integrações na Laranjinha: https://SEU-DOMINIO/api/webhook/laranjinha
import { handleWebhook } from '../_lib/handlers.js';
import { json } from '../_lib/shared.js';

export const onRequestPost = ({ request, env }) => handleWebhook(request, env);

export const onRequest = ({ request, env }) =>
  request.method === 'POST' ? handleWebhook(request, env) : json(405, { ok: false, error: 'method_not_allowed' });
