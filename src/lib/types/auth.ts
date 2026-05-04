import { authClient } from '$lib/auth-client';

export type User = typeof authClient.$Infer.Session.user;
