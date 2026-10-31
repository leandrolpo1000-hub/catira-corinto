import {
  Home, Search, Plus, Heart, User, Menu, MapPin, Sun, Moon, Mic, X, Sparkles,
  MessageCircle, Star, Camera, Repeat2, Bell,
  Gavel, ShoppingBag, Tag,
  CarFront, Smartphone, House, Shirt, Wrench, Gamepad2, BookOpen,
  Dumbbell, Baby, PawPrint, Sprout, Gem, Building2, Briefcase,
} from 'lucide-react';

// Ícones de interface (linguagem visual única via Lucide).
const UI = {
  home: Home,
  search: Search,
  plus: Plus,
  heart: Heart,
  user: User,
  menu: Menu,
  sparkles: Sparkles,
  pin: MapPin,
  swap: Repeat2,
  repeat: Repeat2,
  chat: MessageCircle,
  star: Star,
  wa: MessageCircle,
  camera: Camera,
  sun: Sun,
  moon: Moon,
  mic: Mic,
  close: X,
  bell: Bell,
  // atalhos e leilão
  gavel: Gavel,
  bag: ShoppingBag,
  tag: Tag,
};

// Ícones de categorias.
const CAT = {
  car: CarFront,
  phone: Smartphone,
  home: House,
  shirt: Shirt,
  tool: Wrench,
  game: Gamepad2,
  book: BookOpen,
  sport: Dumbbell,
  baby: Baby,
  cow: PawPrint,
  plant: Sprout,
  gem: Gem,
  building: Building2,
  briefcase: Briefcase,
};

export const icons = { ...UI, ...CAT };

export function Ico({ name, size = 22, stroke = 1.8 }) {
  const Cmp = UI[name] || Gem;
  return <Cmp size={size} strokeWidth={stroke} />;
}

export function CatIcon({ name, size = 18, stroke = 1.7 }) {
  const Cmp = CAT[name] || Gem;
  return <Cmp size={size} strokeWidth={stroke} />;
}

export { Gavel, ShoppingBag, Tag, Repeat2, Search, Bell };
