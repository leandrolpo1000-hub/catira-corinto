import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components';
import Home from './pages/Home';
import Search from './pages/Search';
import Catiras from './pages/Catiras';
import Listing from './pages/Listing';
import { Login, Register, Forgot, VerifyEmail } from './pages/Auth';
import Create from './pages/Create';
import IntelligentCreate from './pages/IntelligentCreate';
import Boost from './pages/Boost';
import Pay from './pages/Pay';
import Profile, { Settings } from './pages/Profile';
import { Favorites, Mine, Conversations, Chat, Trades, PublicUser, Alerts, Support } from './pages/More';
import Admin from './pages/Admin';
import { Privacy, Terms } from './pages/Legal';
import Ranking from './pages/Ranking';
import LanceHub, { LanceDetail, DealerApply, SellerLance } from './pages/LanceHub';
import OwnResale from './pages/OwnResale';
import Auctions, { CreateAuction, AuctionDetail, MyAuctions, Watching, MyWins, AuctionPay, AuctionRanking, AuctionNotices } from './pages/Auction';
import ActionFeed, { ActionCreate } from './pages/Action';

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/buscar" element={<Search />} />
        <Route path="/catiras" element={<Catiras />} />
        <Route path="/anuncio/:id" element={<Listing />} />
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
    </Layout>
  );
}
