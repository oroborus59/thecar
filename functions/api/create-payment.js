// Rota Cloudflare Pages: POST /api/create-payment
import { handleCreatePayment } from './_lib/handlers.js';
import { fail } from './_lib/shared.js';

export const onRequestPost = ({ request, env }) => handleCreatePayment(request, env);

// Qualquer outro método nesta rota
export const onRequest = ({ request, env }) =>
  request.method === 'POST' ? handleCreatePayment(request, env) : fail(405, 'method_not_allowed', 'Método não permitido.');
