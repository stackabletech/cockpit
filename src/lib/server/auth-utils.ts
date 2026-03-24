export function getUserId(locals: App.Locals): string {
  return locals.user?.id ?? 'anonymous';
}
