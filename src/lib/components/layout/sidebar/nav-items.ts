import * as m from '$lib/paraglide/messages.js';
import type { NavSection } from '$lib/types/navigation.js';
import IconDashboard from 'virtual:icons/material-symbols/dashboard';
import IconDatabase from 'virtual:icons/material-symbols/database';

export function getNavSections(): NavSection[] {
  return [
    {
      title: m.nav_platform(),
      items: [{ label: m.nav_dashboard(), href: '/', icon: IconDashboard }]
    },
    {
      title: m.nav_data_tools(),
      items: [
        {
          label: m.nav_trino(),
          href: '/trino',
          icon: IconDatabase
        }
      ]
    }
  ];
}
