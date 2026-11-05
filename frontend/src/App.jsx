import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components';
import Home from './pages/Home';
import Search, { SearchNotices } from './pages/Search';
import Catiras from './pages/Catiras';
import Listing from './pages/Listing';
import OfficialProduct from './pages/OfficialProduct';
import { Login, Register, Forgot, VerifyEmail } from './pages/Auth';
import Create from './pages/Create';
import Boost from './pages/Boost';
import Pay from './pages/Pay';
import Profile, { Settings } from './pages/Profile';
import { Favorites, Mine, Conversations, Chat, Trades, PublicUser, Alerts, Support } from './pages/More';
import { Privacy, Terms } from './pages/Legal';
import Ranking from './pages/Ranking';
import OwnResale from './pages/OwnResale';

const Admin = lazy(() => import('./pages/Admin'));
const Checkout = lazy(() => import('./pages/Checkout'));
const IntelligentCreate = lazy(() => import('./pages/IntelligentCreate'));
const Auctions = lazy(() => import('./pages/Auction'));
const CreateAuction = lazy(() => import('./pages/Auction').then((m) => ({ default: m.CreateAuction })));
const AuctionDetail = lazy(() => import('./pages/Auction').then((m) => ({ default: m.AuctionDetail })));
const MyAuctions = lazy(() => import('./pages/Auction').then((m) => ({ default: m.MyAuctions })));
const Watching = lazy(() => import('./pages/Auction').then((m) => ({ default: m.Watching })));
const MyWins = lazy(() => import('./pages/Auction').then((m) => ({ default: m.MyWins })));
const AuctionPay = lazy(() => import('./pages/Auction').then((m) => ({ default: m.AuctionPay })));
const AuctionRanking = lazy(() => import('./pages/Auction').then((m) => ({ default: m.AuctionRanking })));
const AuctionNotices = lazy(() => import('./pages/Auction').then((m) => ({ default: m.AuctionNotices })));
const LanceHub = lazy(() => import('./pages/LanceHub'));
const LanceDetail = lazy(() => import('./pages/LanceHub').then((m) => ({ default: m.LanceDetail })));
const DealerApply = lazy(() => import('./pages/LanceHub').then((m) => ({ default: m.DealerApply })));
const SellerLance = lazy(() => import('./pages/LanceHub').then((m) => ({ default: m.SellerLance })));
const ActionFeed = lazy(() => import('./pages/Action'));
const ActionCreate = lazy(() => import('./pages/Action').then((m) => ({ default: m.ActionCreate })));
const ActionNotices = lazy(() => import('./pages/Action').then((m) => ({ default: m.ActionNotices })));

export default function App() {
  return (
    <Layout>
      <Suspense fallback={<p>Carregando...</p>}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/buscar" element={<Search />} />
          <Route path="/buscar/avisos" element={<SearchNotices />} />
          <Route path="/catiras" element={<Catiras />} />
          <Route path="/anuncio/:id" element={<Listing />} />
          <Route path="/produto/:id" element={<OfficialProduct />} />
          <Route path="/checkout/entrega" element={<Checkout />} />
          <Route path="/checkout/:orderId/pagamento" element={<Checkout />} />
          <Route path="/checkout/:orderId/pix" element={<Checkout />} />
          <Route path="/checkout/:orderId/aguardando" element={<Checkout />} />
          <Route path="/checkout/:orderId/ok" element={<Checkout />} />
          <Route path="/checkout/:orderId" element={<Checkout />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/entrar" element={<Login />} />
          <Route path="/cadastro" element={<Register />} />
          <Route path="/confirmar-email" element={<VerifyEmail />} />
          <Route path="/recuperar" element={<Forgot />} />
          <Route path="/anunciar" element={<Create />} />
          <Route path="/anunciar-inteligente" element={<IntelligentCreate />} />
          <Route path="/turbinar/:id" element={<Boost />} />
          <Route path="/pagar/:id" element={<Pay />} />
          <Route path="/perfil" element={<Profile />} />
          <Route path="/config" element={<Settings />} />
          <Route path="/favoritos" element={<Favorites />} />
          <Route path="/meus-anuncios" element={<Mine />} />
          <Route path="/alertas" element={<Alerts />} />
          <Route path="/conversas" element={<Conversations />} />
          <Route path="/suporte" element={<Support />} />
          <Route path="/chat/:id" element={<Chat />} />
          <Route path="/propostas" element={<Trades />} />
          <Route path="/usuario/:id" element={<PublicUser />} />
          <Route path="/ranking" element={<Ranking />} />
          <Route path="/em-acao" element={<ActionFeed />} />
          <Route path="/em-acao/publicar" element={<ActionCreate />} />
          <Route path="/em-acao/avisos" element={<ActionNotices />} />
          <Route path="/leiloes" element={<Auctions />} />
          <Route path="/criar-leilao" element={<CreateAuction />} />
          <Route path="/leilao/:id" element={<AuctionDetail />} />
          <Route path="/meus-leiloes" element={<MyAuctions />} />
          <Route path="/estou-de-olho" element={<Watching />} />
          <Route path="/meus-arremates" element={<MyWins />} />
          <Route path="/pagar-leilao/:id" element={<AuctionPay />} />
          <Route path="/ranking-leilao" element={<AuctionRanking />} />
          <Route path="/avisos-leilao" element={<AuctionNotices />} />
          <Route path="/catireiro" element={<DealerApply />} />
          <Route path="/central-repasse" element={<LanceHub />} />
          <Route path="/central-repasse/:id" element={<LanceDetail />} />
          <Route path="/propostas-rapidas" element={<SellerLance />} />
          <Route path="/oportunidades-catira" element={<OwnResale />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/privacidade" element={<Privacy />} />
          <Route path="/termos" element={<Terms />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Layout>
  );
}
