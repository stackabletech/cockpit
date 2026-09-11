import type { Pathname } from '$app/types';
import type { Component } from 'svelte';

export type NavItem = {
  label: string;
  route: Pathname;
  icon: Component;
  disabled?: boolean;
  badge?: string;
};

export type NavSection = {
  title: string;
  items: NavItem[];
};
