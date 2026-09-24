import type { LucideIcon } from 'lucide-react';
import { LayoutDashboard, Megaphone, MessageCircle, MessageSquareText, Search, Settings, Users } from 'lucide-react';

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** true = a tela ainda não existe de verdade, é placeholder honesto ("chega na Fase X") */
  comingSoon?: boolean;
};

export type NavSection = {
  /** `undefined` = seção sem rótulo (a 1ª, "Visão geral" sozinha — rótulo seria ruído). */
  label?: string;
  items: NavItem[];
};

/**
 * Agrupado em seções (não mais uma lista plana) — "navegação com seções" foi
 * pedido explícito da rodada de layout premium. `Sidebar` e `MobileNav`
 * iteram `NAV_SECTIONS` (não mais `NAV_ITEMS` direto); `NavLink` continua
 * recebendo um `NavItem` isolado, sem mudança de contrato.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    items: [{ href: '/painel', label: 'Visão geral', icon: LayoutDashboard }],
  },
  {
    label: 'Prospecção',
    items: [
      { href: '/buscas', label: 'Buscas', icon: Search },
      { href: '/leads', label: 'Leads', icon: Users },
      { href: '/templates', label: 'Templates', icon: MessageSquareText },
      { href: '/campanhas', label: 'Campanhas', icon: Megaphone },
    ],
  },
  {
    label: 'Canais',
    items: [{ href: '/whatsapp', label: 'WhatsApp', icon: MessageCircle }],
  },
  {
    label: 'Sistema',
    items: [{ href: '/configuracoes', label: 'Configurações', icon: Settings }],
  },
];
