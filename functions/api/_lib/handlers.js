// Lógica das rotas, separada do "encaixe" da Cloudflare para poder ser testada.
// Cada função recebe (request, env) e devolve um Response.
import {
  KITS, COLORS, TYPES, UFS, json, fail, onlyDigits, cleanText, isValidCpf, makeOrderId,
  laranjinha, hmacSha256Hex, timingSafeEqualHex, parseSignatureHeader, notifyPaidOrder,
} from './shared.js';

// ---------- POST /api/create-payment ----------
export async function handleCreatePayment(request, env) {
  let body;
  try {
    const raw = await request.text();
    if (raw.length > 8000) return fail(413, 'payload_too_large', 'Dados enviados são grandes demais.');
    body = JSON.parse(raw);
  } catch {
    return fail(400, 'invalid_json', 'Não foi possível ler os dados enviados.');
  }

  const kit = KITS[body.kit];
  if (!kit) return fail(400, 'invalid_kit', 'Kit inválido. Volte à página de produtos e selecione novamente.');

  const tipo = TYPES.includes(body.tipo) ? body.tipo : 'carro';
  const marca = cleanText(body.marca, 60);
  const modelo = cleanText(body.modelo, 100);
  const ano = cleanText(body.ano, 4);
  const cor = COLORS.includes(body.cor) ? body.cor : null;
  if (!marca || !modelo || !/^\d{4}$/.test(ano) || !cor) {
    return fail(400, 'invalid_vehicle', 'Faltam dados do veículo. Volte ao configurador e selecione o carro novamente.');
  }

  const name = cleanText(body.name, 100);
  const email = cleanText(body.email, 150).toLowerCase();
  const phone = onlyDigits(body.phone);
  const document = onlyDigits(body.document);
  if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return fail(400, 'invalid_buyer', 'Confira seu nome e e-mail.');
  }
  if (!isValidCpf(document)) return fail(400, 'invalid_document', 'Confira o CPF.');
  if (!/^\d{10,11}$/.test(phone)) return fail(400, 'invalid_phone', 'Confira o WhatsApp com DDD.');

  const s = body.shipping || {};
  const shipping = {
    cep: onlyDigits(s.cep),
    street: cleanText(s.street, 120),
    number: cleanText(s.number, 15),
    complement: cleanText(s.complement, 100),
    district: cleanText(s.district, 80),
    city: cleanText(s.city, 80),
    uf: UFS.includes(s.uf) ? s.uf : '',
  };
  if (!/^\d{8}$/.test(shipping.cep) || !shipping.street || !shipping.number || !shipping.district || !shipping.city || !shipping.uf) {
    return fail(400, 'invalid_shipping', 'Confira o endereço de entrega.');
  }

  const orderId = makeOrderId();
  const vehicle = `${marca} ${modelo} ${ano}`;
  const chargeBody = {
    amount_cents: kit.amount_cents,
    description: `UltraCar ${kit.label} - ${vehicle} (${orderId})`.slice(0, 140),
    payer: { name, email, document },
    metadata: {
      order_id: orderId,
      kit: body.kit,
      kit_label: kit.label,
      tipo,
      vehicle,
      color: cor,
      phone,
      shipping,
      idempotency_key: cleanText(request.headers.get('idempotency-key'), 80),
    },
  };

  let result;
  try {
    result = await laranjinha(env, '/charges', { method: 'POST', body: chargeBody });
  } catch (err) {
    if (err.code === 'gateway_not_configured') {
      console.error('[create-payment] variáveis LARANJINHA_* não configuradas');
      return fail(503, 'gateway_not_configured', 'Pagamento indisponível no momento. Tente novamente mais tarde.');
    }
    console.error('[create-payment] falha de rede com o gateway:', err.name);
    return fail(502, 'gateway_unreachable', 'Não foi possível gerar o Pix agora. Tente novamente em instantes.');
  }

  if (!result.ok || !result.data.charge?.qr_code) {
    console.error('[create-payment] gateway respondeu', result.status, result.data?.error);
    const message = result.data?.error === 'invalid_payer'
      ? 'Confira seu nome e CPF.'
      : 'Não foi possível gerar o Pix agora. Tente novamente em instantes.';
    return fail(502, 'gateway_error', message);
  }

  const c = result.data.charge;
  return json(201, {
    ok: true,
    order_id: orderId,
    charge: {
      id: c.id,
      status: c.status,
      amount_cents: c.amount_cents,
      qr_code: c.qr_code,
      qr_code_image: c.qr_code_image,
      expires_at: c.expires_at,
    },
  });
}

// ---------- GET /api/payment-status?id=... ----------
const STATUSES = ['pending', 'paid', 'expired', 'failed'];

export async function handlePaymentStatus(request, env) {
  const id = new URL(request.url).searchParams.get('id') || '';
  if (!/^[A-Za-z0-9_-]{6,80}$/.test(id)) return fail(400, 'invalid_id', 'Cobrança inválida.');

  let result;
  try {
    result = await laranjinha(env, '/charges/' + encodeURIComponent(id), { timeoutMs: 10000 });
  } catch (err) {
    if (err.code === 'gateway_not_configured') return fail(503, 'gateway_not_configured', 'Pagamento indisponível.');
    return fail(502, 'gateway_unreachable', 'Não foi possível consultar agora.');
  }

  if (result.status === 404) return fail(404, 'not_found', 'Cobrança não encontrada.');
  if (!result.ok) return fail(502, 'gateway_error', 'Não foi possível consultar agora.');

  const raw = result.data.charge?.status ?? result.data.status;
  const status = STATUSES.includes(raw) ? raw : 'pending';
  return json(200, { ok: true, status });
}

// ---------- POST /api/webhook/laranjinha ----------
const MAX_AGE_SECONDS = 300;

export async function handleWebhook(request, env) {
  const secret = env.WEBHOOK_SECRET;
  if (!secret) {
    console.error('[webhook] WEBHOOK_SECRET não configurado');
    return json(500, { ok: false });
  }

  const raw = await request.text();
  const sig = parseSignatureHeader(request.headers.get('x-laranjinha-signature'));
  const ts = request.headers.get('x-laranjinha-timestamp') || sig.t;

  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!ts || !Number.isFinite(age) || age > MAX_AGE_SECONDS) return json(401, { ok: false, error: 'stale' });

  const expected = await hmacSha256Hex(secret, `${ts}.${raw}`);
  if (!timingSafeEqualHex(sig.v1, expected)) return json(401, { ok: false, error: 'bad_signature' });

  let delivery;
  try { delivery = JSON.parse(raw); } catch { return json(400, { ok: false, error: 'invalid_json' }); }

  const event = request.headers.get('x-laranjinha-event') || delivery.event;
  const deliveryId = request.headers.get('x-laranjinha-delivery') || delivery.id;

  if (event !== 'sale.paid') return json(200, { ok: true, ignored: event });

  const chargeId = delivery.data?.intent_id;
  if (!chargeId) return json(200, { ok: true, ignored: 'no_intent_id' });

  let charge;
  try {
    const r = await laranjinha(env, '/charges/' + encodeURIComponent(chargeId), { timeoutMs: 8000 });
    charge = r.ok ? r.data.charge : null;
  } catch (err) {
    console.error('[webhook] falha ao consultar cobrança', chargeId, err.name);
    return json(502, { ok: false }); // a Laranjinha reenvia depois
  }
  if (!charge || charge.status !== 'paid') {
    console.warn('[webhook] sale.paid sem confirmação no GET', chargeId, charge?.status);
    return json(200, { ok: true, ignored: 'not_paid_on_check' });
  }

  const m = charge.metadata || {};
  const order = {
    order_id: m.order_id || chargeId,
    charge_id: chargeId,
    delivery_id: deliveryId,
    amount_cents: charge.amount_cents,
    paid_at: delivery.data?.paid_at || charge.paid_at || null,
    kit_label: m.kit_label || m.kit || '',
    vehicle: m.vehicle || '',
    color: m.color || '',
    name: charge.payer?.name || '',
    email: charge.payer?.email || '',
    document: charge.payer?.document || '',
    phone: m.phone || '',
    shipping: m.shipping || {},
  };

  try {
    await notifyPaidOrder(env, order);
  } catch (err) {
    console.error('[webhook] falha ao avisar pedido', order.order_id, err.message);
    return json(500, { ok: false });
  }

  return json(200, { ok: true });
}
