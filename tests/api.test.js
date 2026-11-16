// Testes das rotas /api com a Laranjinha SIMULADA (nenhuma chamada real).
// Rodar: npm test
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  handleCreatePayment, handlePaymentStatus, handleWebhook,
} from '../functions/api/_lib/handlers.js';

const BASE = 'https://gateway.test/api-proxy';
let calls;
let charges;
let env;

beforeEach(() => {
  env = {
    LARANJINHA_BASE_URL: BASE,
    LARANJINHA_API_KEY: 'sk_test_fake',
    WEBHOOK_SECRET: 'whsec_fake',
    NOTIFY_WEBHOOK_URL: 'https://notify.test/hook',
  };
  calls = [];
  charges = {};
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    const u = new URL(url);
    if (u.host === 'notify.test') return new Response('{}', { status: 200 });
    assert.equal(init.headers['X-API-Key'], 'sk_test_fake');
    const path = u.pathname.replace('/api-proxy', '');
    if (init.method === 'POST' && path === '/charges') {
      const body = JSON.parse(init.body);
      const id = 'ch_' + Object.keys(charges).length + '_abcdef';
      charges[id] = { id, status: 'pending', amount_cents: body.amount_cents, payer: body.payer, metadata: body.metadata,
        qr_code: '000201FAKE', qr_code_image: 'data:image/png;base64,AAAA', expires_at: '2030-01-01T00:00:00Z', created_at: 'x' };
      return Response.json({ ok: true, charge: charges[id] }, { status: 201 });
    }
    const m = path.match(/^\/charges\/(.+)$/);
    if (m) {
      const c = charges[decodeURIComponent(m[1])];
      return c ? Response.json({ ok: true, charge: c }) : Response.json({ ok: false, error: 'not_found' }, { status: 404 });
    }
    return Response.json({ ok: false }, { status: 500 });
  };
});

const validBody = () => ({
  kit: 'com', tipo: 'carro', marca: 'Honda', modelo: 'Civic', ano: '2020', cor: 'Preto',
  name: 'Fulano de Tal', email: 'Fulano@Example.com', phone: '(21) 99999-9999', document: '111.444.777-35',
  shipping: { cep: '01001-000', street: 'Rua A', number: '10', complement: '', district: 'Centro', city: 'São Paulo', uf: 'SP' },
  amount_cents: 1, // tentativa de mudar o preço: deve ser ignorada
});

const post = (body, headers = {}) => new Request('https://site.test/api/create-payment', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});

test('cria cobrança com preço do servidor e devolve só o necessário', async () => {
  const res = await handleCreatePayment(post(validBody(), { 'Idempotency-Key': 'key-123' }), env);
  assert.equal(res.status, 201);
  const data = await res.json();
  assert.equal(data.ok, true);
  assert.match(data.order_id, /^UC-\d{6}-[A-Z0-9]{6}$/);
  assert.deepEqual(Object.keys(data.charge).sort(), ['amount_cents', 'expires_at', 'id', 'qr_code', 'qr_code_image', 'status']);
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.amount_cents, 12790);
  assert.deepEqual(sent.payer, { name: 'Fulano de Tal', email: 'fulano@example.com', document: '11144477735' });
  assert.equal(sent.metadata.shipping.cep, '01001000');
  assert.equal(sent.metadata.phone, '21999999999');
  assert.equal(sent.metadata.idempotency_key, 'key-123');
});

test('recusa CPF inválido sem chamar o gateway', async () => {
  const res = await handleCreatePayment(post({ ...validBody(), document: '123.456.789-00' }), env);
  assert.equal(res.status, 400);
  assert.equal((await res.json()).error, 'invalid_document');
  assert.equal(calls.length, 0);
});

test('recusa kit inválido e endereço incompleto', async () => {
  assert.equal((await (await handleCreatePayment(post({ ...validBody(), kit: 'xyz' }), env)).json()).error, 'invalid_kit');
  const b = validBody(); b.shipping.uf = '';
  assert.equal((await (await handleCreatePayment(post(b), env)).json()).error, 'invalid_shipping');
});

test('sem chave configurada responde 503 sem vazar detalhes', async () => {
  delete env.LARANJINHA_API_KEY;
  const res = await handleCreatePayment(post(validBody()), env);
  assert.equal(res.status, 503);
});

test('status devolve só o status', async () => {
  const created = await (await handleCreatePayment(post(validBody()), env)).json();
  let res = await handlePaymentStatus(new Request('https://site.test/api/payment-status?id=' + created.charge.id), env);
  assert.deepEqual(await res.json(), { ok: true, status: 'pending' });
  charges[created.charge.id].status = 'paid';
  res = await handlePaymentStatus(new Request('https://site.test/api/payment-status?id=' + created.charge.id), env);
  assert.deepEqual(await res.json(), { ok: true, status: 'paid' });
  res = await handlePaymentStatus(new Request('https://site.test/api/payment-status?id=../balance'), env);
  assert.equal(res.status, 400);
});

function signed(bodyObj, { secret = 'whsec_fake', ts = Math.floor(Date.now() / 1000) } = {}) {
  const raw = JSON.stringify(bodyObj);
  const v1 = createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');
  return new Request('https://site.test/api/webhook/laranjinha', {
    method: 'POST', body: raw,
    headers: { 'Content-Type': 'application/json', 'X-Laranjinha-Event': bodyObj.event, 'X-Laranjinha-Delivery': 'd1',
      'X-Laranjinha-Timestamp': String(ts), 'X-Laranjinha-Signature': `t=${ts},v1=${v1}` },
  });
}

test('webhook sale.paid válido avisa o lojista com os dados do pedido', async () => {
  const created = await (await handleCreatePayment(post(validBody()), env)).json();
  charges[created.charge.id].status = 'paid';
  calls = [];
  const res = await handleWebhook(signed({ id: 'd1', event: 'sale.paid', data: { intent_id: created.charge.id, paid_at: 'now' } }), env);
  assert.equal(res.status, 200);
  const notify = calls.find(c => c.url.startsWith('https://notify.test'));
  assert.ok(notify, 'deveria avisar');
  const body = JSON.parse(notify.init.body);
  assert.equal(body.order.order_id, created.order_id);
  assert.match(body.text, /Honda Civic 2020/);
  assert.match(body.text, /CEP 01001000/);
});

test('webhook com assinatura errada é rejeitado', async () => {
  const res = await handleWebhook(signed({ event: 'sale.paid', data: { intent_id: 'x' } }, { secret: 'outro' }), env);
  assert.equal(res.status, 401);
});

test('webhook antigo (mais de 5 min) é rejeitado', async () => {
  const res = await handleWebhook(signed({ event: 'sale.paid', data: { intent_id: 'x' } }, { ts: Math.floor(Date.now() / 1000) - 600 }), env);
  assert.equal(res.status, 401);
});

test('webhook sale.paid que não está pago no GET não avisa', async () => {
  const created = await (await handleCreatePayment(post(validBody()), env)).json();
  calls = [];
  const res = await handleWebhook(signed({ event: 'sale.paid', data: { intent_id: created.charge.id } }), env);
  assert.equal(res.status, 200);
  assert.equal(calls.some(c => c.url.startsWith('https://notify.test')), false);
});

test('webhook sale.created é ignorado', async () => {
  const res = await handleWebhook(signed({ event: 'sale.created', data: { intent_id: 'x' } }), env);
  assert.equal((await res.json()).ignored, 'sale.created');
});
