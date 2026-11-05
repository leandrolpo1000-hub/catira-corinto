import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const checkout = fs.readFileSync(path.join(dir, 'pages/Checkout.jsx'), 'utf8');
const listing = fs.readFileSync(path.join(dir, 'pages/Listing.jsx'), 'utf8');
const app = fs.readFileSync(path.join(dir, 'App.jsx'), 'utf8');
const css = fs.readFileSync(path.join(dir, 'styles.css'), 'utf8');
const components = fs.readFileSync(path.join(dir, 'components.jsx'), 'utf8');

assert.equal(app.includes('/checkout'), true, 'App tem /checkout');
assert.equal(app.includes('/checkout/entrega'), true, 'App tem entrega');
assert.equal(app.includes('/checkout/:orderId/pagamento'), true, 'App tem pagamento');
assert.equal(app.includes('/checkout/:orderId/pix'), true, 'App tem Pix');
assert.equal(app.includes('/checkout/:orderId/ok'), true, 'App tem confirmação');
assert.equal(app.includes('minhas-compras'), false, 'Fase B sem Minhas compras');

assert.equal(listing.includes('Comprar no Catira'), true, 'ficha tem Comprar');
assert.equal(listing.includes('/checkout?listing='), true, 'ficha navega ao checkout');
assert.equal(listing.includes('/api/orders'), false, 'ficha não POST pedido');
assert.equal(listing.includes('AppmaxCardForm'), false, 'ficha sem cartão');

assert.equal(checkout.includes('Meu carrinho'), true, 'revisão Meu carrinho');
assert.equal(checkout.includes('Finalize sua compra'), true, 'entrega');
assert.equal(checkout.includes('Escolha como deseja pagar'), true, 'pagamento');
assert.equal(checkout.includes('Pague com Pix'), true, 'tela Pix');
assert.equal(checkout.includes('Pedido confirmado'), true, 'confirmação');
assert.equal(checkout.includes('Pagar e finalizar'), true, 'CTA pagamento');
assert.equal(checkout.includes('Continuar para pagamento'), true, 'CTA entrega');
assert.equal(checkout.includes("quantity: 1"), true, 'quantidade 1 no POST');
assert.equal(checkout.includes('/api/orders'), true, 'checkout cria pedido');
assert.equal(checkout.includes('/pix'), true, 'checkout gera Pix');
assert.equal(checkout.includes('data-appmax-customer'), true, 'IP Appmax no pagamento');
assert.equal(checkout.includes('data-appmax-checkout'), false, 'sem form de cartão na fonte do Checkout (vive no AppmaxCardForm)');
assert.equal(checkout.includes('AppmaxCardForm'), true, 'pagamento usa AppmaxCardForm');
assert.equal(checkout.includes("'/card'"), true, 'POST cartão');
assert.equal(checkout.includes('/installments'), true, 'quote parcelas');
assert.equal(checkout.includes("method === 'pix'") || checkout.includes("'pix'"), true, 'escolhe Pix');
assert.equal(checkout.includes('Cartão') || checkout.includes('Cartao'), true, 'escolhe cartão');
assert.equal(checkout.includes('/aguardando'), true, 'aguardo cartão');
assert.equal(checkout.includes('prepareCardCharge'), false, 'front não chama o domínio');
assert.equal(listing.includes('AppmaxCardForm'), false, 'ficha sem cartão');
assert.equal(checkout.includes('cupom'), false, 'sem cupom');
assert.equal(checkout.includes('Retirada'), false, 'sem retirada');
assert.equal(checkout.includes('/minhas-compras'), false, 'sem Minhas compras');
assert.equal(checkout.includes('commercialReady: true'), false, 'não liga commercialReady');
assert.equal(checkout.includes('Frete R$ 0,00 nesta fase'), true, 'frete verdadeiro');
assert.equal(checkout.includes('8000'), true, 'poll 8s');
assert.equal(checkout.includes("status === 'paid'"), true, 'ok só se paid');
assert.equal(checkout.includes('NeedAuth'), true, 'exige login');
assert.equal(checkout.includes('Copiar código Pix'), true, 'copia Pix');

assert.equal(css.includes('.ck-cta'), true, 'CTA sticky');
assert.equal(components.includes("startsWith('/checkout')"), true, 'esconde tab bar no checkout');

console.log('OK checkout ui tests');
