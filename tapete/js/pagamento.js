(() => {
  'use strict';

  const cfg = Object.assign(
    { apiBase: '/api', mockOnLocalhost: true, pollIntervalMs: 5000 },
    window.ULTRACAR_CHECKOUT || {}
  );
  const API_BASE = String(cfg.apiBase).replace(/\/+$/, '');
  const MOCK = cfg.mockOnLocalhost && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const STORAGE_KEY = 'ultracar-pix-v1';

  // Preços só para EXIBIÇÃO. O backend calcula o valor cobrado a partir do kit.
  const prices = { sem: 9790, com: 12790 };
  const labels = { sem: 'Kit Interno', com: 'Kit Completo' };

  const params = new URLSearchParams(location.search);
  const state = {
    kit: params.get('kit') || 'sem',
    tipo: params.get('tipo') || 'carro',
    marca: (params.get('marca') || '').slice(0, 60),
    modelo: (params.get('modelo') || '').slice(0, 100),
    ano: (params.get('ano') || '').slice(0, 4),
    cor: params.get('cor') || 'Preto',
  };

  const $ = id => document.getElementById(id);
  const money = cents => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const vehicle = [state.marca, state.modelo, state.ano].filter(Boolean).join(' ');
  $('kitName').textContent = labels[state.kit] || labels.sem;
  $('vehicleSummary').textContent = vehicle || 'Não informado';
  $('colorSummary').textContent = ['Preto', 'Cinza'].includes(state.cor) ? state.cor : 'Preto';
  $('totalPrice').textContent = money(prices[state.kit] || prices.sem);

  let requestKey = makeRequestKey();
  let payloadFingerprint;
  let pollTimer;
  let currentCharge;

  function makeRequestKey() {
    try { return crypto.randomUUID(); }
    catch { return 'uc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 18); }
  }

  function setStatus(text, isError = false) {
    $('status').textContent = text;
    $('status').classList.toggle('error', isError);
  }

  function setPayState(text, kind) {
    $('payStateText').textContent = text;
    $('payState').classList.toggle('ok', kind === 'ok');
    $('payState').classList.toggle('bad', kind === 'bad');
  }

  // ---------- Máscaras e validação ----------
  function onlyDigits(v) { return String(v || '').replace(/\D/g, ''); }

  function isValidCpf(cpf) {
    cpf = onlyDigits(cpf);
    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;
    for (let t = 9; t < 11; t++) {
      let sum = 0;
      for (let i = 0; i < t; i++) sum += Number(cpf[i]) * (t + 1 - i);
      const digit = ((sum * 10) % 11) % 10;
      if (digit !== Number(cpf[t])) return false;
    }
    return true;
  }

  $('buyerDocument').addEventListener('input', e => {
    const d = onlyDigits(e.target.value).slice(0, 11);
    e.target.value = d
      .replace(/^(\d{3})(\d)/, '$1.$2')
      .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d{1,2})$/, '.$1-$2');
  });

  // ---------- Comunicação com o backend ----------
  async function api(path, options = {}) {
    if (MOCK) return mockApi(path, options);
    const response = await fetch(API_BASE + path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.ok) {
      const err = new Error(data.message || 'Não foi possível concluir agora. Tente novamente em instantes.');
      err.code = data.error;
      throw err;
    }
    return data;
  }

  // Simulação local (só em localhost). Não fala com nenhum gateway.
  const mockStore = {};
  async function mockApi(path, options) {
    await new Promise(r => setTimeout(r, 700));
    if (path === '/create-payment') {
      const body = JSON.parse(options.body);
      const id = 'mock_' + Math.random().toString(36).slice(2, 10);
      mockStore[id] = { createdAt: Date.now() };
      return {
        ok: true,
        order_id: 'UC-TESTE-' + id.slice(5, 11).toUpperCase(),
        charge: {
          id,
          status: 'pending',
          amount_cents: prices[body.kit] || prices.sem,
          qr_code: '00020126580014BR.GOV.BCB.PIX0136SIMULACAO-LOCAL-NAO-PAGUE5204000053039865802BR6304TEST',
          qr_code_image: mockQrImage(),
          expires_at: new Date(Date.now() + 30 * 60000).toISOString(),
        },
      };
    }
    const m = path.match(/^\/payment-status\?id=(.+)$/);
    if (m) {
      const c = mockStore[decodeURIComponent(m[1])];
      const paid = c && Date.now() - c.createdAt > 12000;
      return { ok: true, status: paid ? 'paid' : 'pending' };
    }
    throw new Error('Rota simulada desconhecida: ' + path);
  }

  function mockQrImage() {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="224" height="224" viewBox="0 0 224 224">' +
      '<rect width="224" height="224" fill="#fff"/><rect x="12" y="12" width="200" height="200" fill="none" stroke="#ea580c" stroke-width="4" stroke-dasharray="10 6"/>' +
      '<text x="112" y="106" font-family="Arial" font-size="16" font-weight="700" text-anchor="middle" fill="#17191b">QR DE TESTE</text>' +
      '<text x="112" y="130" font-family="Arial" font-size="12" text-anchor="middle" fill="#5a6066">simulação local</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  // ---------- Exibição do Pix ----------
  function showCharge(charge) {
    currentCharge = charge;
    $('paymentForm').querySelectorAll('input,select,button').forEach(el => el.disabled = true);
    $('generateButton').textContent = 'Pix gerado';
    $('pixCopyPaste').value = charge.qr_code;
    const img = new Image();
    img.src = charge.qr_code_image;
    img.width = 224; img.height = 224;
    img.alt = 'QR Code Pix';
    $('pixQr').replaceChildren(img);
    if (charge.expires_at) {
      const date = new Date(charge.expires_at);
      $('expiry').textContent = Number.isNaN(date.getTime()) ? '' : 'Válido até ' + date.toLocaleString('pt-BR');
    } else $('expiry').textContent = '';
    $('pixResult').classList.remove('hidden');
    setStatus('Pix gerado. Pague usando o QR Code ou o código copia e cola.');
    setPayState('Aguardando pagamento…');
    startPolling();
  }

  function showPaid() {
    stopPolling();
    $('paymentForm').classList.add('hidden');
    $('pixResult').classList.add('hidden');
    $('paidOrderId').textContent = currentCharge ? (currentCharge.order_id || currentCharge.id.slice(0, 8).toUpperCase()) : '';
    $('paidBox').classList.remove('hidden');
    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
  }

  function showEnded(text) {
    stopPolling();
    setPayState(text, 'bad');
    try { sessionStorage.removeItem(STORAGE_KEY); } catch {}
  }

  // ---------- Consulta de status ----------
  function startPolling() {
    stopPolling();
    pollTimer = setInterval(checkStatus, Math.max(3000, Number(cfg.pollIntervalMs) || 5000));
  }
  function stopPolling() { clearInterval(pollTimer); pollTimer = null; }

  async function checkStatus() {
    if (!currentCharge) return;
    if (currentCharge.expires_at && Date.now() > new Date(currentCharge.expires_at).getTime() + 60000) {
      showEnded('Este Pix expirou. Recarregue a página para gerar um novo.');
      return;
    }
    try {
      const data = await api('/payment-status?id=' + encodeURIComponent(currentCharge.id));
      if (data.status === 'paid') showPaid();
      else if (data.status === 'expired') showEnded('Este Pix expirou. Recarregue a página para gerar um novo.');
      else if (data.status === 'failed') showEnded('O pagamento não foi concluído. Recarregue a página e tente novamente.');
    } catch {
      // Falha temporária de rede: tenta de novo no próximo ciclo.
    }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && pollTimer) checkStatus();
  });

  // Recupera um Pix já gerado se a página for recarregada.
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || 'null');
    if (saved && saved.charge && saved.search === location.search &&
        (!saved.charge.expires_at || new Date(saved.charge.expires_at).getTime() > Date.now())) {
      showCharge(saved.charge);
      checkStatus();
    }
  } catch {}

  // ---------- Envio do formulário ----------
  $('paymentForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!prices[state.kit]) { setStatus('Kit inválido. Volte à página de produtos e selecione novamente.', true); return; }
    if (!state.marca || !state.modelo || !/^\d{4}$/.test(state.ano) || !['Preto', 'Cinza'].includes(state.cor)) {
      setStatus('Faltam dados do veículo. Volte ao configurador e selecione o carro novamente.', true); return;
    }
    const name = $('buyerName').value.trim();
    const email = $('buyerEmail').value.trim();
    if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setStatus('Confira seu nome e e-mail.', true); return;
    }
    const document_ = onlyDigits($('buyerDocument').value);
    if (!isValidCpf(document_)) { setStatus('Confira o CPF.', true); $('buyerDocument').focus(); return; }
    const phone = onlyDigits($('buyerPhone').value);
    const shipping = Object.fromEntries(['cep', 'street', 'number', 'complement', 'district', 'city', 'uf'].map(k => [k, $(k).value.trim()]));
    shipping.cep = onlyDigits(shipping.cep);
    if (!/^\d{10,11}$/.test(phone) || !/^\d{8}$/.test(shipping.cep)) { setStatus('Confira WhatsApp e CEP.', true); return; }

    const payload = { ...state, name, email, phone, document: document_, shipping };
    const fingerprint = JSON.stringify(payload);
    // Se os dados mudarem depois de uma tentativa, usa uma nova chave de idempotência.
    if (payloadFingerprint && fingerprint !== payloadFingerprint) requestKey = makeRequestKey();
    payloadFingerprint = fingerprint;

    const button = $('generateButton');
    button.disabled = true;
    setStatus(MOCK ? 'Gerando Pix de teste (simulação local)…' : 'Gerando seu Pix…');
    try {
      const data = await api('/create-payment', {
        method: 'POST',
        headers: { 'Idempotency-Key': requestKey },
        body: JSON.stringify(payload),
      });
      if (!data.charge || !data.charge.qr_code) throw new Error('Resposta inválida do servidor de pagamento.');
      data.charge.order_id = data.order_id || data.charge.order_id;
      try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ search: location.search, charge: data.charge })); } catch {}
      showCharge(data.charge);
    } catch (error) {
      setStatus(error?.message || 'Falha ao gerar o Pix. Tente novamente.', true);
      // Mantém a mesma chave ao repetir com os mesmos dados, para não gerar cobrança duplicada.
      button.disabled = false;
    }
  });

  // ---------- Copiar código ----------
  $('copyButton').addEventListener('click', async () => {
    const value = $('pixCopyPaste').value;
    try {
      await navigator.clipboard.writeText(value);
      $('copyButton').textContent = 'Código copiado!';
    } catch {
      $('pixCopyPaste').focus(); $('pixCopyPaste').select();
      const copied = document.execCommand('copy');
      $('copyButton').textContent = copied ? 'Código copiado!' : 'Selecione o código e copie';
    }
    setTimeout(() => { $('copyButton').textContent = 'Copiar código Pix'; }, 2500);
  });
})();
