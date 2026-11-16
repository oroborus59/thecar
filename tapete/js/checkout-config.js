/*
 * Configuração do checkout (somente o frontend).
 * NENHUMA chave do gateway vai aqui: a chave secreta fica só no backend.
 *
 * apiBase: endereço do backend que cria e consulta as cobranças Pix.
 *   - Mesmo domínio (Vercel / Cloudflare Pages Functions): '/api'
 *   - Worker em outro domínio: 'https://seu-worker.workers.dev/api'
 *
 * mockOnLocalhost: quando true, abrindo o site em localhost/127.0.0.1
 *   o checkout simula o gateway (Pix falso, pago depois de alguns segundos).
 *   Em qualquer outro domínio isso é ignorado e o backend real é usado.
 */
window.ULTRACAR_CHECKOUT = {
  apiBase: '/api',
  mockOnLocalhost: true,
  pollIntervalMs: 5000,
};
