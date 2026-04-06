/**
 * VECTOR STORE SERVICE 
 * PostgreSQL + pgvector for semantic search over OpenCI documentation
 * Supports embedding and retrieval of OpenCI knowledge
 */

import { Pool, PoolClient } from 'pg';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

interface VectorDocument {
  id: string;
  content: string;
  type: 'module' | 'workflow' | 'troubleshooting' | 'procedure' | 'faq';
  source: string;
  access_level?: 'public' | 'authenticated';
  embedding?: number[];
  created_at?: Date;
}

interface SearchResult {
  id: string;
  content: string;
  type: string;
  similarity: number;
  source: string;
}

class VectorStore {
  private pool: Pool;
  private embeddingModel = 'models/text-embedding-004';
  private embeddingDimension = 768; // Keep under pgvector ivfflat 2000-dimension limit
  private embeddingErrorLogWindowStart = 0;
  private embeddingErrorLogCount = 0;
  private discoveredEmbeddingModel: string | null = null;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  /**
   * Initialize vector store: creates pgvector extension and documents table
   */
  async initialize(): Promise<void> {
    const client = await this.pool.connect();
    try {
      // Enable pgvector extension
      await client.query('CREATE EXTENSION IF NOT EXISTS vector');
      console.log('✓ pgvector extension enabled');

      // Create documents table with vector column
      await client.query(`
        CREATE TABLE IF NOT EXISTS openci_documents (
          id TEXT PRIMARY KEY,
          content TEXT NOT NULL,
          type VARCHAR(50) NOT NULL,
          source VARCHAR(255),
          access_level VARCHAR(20) NOT NULL DEFAULT 'authenticated',
          embedding vector(${this.embeddingDimension}),
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        );
      `);

      // Add access_level column if table already exists without it
      await client.query(`
        ALTER TABLE openci_documents ADD COLUMN IF NOT EXISTS access_level VARCHAR(20) NOT NULL DEFAULT 'authenticated';
      `);

      // Migrate id column to TEXT for stable deterministic doc IDs (e.g., module-ci, faq-banks).
      await client.query(`
        ALTER TABLE openci_documents
        ALTER COLUMN id TYPE TEXT USING id::text;
      `).catch(() => {
        // No-op if already TEXT or if migration isn't needed.
      });

      // Ensure embedding column dimension matches configured embedding dimension.
      await client.query(`
        ALTER TABLE openci_documents
        ALTER COLUMN embedding TYPE vector(${this.embeddingDimension});
      `).catch(async () => {
        // If existing data has incompatible vector dimension, clear and migrate.
        await client.query('UPDATE openci_documents SET embedding = NULL;');
        await client.query(`
          ALTER TABLE openci_documents
          ALTER COLUMN embedding TYPE vector(${this.embeddingDimension});
        `);
      });

      // Create index for efficient vector searches
      await client.query(`
        CREATE INDEX IF NOT EXISTS openci_documents_embedding_idx 
        ON openci_documents USING ivfflat (embedding vector_cosine_ops);
      `);

      console.log('✓ Vector store table and index created');

      // Create conversation embeddings table
      await client.query(`
        CREATE TABLE IF NOT EXISTS conversation_embeddings (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          conversation_id UUID NOT NULL,
          message_content TEXT NOT NULL,
          embedding vector(${this.embeddingDimension}),
          created_at TIMESTAMP DEFAULT NOW()
        );
      `);

      await client.query(`
        ALTER TABLE conversation_embeddings
        ALTER COLUMN embedding TYPE vector(${this.embeddingDimension});
      `).catch(async () => {
        await client.query('UPDATE conversation_embeddings SET embedding = NULL;');
        await client.query(`
          ALTER TABLE conversation_embeddings
          ALTER COLUMN embedding TYPE vector(${this.embeddingDimension});
        `);
      });

      console.log('✓ Conversation embeddings table created');
    } finally {
      client.release();
    }
  }

  /**
   * Generate embedding for text using Google's Generative AI
   */
  async generateEmbedding(text: string): Promise<number[]> {
    try {
      const apiKey = process.env.GOOGLE_AI_API_KEY;
      if (!apiKey) {
        throw new Error('GOOGLE_AI_API_KEY not configured');
      }
      const model = await this.resolveEmbeddingModel(apiKey);
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/${model}:embedContent?key=${apiKey}`,
        {
          model,
          outputDimensionality: this.embeddingDimension,
          content: {
            parts: [{ text }]
          }
        },
        { timeout: 5000 }
      );
      this.embeddingModel = model;

      const embedding = response.data?.embedding?.values;
      if (!embedding || !Array.isArray(embedding)) {
        throw new Error('Invalid embedding response');
      }

      return embedding;
    } catch (error) {
      this.logEmbeddingError(error, this.embeddingModel);
      // Re-throw error to propagate it up and fail gracefully
      // Don't return dummy embedding as it distorts results
      throw error;
    }
  }

  private async resolveEmbeddingModel(apiKey: string): Promise<string> {
    if (this.discoveredEmbeddingModel) {
      return this.discoveredEmbeddingModel;
    }

    const fallbackCandidates = [
      'models/text-embedding-004',
      'models/embedding-001',
    ];

    try {
      const response = await axios.get(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
        { timeout: 5000 }
      );

      const models = Array.isArray(response.data?.models) ? response.data.models : [];
      const supportsEmbed = (m: any) => {
        const methods = Array.isArray(m?.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
        return methods.includes('embedContent') || methods.includes('batchEmbedContents');
      };

      const availableEmbedModels = models
        .filter((m: any) => supportsEmbed(m))
        .map((m: any) => String(m.name || ''))
        .filter((name: string) => name.startsWith('models/'));

      const preferred = fallbackCandidates.find((candidate) => availableEmbedModels.includes(candidate));
      const chosen = preferred || availableEmbedModels.find((name: string) => /embed/i.test(name));

      if (chosen) {
        this.discoveredEmbeddingModel = chosen;
        console.log(`✓ Using embedding model: ${chosen}`);
        return chosen;
      }
    } catch (error) {
      this.logEmbeddingError(error, 'model-discovery');
    }

    // Last resort: try known defaults in order.
    this.discoveredEmbeddingModel = fallbackCandidates[0];
    return this.discoveredEmbeddingModel;
  }

  private logEmbeddingError(error: any, model: string): void {
    const now = Date.now();
    if (now - this.embeddingErrorLogWindowStart > 60000) {
      this.embeddingErrorLogWindowStart = now;
      this.embeddingErrorLogCount = 0;
    }

    const status = error?.response?.status;
    const code = error?.response?.data?.error?.code || error?.code;
    const message = error?.response?.data?.error?.message || error?.message || 'Unknown error';

    if (this.embeddingErrorLogCount < 5) {
      console.error(`Embedding request failed (${model}) status=${status ?? 'n/a'} code=${code ?? 'n/a'} message=${message}`);
    } else if (this.embeddingErrorLogCount === 5) {
      console.error('Embedding error log limit reached for this minute; suppressing additional repeated logs.');
    }

    this.embeddingErrorLogCount += 1;
  }

  /**
   * Add document to vector store
   */
  async addDocument(document: VectorDocument): Promise<string> {
    try {
      // Generate embedding
      const embedding = await this.generateEmbedding(document.content);

      const query = `
        INSERT INTO openci_documents (id, content, type, source, access_level, embedding)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (id) DO UPDATE SET
          content = $2,
          type = $3,
          source = $4,
          access_level = $5,
          embedding = $6,
          updated_at = NOW()
        RETURNING id;
      `;

      const result = await this.pool.query(query, [
        document.id,
        document.content,
        document.type,
        document.source,
        document.access_level || 'authenticated',
        JSON.stringify(embedding)
      ]);

      return result.rows[0].id;
    } catch (error) {
      console.error(`Error adding document to vector store: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Search documents by semantic similarity
   * @param accessLevel - Optional filter: 'public' for anonymous, undefined for all
   */
  async search(query: string, limit = 5, threshold = 0.5, accessLevel?: string): Promise<SearchResult[]> {
    try {
      const queryEmbedding = await this.generateEmbedding(query);

      let searchQuery: string;
      let params: any[];

      if (accessLevel) {
        // Filter by access level (anonymous users only get 'public' docs)
        searchQuery = `
          SELECT 
            id,
            content,
            type,
            source,
            1 - (embedding <=> $1::vector) as similarity
          FROM openci_documents
          WHERE 1 - (embedding <=> $1::vector) > $2
            AND access_level = $4
          ORDER BY similarity DESC
          LIMIT $3;
        `;
        params = [JSON.stringify(queryEmbedding), threshold, limit, accessLevel];
      } else {
        // No filter — authenticated users get all documents
        searchQuery = `
          SELECT 
            id,
            content,
            type,
            source,
            1 - (embedding <=> $1::vector) as similarity
          FROM openci_documents
          WHERE 1 - (embedding <=> $1::vector) > $2
          ORDER BY similarity DESC
          LIMIT $3;
        `;
        params = [JSON.stringify(queryEmbedding), threshold, limit];
      }

      const result = await this.pool.query(searchQuery, params);

      return result.rows;
    } catch (error) {
      console.error(`Error searching documents: ${error instanceof Error ? error.message : 'Unknown error'}`);
      throw error;
    }
  }

  /**
   * Get documents by type
   */
  async getDocumentsByType(type: string): Promise<VectorDocument[]> {
    const query = `
      SELECT id, content, type, source, embedding, created_at
      FROM openci_documents
      WHERE type = $1
      ORDER BY created_at DESC;
    `;

    const result = await this.pool.query(query, [type]);
    return result.rows;
  }

  /**
   * Add conversation embedding for context retrieval
   */
  async addConversationEmbedding(conversationId: string, messageContent: string): Promise<void> {
    try {
      const embedding = await this.generateEmbedding(messageContent);

      const query = `
        INSERT INTO conversation_embeddings (conversation_id, message_content, embedding)
        VALUES ($1, $2, $3);
      `;

      await this.pool.query(query, [
        conversationId,
        messageContent,
        JSON.stringify(embedding)
      ]);
    } catch (error) {
      console.error(`Error adding conversation embedding: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Find similar past conversations
   */
  async findSimilarConversations(messageContent: string, conversationId: string, limit = 3): Promise<any[]> {
    try {
      const embedding = await this.generateEmbedding(messageContent);

      const query = `
        SELECT 
          conversation_id,
          message_content,
          1 - (embedding <=> $1::vector) as similarity
        FROM conversation_embeddings
        WHERE conversation_id != $2
        ORDER BY similarity DESC
        LIMIT $3;
      `;

      const result = await this.pool.query(query, [
        JSON.stringify(embedding),
        conversationId,
        limit
      ]);

      return result.rows;
    } catch (error) {
      console.error(`Error finding similar conversations: ${error instanceof Error ? error.message : 'Unknown error'}`);
      return [];
    }
  }

  /**
   * Bulk add documents (for initialization)
   */
  async bulkAddDocuments(documents: VectorDocument[]): Promise<void> {
    console.log(`Adding ${documents.length} documents to vector store...`);

    let successful = 0;
    let failed = 0;

    for (const doc of documents) {
      try {
        await this.addDocument(doc);
        successful++;
        if (successful % 10 === 0) {
          console.log(`  ✓ Added ${successful}/${documents.length} documents`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Failed to add document ${doc.id}: ${message}`);
        failed++;
      }
    }

    console.log(`✓ Vector store loaded: ${successful} documents added, ${failed} failed`);
  }

  /**
   * Cleanup old documents
   */
  async deleteOldDocuments(daysOld: number = 30): Promise<number> {
    // Ensure daysOld is a positive integer to prevent SQL injection
    const safeDaysOld = Math.max(1, parseInt(String(daysOld), 10));
    
    const query = `
      DELETE FROM openci_documents
      WHERE created_at < NOW() - INTERVAL '${safeDaysOld} days';
    `;

    const result = await this.pool.query(query);
    return result.rowCount || 0;
  }

  /**
   * Get vector store stats
   */
  async getStats(): Promise<{ total: number; byType: any }> {
    const totalResult = await this.pool.query(
      'SELECT COUNT(*) as total FROM openci_documents'
    );

    const byTypeResult = await this.pool.query(`
      SELECT type, COUNT(*) as count
      FROM openci_documents
      GROUP BY type
    `);

    return {
      total: totalResult.rows[0].total,
      byType: byTypeResult.rows
    };
  }
}

export { VectorStore, VectorDocument, SearchResult };
