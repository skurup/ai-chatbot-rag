import { QdrantClient } from '@qdrant/js-client-rest';
import logger from './logger.js';

class QdrantService {
  constructor() {
    this.client = new QdrantClient({
      url: process.env.QDRANT_URL || 'http://localhost:6333',
      apiKey: process.env.QDRANT_API_KEY || null,
      timeout: 10000 // 10 second timeout
    });
    
    this.collectionName = process.env.QDRANT_COLLECTION || 'rag_chunks';
    this.vectorSize = 1536; // OpenAI text-embedding-ada-002 dimension
    this.distance = 'Cosine'; // Cosine similarity for semantic search
    
    this.isInitialized = false;
  }

  async initialize() {
    try {
      logger.info('Initializing Qdrant service', {
        url: this.client.url,
        collection: this.collectionName
      });

      // Test connection by checking collections (healthCheck method doesn't exist)
      logger.info('Testing Qdrant connection...');
      const collections = await this.client.getCollections();
      logger.info('Qdrant connection successful', { collectionsCount: collections.collections.length });

      // Check if collection exists
      logger.info('Checking for existing collections...');
      const collectionExists = collections.collections.some(
        col => col.name === this.collectionName
      );

      if (!collectionExists) {
        await this.createCollection();
        logger.info('Created new Qdrant collection', { collection: this.collectionName });
      } else {
        // Validate existing collection configuration
        const collectionInfo = await this.client.getCollection(this.collectionName);
        logger.info('Using existing Qdrant collection', {
          collection: this.collectionName,
          vectorSize: collectionInfo.config?.params?.vectors?.size,
          distance: collectionInfo.config?.params?.vectors?.distance
        });

        // Check if vector size matches
        const existingVectorSize = collectionInfo.config?.params?.vectors?.size;
        if (existingVectorSize && existingVectorSize !== this.vectorSize) {
          logger.warn('Vector size mismatch', {
            expected: this.vectorSize,
            actual: existingVectorSize,
            collection: this.collectionName
          });
          // Update our vector size to match the existing collection
          this.vectorSize = existingVectorSize;
        }
      }

      this.isInitialized = true;
      return true;

    } catch (error) {
      logger.error('Failed to initialize Qdrant service', { 
        error: error.message,
        url: this.client.url,
        collection: this.collectionName
      });
      
      // Don't throw error, just log it and let the system fall back to in-memory
      logger.warn('Qdrant initialization failed, system will use in-memory storage');
      this.isInitialized = false;
      return false;
    }
  }

  async createCollection() {
    try {
      await this.client.createCollection(this.collectionName, {
        vectors: {
          size: this.vectorSize,
          distance: this.distance
        },
        optimizers_config: {
          default_segment_number: 2
        },
        replication_factor: 1
      });

      // Create payload index for metadata filtering
      await this.client.createPayloadIndex(this.collectionName, {
        field_name: 'source_url',
        field_schema: 'keyword'
      });

      await this.client.createPayloadIndex(this.collectionName, {
        field_name: 'source_title',
        field_schema: 'keyword'
      });

      await this.client.createPayloadIndex(this.collectionName, {
        field_name: 'is_manually_added',
        field_schema: 'bool'
      });

      logger.info('Created Qdrant collection with indexes', { collection: this.collectionName });

    } catch (error) {
      logger.error('Failed to create Qdrant collection', { error: error.message });
      throw error;
    }
  }

  async upsertPoints(points) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Validate points before sending
      const validatedPoints = points.map(point => {
        // Ensure ID is a string or number
        if (typeof point.id !== 'string' && typeof point.id !== 'number') {
          point.id = String(point.id);
        }
        
        // Ensure vector is an array of numbers
        if (!Array.isArray(point.vector)) {
          throw new Error(`Invalid vector format for point ${point.id}`);
        }
        
        // Ensure payload exists
        if (!point.payload) {
          point.payload = {};
        }
        
        return point;
      });

      logger.info('Attempting to upsert points to Qdrant', {
        collection: this.collectionName,
        pointsCount: validatedPoints.length,
        samplePoint: {
          id: validatedPoints[0]?.id,
          vectorLength: validatedPoints[0]?.vector?.length,
          payloadKeys: Object.keys(validatedPoints[0]?.payload || {})
        }
      });

      // Additional validation before sending
      validatedPoints.forEach((point, index) => {
        if (!point.vector || point.vector.length !== this.vectorSize) {
          throw new Error(`Point ${index} has invalid vector size: ${point.vector?.length}, expected: ${this.vectorSize}`);
        }
        
        // Check for invalid characters in ID
        if (typeof point.id === 'string' && point.id.includes(' ')) {
          point.id = point.id.replace(/\s+/g, '_');
        }
        
        // Validate payload structure
        if (point.payload) {
          // Check for any undefined or null values that might cause issues
          Object.keys(point.payload).forEach(key => {
            if (point.payload[key] === undefined) {
              delete point.payload[key];
            }
          });
        }
      });

      // Check collection exists and get its configuration
      try {
        const collectionInfo = await this.client.getCollection(this.collectionName);
        logger.info('Collection configuration', {
          collection: this.collectionName,
          vectorSize: collectionInfo.config?.params?.vectors?.size,
          distance: collectionInfo.config?.params?.vectors?.distance,
          pointsCount: collectionInfo.points_count
        });
      } catch (error) {
        logger.error('Collection check failed', { 
          collection: this.collectionName, 
          error: error.message 
        });
        throw new Error(`Collection ${this.collectionName} does not exist or is not accessible`);
      }

      // Log detailed information about what we're sending
      logger.info('Detailed point validation', {
        collection: this.collectionName,
        pointsCount: validatedPoints.length,
        vectorSize: this.vectorSize,
        samplePoint: {
          id: validatedPoints[0]?.id,
          vectorLength: validatedPoints[0]?.vector?.length,
          payload: validatedPoints[0]?.payload,
          payloadKeys: Object.keys(validatedPoints[0]?.payload || {}),
          payloadValues: Object.values(validatedPoints[0]?.payload || {}).map(v => 
            typeof v === 'string' ? v.substring(0, 50) + '...' : v
          )
        }
      });

      // Try upsert with a single point first to debug
      if (validatedPoints.length > 1) {
        logger.info('Testing upsert with single point first');
        try {
          const testResult = await this.client.upsert(this.collectionName, {
            wait: true,
            points: [validatedPoints[0]]
          });
          logger.info('Single point upsert successful', { operationId: testResult.operation_id });
        } catch (testError) {
          logger.error('Single point upsert failed', { 
            error: testError.message,
            response: testError.response?.data,
            status: testError.response?.status
          });
          throw testError;
        }
      }

      const result = await this.client.upsert(this.collectionName, {
        wait: true,
        points: validatedPoints
      });

      logger.info('Upserted points to Qdrant', {
        collection: this.collectionName,
        pointsCount: validatedPoints.length,
        operationId: result.operation_id
      });

      return result;

    } catch (error) {
      // Enhanced error logging
      const errorDetails = {
        message: error.message,
        stack: error.stack,
        response: error.response?.data,
        status: error.response?.status,
        statusText: error.response?.statusText,
        pointsCount: points?.length || 0,
        samplePoint: points?.[0] ? {
          id: points[0].id,
          vectorLength: points[0].vector?.length,
          payloadKeys: Object.keys(points[0].payload || {})
        } : null
      };

      logger.error('Failed to upsert points to Qdrant', errorDetails);
      
      // Try to provide more helpful error message
      if (error.response?.status === 400) {
        throw new Error(`Qdrant Bad Request: ${error.response?.data?.error || error.message}. Check vector dimensions (expected: ${this.vectorSize}) and payload format.`);
      }
      
      throw error;
    }
  }

  async searchVectors(queryVector, options = {}) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const {
        limit = 5,
        scoreThreshold = 0.7,
        filter = null,
        searchStrategy = 'semantic'
      } = options;

      let searchParams = {
        vector: queryVector,
        limit: limit,
        score_threshold: scoreThreshold,
        with_payload: true,
        with_vector: false
      };

      // Add filtering based on search strategy
      if (filter) {
        searchParams.filter = filter;
      }

      // Enhanced search strategies with Qdrant
      switch (searchStrategy) {
        case 'semantic':
          // Pure semantic search with cosine similarity
          searchParams.score_threshold = scoreThreshold;
          break;

        case 'keyword':
          // For keyword search, we'll use a lower threshold and post-process
          searchParams.score_threshold = 0.3;
          break;

        case 'hybrid':
          // Hybrid search combining semantic and keyword
          searchParams.score_threshold = scoreThreshold * 0.8;
          break;

        case 'contextual':
          // Contextual search with conversation history
          searchParams.score_threshold = scoreThreshold * 0.9;
          break;

        default:
          searchParams.score_threshold = scoreThreshold;
      }

      const result = await this.client.search(this.collectionName, searchParams);

      logger.info('Qdrant search completed', {
        strategy: searchStrategy,
        resultsCount: result.length,
        threshold: scoreThreshold,
        searchParams: {
          limit: searchParams.limit,
          score_threshold: searchParams.score_threshold,
          with_payload: searchParams.with_payload
        },
        sampleResults: result.slice(0, 2).map(r => ({
          id: r.id,
          score: r.score,
          payloadKeys: Object.keys(r.payload || {}),
          hasText: !!r.payload?.text
        }))
      });

      return result;

    } catch (error) {
      logger.error('Qdrant search failed', { error: error.message });
      throw error;
    }
  }

  async searchWithFilters(queryVector, filters, options = {}) {
    try {
      const searchOptions = {
        ...options,
        filter: {
          must: filters.map(filter => ({
            key: filter.field,
            match: { value: filter.value }
          }))
        }
      };

      return await this.searchVectors(queryVector, searchOptions);

    } catch (error) {
      logger.error('Qdrant filtered search failed', { error: error.message });
      throw error;
    }
  }

  async deletePoints(pointIds) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const result = await this.client.delete(this.collectionName, {
        wait: true,
        points: pointIds
      });

      logger.info('Deleted points from Qdrant', {
        collection: this.collectionName,
        pointsCount: pointIds.length,
        operationId: result.operation_id
      });

      return result;

    } catch (error) {
      logger.error('Failed to delete points from Qdrant', { error: error.message });
      throw error;
    }
  }

  async deleteByFilter(filter) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const result = await this.client.delete(this.collectionName, {
        wait: true,
        filter: {
          must: filter.must || [],
          should: filter.should || [],
          must_not: filter.must_not || []
        }
      });

      logger.info('Deleted points by filter from Qdrant', {
        collection: this.collectionName,
        operationId: result.operation_id
      });

      return result;

    } catch (error) {
      logger.error('Failed to delete points by filter from Qdrant', { error: error.message });
      throw error;
    }
  }

  async getCollectionInfo() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const info = await this.client.getCollection(this.collectionName);
      return info;

    } catch (error) {
      logger.error('Failed to get collection info', { error: error.message });
      throw error;
    }
  }

  async getStats() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const info = await this.getCollectionInfo();
      const count = await this.client.count(this.collectionName);

      return {
        collectionName: this.collectionName,
        vectorSize: this.vectorSize,
        distance: this.distance,
        pointsCount: count.count,
        segmentsCount: info.segments_count,
        diskDataSize: info.disk_data_size,
        ramDataSize: info.ram_data_size,
        isInitialized: this.isInitialized
      };

    } catch (error) {
      logger.error('Failed to get Qdrant stats', { error: error.message });
      return {
        collectionName: this.collectionName,
        isInitialized: false,
        error: error.message
      };
    }
  }

  async clearCollection() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Delete all points in the collection
      const result = await this.client.delete(this.collectionName, {
        wait: true,
        filter: {} // Empty filter deletes all points
      });

      logger.info('Cleared Qdrant collection', {
        collection: this.collectionName,
        operationId: result.operation_id
      });

      return result;

    } catch (error) {
      logger.error('Failed to clear Qdrant collection', { error: error.message });
      throw error;
    }
  }

  async recreateCollection() {
    try {
      logger.info('Recreating Qdrant collection', { collection: this.collectionName });
      
      // Delete existing collection
      try {
        await this.client.deleteCollection(this.collectionName);
        logger.info('Deleted existing collection', { collection: this.collectionName });
      } catch (error) {
        logger.warn('Collection deletion failed (may not exist)', { error: error.message });
      }

      // Create new collection
      await this.createCollection();
      logger.info('Recreated Qdrant collection', { collection: this.collectionName });
      
      this.isInitialized = true;
      return true;

    } catch (error) {
      logger.error('Failed to recreate Qdrant collection', { error: error.message });
      throw error;
    }
  }

  async healthCheck() {
    try {
      await this.client.getCollections();
      return { status: 'healthy', service: 'qdrant' };
    } catch (error) {
      return { status: 'unhealthy', service: 'qdrant', error: error.message };
    }
  }
}

export default QdrantService;
