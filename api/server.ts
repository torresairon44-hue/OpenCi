import app, { ensureEnhancedServicesInitialized } from '../src/index';

export default async function handler(req: any, res: any): Promise<void> {
  await ensureEnhancedServicesInitialized();
  app(req, res);
}
