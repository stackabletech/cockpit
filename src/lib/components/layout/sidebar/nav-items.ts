import * as m from '$lib/paraglide/messages.js';
import type { NavItem, NavSection } from '$lib/types/navigation.js';

export type { NavItem, NavSection };

export function getNavSections(): NavSection[] {
  return [
    {
      title: m.nav_platform(),
      items: [{ label: m.nav_dashboard(), href: '/', icon: 'dashboard' }]
    },
    {
      title: m.nav_data_tools(),
      items: [
        {
          label: m.nav_trino(),
          href: '/trino',
          icon: 'database'
        }
      ]
    }
  ];
}
