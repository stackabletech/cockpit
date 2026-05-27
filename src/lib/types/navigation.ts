import type { Component } from 'svelte';

export type NavItem = {
  label: string;
  href: string;
  icon: Component;
  disabled?: boolean;
  badge?: string;
};

export type NavSection = {
  title: string;
  items: NavItem[];
};
