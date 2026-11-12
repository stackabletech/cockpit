// Further E2E app instances with a different configuration than the main one.
// Started by start-app-variant.ts; shared with playwright.config.ts and the specs.

export const APP_VARIANTS = {
  /** OIDC disabled: everyone acts as the shared local user. */
  'local-user': {
    port: '4175',
    specs: /local-user\/.*\.spec\.ts$/,
    env: {
      STACKABLE_COCKPIT_OIDC_DISCOVERY_URL: '',
      STACKABLE_COCKPIT_OIDC_CLIENT_ID: '',
      STACKABLE_COCKPIT_OIDC_CLIENT_SECRET: ''
    }
  }
} as const satisfies Record<
  string,
  { port: string; specs: RegExp; env: Readonly<Record<string, string>> }
>;

export type AppVariant = keyof typeof APP_VARIANTS;
