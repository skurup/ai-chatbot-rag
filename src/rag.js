import EmbeddingService from './embeddings.js';
import QdrantService from './qdrantService.js';
import QueryOptimizer from './queryOptimizer.js';
import CitationManager from './citationManager.js';
import logger from './logger.js';
import { v4 as uuidv4 } from 'uuid';

class RAGEngine {
  constructor() {
    this.embeddingService = new EmbeddingService();
    this.qdrantService = new QdrantService();
    this.queryOptimizer = new QueryOptimizer();
    this.citationManager = new CitationManager();
    this.knowledgeBase = []; // Keep for fallback
    this.chunkSize = parseInt(process.env.CHUNK_SIZE) || 500;
    this.chunkOverlap = parseInt(process.env.CHUNK_OVERLAP) || 50;
    this.maxChunksPerQuery = parseInt(process.env.MAX_CHUNKS_PER_QUERY) || 5;
    this.similarityThreshold = parseFloat(process.env.SIMILARITY_THRESHOLD) || 0.7;
    this.useQdrant = process.env.USE_QDRANT === 'true'; // Re-enabled with improved error handling
    this.isInitialized = false;
    
    // Performance optimizations
    this.queryCache = new Map();
    this.embeddingCache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
  }

  async initialize() {
    try {
      if (this.useQdrant) {
        await this.qdrantService.initialize();
        logger.info('RAG Engine initialized with Qdrant');
      } else {
        logger.info('RAG Engine initialized with in-memory storage');
      }
      this.isInitialized = true;
    } catch (error) {
      logger.warn('Qdrant initialization failed, falling back to in-memory storage', { error: error.message });
      this.useQdrant = false;
      this.isInitialized = true;
    }
  }

  async addDocument(document) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      logger.info(`Adding document: ${document.title}`);

      const chunks = this.chunkText(document.content, this.chunkSize, this.chunkOverlap);
      const embeddings = await this.embeddingService.createEmbeddings(chunks);

      if (this.useQdrant) {
        // Prepare points for Qdrant
        const points = chunks.map((chunk, i) => {
          // Generate a valid UUID for Qdrant
          const pointId = uuidv4();

          return {
            id: pointId,
            vector: embeddings[i],
            payload: {
              text: chunk,
              url: document.url,
              title: document.title,
              description: document.description,
              chunkIndex: i,
              totalChunks: chunks.length,
              timestamp: document.timestamp,
              wordCount: chunk.split(/\s+/).length,
              isManuallyAdded: document.isManuallyAdded || false,
              source_url: document.url,
              source_title: document.title
            }
          };
        });

        await this.qdrantService.upsertPoints(points);
        logger.info(`✓ Added ${chunks.length} chunks to Qdrant from: ${document.title}`);
      } else {
        // Fallback to in-memory storage
        for (let i = 0; i < chunks.length; i++) {
          const chunk = {
            id: `${document.url}_chunk_${i}`,
            text: chunks[i],
            vector: embeddings[i],
            metadata: {
              url: document.url,
              title: document.title,
              description: document.description,
              chunkIndex: i,
              totalChunks: chunks.length,
              timestamp: document.timestamp,
              wordCount: chunks[i].split(/\s+/).length,
              isManuallyAdded: document.isManuallyAdded || false
            }
          };
          this.knowledgeBase.push(chunk);
        }
        logger.info(`✓ Added ${chunks.length} chunks to memory from: ${document.title}`);
      }

      return chunks.length;

    } catch (error) {
      logger.error(`Failed to add document ${document.title}`, { error: error.message });
      throw error;
    }
  }

  async addDocuments(documents) {
    let totalChunks = 0;
    const errors = [];

    for (const document of documents) {
      try {
        const chunks = await this.addDocument(document);
        totalChunks += chunks;
      } catch (error) {
        errors.push({ document: document.title || document.url, error: error.message });
      }
    }

    return { totalChunks, errors };
  }

  chunkText(text, chunkSize = 500, overlap = 50) {
    if (!text || text.trim().length === 0) {
      return [];
    }

    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const chunks = [];
    let currentChunk = '';
    let currentLength = 0;

    for (const sentence of sentences) {
      const sentenceLength = sentence.trim().length;

      // If adding this sentence would exceed chunk size, start a new chunk
      if (currentLength + sentenceLength > chunkSize && currentChunk.length > 0) {
        chunks.push(currentChunk.trim());

        // Start new chunk with overlap
        const words = currentChunk.split(/\s+/);
        const overlapWords = words.slice(-overlap);
        currentChunk = overlapWords.join(' ') + ' ' + sentence.trim();
        currentLength = currentChunk.length;
      } else {
        currentChunk += (currentChunk ? ' ' : '') + sentence.trim();
        currentLength = currentChunk.length;
      }
    }

    // Add the last chunk
    if (currentChunk.trim().length > 0) {
      chunks.push(currentChunk.trim());
    }

    return chunks.filter(chunk => chunk.length > 20); // Filter out very short chunks
  }

  async semanticSearch(query, topK = 5) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const queryEmbedding = await this.embeddingService.createEmbedding(query);

      if (this.useQdrant) {
        // Use Qdrant for semantic search
        const results = await this.qdrantService.searchVectors(queryEmbedding, {
          limit: topK,
          scoreThreshold: this.similarityThreshold,
          searchStrategy: 'semantic'
        });

        return results.map(result => ({
          id: result.id,
          text: result.payload.text,
          similarity: result.score,
          metadata: {
            url: result.payload.url,
            title: result.payload.title,
            description: result.payload.description,
            chunkIndex: result.payload.chunkIndex,
            totalChunks: result.payload.totalChunks,
            timestamp: result.payload.timestamp,
            wordCount: result.payload.wordCount,
            isManuallyAdded: result.payload.isManuallyAdded
          }
        }));
      } else {
        // Fallback to in-memory search
        if (this.knowledgeBase.length === 0) {
          return [];
        }

        const similarities = this.knowledgeBase.map((chunk, index) => ({
          chunk,
          similarity: this.embeddingService.cosineSimilarity(queryEmbedding, chunk.vector),
          index
        }));

        return similarities
          .filter(item => item.similarity >= this.similarityThreshold)
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, topK)
          .map(item => ({
            ...item.chunk,
            similarity: item.similarity
          }));
      }

    } catch (error) {
      logger.error('Semantic search error', { error: error.message });
      return [];
    }
  }

  keywordSearch(query, topK = 5) {
    logger.info('Keyword search called', {
      query,
      topK,
      knowledgeBaseLength: this.knowledgeBase.length,
      useQdrant: this.useQdrant
    });

    // If using Qdrant, we need to use semantic search as fallback
    // since Qdrant doesn't have built-in keyword search
    if (this.useQdrant) {
      logger.info('Using Qdrant for keyword search (semantic fallback)');
      // For now, return empty array and let the fallback strategies handle it
      // The hybrid search will use semantic search from Qdrant
      return [];
    }

    if (this.knowledgeBase.length === 0) {
      logger.warn('Keyword search: Knowledge base is empty');
      return [];
    }

    const queryTerms = query.toLowerCase().split(/\s+/);
    const queryLower = query.toLowerCase();

    const scores = this.knowledgeBase.map(chunk => {
      const text = chunk.text.toLowerCase();
      let score = 0;

      // Exact phrase matching (highest weight)
      if (text.includes(queryLower)) {
        score += 20;
      }

      // Partial phrase matching (high weight)
      const words = queryLower.split(/\s+/);
      if (words.length > 1) {
        const phraseScore = words.reduce((acc, word) => {
          return acc + (text.includes(word) ? 1 : 0);
        }, 0);
        if (phraseScore === words.length) {
          score += 15; // All words present
        } else if (phraseScore > words.length / 2) {
          score += 10; // Most words present
        }
      }

      // Individual term matching with proximity bonus
      for (const term of queryTerms) {
        const termCount = (text.match(new RegExp(term, 'g')) || []).length;
        score += termCount * 3; // Increased weight
        
        // Bonus for terms in title
        if (chunk.metadata?.title?.toLowerCase().includes(term)) {
          score += 5;
        }
      }

      // Generic term variation bonuses (case-insensitive, hyphenated, etc.)
      const variations = this.generateTermVariations(term);
      variations.forEach(variation => {
        if (text.includes(variation)) {
          score += 1; // Smaller bonus for variations
        }
      });

      // Term frequency normalization (less aggressive)
      const wordCount = chunk.text.split(/\s+/).length;
      score = score / Math.max(wordCount / 200, 1); // Less aggressive normalization

      return {
        ...chunk,
        similarity: Math.min(score / 15, 1) // Adjusted normalization
      };
    });

    return scores
      .filter(item => item.similarity > 0.05) // Lower threshold for keyword search
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  async hybridSearch(query, topK = 5, semanticWeight = 0.7, keywordWeight = 0.3) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      if (this.useQdrant) {
        // Enhanced hybrid search with Qdrant
        const queryEmbedding = await this.embeddingService.createEmbedding(query);
        
        // Get semantic results from Qdrant
        const semanticResults = await this.qdrantService.searchVectors(queryEmbedding, {
          limit: topK * 2,
          scoreThreshold: this.similarityThreshold * 0.8, // Lower threshold for hybrid
          searchStrategy: 'hybrid'
        });

        // Convert Qdrant results to our format
        const formattedResults = semanticResults.map(result => ({
          id: result.id,
          text: result.payload.text,
          similarity: result.score,
          metadata: {
            url: result.payload.url,
            title: result.payload.title,
            description: result.payload.description,
            chunkIndex: result.payload.chunkIndex,
            totalChunks: result.payload.totalChunks,
            timestamp: result.payload.timestamp,
            wordCount: result.payload.wordCount,
            isManuallyAdded: result.payload.isManuallyAdded
          }
        }));

        // Apply enhanced BM25-style keyword boosting
        const boostedResults = formattedResults.map(result => {
          const bm25Score = this.calculateBM25Score(query, result.text);
          const combinedScore = result.similarity * semanticWeight + bm25Score * keywordWeight;

          return {
            ...result,
            similarity: Math.min(combinedScore, 1.0), // Cap at 1.0
            bm25Score: bm25Score // Track BM25 score separately
          };
        });

        return boostedResults
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, topK);

      } else {
        // Fallback to original hybrid search
        const [semanticResults, keywordResults] = await Promise.all([
          this.semanticSearch(query, topK * 2),
          Promise.resolve(this.keywordSearch(query, topK * 2))
        ]);

        // Combine results with weighted scores
        const combinedScores = new Map();

        // Add semantic scores
        semanticResults.forEach(result => {
          combinedScores.set(result.id, {
            chunk: result,
            score: result.similarity * semanticWeight
          });
        });

        // Add keyword scores
        keywordResults.forEach(result => {
          const existing = combinedScores.get(result.id);
          if (existing) {
            existing.score += result.similarity * keywordWeight;
          } else {
            combinedScores.set(result.id, {
              chunk: result,
              score: result.similarity * keywordWeight
            });
          }
        });

        // Sort by combined score and return top results
        return Array.from(combinedScores.values())
          .sort((a, b) => b.score - a.score)
          .slice(0, topK)
          .map(item => ({
            ...item.chunk,
            similarity: item.score
          }));
      }

    } catch (error) {
      logger.error('Hybrid search error', { error: error.message });
      return [];
    }
  }

  async contextualSearch(query, conversationHistory = [], topK = 5) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Enhance query with conversation context
      const contextQuery = this.enhanceQueryWithContext(query, conversationHistory);

      if (this.useQdrant) {
        // Enhanced contextual search with Qdrant
        const queryEmbedding = await this.embeddingService.createEmbedding(contextQuery);
        
        const results = await this.qdrantService.searchVectors(queryEmbedding, {
          limit: topK,
          scoreThreshold: this.similarityThreshold * 0.9, // Slightly lower for contextual
          searchStrategy: 'contextual'
        });

        return results.map(result => ({
          id: result.id,
          text: result.payload.text,
          similarity: result.score,
          metadata: {
            url: result.payload.url,
            title: result.payload.title,
            description: result.payload.description,
            chunkIndex: result.payload.chunkIndex,
            totalChunks: result.payload.totalChunks,
            timestamp: result.payload.timestamp,
            wordCount: result.payload.wordCount,
            isManuallyAdded: result.payload.isManuallyAdded
          }
        }));
      } else {
        // Fallback to hybrid search with enhanced query
        return await this.hybridSearch(contextQuery, topK);
      }

    } catch (error) {
      logger.error('Contextual search error', { error: error.message });
      return [];
    }
  }

  enhanceQueryWithContext(query, conversationHistory) {
    if (!conversationHistory || conversationHistory.length === 0) {
      return query;
    }

    // Extract key terms from recent conversation
    const recentMessages = conversationHistory.slice(-3);
    const contextTerms = recentMessages
      .map(msg => msg.content)
      .join(' ')
      .split(/\s+/)
      .filter(word => word.length > 3)
      .slice(0, 10);

    // Combine original query with context terms
    return `${query} ${contextTerms.join(' ')}`;
  }

  async search(query, strategy = 'hybrid', conversationHistory = [], topK = null, sourceFilter = null) {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      // Validate query
      if (!query || typeof query !== 'string') {
        logger.error('Invalid query provided to search', { query, type: typeof query });
        return [];
      }

      topK = topK || this.maxChunksPerQuery;

      // Debug: Log knowledge base state
      logger.info('Search debug info', {
        query,
        strategy,
        knowledgeBaseLength: this.knowledgeBase.length,
        useQdrant: this.useQdrant,
        isInitialized: this.isInitialized,
        sampleChunk: this.knowledgeBase.length > 0 ? {
          title: this.knowledgeBase[0].metadata?.title,
          url: this.knowledgeBase[0].metadata?.url,
          textPreview: this.knowledgeBase[0].text?.substring(0, 100)
        } : 'No chunks available'
      });

      // Early return if no chunks available - fixed for Qdrant
      if (this.useQdrant && this.isInitialized) {
        // When using Qdrant, check if Qdrant has data
        const qdrantStats = await this.qdrantService.getStats();
        if (qdrantStats.pointsCount === 0) {
          logger.warn('Qdrant knowledge base is empty, returning no results');
          return [];
        }
      } else if (this.knowledgeBase.length === 0) {
        // When using in-memory, check in-memory knowledge base
        logger.warn('In-memory knowledge base is empty, returning no results');
        return [];
      }

      // Step 1: Optimize query
      const queryOptimization = this.queryOptimizer.preprocessQuery(query);
      const optimizedQuery = queryOptimization.optimized;
      const queryAnalysis = queryOptimization.analysis;

      // Step 2: Check cache
      const cacheKey = this.generateCacheKey(optimizedQuery, strategy, sourceFilter);
      const cachedResult = this.getCachedResult(cacheKey);
      if (cachedResult) {
        logger.info('Cache hit for query', { query: optimizedQuery, strategy });
        return cachedResult;
      }

      // Step 3: Generate contextual query if needed
      const contextualQuery = this.queryOptimizer.generateContextualQuery(
        optimizedQuery, 
        conversationHistory
      );

      // Step 3.5: Expand query with synonyms and related terms
      const expandedQuery = this.expandQuery(optimizedQuery, queryAnalysis);

      // Step 4: Determine optimal strategy if auto
      const finalStrategy = strategy === 'auto' ? 
        this.determineOptimalStrategy(queryAnalysis) : strategy;

      // Step 5: Prepare Qdrant filter if source filtering is requested
      let qdrantFilter = null;
      // TEMPORARY: Disable Qdrant filtering and rely on post-processing
      // The Qdrant filter is not working correctly, so we'll filter after getting results
      if (false && sourceFilter && sourceFilter !== 'all' && this.useQdrant) {
        // For Qdrant, we'll filter by domain since we can't easily filter by brand name
        const domainMap = {
          'Atlan': 'docs.atlan.com',
          'Snowflake': 'docs.snowflake.com',
          'Databricks': 'docs.databricks.com'
        };
        
        const domain = domainMap[sourceFilter];
        if (domain) {
          qdrantFilter = {
            must: [
              {
                key: 'source_url',
                match: { 
                  text: domain
                }
              }
            ]
          };
        }
      }

      // Step 6: Execute search with optimizations
      let results = await this.executeOptimizedSearch(
        contextualQuery, 
        finalStrategy, 
        topK, 
        qdrantFilter,
        queryAnalysis
      );

      // Step 6.5: Multi-strategy fallback if no results found
      if (results.length === 0) {
        logger.info('No results found with primary strategy, trying fallback strategies', {
          originalQuery: query,
          strategy: finalStrategy,
          threshold: this.similarityThreshold
        });
        
        // Try with lower threshold
        const lowerThreshold = Math.max(0.2, this.similarityThreshold - 0.2);
        const fallbackStrategy = this.useQdrant ? 'semantic' : 'keyword'; // Use semantic for Qdrant, keyword for in-memory
        const fallbackResults = await this.executeOptimizedSearch(
          contextualQuery, 
          fallbackStrategy, // Use appropriate fallback strategy
          topK, 
          qdrantFilter,
          queryAnalysis
        );
        
        if (fallbackResults.length > 0) {
          results = fallbackResults;
          logger.info('Fallback strategy found results', { 
            resultCount: results.length,
            strategy: 'keyword_fallback'
          });
        }
      }

      // Step 6.6: Re-rank results using multiple strategies for better relevancy
      // Skip reranking for Qdrant results since they don't include vector data
      if (!this.useQdrant) {
        results = await this.rerankResults(results, optimizedQuery, expandedQuery, queryAnalysis);
      }

      // Step 7: Apply post-processing optimizations
      results = this.postProcessResults(results, queryAnalysis, sourceFilter);

      // Step 8: Cache results
      this.cacheResult(cacheKey, results);

      logger.info('Optimized search completed', {
        originalQuery: query,
        optimizedQuery: optimizedQuery,
        contextualQuery: contextualQuery,
        strategy: finalStrategy,
        resultCount: results.length,
        queryType: queryAnalysis.type,
        topResults: results.slice(0, 3).map(r => ({
          title: r.metadata?.title || 'Unknown',
          similarity: r.similarity,
          textPreview: r.text?.substring(0, 100) || 'No text'
        }))
      });

      return results;

    } catch (error) {
      logger.error('Search error', { error: error.message, strategy, query });
      return [];
    }
  }

  buildContext(retrievedChunks, maxTokens = 2000) {
    if (!retrievedChunks || retrievedChunks.length === 0) {
      return '';
    }

    let context = '';
    let tokenCount = 0;

    for (const chunk of retrievedChunks) {
      const chunkText = `Source: ${chunk.metadata.title} (${chunk.metadata.url})\n${chunk.text}\n\n`;
      const chunkTokens = Math.ceil(chunkText.length / 4); // Rough token estimation

      if (tokenCount + chunkTokens > maxTokens) {
        break;
      }

      context += chunkText;
      tokenCount += chunkTokens;
    }

    return context.trim();
  }

  generateSourceCitations(retrievedChunks) {
    if (!retrievedChunks || retrievedChunks.length === 0) {
      return [];
    }

    const sources = new Map();

    retrievedChunks.forEach(chunk => {
      const key = chunk.metadata.url;
      if (!sources.has(key)) {
        sources.set(key, {
          url: chunk.metadata.url,
          title: chunk.metadata.title,
          similarity: chunk.similarity,
          chunks: 0
        });
      }
      sources.get(key).chunks++;
      sources.get(key).similarity = Math.max(sources.get(key).similarity, chunk.similarity);
    });

    return Array.from(sources.values())
      .sort((a, b) => b.similarity - a.similarity);
  }

  async getStats() {
    try {
      if (!this.isInitialized) {
        await this.initialize();
      }

      const baseStats = {
        chunkSize: this.chunkSize,
        chunkOverlap: this.chunkOverlap,
        maxChunksPerQuery: this.maxChunksPerQuery,
        similarityThreshold: this.similarityThreshold,
        useQdrant: this.useQdrant,
        isInitialized: this.isInitialized,
        embeddingStats: this.embeddingService.getStats()
      };

      if (this.useQdrant) {
        try {
          const qdrantStats = await this.qdrantService.getStats();
            const sources = await this.getAvailableSources();
            return {
              ...baseStats,
              ...qdrantStats,
              totalSources: sources.length,
              dataSource: 'qdrant'
            };
        } catch (qdrantError) {
          logger.warn('Qdrant stats failed, using fallback', { error: qdrantError.message });
          const sources = await this.getAvailableSources();
          return {
            ...baseStats,
            totalSources: sources.length,
            qdrantError: qdrantError.message
          };
        }
      } else {
        const totalChunks = this.knowledgeBase.length;
        const sources = new Set(this.knowledgeBase.map(chunk => chunk.metadata.url));
        const avgChunkLength = totalChunks > 0
          ? this.knowledgeBase.reduce((sum, chunk) => sum + chunk.text.length, 0) / totalChunks
          : 0;

        // Debug: Log actual knowledge base content
        logger.info('In-memory knowledge base debug', {
          totalChunks,
          sampleChunks: this.knowledgeBase.slice(0, 3).map(chunk => ({
            title: chunk.metadata?.title,
            url: chunk.metadata?.url,
            textLength: chunk.text?.length,
            textPreview: chunk.text?.substring(0, 100)
          }))
        });

        const availableSources = await this.getAvailableSources();
        return {
          ...baseStats,
          totalChunks,
          totalSources: availableSources.length,
          avgChunkLength: Math.round(avgChunkLength),
          dataSource: 'memory'
        };
      }

    } catch (error) {
      logger.error('Failed to get RAG stats', { error: error.message });
      return {
        totalChunks: 0,
        totalDocuments: 0,
        totalSources: 0,
        chunkSize: this.chunkSize,
        chunkOverlap: this.chunkOverlap,
        maxChunksPerQuery: this.maxChunksPerQuery,
        similarityThreshold: this.similarityThreshold,
        useQdrant: this.useQdrant,
        isInitialized: this.isInitialized,
        error: error.message
      };
    }
  }

  clearKnowledgeBase() {
    this.knowledgeBase = [];
    this.embeddingService.clearCache();
  }

  clearConfiguredSources() {
    // Only remove sources that were not manually added
    this.knowledgeBase = this.knowledgeBase.filter(
      chunk => chunk.metadata.isManuallyAdded === true
    );
    this.embeddingService.clearCache();
  }

  async getAvailableSources() {
    const sourcesMap = new Map();

    logger.info('getAvailableSources called', {
      useQdrant: this.useQdrant,
      isInitialized: this.isInitialized
    });

    if (this.useQdrant && this.isInitialized) {
      try {
        // Get sources from Qdrant
        const qdrantStats = await this.qdrantService.getStats();
        logger.info('Qdrant stats for sources', { pointsCount: qdrantStats.pointsCount });

        if (qdrantStats.pointsCount > 0) {
          // Query Qdrant to get unique source titles
          const uniqueSources = await this.getUniqueSourcesFromQdrant();
          logger.info('Retrieved unique sources from getUniqueSourcesFromQdrant', { count: uniqueSources.length });
          return uniqueSources;
        }
      } catch (error) {
        logger.warn('Failed to get sources from Qdrant, falling back to in-memory', { error: error.message });
      }
    }

    // Fallback to in-memory sources
    this.knowledgeBase.forEach(chunk => {
      const domain = this.extractDomain(chunk.metadata.url);
      const brandName = this.extractBrandName(chunk.metadata.url, chunk.metadata.title);
      
      // Group by brand/domain instead of individual pages
      const key = brandName;
      if (!sourcesMap.has(key)) {
        sourcesMap.set(key, {
          title: brandName,
          domain: domain,
          isManuallyAdded: chunk.metadata.isManuallyAdded,
          chunkCount: 0,
          pages: new Set() // Track individual pages for this brand
        });
      }
      
      const source = sourcesMap.get(key);
      source.chunkCount++;
      source.pages.add(chunk.metadata.title);
    });

    return Array.from(sourcesMap.values()).sort((a, b) => a.title.localeCompare(b.title));
  }

  async getUniqueSourcesFromQdrant() {
    try {
      // Query Qdrant to get a sample of points and extract unique sources
      const sampleResults = await this.qdrantService.client.scroll(this.qdrantService.collectionName, {
        limit: 1000, // Get a reasonable sample
        with_payload: true,
        with_vector: false
      });

      const sourcesMap = new Map();

      if (sampleResults.points) {
        sampleResults.points.forEach(point => {
          const payload = point.payload;
          if (payload && payload.source_title && payload.source_url) {
            const domain = this.extractDomain(payload.source_url);
            const brandName = this.extractBrandName(payload.source_url, payload.source_title);

            const key = brandName;
            if (!sourcesMap.has(key)) {
              sourcesMap.set(key, {
                title: brandName,
                domain: domain,
                isManuallyAdded: payload.isManuallyAdded || false,
                chunkCount: 0,
                pages: new Set()
              });
            }

            const source = sourcesMap.get(key);
            source.chunkCount++;
            source.pages.add(payload.source_title);
          }
        });
      }

      const sources = Array.from(sourcesMap.values()).sort((a, b) => a.title.localeCompare(b.title));

      logger.info('Retrieved unique sources from Qdrant', {
        totalSources: sources.length,
        sources: sources.map(s => ({ title: s.title, chunkCount: s.chunkCount }))
      });

      return sources;
    } catch (error) {
      logger.error('Failed to get unique sources from Qdrant', { error: error.message });
      return [];
    }
  }

  extractBrandName(url, title) {
    const domain = this.extractDomain(url);
    
    // Map domains to brand names (only for domains you're actually using)
    const brandMap = {
      'docs.atlan.com': 'Atlan',
      'docs.snowflake.com': 'Snowflake',
      'docs.databricks.com': 'Databricks'
    };

    // Check if we have a specific brand mapping
    if (brandMap[domain]) {
      return brandMap[domain];
    }

    // Fallback 1: Extract brand from docs.* subdomain
    if (domain.startsWith('docs.')) {
      const brandPart = domain.split('.')[1]; // Get the part after 'docs.'
      return brandPart.charAt(0).toUpperCase() + brandPart.slice(1);
    }

    // Fallback 2: Extract brand from other subdomains
    if (domain.includes('.')) {
      const parts = domain.split('.');
      // Skip common prefixes and get the main brand name
      const skipPrefixes = ['www', 'api', 'app', 'portal', 'admin'];
      for (const part of parts) {
        if (!skipPrefixes.includes(part) && part.length > 2) {
          return part.charAt(0).toUpperCase() + part.slice(1);
        }
      }
    }

    // Fallback 3: Use domain as-is (capitalized)
    return domain.charAt(0).toUpperCase() + domain.slice(1);
  }

  extractDomain(url) {
    try {
      return new URL(url).hostname;
    } catch (error) {
      return 'unknown';
    }
  }

  async reindexDocument(document) {
    // Remove existing chunks for this document
    this.knowledgeBase = this.knowledgeBase.filter(
      chunk => chunk.metadata.url !== document.url
    );

    // Add the document again
    return await this.addDocument(document);
  }

  // New optimization methods
  generateCacheKey(query, strategy, sourceFilter) {
    return `${query}_${strategy}_${sourceFilter || 'all'}`;
  }

  getCachedResult(cacheKey) {
    const cached = this.queryCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.results;
    }
    return null;
  }

  cacheResult(cacheKey, results) {
    this.queryCache.set(cacheKey, {
      results,
      timestamp: Date.now()
    });

    // Clean old cache entries
    if (this.queryCache.size > 100) {
      const entries = Array.from(this.queryCache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toDelete = entries.slice(0, 20);
      toDelete.forEach(([key]) => this.queryCache.delete(key));
    }
  }

  determineOptimalStrategy(queryAnalysis) {
    // Determine best strategy based on query analysis
    if (queryAnalysis.type === 'definition') {
      return 'semantic';
    } else if (queryAnalysis.type === 'how_to') {
      return 'hybrid';
    } else if (queryAnalysis.type === 'troubleshooting') {
      return 'keyword';
    } else if (queryAnalysis.isShort) {
      return 'semantic';
    } else if (queryAnalysis.isLong) {
      return 'hybrid';
    } else {
      return 'hybrid';
    }
  }

  async executeOptimizedSearch(query, strategy, topK, qdrantFilter, queryAnalysis) {
    let results;

    switch (strategy) {
      case 'semantic':
        results = await this.optimizedSemanticSearch(query, topK, qdrantFilter, queryAnalysis);
        break;
      case 'keyword':
        results = this.optimizedKeywordSearch(query, topK, queryAnalysis);
        break;
      case 'hybrid':
        results = await this.optimizedHybridSearch(query, topK, qdrantFilter, queryAnalysis);
        break;
      case 'contextual':
        results = await this.optimizedContextualSearch(query, topK, queryAnalysis);
        break;
      default:
        results = await this.optimizedHybridSearch(query, topK, qdrantFilter, queryAnalysis);
    }

    return results;
  }

  async optimizedSemanticSearch(query, topK, qdrantFilter, queryAnalysis) {
    if (this.useQdrant) {
      const queryEmbedding = await this.getCachedEmbedding(query);

      // Use dynamic threshold based on query analysis
      const threshold = this.adjustThreshold(queryAnalysis);

      logger.info('Qdrant semantic search debug', {
        query: query.substring(0, 50),
        threshold: threshold,
        embeddingLength: queryEmbedding.length,
        topK: topK || 5,
        filter: qdrantFilter
      });

      const qdrantResults = await this.qdrantService.searchVectors(queryEmbedding, {
        limit: topK || 5,
        scoreThreshold: threshold,
        searchStrategy: 'semantic',
        filter: qdrantFilter
      });

      logger.info('Qdrant search results', {
        resultCount: qdrantResults.length,
        sampleScores: qdrantResults.slice(0, 3).map(r => ({
          id: r.id,
          score: r.score,
          title: r.payload?.title || 'No title'
        }))
      });

      return this.formatQdrantResults(qdrantResults);
    } else {
      return await this.semanticSearch(query, topK);
    }
  }

  optimizedKeywordSearch(query, topK, queryAnalysis) {
    const results = this.keywordSearch(query, topK);
    
    // Boost results based on query type
    return results.map(result => {
      let boost = 1.0;
      
      // Validate result structure
      if (!result || !result.text || typeof result.text !== 'string') {
        logger.warn('Invalid result structure in optimizedKeywordSearch', { 
          result: result,
          hasText: !!result?.text,
          textType: typeof result?.text
        });
        return result;
      }
      
      if (queryAnalysis.type === 'troubleshooting') {
        // Boost troubleshooting-related content
        if (result.text.toLowerCase().includes('error') || 
            result.text.toLowerCase().includes('problem')) {
          boost = 1.2;
        }
      } else if (queryAnalysis.type === 'definition') {
        // Boost definition-like content
        if (result.text.toLowerCase().includes('is') || 
            result.text.toLowerCase().includes('means')) {
          boost = 1.1;
        }
      }
      
      return {
        ...result,
        similarity: result.similarity * boost
      };
    }).sort((a, b) => b.similarity - a.similarity);
  }

  async optimizedHybridSearch(query, topK, qdrantFilter, queryAnalysis) {
    if (this.useQdrant) {
      const queryEmbedding = await this.getCachedEmbedding(query);

      // Use dynamic threshold based on query analysis
      const threshold = this.adjustThreshold(queryAnalysis);

      const qdrantResults = await this.qdrantService.searchVectors(queryEmbedding, {
        limit: topK || 5,
        scoreThreshold: threshold,
        searchStrategy: 'hybrid',
        filter: qdrantFilter
      });

      return this.formatQdrantResults(qdrantResults);
    } else {
      return await this.hybridSearch(query, topK);
    }
  }

  async optimizedContextualSearch(query, topK, queryAnalysis) {
    return await this.contextualSearch(query, [], topK);
  }

  async getCachedEmbedding(text) {
    const cacheKey = text.toLowerCase().trim();
    const cached = this.embeddingCache.get(cacheKey);
    
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.embedding;
    }
    
    const embedding = await this.embeddingService.createEmbedding(text);
    this.embeddingCache.set(cacheKey, {
      embedding,
      timestamp: Date.now()
    });
    
    return embedding;
  }

  adjustThreshold(queryAnalysis) {
    let threshold = this.similarityThreshold;
    
    // Adjust threshold based on query characteristics
    if (queryAnalysis.isShort) {
      threshold -= 0.15; // Lower threshold for short queries
    } else if (queryAnalysis.isLong) {
      threshold += 0.1; // Higher threshold for long queries
    }
    
    // Query type specific adjustments
    switch (queryAnalysis.type) {
      case 'definition':
        threshold -= 0.1; // Lower threshold for definitions
        break;
      case 'how_to':
        threshold -= 0.05; // Slightly lower for how-to queries
        break;
      case 'troubleshooting':
        threshold -= 0.08; // Lower for troubleshooting
        break;
      case 'comparison':
        threshold += 0.05; // Higher for comparisons
        break;
    }
    
    // Adjust based on keyword density
    if (queryAnalysis.keywords.length > 3) {
      threshold += 0.05; // Higher threshold for keyword-rich queries
    }
    
    // Generic solution: Lower threshold for multi-word terms (likely product/feature names)
    // This works for any vendor: "Auto Loader", "Unity Catalog", "Snowflake Warehouse", etc.
    const hasMultiWordTerms = queryAnalysis.keywords.some(keyword => {
      return keyword.includes(' ') && keyword.length > 5;
    });
    
    if (hasMultiWordTerms) {
      threshold -= 0.1; // Lower threshold for multi-word terms (likely product names)
    }
    
    // TEMPORARY FIX: Since we know Qdrant has excellent results (0.86+ scores),
    // but our thresholds are too high, let's use a much lower threshold
    // TODO: Investigate why similarity scores are so high in Qdrant vs expected
    threshold = Math.min(threshold, 0.3); // Cap at 0.3 to ensure we get results
    
    return Math.max(0.1, Math.min(0.95, threshold)); // Lower minimum to 0.1
  }

  formatQdrantResults(qdrantResults) {
    const formatted = qdrantResults.map(result => {
      // Validate result structure
      if (!result || !result.payload) {
        logger.warn('Invalid Qdrant result structure', { result });
        return null;
      }

      const formattedResult = {
        id: result.id,
        text: result.payload.text || '',
        similarity: result.score,
        metadata: {
          url: result.payload.url,
          title: result.payload.title,
          description: result.payload.description,
          chunkIndex: result.payload.chunkIndex,
          totalChunks: result.payload.totalChunks,
          timestamp: result.payload.timestamp,
          wordCount: result.payload.wordCount,
          isManuallyAdded: result.payload.isManuallyAdded
        }
      };

      // Debug logging to track the text field
      if (!formattedResult.text) {
        logger.warn('formatQdrantResults: Missing text field', {
          resultId: result.id,
          payloadKeys: Object.keys(result.payload || {}),
          payloadText: result.payload?.text
        });
      }

      return formattedResult;
    }).filter(result => result !== null); // Remove null results

    logger.info('formatQdrantResults: Successfully processed results', {
      totalResults: formatted.length,
      sampleResult: formatted[0] ? {
        id: formatted[0].id,
        hasText: !!formatted[0].text,
        textLength: formatted[0].text?.length || 0
      } : null
    });

    return formatted;
  }

  postProcessResults(results, queryAnalysis, sourceFilter) {
    logger.info('postProcessResults: Starting post-processing', {
      resultsCount: results.length,
      sampleResult: results[0] ? {
        id: results[0].id,
        hasText: !!results[0].text,
        textType: typeof results[0].text,
        textLength: results[0].text?.length || 0
      } : null
    });

    // Apply source filter if specified and not using Qdrant filtering
    if (sourceFilter && sourceFilter !== 'all') {
      const originalLength = results.length;

      results = results.filter(chunk => {
        // Check if this chunk belongs to the selected brand/domain
        // Handle both in-memory (url) and Qdrant (source_url) formats
        const url = chunk.metadata?.url || chunk.metadata?.source_url;
        const title = chunk.metadata?.title || chunk.metadata?.source_title;
        const chunkBrand = this.extractBrandName(url, title);
        return chunkBrand === sourceFilter;
      });

      logger.info(`Source filter applied`, {
        filter: sourceFilter,
        originalCount: originalLength,
        filteredCount: results.length
      });

      if (results.length === 0) {
        logger.warn(`No results found for source filter`, { filter: sourceFilter });
      }
    }

    logger.info('postProcessResults: Before diversity filtering', {
      resultsCount: results.length,
      sampleResult: results[0] ? {
        id: results[0].id,
        hasText: !!results[0].text,
        textType: typeof results[0].text,
        textLength: results[0].text?.length || 0
      } : null
    });

    // Apply result diversity to prevent too many similar results
    results = this.applyResultDiversity(results);

    logger.info('postProcessResults: After diversity filtering', {
      resultsCount: results.length
    });

    // Apply query-type specific ranking
    results = this.applyQueryTypeRanking(results, queryAnalysis);

    logger.info('postProcessResults: After applyQueryTypeRanking', {
      resultsCount: results.length
    });

    return results;
  }

  applyQueryTypeRanking(results, queryAnalysis) {
    return results.map(result => {
      let boost = 1.0;

      // Defensive check for undefined text
      if (!result.text) {
        logger.warn('Result missing text field - defensive check activated', {
          resultId: result.id,
          hasPayload: !!result.payload,
          payloadText: result.payload?.text
        });
        return { ...result, boost };
      }

      const text = result.text.toLowerCase();
      const query = queryAnalysis.original?.toLowerCase() || '';
      
      // Enhanced ranking based on query type and content patterns
      switch (queryAnalysis.type) {
        case 'definition':
          // Boost content that defines terms
          if (text.includes('is') || text.includes('means') || text.includes('refers to') ||
              text.includes('definition') || text.includes('defined as')) {
            boost = 1.4;
          }
          // Boost content with exact term matches
          if (queryAnalysis.keywords.some(keyword => keyword && text.includes(keyword.toLowerCase()))) {
            boost *= 1.2;
          }
          break;
          
        case 'how_to':
          // Boost step-by-step content
          if (text.includes('step') || text.includes('process') || text.includes('procedure') ||
              text.includes('tutorial') || text.includes('guide') || text.includes('instructions')) {
            boost = 1.3;
          }
          // Boost content with action words
          if (text.includes('create') || text.includes('build') || text.includes('configure') ||
              text.includes('setup') || text.includes('install')) {
            boost *= 1.15;
          }
          break;
          
        case 'troubleshooting':
          // Boost error-related content
          if (text.includes('error') || text.includes('issue') || text.includes('problem') ||
              text.includes('fix') || text.includes('resolve') || text.includes('debug')) {
            boost = 1.35;
          }
          break;
          
        case 'comparison':
          // Boost comparative content
          if (text.includes('vs') || text.includes('versus') || text.includes('compare') ||
              text.includes('difference') || text.includes('better') || text.includes('advantages')) {
            boost = 1.25;
          }
          break;
          
        case 'example':
          // Boost example content
          if (text.includes('example') || text.includes('sample') || text.includes('demo') ||
              text.includes('for instance') || text.includes('such as')) {
            boost = 1.2;
          }
          break;
      }
      
      // Additional relevance boosts
      
      // Boost content with exact phrase matches
      if (text.includes(query)) {
        boost *= 1.3;
      }
      
      // Boost content with multiple keyword matches
      const keywordMatches = queryAnalysis.keywords.filter(keyword => 
        keyword && text.includes(keyword.toLowerCase())
      ).length;
      if (keywordMatches > 1) {
        boost *= (1 + keywordMatches * 0.1);
      }
      
      // Enhanced metadata-based boosting
      boost = this.applyMetadataBoosts(result, boost, queryAnalysis);
      
      return {
        ...result,
        similarity: Math.min(result.similarity * boost, 1.0),
        relevanceBoost: boost // Track the boost applied
      };
    }).sort((a, b) => b.similarity - a.similarity);
  }

  applyResultDiversity(results) {
    if (results.length <= 3) return results; // Not enough results to diversify

    const diversifiedResults = [];
    const usedSources = new Set();
    const usedUrlPaths = new Set();
    const textSimilarityThreshold = 0.7; // Cosine similarity threshold for text
    const maxPerSource = 2; // Maximum results per source

    // Sort by similarity first
    const sortedResults = [...results].sort((a, b) => b.similarity - a.similarity);

    for (const result of sortedResults) {
      let shouldInclude = true;

      // Check source diversity
      const sourceUrl = result.metadata?.source_url || result.metadata?.url || '';
      const sourceDomain = this.extractDomain(sourceUrl);
      const sourceCount = diversifiedResults.filter(r =>
        this.extractDomain(r.metadata?.source_url || r.metadata?.url || '') === sourceDomain
      ).length;

      if (sourceCount >= maxPerSource) {
        shouldInclude = false;
      }

      // Check URL path diversity
      const urlPath = this.extractUrlPath(sourceUrl);
      if (usedUrlPaths.has(urlPath)) {
        shouldInclude = false;
      }

      // Check text similarity to prevent near-duplicates
      if (shouldInclude && diversifiedResults.length > 0) {
        const textSimilarity = this.calculateMaxTextSimilarity(result.text, diversifiedResults);
        if (textSimilarity > textSimilarityThreshold) {
          shouldInclude = false;
        }
      }

      if (shouldInclude) {
        diversifiedResults.push(result);
        usedSources.add(sourceDomain);
        usedUrlPaths.add(urlPath);

        // Stop if we have enough diverse results
        if (diversifiedResults.length >= this.maxChunksPerQuery) {
          break;
        }
      }
    }

    logger.info('Result diversity applied', {
      originalCount: results.length,
      diversifiedCount: diversifiedResults.length,
      uniqueSources: usedSources.size,
      uniquePaths: usedUrlPaths.size
    });

    return diversifiedResults;
  }

  extractDomain(url) {
    try {
      if (!url) return '';
      const urlObj = new URL(url);
      return urlObj.hostname;
    } catch {
      return url.split('/')[0] || '';
    }
  }

  extractUrlPath(url) {
    try {
      if (!url) return '';
      const urlObj = new URL(url);
      // Get path without query parameters, normalized
      return urlObj.pathname.replace(/\/$/, '') || '/';
    } catch {
      return url.split('?')[0] || '';
    }
  }

  calculateMaxTextSimilarity(text, existingResults) {
    if (!text || existingResults.length === 0) return 0;

    let maxSimilarity = 0;
    const words1 = this.getTextWords(text);

    for (const result of existingResults) {
      if (!result.text) continue;
      const words2 = this.getTextWords(result.text);
      const similarity = this.calculateJaccardSimilarity(words1, words2);
      maxSimilarity = Math.max(maxSimilarity, similarity);
    }

    return maxSimilarity;
  }

  getTextWords(text) {
    return new Set(
      text.toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .split(/\s+/)
        .filter(word => word.length > 2)
    );
  }

  calculateJaccardSimilarity(set1, set2) {
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);
    return union.size === 0 ? 0 : intersection.size / union.size;
  }

  applyMetadataBoosts(result, currentBoost, queryAnalysis) {
    let boost = currentBoost;
    const metadata = result.metadata || {};
    const title = metadata.title?.toLowerCase() || '';
    const url = metadata.source_url || metadata.url || '';
    const description = metadata.description?.toLowerCase() || '';

    // 1. Source authority boosting
    const domain = this.extractDomain(url);
    if (domain.includes('docs.') || domain.includes('documentation')) {
      boost *= 1.2; // Strong boost for official docs
    } else if (domain.includes('github.com') && url.includes('/docs/')) {
      boost *= 1.15; // Boost for GitHub documentation
    } else if (title.includes('official') || title.includes('documentation')) {
      boost *= 1.1; // Boost for official content
    }

    // 2. Content type boosting based on title and URL patterns
    const contentTypeBoosts = {
      'getting-started': 1.15,
      'quick-start': 1.15,
      'tutorial': 1.1,
      'guide': 1.1,
      'reference': 1.05,
      'api': 1.05,
      'troubleshooting': 1.1,
      'faq': 1.05,
      'examples': 1.08,
      'best-practices': 1.08
    };

    for (const [pattern, boostValue] of Object.entries(contentTypeBoosts)) {
      if (title.includes(pattern) || url.includes(pattern) || description.includes(pattern)) {
        boost *= boostValue;
        break; // Apply only the first match to avoid over-boosting
      }
    }

    // 3. Query-specific content boosting
    if (queryAnalysis.type === 'how_to') {
      if (title.includes('setup') || title.includes('configure') || title.includes('install') ||
          url.includes('/setup/') || url.includes('/configuration/') || url.includes('/install/')) {
        boost *= 1.2;
      }
    } else if (queryAnalysis.type === 'troubleshooting') {
      if (title.includes('error') || title.includes('troubleshoot') || title.includes('debug') ||
          url.includes('/troubleshooting/') || url.includes('/errors/')) {
        boost *= 1.25;
      }
    } else if (queryAnalysis.type === 'definition') {
      if (title.includes('overview') || title.includes('introduction') || title.includes('concepts') ||
          url.includes('/concepts/') || url.includes('/overview/')) {
        boost *= 1.15;
      }
    }

    // 4. Recency boosting (enhanced)
    if (metadata.timestamp) {
      const age = Date.now() - new Date(metadata.timestamp).getTime();
      const daysOld = age / (1000 * 60 * 60 * 24);

      if (daysOld < 7) {
        boost *= 1.1; // Strong boost for very recent content
      } else if (daysOld < 30) {
        boost *= 1.05; // Moderate boost for recent content
      } else if (daysOld > 365) {
        boost *= 0.95; // Slight penalty for very old content
      }
    }

    // 5. Content depth boosting
    const wordCount = metadata.wordCount || 0;
    if (wordCount > 200 && wordCount < 2000) {
      boost *= 1.05; // Boost for substantial but not overwhelming content
    } else if (wordCount < 50) {
      boost *= 0.9; // Slight penalty for very short content
    }

    // 6. Structural position boosting
    const chunkIndex = metadata.chunkIndex || 0;
    const totalChunks = metadata.totalChunks || 1;

    // Boost content from the beginning of documents (often contains key information)
    if (chunkIndex === 0 && totalChunks > 1) {
      boost *= 1.1;
    } else if (chunkIndex < 3 && totalChunks > 5) {
      boost *= 1.05;
    }

    return boost;
  }

  calculateBM25Score(query, text, k1 = 1.2, b = 0.75) {
    const queryTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 0);
    const docTerms = text.toLowerCase().split(/\s+/).filter(term => term.length > 0);
    const docLength = docTerms.length;

    // Calculate average document length (approximation)
    const avgDocLength = 100; // Approximate average chunk size in words

    let bm25Score = 0;

    for (const queryTerm of queryTerms) {
      // Calculate term frequency (tf) in document
      const tf = docTerms.filter(term => term === queryTerm).length;

      if (tf === 0) continue;

      // Calculate inverse document frequency (idf) approximation
      // In a full implementation, this would be calculated across the entire corpus
      const idf = Math.log((this.knowledgeBase.length + 1) / (1 + 1)); // Simplified IDF

      // Calculate BM25 component for this term
      const numerator = tf * (k1 + 1);
      const denominator = tf + k1 * (1 - b + b * (docLength / avgDocLength));

      bm25Score += idf * (numerator / denominator);
    }

    // Normalize score to 0-1 range
    return Math.min(bm25Score / queryTerms.length, 1.0);
  }

  async rerankResults(results, originalQuery, expandedQuery, queryAnalysis) {
    if (results.length <= 1) return results;

    // Create embeddings for both queries
    const originalEmbedding = await this.getCachedEmbedding(originalQuery);
    const expandedEmbedding = await this.getCachedEmbedding(expandedQuery);

    // Re-rank using multiple similarity measures
    const rerankedResults = results.map(result => {
      let finalScore = result.similarity;

      // 1. Original query similarity (70% weight)
      const originalSimilarity = this.embeddingService.cosineSimilarity(
        originalEmbedding, 
        result.vector || result.embedding
      );
      finalScore = finalScore * 0.7 + originalSimilarity * 0.3;

      // 2. Expanded query similarity (20% weight)
      const expandedSimilarity = this.embeddingService.cosineSimilarity(
        expandedEmbedding, 
        result.vector || result.embedding
      );
      finalScore = finalScore * 0.8 + expandedSimilarity * 0.2;

      // 3. Keyword density boost (10% weight)
      const keywordDensity = this.calculateKeywordDensity(result.text, queryAnalysis.keywords);
      finalScore = finalScore * 0.9 + keywordDensity * 0.1;

      // 4. Position boost (earlier in document = higher relevance)
      const positionBoost = result.metadata?.chunkIndex ? 
        Math.max(0.8, 1 - (result.metadata.chunkIndex / 10)) : 1.0;
      finalScore *= positionBoost;

      return {
        ...result,
        similarity: Math.min(finalScore, 1.0),
        originalSimilarity,
        expandedSimilarity,
        keywordDensity,
        positionBoost
      };
    });

    // Sort by final score
    return rerankedResults.sort((a, b) => b.similarity - a.similarity);
  }

  calculateKeywordDensity(text, keywords) {
    const textLower = text.toLowerCase();
    const words = textLower.split(/\s+/);
    const totalWords = words.length;
    
    let keywordCount = 0;
    keywords.forEach(keyword => {
      if (keyword) {
        const matches = (textLower.match(new RegExp(keyword.toLowerCase(), 'g')) || []).length;
        keywordCount += matches;
      }
    });

    return Math.min(keywordCount / totalWords, 0.1); // Cap at 10%
  }

  generateTermVariations(term) {
    const variations = [];
    const termLower = term.toLowerCase();
    
    // Add original term
    variations.push(termLower);
    
    // Hyphenated variations (e.g., "auto-loader", "auto_loader")
    variations.push(termLower.replace(/\s+/g, '-'));
    variations.push(termLower.replace(/\s+/g, '_'));
    
    // CamelCase variations (e.g., "autoLoader", "AutoLoader")
    const words = termLower.split(/\s+/);
    if (words.length > 1) {
      const camelCase = words[0] + words.slice(1).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('');
      variations.push(camelCase);
      variations.push(camelCase.charAt(0).toUpperCase() + camelCase.slice(1));
    }
    
    // Remove duplicates
    return [...new Set(variations)];
  }

  expandQuery(query, queryAnalysis) {
    // Simple query expansion with domain-specific synonyms
    const synonyms = {
      'data': ['information', 'dataset', 'records'],
      'catalog': ['directory', 'registry', 'inventory'],
      'governance': ['management', 'control', 'oversight'],
      'security': ['protection', 'safety', 'privacy'],
      'analytics': ['analysis', 'insights', 'metrics'],
      'dashboard': ['interface', 'panel', 'console'],
      'api': ['interface', 'endpoint', 'service'],
      'database': ['db', 'data store', 'repository'],
      'table': ['dataset', 'collection', 'entity'],
      'column': ['field', 'attribute', 'property'],
      'row': ['record', 'entry', 'item'],
      'query': ['search', 'request', 'question'],
      'report': ['summary', 'analysis', 'document'],
      'user': ['person', 'account', 'profile'],
      'role': ['permission', 'access', 'privilege'],
      'admin': ['administrator', 'manager', 'supervisor'],
      'config': ['configuration', 'settings', 'setup'],
      'deploy': ['deployment', 'release', 'publish'],
      'monitor': ['tracking', 'observability', 'surveillance'],
      'alert': ['notification', 'warning', 'alarm']
    };

    let expandedTerms = [...queryAnalysis.keywords];
    
    // Add synonyms for key terms
    queryAnalysis.keywords.forEach(keyword => {
      if (keyword) {
        const lowerKeyword = keyword.toLowerCase();
        if (synonyms[lowerKeyword]) {
          expandedTerms.push(...synonyms[lowerKeyword]);
        }
      }
    });

    // Add query type specific terms
    switch (queryAnalysis.type) {
      case 'definition':
        expandedTerms.push('what is', 'meaning', 'explanation');
        break;
      case 'how_to':
        expandedTerms.push('steps', 'process', 'procedure', 'tutorial');
        break;
      case 'troubleshooting':
        expandedTerms.push('error', 'issue', 'problem', 'fix', 'solution');
        break;
      case 'comparison':
        expandedTerms.push('vs', 'versus', 'difference', 'compare');
        break;
    }

    // Remove duplicates and return expanded query
    const uniqueTerms = [...new Set(expandedTerms)];
    return uniqueTerms.join(' ');
  }

  // Enhanced method to generate citations
  generateCitations(searchResults, query, conversationHistory = []) {
    try {
      // Validate parameters
      if (!searchResults || !Array.isArray(searchResults)) {
        logger.warn('Invalid searchResults provided to generateCitations', { 
          searchResults: searchResults,
          type: typeof searchResults,
          isArray: Array.isArray(searchResults)
        });
        return {
          citations: [],
          summary: {
            totalSources: 0,
            confidence: 0,
            coverage: 0
          }
        };
      }

      if (!query || typeof query !== 'string') {
        logger.warn('Invalid query provided to generateCitations', { query, type: typeof query });
        return {
          citations: [],
          summary: {
            totalSources: 0,
            confidence: 0,
            coverage: 0
          }
        };
      }

      const queryOptimization = this.queryOptimizer.preprocessQuery(query);
      const citations = this.citationManager.generateCitations(searchResults, query, queryOptimization.analysis);
      logger.info('Citations generated successfully', { 
        query, 
        resultCount: searchResults.length, 
        citationCount: citations.citations?.length || 0 
      });
      return citations;
    } catch (error) {
      logger.error('Citation generation failed', { error: error.message, query, stack: error.stack });
      // Return empty citations structure as fallback
      return {
        citations: [],
        summary: {
          totalSources: 0,
          confidence: 0,
          coverage: 0
        }
      };
    }
  }
}

export default RAGEngine;