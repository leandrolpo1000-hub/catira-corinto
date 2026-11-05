import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const admin = fs.readFileSync(path.join(dir, 'pages/AdminOfficial.jsx'), 'utf8');
const adminPage = fs.readFileSync(path.join(dir, 'pages/Admin.jsx'), 'utf8');
const listing = fs.readFileSync(path.join(dir, 'pages/Listing.jsx'), 'utf8');
const css = fs.readFileSync(path.join(dir, 'styles.css'), 'utf8');

assert.equal(admin.includes("['catira', 'Catira']"), true, 'admin lista Catira');
assert.equal(admin.includes("provider: offer ? offer.provider : 'catira'"), true, 'nova oferta começa em Catira');
assert.equal(admin.includes("url: isCatira ? '' : offerForm.url"), true, 'Catira envia URL vazia');
assert.equal(/provider !== 'catira'[\s\S]*required=\{offerForm.status !== 'suspended'\}/.test(admin), true, 'URL obrigatória só nas externas');
assert.equal(admin.includes('Liberar compra'), false, 'sem botão de liberar compra');
assert.equal(admin.includes('commercialReady'), false, 'admin não edita commercialReady');
assert.equal(admin.includes('buyEnabled'), false, 'admin não edita buyEnabled');
assert.equal(admin.includes('em preparação'), true, 'admin marca Catira em preparação');

assert.equal(listing.includes('catiraOffer'), true, 'ficha separa oferta Catira');
assert.equal(listing.includes('externalOffers'), true, 'ficha separa ofertas externas');
assert.equal(listing.includes('official-offer-prep'), true, 'Catira não é botão');
assert.equal(listing.includes('Em preparação'), true, 'indica em preparação');
assert.equal(listing.includes('ainda não está disponível'), true, 'indica indisponível para compra');
assert.equal(/provider === 'catira'[\s\S]{0,200}href=/.test(listing), false, 'Catira sem href de compra');
assert.equal(listing.includes("o.provider !== 'catira'"), true, 'links só nas externas');
assert.equal(css.includes('.official-offer-prep'), true, 'estilo de preparação');
assert.equal(listing.includes('Comprar pelo Catira'), false, 'ficha sem Comprar pelo Catira');
assert.equal(listing.includes('Comprar no Catira'), true, 'ficha tem Comprar no Catira');
assert.equal(listing.includes('catiraOffer.buyEnabled'), true, 'botão respeita buyEnabled');
assert.equal(listing.includes('AppmaxCardForm'), false, 'ficha sem form de cartão');
assert.equal(listing.includes('/api/orders'), false, 'ficha não cria pedido');
assert.equal(listing.includes('/pix'), false, 'ficha não gera Pix');
assert.equal(listing.includes('/checkout?listing='), true, 'ficha vai ao checkout');
assert.equal(listing.includes('loadAppmaxScript'), false, 'ficha sem Appmax JS');
assert.equal(adminPage.includes("['pedidos', 'Pedidos']"), true, 'admin tem aba Pedidos');
assert.equal(adminPage.includes('Compra pelo Catira ainda não está disponível'), true, 'aba Pedidos não sugere compra');
assert.equal(adminPage.includes('Liberar compra'), false, 'admin geral sem liberar compra');
const pedidosBlock = adminPage.slice(adminPage.indexOf("{tab === 'pedidos'"), adminPage.indexOf("{tab === 'rel'"));
assert.equal(pedidosBlock.includes('Pedido Appmax'), true, 'aba Pedidos mostra id Appmax');
assert.equal(pedidosBlock.includes('payment.method') || pedidosBlock.includes('paymentMethod'), true, 'aba Pedidos mostra método');
assert.equal(pedidosBlock.includes('appmaxPaymentStatus') || pedidosBlock.includes('Status Appmax'), true, 'aba Pedidos mostra status Appmax');
assert.equal(pedidosBlock.includes('cardInstallments') || pedidosBlock.includes('Parcela'), true, 'aba Pedidos mostra parcelas');
assert.equal(pedidosBlock.includes('Confirmar pagamento'), false, 'aba Pedidos não confirma pagamento');
assert.equal(pedidosBlock.includes('Liberar compra'), false, 'aba Pedidos sem liberar compra');
assert.equal(/method:\s*'POST'/.test(pedidosBlock), false, 'aba Pedidos é somente leitura');

console.log('OK catira offer ui tests');
