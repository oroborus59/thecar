// Rota Cloudflare Pages: GET /api/payment-status?id=...
import { handlePaymentStatus } from './_lib/handlers.js';
import { fail } from './_lib/shared.js';

export const onRequestGet = ({ request, env }) => handlePaymentStatus(request, env);

export const onRequest = ({ request, env }) =>
  request.method === 'GET' ? handlePaymentStatus(request, env) : fail(405, 'method_not_allowed', 'Método não permitido.');
