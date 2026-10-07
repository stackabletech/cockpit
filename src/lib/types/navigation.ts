import type { Component } from 'svelte';
import type { Pathname } from '$app/types';

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
