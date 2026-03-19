/**
 * DEMO API ENDPOINTS
 * Testing and demonstration endpoints for v2.0 features
 */

import { Router, Request, Response, NextFunction } from 'express';
import { getVectorStore, getOpenCIAPI } from './ai-service';
import { extractMainConcern, OPENCI_KNOWLEDGE_BASE } from './openci-kb';
import { healthCheck, testAllFeatures, getSystemConfig } from './init-utils';
import { requireAuth } from './auth';

export const demoRouter = Router();

function requireAdminDemoAccess(req: Request, res: Response, next: NextFunction): void {
  const role = (req as any).user?.role;
  if (role !== 'admin') {
    res.status(403).json({ error: 'Admin role required for demo endpoints' });
    return;
  }
  next();
}

// All demo endpoints are restricted to authenticated admins.
demoRouter.use(requireAuth, requireAdminDemoAccess);

/**
 * Test health of all services
 */
demoRouter.get('/demo/health', async (_req: Request, res: Response) => {
  try {
    const health = await healthCheck(getVectorStore(), getOpenCIAPI());
    res.json({
      healthy: health.healthy,
      timestamp: health.timestamp,
      services: health.services,
      message: health.healthy
        ? 'All services operational'
        : 'Some services degraded but system operational'
    });
  } catch (error) {
    res.status(500).json({
      error: 'Health check failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Test Option A: Concern Detection
 */
demoRouter.post('/demo/test-concern-detection', (req: Request, res: Response): void => {
  try {
    const { message } = req.body;
    if (!message) {
      res.status(400).json({ error: 'Message is required' });
      return;
    }

    const concern = extractMainConcern(message);
    
    res.json({
      success: true,
      message,
      detected_concern: concern,
      description: 'Option A: System prompt concern detection',
      concerns_available: [
        'App Update Issue',
        'Lark Access Issue',
        'QR/Reference Code Issue',
        'Account/Location Issue',
        'GPS/Map Concern',
        'CI Inquiry',
        'Demand Letter Workflow',
        'Skip & Collect Activity',
        'Form/Field Issue',
        'Workforce Management',
        'System/App Error',
        'Performance Issue'
      ]
    });
  } catch (error) {
    res.status(500).json({
      error: 'Concern detection failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Test Option A: Knowledge Base Lookup
 */
demoRouter.post('/demo/knowledge-lookup', (req: Request, res: Response): void => {
  try {
    const { query } = req.body;
    if (!query) {
      res.status(400).json({ error: 'Query is required' });
      return;
    }

    const queryLower = query.toLowerCase();
    
    // Search modules
    const matchedModules = Object.entries(OPENCI_KNOWLEDGE_BASE.modules)
      .filter(([key, value]) => 
        key.toLowerCase().includes(queryLower) || 
        value.toLowerCase().includes(queryLower)
      )
      .map(([key, value]) => ({ code: key, description: value }));

    // Search banks
    const matchedBanks = OPENCI_KNOWLEDGE_BASE.banks
      .filter(bank => bank.toLowerCase().includes(queryLower));

    // Search supported formats
    const matchedFormats = OPENCI_KNOWLEDGE_BASE.supportedFormats
      .filter(fmt => fmt.toLowerCase().includes(queryLower));

    res.json({
      success: true,
      query,
      results: {
        modules: matchedModules,
        banks: matchedBanks,
        formats: matchedFormats,
        operational_hours: matchedModules.length > 0 || query.toLowerCase().includes('hour') ? 
          OPENCI_KNOWLEDGE_BASE.operationalHours : null
      },
      description: 'Option A: Knowledge base lookup using system prompt data'
    });
  } catch (error) {
    res.status(500).json({
      error: 'Knowledge lookup failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Test Option B: Vector Store Search
 */
demoRouter.post('/demo/vector-search', async (req: Request, res: Response): Promise<void> => {
  try {
    const { query, limit = 5, threshold = 0.5 } = req.body;
    
    if (!query) {
      res.status(400).json({ error: 'Query is required' });
      return;
    }

    const vectorStore = getVectorStore();
    if (!vectorStore) {
      res.status(503).json({
        error: 'Vector Store not available',
        message: 'PostgreSQL with pgvector extension required',
        suggestion: 'Check database connection and pgvector extension'
      });
      return;
    }

    const results = await vectorStore.search(query, limit, threshold);
    
    res.json({
      success: true,
      query,
      results_found: results.length,
      results: results.map(r => ({
        id: r.id,
        type: r.type,
        source: r.source,
        similarity_score: (r.similarity * 100).toFixed(1) + '%',
        preview: r.content.substring(0, 200) + '...'
      })),
      description: 'Option B: Vector database semantic search',
      note: 'Similarity score indicates relevance (0-100%)'
    });
  } catch (error: any) {
    res.status(500).json({
      error: 'Vector search failed',
      message: error.message || 'Unknown error',
      suggestion: 'Check that PostgreSQL is running and pgvector extension is enabled'
    });
  }
});

/**
 * Test Option B: Vector Store Statistics
 */
demoRouter.get('/demo/vector-stats', async (_req: Request, res: Response): Promise<void> => {
  try {
    const vectorStore = getVectorStore();
    if (!vectorStore) {
      res.json({
        available: false,
        message: 'Vector Store not initialized'
      });
      return;
    }

    const stats = await vectorStore.getStats();
    
    res.json({
      available: true,
      total_documents: stats.total,
      by_type: stats.byType,
      description: 'Option B: Vector database statistics',
      indexing: {
        type: 'IVFFlat (Inverted File Flat)',
        dimensions: 384,
        model: 'Google embedding-001'
      }
    });
  } catch (error) {
    res.status(500).json({
      error: 'Could not fetch vector stats',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Test Option C: OpenCI API Status
 */
demoRouter.get('/demo/api-status', async (_req: Request, res: Response): Promise<void> => {
  try {
    const openCIAPI = getOpenCIAPI();
    if (!openCIAPI) {
      res.json({
        initialized: false,
        message: 'OpenCI API not initialized'
      });
      return;
    }

    const isConnected = openCIAPI.isConnected();
    const config = openCIAPI.getConfig();

    res.json({
      success: true,
      initialized: true,
      connected: isConnected,
      mode: isConnected ? 'authenticated' : 'template',
      configuration: config,
      description: 'Option C: OpenCI API integration status',
      available_methods: {
        authentication: ['authenticate()'],
        system: ['getSystemStatus()'],
        agents: ['getAgentActivities()', 'getAgentSchedule()', 'logActivity()'],
        demand_letters: ['getDemandLetterStatus()', 'createDemandLetter()', 'updateDemandLetterStatus()'],
        clients: ['searchClients()', 'getLiveMapData()'],
        forms: ['getAvailableForms()', 'submitForm()']
      }
    });
  } catch (error) {
    res.status(500).json({
      error: 'API status check failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Test Option C: Mock API Method Call
 */
demoRouter.post('/demo/api-call', async (req: Request, res: Response): Promise<void> => {
  try {
    const { method, params } = req.body;
    
    if (!method) {
      res.status(400).json({ error: 'Method name is required' });
      return;
    }

    const openCIAPI = getOpenCIAPI();
    if (!openCIAPI) {
      res.status(503).json({
        error: 'OpenCI API not available',
        message: 'API integration not initialized'
      });
      return;
    }

    // Route to appropriate method
    let result: any;
    
    switch (method) {
      case 'getSystemStatus':
        result = await openCIAPI.getSystemStatus();
        break;
      case 'getAgentActivities':
        result = await openCIAPI.getAgentActivities(params?.agentId || 'demo-agent-1', params?.limit || 20);
        break;
      case 'getDemandLetterStatus':
        result = await openCIAPI.getDemandLetterStatus(params?.dlId || 'demo-dl-1');
        break;
      case 'searchClients':
        result = await openCIAPI.searchClients(params?.query || 'demo', params?.bank);
        break;
      case 'getAvailableForms':
        result = await openCIAPI.getAvailableForms(params?.moduleCode || 'CI');
        break;
      default:
        res.status(400).json({
          error: 'Unknown method',
          message: `Method '${method}' not found`,
          available_methods: [
            'getSystemStatus',
            'getAgentActivities',
            'getDemandLetterStatus',
            'searchClients',
            'getAvailableForms'
          ]
        });
        return;
    }

    res.json({
      success: result.success,
      method,
      params: params || {},
      response: result.data || result,
      description: 'Option C: OpenCI API method call result'
    });
  } catch (error) {
    res.status(500).json({
      error: 'API call failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Test all v2.0 features
 */
demoRouter.get('/demo/test-all', async (_req: Request, res: Response) => {
  try {
    // Run feature tests in background
    testAllFeatures(getVectorStore(), getOpenCIAPI()).catch(err => 
      console.error('Feature test error:', err)
    );

    res.json({
      success: true,
      message: 'Feature tests started',
      description: 'All v2.0 features are being tested. Check server logs for results.',
      testing: {
        option_a: 'Concern detection and knowledge base',
        option_b: 'Vector store search with 13 sample documents',
        option_c: 'OpenCI API methods and authentication'
      },
      check_logs: 'See server console for detailed test results'
    });
  } catch (error) {
    res.status(500).json({
      error: 'Test execution failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get system configuration
 */
demoRouter.get('/demo/config', (_req: Request, res: Response) => {
  try {
    const config = getSystemConfig();
    
    res.json({
      success: true,
      system_configuration: config,
      v2_features: {
        option_a: 'Enhanced System Prompt',
        option_b: 'Vector Database (pgvector)',
        option_c: 'OpenCI API Integration'
      },
      sample_documents_available: config.sampleDocumentsAvailable,
      environment: config.environment,
      endpoints: {
        health: 'GET /demo/health',
        concern_detection: 'POST /demo/test-concern-detection',
        knowledge_lookup: 'POST /demo/knowledge-lookup',
        vector_search: 'POST /demo/vector-search',
        vector_stats: 'GET /demo/vector-stats',
        api_status: 'GET /demo/api-status',
        api_call: 'POST /demo/api-call',
        test_all: 'GET /demo/test-all',
        config: 'GET /demo/config'
      }
    });
  } catch (error) {
    res.status(500).json({
      error: 'Configuration fetch failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Demo conversation endpoint showing all context
 */
demoRouter.post('/demo/full-context', async (req: Request, res: Response): Promise<void> => {
  try {
    const { message } = req.body;
    
    if (!message) {
      res.status(400).json({ error: 'Message is required' });
      return;
    }

    // Option A: Concern detection
    const concern = extractMainConcern(message);

    // Option B: Vector search
    let vectorResults: any[] = [];
    const vectorStore = getVectorStore();
    if (vectorStore) {
      try {
        vectorResults = await vectorStore.search(message, 3, 0.3);
      } catch (error) {
        // Vector search optional
      }
    }

    // Option C: API context
    let apiStatus = null;
    const openCIAPI = getOpenCIAPI();
    if (openCIAPI && openCIAPI.isConnected()) {
      try {
        const result = await openCIAPI.getSystemStatus();
        if (result.success) {
          apiStatus = result.data;
        }
      } catch (error) {
        // API call optional
      }
    }

    res.json({
      success: true,
      user_message: message,
      context_gathered: {
        option_a_concern_detection: concern,
        option_b_vector_search: {
          enabled: !!vectorStore,
          results_found: vectorResults.length,
          results: vectorResults.map(r => ({
            type: r.type,
            similarity: (r.similarity * 100).toFixed(1) + '%',
            preview: r.content.substring(0, 150)
          }))
        },
        option_c_api_context: {
          enabled: !!openCIAPI,
          connected: openCIAPI?.isConnected() || false,
          data: apiStatus
        }
      },
      message_ready_for_ai: 'Yes - all context prepared',
      total_context_size: `${JSON.stringify({
        concern,
        vectorResults,
        apiStatus
      }).length} bytes`
    });
  } catch (error) {
    res.status(500).json({
      error: 'Context gathering failed',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default demoRouter;
