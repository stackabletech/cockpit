import * as m from '$lib/paraglide/messages.js';
import type { NavItem, NavSection } from '$lib/types/navigation.js';
import IconDashboard from 'virtual:icons/material-symbols/dashboard';
import IconDatabase from 'virtual:icons/material-symbols/database';
import IconFolder from 'virtual:icons/material-symbols/folder';

export type { NavItem, NavSection };

export interface NavFlags {
  storageBrowserEnabled?: boolean;
}

export function getPlatformSection(): NavSection {
  return {
    title: m.nav_platform(),
    items: [{ label: m.nav_dashboard(), href: '/', icon: IconDashboard }]
  };
}

export function getToolsSection(flags: NavFlags = {}): NavSection {
  const { storageBrowserEnabled = false } = flags;

  const toolsItems: NavItem[] = [
    {
      label: m.nav_trino(),
      href: '/trino',
      icon: IconDatabase
    }
  ];

  if (storageBrowserEnabled) {
    toolsItems.push({
      label: m.nav_storage(),
      href: '/storage',
      icon: IconFolder
    });
  }

  return {
    title: m.sidebar_tools(),
    items: toolsItems
  };
}
