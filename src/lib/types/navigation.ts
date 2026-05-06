export type NavItem = {
  label: string;
  href: string;
  icon: string;
  disabled?: boolean;
  badge?: string;
};

export type NavSection = {
  title: string;
  items: NavItem[];
};
