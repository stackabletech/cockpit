import path from 'path';

export default async function globalSetup() {
  process.loadEnvFile(path.join(import.meta.dirname, '..', '.env.test'));
}
