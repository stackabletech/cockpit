import { env } from '$env/dynamic/public';
import * as m from '$lib/paraglide/messages.js';
import type { NavItem, NavSection } from '$lib/types/navigation.js';
import IconDashboard from 'virtual:icons/material-symbols/dashboard';
import IconDatabase from 'virtual:icons/material-symbols/database';
import IconFolder from 'virtual:icons/material-symbols/folder';
import IconMonitoring from 'virtual:icons/material-symbols/monitoring';

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
      icon: IconDatabase
    }
  ];

  // Integrated PoC (iframe-spike): only surface the embedded Trino Web UI when a URL is set.
  if (env.PUBLIC_STACKABLE_COCKPIT_TRINO_UI_URL) {
    dataToolsItems.push({
      label: m.nav_trino_console(),
      href: '/trino-console',
      icon: IconMonitoring
    });
  }

  if (storageBrowserEnabled) {
    dataToolsItems.push({
      label: m.nav_storage(),
      href: '/storage',
      icon: IconFolder
    });
  }

  return [
    {
      title: m.nav_platform(),
      items: [{ label: m.nav_dashboard(), href: '/', icon: IconDashboard }]
    },
    {
      title: m.nav_data_tools(),
      items: dataToolsItems
    }
  ];
}
