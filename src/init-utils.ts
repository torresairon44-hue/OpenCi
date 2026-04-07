/**
 * INITIALIZATION UTILITIES
 * Helper functions for system initialization and setup
 */

import { VectorStore } from './vector-store';
import { OpenCIAPI } from './openci-api';
import { loadSampleDocuments, OPENCI_SAMPLE_DOCUMENTS } from './openci-documents';

interface InitializationStatus {
  timestamp: Date;
  components: {
    database: boolean;
    googleAI: boolean;
    vectorStore: boolean;
    openCIAPI: boolean;
  };
  stats: {
    vectorDocuments: number;
    conversationEmbeddings: number;
  };
  warnings: string[];
}

/**
 * Initialize all enhanced components on startup
 */
export async function initializeAll(options: {
  vectorStore?: VectorStore | null;
  openCIAPI?: OpenCIAPI | null;
  loadSampleDocs?: boolean;
}): Promise<InitializationStatus> {
  const status: InitializationStatus = {
    timestamp: new Date(),
    components: {
      database: true,
      googleAI: true,
      vectorStore: false,
      openCIAPI: false,
    },
    stats: {
      vectorDocuments: 0,
      conversationEmbeddings: 0,
    },
    warnings: [],
  };

  // Option B: Initialize Vector Store with Sample Documents
  if (options.vectorStore) {
    try {
      if (options.loadSampleDocs) {
        await loadSampleDocuments(options.vectorStore);
      }

      const stats = await options.vectorStore.getStats();
      status.components.vectorStore = true;
      status.stats.vectorDocuments = stats.total;

      console.log(`✅ Vector Store initialized with ${stats.total} documents`);
    } catch (error) {
      status.warnings.push(`Vector Store initialization: ${error instanceof Error ? error.message : 'Unknown error'}`);
      console.warn('⚠  Vector Store initialization failed');
    }
  }

  // Option C: Initialize OpenCI API
  if (options.openCIAPI) {
    try {
      status.components.openCIAPI = options.openCIAPI.isConnected();
      if (status.components.openCIAPI) {
        console.log('✅ OpenCI API initialized and authenticated');
      } else {
        console.log('ℹ  OpenCI API in template mode (no authentication)');
      }
    } catch (error) {
      status.warnings.push(`OpenCI API initialization: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // Log initialization summary
  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('INITIALIZATION SUMMARY');
  console.log('═══════════════════════════════════════════════════════════');
  console.log(`Timestamp: ${status.timestamp.toISOString()}`);
  console.log(`\nComponents:`);
  console.log(`  Database:     ${status.components.database ? '✅' : '❌'}`);
  console.log(`  Google AI:    ${status.components.googleAI ? '✅' : '❌'}`);
  console.log(`  Vector Store: ${status.components.vectorStore ? '✅' : '❌'}`);
  console.log(`  OpenCI API:   ${status.components.openCIAPI ? '✅' : '❌'}`);

  if (status.stats.vectorDocuments > 0) {
    console.log(`\nKnowledge Base:`);
    console.log(`  Documents: ${status.stats.vectorDocuments}`);
  }

  if (status.warnings.length > 0) {
    console.log(`\nWarnings:`);
    status.warnings.forEach(w => console.log(`  ⚠ ${w}`));
  }

  console.log('═══════════════════════════════════════════════════════════\n');

  return status;
}

/**
 * Test all v2.0 features
 */
export async function testAllFeatures(
  vectorStore?: VectorStore | null,
  openCIAPI?: OpenCIAPI | null
): Promise<void> {
  console.log('\n🧪 Running v2.0 Feature Tests...\n');

  // Test Option A: Concern Detection
  console.log('Test 1: Concern Detection (Option A)');
  const { extractMainConcern } = await import('./openci-kb.js');
  const testQueries = [
    "Can't log into Lark",
    'DL workflow after visit',
    'GPS location not working',
    'Form submission error',
  ];
  testQueries.forEach(q => {
    const concern = extractMainConcern(q);
    console.log(`  "${q}" → ${concern}`);
  });

  // Test Option B: Vector Store
  if (vectorStore) {
    console.log('\nTest 2: Vector Store Search (Option B)');
    const searchQueries = [
      'password reset lark',
      'demand letter workflow',
      'GPS troubleshooting',
      'form validation error',
    ];
    
    for (const query of searchQueries) {
      try {
        const results = await vectorStore.search(query, 2, 0.3);
        console.log(`  "${query}" → Found ${results.length} documents`);
        if (results.length > 0) {
          console.log(`    Top match: ${results[0].type} - similarity: ${(results[0].similarity * 100).toFixed(1)}%`);
        }
      } catch (error) {
        console.log(`  "${query}" → Search failed`);
      }
    }
  } else {
    console.log('\nTest 2: Vector Store → Not available');
  }

  // Test Option C: OpenCI API
  if (openCIAPI) {
    console.log('\nTest 3: OpenCI API Methods (Option C)');
    
    try {
      if (openCIAPI.isConnected()) {
        console.log('  API Status: ✅ Connected');
        const status = await openCIAPI.getSystemStatus();
        if (status.success) {
          console.log(`  System Status: ✅ Retrieved`);
        } else {
          console.log(`  System Status: ⚠ ${status.error}`);
        }
      } else {
        console.log('  API Status: ℹ Template mode (no authentication)');
        console.log('  All API methods available but require API key for real data');
      }
    } catch (error) {
      console.log(`  API Test: ⚠ Error`);
    }
  } else {
    console.log('\nTest 3: OpenCI API → Not available');
  }

  console.log('\n✅ Feature tests complete!\n');
}

/**
 * Health check for all services
 */
export async function healthCheck(
  vectorStore?: VectorStore | null,
  openCIAPI?: OpenCIAPI | null
): Promise<{
  healthy: boolean;
  timestamp: Date;
  services: Record<string, { status: 'ok' | 'warning' | 'error'; message?: string }>;
}> {
  const health: any = {
    healthy: true,
    timestamp: new Date(),
    services: {},
  };

  // Check Vector Store
  if (vectorStore) {
    try {
      const stats = await vectorStore.getStats();
      health.services.vectorStore = {
        status: stats.total > 0 ? 'ok' : 'warning',
        message: `${stats.total} documents loaded`,
      };
    } catch (error) {
      health.services.vectorStore = {
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
      health.healthy = false;
    }
  }

  // Check OpenCI API
  if (openCIAPI) {
    try {
      health.services.openCIAPI = {
        status: openCIAPI.isConnected() ? 'ok' : 'warning',
        message: openCIAPI.isConnected() ? 'Authenticated' : 'Template mode (no API key)',
      };
    } catch (error) {
      health.services.openCIAPI = {
        status: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
      };
      health.healthy = false;
    }
  }

  return health;
}

/**
 * Get system configuration summary
 */
export function getSystemConfig(): {
  hasVectorStore: boolean;
  hasOpenCIAPI: boolean;
  sampleDocumentsAvailable: number;
  environment: string;
} {
  // Import at runtime to get actual state
  const { getVectorStore, getOpenCIAPI } = require('./ai-service');
  const vectorStore = getVectorStore();
  const openCIAPI = getOpenCIAPI();

  return {
    hasVectorStore: vectorStore !== null && vectorStore !== undefined,
    hasOpenCIAPI: openCIAPI !== null && openCIAPI !== undefined && openCIAPI.isConnected(),
    sampleDocumentsAvailable: OPENCI_SAMPLE_DOCUMENTS.length,
    environment: process.env.NODE_ENV || 'development',
  };
}

export { loadSampleDocuments };
