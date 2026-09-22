import type { LucideIcon } from 'lucide-react';
import { LayoutDashboard, Megaphone, MessageCircle, MessageSquareText, Search, Settings, Users } from 'lucide-react';

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** true = a tela ainda não existe de verdade, é placeholder honesto ("chega na Fase X") */
  comingSoon?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { href: '/painel', label: 'Visão geral', icon: LayoutDashboard },
  { href: '/buscas', label: 'Buscas', icon: Search },
  { href: '/leads', label: 'Leads', icon: Users },
  { href: '/templates', label: 'Templates', icon: MessageSquareText },
  { href: '/campanhas', label: 'Campanhas', icon: Megaphone, comingSoon: true },
  { href: '/whatsapp', label: 'WhatsApp', icon: MessageCircle },
  { href: '/configuracoes', label: 'Configurações', icon: Settings },
];
