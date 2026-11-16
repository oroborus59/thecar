// Código compartilhado pelas rotas /api. Pastas/arquivos com "_" não viram rotas no Pages.
// As variáveis de ambiente chegam em "env" (contexto da Cloudflare), não em process.env.

// Preço cobrado é SEMPRE calculado aqui no servidor, nunca vindo do navegador.
export const KITS = {
  sem: { label: 'Kit Interno', amount_cents: 9790 },
  com: { label: 'Kit Completo', amount_cents: 12790 },
};
export const COLORS = ['Preto', 'Cinza'];
export const TYPES = ['carro', 'picape'];
export const UFS = ['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'];

export function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

export function fail(status, error, message) {
  return json(status, { ok: false, error, message });
}

export function onlyDigits(v) {
  return String(v ?? '').replace(/\D/g, '');
}

export function cleanText(v, max) {
  return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function isValidCpf(cpf) {
  cpf = onlyDigits(cpf);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
  for (let t = 9; t < 11; t++) {
    let sum = 0;
    for (let i = 0; i < t; i++) sum += Number(cpf[i]) * (t + 1 - i);
    if (((sum * 10) % 11) % 10 !== Number(cpf[t])) return false;
  }
  return true;
}

export function makeOrderId(now = new Date()) {
  const d = now.toISOString().slice(2, 10).replace(/-/g, '');
  const rand = crypto.getRandomValues(new Uint8Array(4));
  const suffix = Array.from(rand, b => b.toString(36).padStart(2, '0')).join('').slice(0, 6).toUpperCase();
  return `UC-${d}-${suffix}`;
}

// ---------- Laranjinha ----------
function gatewayConfig(env) {
  const baseUrl = (env.LARANJINHA_BASE_URL || '').replace(/\/+$/, '');
  const apiKey = env.LARANJINHA_API_KEY || '';
  if (!baseUrl || !apiKey) {
    const err = new Error('gateway_not_configured');
    err.code = 'gateway_not_configured';
    throw err;
  }
  return { baseUrl, apiKey };
}

export async function laranjinha(env, path, { method = 'GET', body, timeoutMs = 20000 } = {}) {
  const { baseUrl, apiKey } = gatewayConfig(env);
  const res = await fetch(baseUrl + path, {
    method,
    headers: { 'X-API-Key': apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok && data.ok !== false, data };
}

// ---------- Assinatura do webhook ----------
export async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  return Array.from(new Uint8Array(sig), b => b.toString(16).padStart(2, '0')).join('');
}

export function timingSafeEqualHex(a, b) {
  a = String(a || ''); b = String(b || '');
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function parseSignatureHeader(header) {
  const out = {};
  for (const part of String(header || '').split(',')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

// ---------- Aviso de pedido pago ----------
// Se NOTIFY_WEBHOOK_URL estiver definido, envia o pedido para lá (Discord, Make, n8n, Zapier...).
export async function notifyPaidOrder(env, order) {
  const url = env.NOTIFY_WEBHOOK_URL;
  if (!url) {
    console.log('[pedido pago]', order.order_id, '(NOTIFY_WEBHOOK_URL não configurado)');
    return false;
  }
  const s = order.shipping || {};
  const text = [
    `✅ Pedido pago ${order.order_id}`,
    `${order.kit_label} | ${order.vehicle} | ${order.color} | ${(order.amount_cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`,
    `Cliente: ${order.name} | CPF ${order.document} | ${order.email} | WhatsApp ${order.phone}`,
    `Entrega: ${s.street}, ${s.number}${s.complement ? ' - ' + s.complement : ''} - ${s.district}, ${s.city}/${s.uf} - CEP ${s.cep}`,
  ].join('\n');
  const isDiscord = /discord(app)?\.com\/api\/webhooks\//.test(url);
  const body = isDiscord ? { content: text } : { text, order };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error('notify_failed_' + res.status);
  return true;
}
