import app, { ensureEnhancedServicesInitialized } from '../src/index';

export default async function handler(req: any, res: any): Promise<void> {
  try {
    await ensureEnhancedServicesInitialized();
  } catch (error) {
    console.error('Critical startup initialization failed in serverless handler:', error);
    res.status(503).json({
      error: 'Service unavailable',
      message: 'Critical startup dependency is unavailable. Please retry shortly.',
    });
    return;
  }

  app(req, res);
}
