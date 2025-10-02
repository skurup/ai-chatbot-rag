import express from 'express';
import dotenv from 'dotenv';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { body, validationResult } from 'express-validator';

import WebScraper from './src/scraper.js';
import RAGEngine from './src/rag.js';
import ChatService from './src/chat.js';
import ConversationExport from './src/conversationExport.js';
import logger from './src/logger.js';
import { URLS_TO_SCRAPE } from './config/urls.js';

// Initialize environment
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize services
const scraper = new WebScraper();
const ragEngine = new RAGEngine();
const chatService = new ChatService(ragEngine);

// Inject RAG engine into scraper for content availability checking
scraper.ragEngine = ragEngine;
const conversationExport = new ConversationExport();


// Global state
let isInitialized = false;
let lastScrapeTime = null;

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      upgradeInsecureRequests: []
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  },
  crossOriginEmbedderPolicy: false
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100000, // Very high limit for development
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

app.use(limiter);

// CORS
app.use(cors({
  origin: process.env.NODE_ENV === 'production' ? false : true,
  credentials: true
}));

// Logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('HTTP Request', {
      method: req.method,
      url: req.url,
      status: res.statusCode,
      duration: `${duration}ms`,
      userAgent: req.get('User-Agent'),
      ip: req.ip
    });
  });
  next();
});

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Initialize knowledge base
async function initializeKnowledgeBase() {
  if (isInitialized) {
    return;
  }

  try {
    logger.info('🚀 Initializing knowledge base...');
    
    // Initialize RAG engine (which will initialize Qdrant)
    await ragEngine.initialize();

    if (!URLS_TO_SCRAPE || URLS_TO_SCRAPE.length === 0) {
      logger.warn('⚠️  No URLs configured for scraping');
      isInitialized = true;
      return;
    }

    const { results, errors } = await scraper.scrapeUrls(URLS_TO_SCRAPE);

    if (results.length > 0) {
      const { totalChunks, errors: ragErrors } = await ragEngine.addDocuments(results);
      logger.info(`✅ Knowledge base initialized with ${totalChunks} chunks from ${results.length} documents`);

      if (ragErrors.length > 0) {
        logger.warn('⚠️  Some documents failed to process:', ragErrors);
      }
    }

    if (errors.length > 0) {
      logger.warn('⚠️  Some URLs failed to scrape:', errors);
    }

    lastScrapeTime = new Date().toISOString();
    isInitialized = true;

  } catch (error) {
    console.error('❌ Failed to initialize knowledge base:', error.message);
    isInitialized = true; // Mark as initialized even on failure to prevent infinite retries
  }
}

// Routes

// Serve main chat interface
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve RAG dashboard
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'rag-dashboard.html'));
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const qdrantHealth = await ragEngine.qdrantService.healthCheck();
    
    const stats = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      initialized: isInitialized,
      lastScrapeTime,
      qdrant: qdrantHealth,
      server: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        version: process.version
      },
      services: {
        scraper: scraper.getStats(),
        rag: await ragEngine.getStats(),
        chat: chatService.getStats()
      }
    };

    res.json(stats);
  } catch (error) {
    logger.error('Health check failed', { error: error.message });
    res.status(500).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Stats endpoint for dashboard
app.get('/api/stats', async (req, res) => {
  try {
    const stats = {
      success: true,
      timestamp: new Date().toISOString(),
      stats: {
        rag: await ragEngine.getStats(),
        chat: chatService.getStats(),
        scraper: scraper.getStats()
      }
    };

    res.json(stats);
  } catch (error) {
    logger.error('Stats endpoint error', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get stats',
      message: error.message
    });
  }
});

// Get available sources endpoint
app.get('/api/sources', async (req, res) => {
  try {
    const sources = await ragEngine.getAvailableSources();

    res.json({
      success: true,
      sources,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get sources error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get sources',
      message: error.message
    });
  }
});

// Chat endpoint with validation
app.post('/api/chat', [
  body('message')
    .isLength({ min: 1, max: 1000 })
    .withMessage('Message must be between 1 and 1000 characters')
    .trim()
    .escape(),
  body('conversationId')
    .optional()
    .isLength({ min: 1, max: 100 })
    .withMessage('Conversation ID must be between 1 and 100 characters'),
  body('searchStrategy')
    .optional()
    .isIn(['semantic', 'keyword', 'hybrid', 'contextual'])
    .withMessage('Invalid search strategy'),
  body('sourceFilter')
    .optional()
    .isLength({ min: 1, max: 200 })
    .withMessage('Source filter must be between 1 and 200 characters')
], async (req, res) => {
  try {
    // Check validation results
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        error: 'Validation failed',
        code: 'VALIDATION_ERROR',
        details: errors.array()
      });
    }

    const { message, conversationId, searchStrategy, sourceFilter } = req.body;

    // Ensure knowledge base is initialized
    if (!isInitialized) {
      await initializeKnowledgeBase();
    }

    const response = await chatService.generateResponse(
      message.trim(),
      conversationId || 'default',
      searchStrategy || 'hybrid',
      sourceFilter || 'all'
    );

    res.json({
      success: true,
      ...response
    });

  } catch (error) {
    console.error('Chat endpoint error:', error.message);
    res.status(500).json({
      error: 'Failed to generate response',
      code: 'CHAT_ERROR',
      message: error.message
    });
  }
});

// Manual scraping endpoint
app.post('/api/scrape', async (req, res) => {
  try {
    console.log('🔄 Manual scraping triggered');

    // Initialize URL tracker if not already done
    await scraper.initialize();

    const { results, errors } = await scraper.scrapeUrls(URLS_TO_SCRAPE);

    if (results.length > 0) {
      // Clear only configured sources, preserve manually added ones
      ragEngine.clearConfiguredSources();

      // Add new documents
      const { totalChunks, errors: ragErrors } = await ragEngine.addDocuments(results);

      lastScrapeTime = new Date().toISOString();

      res.json({
        success: true,
        message: 'Scraping completed successfully',
        stats: {
          documentsScraped: results.length,
          totalChunks,
          scrapeErrors: errors.length,
          processingErrors: ragErrors.length,
          timestamp: lastScrapeTime
        },
        errors: [...errors, ...ragErrors]
      });
    } else {
      res.status(400).json({
        success: false,
        message: 'No documents were successfully scraped',
        errors
      });
    }

  } catch (error) {
    console.error('Manual scraping error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Scraping failed',
      message: error.message
    });
  }
});

// Add single URL endpoint
app.post('/api/add-url', async (req, res) => {
  try {
    const { url } = req.body;

    if (!url || !scraper.validateUrl(url)) {
      return res.status(400).json({
        error: 'Valid URL is required',
        code: 'INVALID_URL'
      });
    }

    // Initialize URL tracker if not already done
    await scraper.initialize();
    
    // Reset scraper state for this single URL scraping
    scraper.resetScraperState();
    
    // Use recursive scraping for the single URL
    const results = await scraper.scrapeUrlRecursively(url);
    
    if (!results || results.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No content found at URL',
        message: 'The URL could not be scraped or contains no relevant content'
      });
    }

    // Mark all documents as manually added
    results.forEach(doc => {
      doc.isManuallyAdded = true;
    });

    // Add all scraped documents to RAG engine
    const { totalChunks, errors: ragErrors } = await ragEngine.addDocuments(results);

    res.json({
      success: true,
      message: 'URL and associated links scraped successfully',
      stats: {
        url,
        pagesScraped: results.length,
        totalChunks,
        wordCount: results.reduce((sum, doc) => sum + doc.wordCount, 0),
        pages: results.map(doc => ({
          title: doc.title,
          url: doc.url,
          wordCount: doc.wordCount,
          depth: doc.depth
        }))
      },
      errors: ragErrors
    });

  } catch (error) {
    console.error('Add URL error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to add URL',
      message: error.message
    });
  }
});

// URL tracking status endpoint
app.get('/api/url-tracking', async (req, res) => {
  try {
    await scraper.initialize();
    const stats = scraper.urlTracker.getStats();
    const trackedUrls = scraper.urlTracker.getTrackedUrls();

    res.json({
      success: true,
      stats,
      trackedUrls: trackedUrls.slice(0, 50), // Return first 50 URLs
      totalTracked: trackedUrls.length
    });
  } catch (error) {
    console.error('URL tracking status error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get URL tracking status',
      message: error.message
    });
  }
});

// Clear URL tracking endpoint
app.post('/api/url-tracking/clear', async (req, res) => {
  try {
    await scraper.initialize();
    await scraper.urlTracker.clearTrackedUrls();

    res.json({
      success: true,
      message: 'URL tracking cleared successfully'
    });
  } catch (error) {
    console.error('Clear URL tracking error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to clear URL tracking',
      message: error.message
    });
  }
});

// Remove specific URL from tracking endpoint
app.post('/api/url-tracking/remove', async (req, res) => {
  try {
    const { url } = req.body;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        message: 'URL is required'
      });
    }

    await scraper.initialize();
    const removed = await scraper.urlTracker.removeUrl(url);
    
    res.json({
      success: true,
      message: removed ? 'URL removed from tracking' : 'URL was not being tracked',
      url: url,
      removed: removed
    });
  } catch (error) {
    console.error('Remove URL tracking error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to remove URL from tracking',
      message: error.message
    });
  }
});

// Debug search endpoint with lower thresholds
app.post('/api/debug-search', async (req, res) => {
  try {
    const { query, threshold = 0.3 } = req.body;

    if (!query || query.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Query is required'
      });
    }

    // Temporarily lower the similarity threshold
    const originalThreshold = ragEngine.similarityThreshold;
    ragEngine.similarityThreshold = threshold;

    // Test search with lower threshold
    const results = await ragEngine.search(query, 'hybrid', [], 10, 'all');

    // Restore original threshold
    ragEngine.similarityThreshold = originalThreshold;

    res.json({
      success: true,
      query,
      threshold,
      resultCount: results.length,
      results: results.map(r => ({
        title: r.metadata?.title || 'Unknown',
        similarity: r.similarity,
        textPreview: r.text?.substring(0, 200) || 'No text',
        url: r.metadata?.url || 'Unknown URL'
      }))
    });

  } catch (error) {
    console.error('Debug search error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Debug search failed',
      message: error.message
    });
  }
});

// Debug knowledge base endpoint
app.get('/api/debug-kb', async (req, res) => {
  try {
    const kbInfo = {
      knowledgeBaseLength: ragEngine.knowledgeBase.length,
      useQdrant: ragEngine.useQdrant,
      isInitialized: ragEngine.isInitialized,
      sampleChunks: ragEngine.knowledgeBase.slice(0, 3).map(chunk => ({
        title: chunk.metadata?.title,
        url: chunk.metadata?.url,
        textLength: chunk.text?.length,
        textPreview: chunk.text?.substring(0, 100)
      }))
    };

    res.json({
      success: true,
      knowledgeBase: kbInfo
    });
  } catch (error) {
    console.error('Debug KB error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Debug KB failed',
      message: error.message
    });
  }
});

// Debug Qdrant endpoint
app.get('/api/debug-qdrant', async (req, res) => {
  try {
    if (!ragEngine.useQdrant) {
      return res.json({
        success: true,
        message: 'Qdrant is disabled',
        useQdrant: false
      });
    }

    const collections = await ragEngine.qdrantService.client.getCollections();
    const collectionInfo = await ragEngine.qdrantService.client.getCollection('rag_chunks');
    
    res.json({
      success: true,
      collections: collections.collections,
      ragChunksCollection: {
        exists: true,
        config: collectionInfo.config,
        pointsCount: collectionInfo.points_count,
        vectorSize: collectionInfo.config?.params?.vectors?.size,
        distance: collectionInfo.config?.params?.vectors?.distance
      }
    });
  } catch (error) {
    res.json({
      success: false,
      error: error.message,
      collections: await ragEngine.qdrantService.client.getCollections().catch(() => ({ collections: [] }))
    });
  }
});

// Simple Qdrant test endpoint
app.post('/api/test-qdrant-search', async (req, res) => {
  try {
    if (!ragEngine.useQdrant) {
      return res.json({
        success: false,
        message: 'Qdrant is disabled'
      });
    }

    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    // Get embedding
    const queryEmbedding = await ragEngine.getCachedEmbedding(query);
    
    // Direct Qdrant search with very low threshold
    const qdrantResults = await ragEngine.qdrantService.client.search('rag_chunks', {
      vector: queryEmbedding,
      limit: 10,
      score_threshold: 0.01, // Very low threshold
      with_payload: true,
      with_vector: false
    });

    res.json({
      success: true,
      query: query,
      embeddingLength: queryEmbedding.length,
      resultsCount: qdrantResults.length,
      results: qdrantResults.map(r => ({
        id: r.id,
        score: r.score,
        title: r.payload?.title || 'No title',
        textPreview: r.payload?.text?.substring(0, 100) || 'No text',
        payloadKeys: Object.keys(r.payload || {})
      }))
    });

  } catch (error) {
    logger.error('Qdrant test search failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test RAG engine search method directly
app.post('/api/test-rag-search', async (req, res) => {
  try {
    const { query, threshold } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    console.log('=== RAG SEARCH TEST START ===');
    console.log('Query:', query);
    console.log('Threshold:', threshold);
    console.log('useQdrant:', ragEngine.useQdrant);
    console.log('isInitialized:', ragEngine.isInitialized);

    // Test the optimizedSemanticSearch method directly
    const queryAnalysis = ragEngine.queryOptimizer.analyzeQuery(query);
    console.log('Query analysis:', JSON.stringify(queryAnalysis, null, 2));

    const thresholdUsed = ragEngine.adjustThreshold(queryAnalysis);
    console.log('Original threshold:', ragEngine.similarityThreshold);
    console.log('Adjusted threshold:', thresholdUsed);

    // Call the optimizedSemanticSearch method directly
    console.log('Calling optimizedSemanticSearch...');
    const results = await ragEngine.optimizedSemanticSearch(query, 5, null, queryAnalysis);
    console.log('Results count:', results.length);
    console.log('Sample results:', results.slice(0, 2));

    console.log('=== RAG SEARCH TEST END ===');

    res.json({
      success: true,
      query: query,
      threshold: threshold,
      thresholdUsed: thresholdUsed,
      queryAnalysis: queryAnalysis,
      resultCount: results.length,
      results: results.map(r => ({
        id: r.id,
        similarity: r.similarity,
        title: r.metadata?.title || 'No title',
        textPreview: r.text?.substring(0, 100) || 'No text'
      }))
    });

  } catch (error) {
    console.error('RAG search test failed:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test RAG engine main search method (same as chat service uses)
app.post('/api/test-rag-main-search', async (req, res) => {
  try {
    const { query } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    console.log('=== RAG MAIN SEARCH TEST START ===');
    console.log('Query:', query);
    console.log('Strategy: hybrid');
    console.log('Source filter: all');
    console.log('Max chunks: 5');

    // Call the main search method with same parameters as chat service
    const results = await ragEngine.search(query, 'hybrid', [], 5, 'all');
    
    console.log('Main search results count:', results.length);
    console.log('Sample results:', results.slice(0, 2));
    console.log('=== RAG MAIN SEARCH TEST END ===');

    res.json({
      success: true,
      query: query,
      resultCount: results.length,
      results: results.map(r => ({
        id: r.id,
        similarity: r.similarity,
        title: r.metadata?.title || 'No title',
        textPreview: r.text?.substring(0, 100) || 'No text'
      }))
    });

  } catch (error) {
    console.error('RAG main search test failed:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Recreate Qdrant collection endpoint
app.post('/api/recreate-qdrant', async (req, res) => {
  try {
    if (!ragEngine.useQdrant) {
      return res.json({
        success: false,
        message: 'Qdrant is disabled'
      });
    }

    await ragEngine.qdrantService.recreateCollection();
    
    res.json({
      success: true,
      message: 'Qdrant collection recreated successfully'
    });
  } catch (error) {
    logger.error('Failed to recreate Qdrant collection', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test search strategies endpoint
app.post('/api/test-search', async (req, res) => {
  try {
    const { query, strategies } = req.body;

    if (!query || query.trim().length === 0) {
      return res.status(400).json({
        error: 'Query is required',
        code: 'MISSING_QUERY'
      });
    }

    const results = await chatService.testQuery(
      query.trim(),
      strategies || ['semantic', 'keyword', 'hybrid', 'contextual']
    );

    res.json({
      success: true,
      query,
      results,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Test search error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Search test failed',
      message: error.message
    });
  }
});

// Get conversation history
app.get('/api/conversation/:id', (req, res) => {
  try {
    const { id } = req.params;
    const history = chatService.exportHistory(id);

    res.json({
      success: true,
      ...history
    });

  } catch (error) {
    console.error('Get conversation error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get conversation',
      message: error.message
    });
  }
});

// Clear conversation history
app.delete('/api/conversation/:id', (req, res) => {
  try {
    const { id } = req.params;
    chatService.clearHistory(id);

    res.json({
      success: true,
      message: 'Conversation history cleared'
    });

  } catch (error) {
    console.error('Clear conversation error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to clear conversation',
      message: error.message
    });
  }
});

// Rate response endpoint
app.post('/api/conversation/:id/rate', [
  body('messageId')
    .isLength({ min: 1 })
    .withMessage('Message ID is required'),
  body('rating')
    .isIn([1, -1])
    .withMessage('Rating must be 1 (thumbs up) or -1 (thumbs down)'),
  body('feedback')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Feedback must be less than 500 characters')
], (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        error: 'Validation failed',
        details: errors.array()
      });
    }

    const { id } = req.params;
    const { messageId, rating, feedback } = req.body;

    const success = chatService.rateResponse(id, messageId, rating, feedback);

    if (success) {
      res.json({
        success: true,
        message: 'Response rated successfully'
      });
    } else {
      res.status(404).json({
        success: false,
        error: 'Message not found or invalid'
      });
    }

  } catch (error) {
    console.error('Rate response error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to rate response',
      message: error.message
    });
  }
});

// Search conversations endpoint
app.get('/api/conversations/search', [
  body('query')
    .optional()
    .isLength({ min: 1, max: 200 })
    .withMessage('Query must be between 1 and 200 characters')
], (req, res) => {
  try {
    const { query, limit = 10 } = req.query;

    if (!query || query.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Search query is required'
      });
    }

    const results = chatService.searchConversations(query, parseInt(limit));

    res.json({
      success: true,
      query,
      results,
      count: results.length
    });

  } catch (error) {
    console.error('Search conversations error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to search conversations',
      message: error.message
    });
  }
});

// Get conversation list endpoint
app.get('/api/conversations', (req, res) => {
  try {
    const { limit = 20 } = req.query;
    const conversations = chatService.getConversationList(parseInt(limit));

    res.json({
      success: true,
      conversations,
      count: conversations.length
    });

  } catch (error) {
    console.error('Get conversations error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get conversations',
      message: error.message
    });
  }
});

// Get specific conversation details
app.get('/api/conversation/:id/details', (req, res) => {
  try {
    const { id } = req.params;
    const conversation = chatService.getConversationById(id);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found'
      });
    }

    res.json({
      success: true,
      conversation
    });

  } catch (error) {
    console.error('Get conversation details error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get conversation details',
      message: error.message
    });
  }
});

// Generate contextual suggestions
app.get('/api/conversation/:id/suggestions', (req, res) => {
  try {
    const { id } = req.params;
    const suggestions = chatService.generateContextualSuggestions(id);

    res.json({
      success: true,
      suggestions,
      conversationId: id
    });

  } catch (error) {
    console.error('Generate suggestions error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to generate suggestions',
      message: error.message
    });
  }
});

// Analyze conversation endpoint
app.get('/api/conversation/:id/analysis', async (req, res) => {
  try {
    const { id } = req.params;
    const analysis = await chatService.analyzeConversation(id);

    if (!analysis) {
      return res.status(404).json({
        success: false,
        error: 'Conversation not found'
      });
    }

    res.json({
      success: true,
      analysis
    });

  } catch (error) {
    console.error('Analyze conversation error:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to analyze conversation',
      message: error.message
    });
  }
});


// Export conversation endpoint
app.get('/api/conversation/:id/export', (req, res) => {
  try {
    const { id } = req.params;
    const { format = 'json' } = req.query;
    
    const history = chatService.getConversationHistory(id);
    
    if (history.length === 0) {
      return res.status(404).json({
        error: 'Conversation not found',
        code: 'CONVERSATION_NOT_FOUND'
      });
    }

    const exportResult = conversationExport.exportConversation(id, history, format);

    res.json({
      success: true,
      message: 'Conversation exported successfully',
      ...exportResult,
      downloadUrl: `/api/conversation/${id}/download/${exportResult.filename}`
    });

  } catch (error) {
    logger.error('Conversation export failed', {
      conversationId: req.params.id,
      error: error.message
    });

    res.status(500).json({
      success: false,
      error: 'Export failed',
      message: error.message
    });
  }
});

// Download exported conversation
app.get('/api/conversation/:id/download/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    const filePath = path.join(conversationExport.exportDir, filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        error: 'File not found',
        code: 'FILE_NOT_FOUND'
      });
    }

    res.download(filePath, filename);

  } catch (error) {
    logger.error('File download failed', {
      filename: req.params.filename,
      error: error.message
    });

    res.status(500).json({
      success: false,
      error: 'Download failed',
      message: error.message
    });
  }
});

// Get export history
app.get('/api/exports', (req, res) => {
  try {
    const exports = conversationExport.getExportHistory();
    
    res.json({
      success: true,
      exports,
      count: exports.length
    });

  } catch (error) {
    logger.error('Get exports failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get exports',
      message: error.message
    });
  }
});

// Delete export
app.delete('/api/exports/:filename', (req, res) => {
  try {
    const { filename } = req.params;
    conversationExport.deleteExport(filename);
    
    res.json({
      success: true,
      message: 'Export deleted successfully'
    });

  } catch (error) {
    logger.error('Delete export failed', {
      filename: req.params.filename,
      error: error.message
    });

    res.status(500).json({
      success: false,
      error: 'Delete failed',
      message: error.message
    });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method
  });
  
  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR'
  });
});

// 404 handler
app.use((req, res) => {
  logger.warn('404 Not Found', {
    url: req.url,
    method: req.method,
    ip: req.ip
  });
  
  res.status(404).json({
    error: 'Endpoint not found',
    code: 'NOT_FOUND'
  });
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('🛑 SIGTERM received, shutting down gracefully');
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('🛑 SIGINT received, shutting down gracefully');
  process.exit(0);
});

// Start server
app.listen(PORT, '0.0.0.0', async () => {
  logger.info('🚀 AI Chatbot RAG server started', {
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
    pid: process.pid
  });
  
  console.log(`🚀 AI Chatbot RAG server running on port ${PORT}`);
  console.log(`📱 Chat interface: http://localhost:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`🔍 Health check: http://localhost:${PORT}/api/health`);

  // Initialize knowledge base in background
  initializeKnowledgeBase().catch(error => {
    logger.error('Background initialization failed', { error: error.message });
  });
});

export default app;