import * as m from '$lib/paraglide/messages.js';
import type { NavItem, NavSection } from '$lib/types/navigation.js';

export type { NavItem, NavSection };

export interface NavFlags {
  storageBrowserEnabled?: boolean;
}

export function getNavSections(flags: NavFlags = {}): NavSection[] {
  const { storageBrowserEnabled = false } = flags;

  const dataToolsItems: NavItem[] = [
    {
      label: m.nav_trino(),
      href: '/trino',
      icon: 'database'
    }
  ];

  if (storageBrowserEnabled) {
    dataToolsItems.push({
      label: m.nav_storage(),
      href: '/storage',
      icon: 'folder'
    });
  }

  return [
    {
      title: m.nav_platform(),
      items: [{ label: m.nav_dashboard(), href: '/', icon: 'dashboard' }]
    },
    {
      title: m.nav_data_tools(),
      items: dataToolsItems
    }
  ];
}
