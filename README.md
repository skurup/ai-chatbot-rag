# AI Chatbot with Advanced RAG 🤖

A production-ready conversational AI chatbot built with **Retrieval-Augmented Generation (RAG)** capabilities. The system scrapes websites, processes content into vector embeddings, and uses advanced retrieval strategies to provide accurate, context-aware responses with source attribution.

## ✨ **Latest Enhancements**

- 🚀 **Advanced RAG Accuracy Improvements** - Query expansion, result diversity, metadata boosting, and BM25 hybrid ranking
- 🗄️ **Qdrant Vector Database Integration** - High-performance vector storage and retrieval
- 📊 **Enhanced Citation System** - Rich citations with confidence scoring and keyword highlighting
- 🎯 **Advanced Source Filtering** - Filter by brand/domain (Atlan, Snowflake, Databricks)
- 🔄 **Recursive Web Scraping** - Intelligent link following with depth control and URL tracking
- 📁 **File Upload Support** - Process TXT, DOCX, DOC, PDF, and RTF documents
- 📤 **Conversation Export** - Export chat history in JSON, TXT, CSV, and Markdown formats
- 🔍 **Multi-Strategy Search** - Semantic, keyword, hybrid, and contextual search with intelligent fallbacks
- 📈 **Comprehensive Analytics** - Real-time monitoring, health checks, and performance metrics
- 🛡️ **Production Security** - Helmet.js, rate limiting, input validation, and structured logging

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![OpenAI](https://img.shields.io/badge/OpenAI-API-blue.svg)](https://openai.com/)
[![Express.js](https://img.shields.io/badge/Express.js-4.18+-lightgrey.svg)](https://expressjs.com/)
[![Qdrant](https://img.shields.io/badge/Qdrant-Vector%20DB-orange.svg)](https://qdrant.tech/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 🚀 Quick Start

### Prerequisites

- **Node.js 18+** with ES6 module support
- **OpenAI API key** with sufficient credits
- **Qdrant Vector Database** (optional - Docker recommended)
- **1GB+ RAM** for embedding storage and vector operations
- **Internet connection** for web scraping

### Installation

1. **Clone and setup:**
```bash
git clone <your-repo-url>
cd ai-chatbot-rag
npm install
```

2. **Setup Qdrant (Optional but Recommended):**
```bash
# Using Docker (recommended)
docker run -p 6333:6333 qdrant/qdrant

# Or using Docker Compose
docker-compose up -d qdrant
```

3. **Configure environment:**
```bash
cp .env.example .env
# Edit .env with your OpenAI API key and Qdrant settings
```

4. **Configure URLs to scrape:**
```javascript
// Edit config/urls.js
export const URLS_TO_SCRAPE = [
  'https://docs.atlan.com',
  'https://docs.snowflake.com',
  'https://docs.databricks.com'
];
```

5. **Start the application:**
```bash
# Using startup script (recommended - includes log management)
./startup.sh start

# Development mode with auto-restart
npm run dev

# Production mode
npm start
```

6. **Access the application:**
- **Chat Interface:** http://localhost:3000
- **Analytics Dashboard:** http://localhost:3000/dashboard
- **Health Check:** http://localhost:3000/api/health
- **Qdrant Dashboard:** http://localhost:6333/dashboard

## 🏗️ Architecture Overview

### Core Components

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Web Scraper   │───▶│   RAG Engine    │───▶│  Chat Service   │
│  (Axios+Cheerio)│    │ (Multi-Strategy)│    │   (OpenAI)      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│  Content Store  │    │  Vector Store   │    │ Conversation    │
│   (Metadata)    │    │   (Qdrant)      │    │    History      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│ URL Tracking    │    │ Enhanced        │    │ File Upload     │
│ (Persistent)    │    │ Citations       │    │ & Export        │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### RAG Pipeline

```
1. Content Ingestion → Recursive web scraping with URL tracking
2. Text Processing  → Smart chunking with sentence boundaries
3. Embedding        → OpenAI text-embedding-ada-002 (1536 dimensions)
4. Storage          → Qdrant vector database with fallback to in-memory
5. Retrieval        → Multi-strategy search with intelligent fallbacks
6. Filtering        → Brand/domain-based source filtering
7. Generation       → OpenAI GPT with context-augmented prompts
8. Response         → Enhanced citations with confidence scoring
9. Export           → Conversation history and file processing
```

## 🧠 RAG Capabilities

### Multiple Retrieval Strategies

| Strategy | Description | Best For | Qdrant Support |
|----------|-------------|----------|----------------|
| **Semantic** | Vector similarity search | Conceptual understanding | ✅ Native |
| **Keyword** | Term frequency matching | Exact term matches | ✅ Fallback |
| **Hybrid** | Combined semantic + keyword (70%/30%) | Balanced accuracy | ✅ Optimized |
| **Contextual** | Conversation history-aware | Follow-up questions | ✅ Enhanced |

### Advanced Features

- **Smart Chunking:** Sentence-boundary aware with configurable overlap
- **Content Filtering:** Removes navigation, ads, and irrelevant elements
- **Enhanced Citations:** Rich metadata with confidence scores and keyword highlighting
- **Source Filtering:** Filter by brand/domain (Atlan, Snowflake, Databricks)
- **URL Tracking:** Persistent tracking to prevent re-scraping
- **Recursive Scraping:** Intelligent link following with depth control
- **File Processing:** Support for TXT, DOCX, and DOC documents
- **Conversation Export:** Multiple export formats (JSON, TXT, CSV, Markdown)
- **Vector Database:** High-performance Qdrant integration with fallback
- **Intelligent Fallbacks:** Automatic strategy switching for optimal results

### 🎯 **RAG Accuracy Improvements**

- **Query Expansion:** Automatic synonym expansion with 19 domain-specific synonym groups (connect→integration/setup/configure)
- **Result Diversity:** Smart deduplication with source diversity (max 2 per domain), URL path filtering, and text similarity detection
- **Metadata Boosting:** Advanced relevance scoring based on source authority (1.2x official docs), content type (1.15x tutorials), query-specific boosts, recency weighting, and structural position
- **BM25 Hybrid Ranking:** Combines semantic similarity (70%) with BM25 keyword matching (30%) for balanced accuracy
- **Enhanced Configuration:** Optimized chunk size (750), overlap (100), similarity threshold (0.6), and result count (7) for better performance

## 📁 Project Structure

```
ai-chatbot-rag/
├── server.js              # Main Express server with RAG integration
├── startup.sh             # Production startup script with log management
├── log-manager.sh         # Independent log rotation and cleanup daemon
├── package.json           # Dependencies and scripts
├── .env.example           # Environment configuration template
├── .gitignore            # Git ignore rules
├── LICENSE               # MIT License
├── src/                  # Core backend modules
│   ├── scraper.js        # Recursive web scraping with URL tracking
│   ├── embeddings.js     # Vector embedding creation and similarity
│   ├── rag.js           # Advanced RAG engine with Qdrant integration
│   ├── chat.js          # Chat logic with OpenAI integration
│   ├── qdrantService.js # Qdrant vector database service
│   ├── citationManager.js # Enhanced citation generation
│   ├── queryOptimizer.js # Query preprocessing and optimization
│   ├── fileProcessor.js # File upload processing (TXT, DOCX, DOC)
│   ├── conversationExport.js # Conversation export functionality
│   ├── urlTracker.js     # Persistent URL tracking
│   └── logger.js        # Structured logging with Winston
├── config/
│   └── urls.js          # Configurable URLs for scraping
├── scripts/
│   └── scrape.js        # Manual scraping utility
├── public/              # Frontend assets
│   ├── index.html       # Main chat interface with enhanced citations
│   ├── style.css        # Complete responsive styling
│   ├── script.js        # Frontend JavaScript logic
│   └── rag-dashboard.html # Analytics and testing dashboard
├── data/                # Persistent data storage
│   └── scraped_urls.json # URL tracking data
├── logs/                # Application logs
├── uploads/             # User uploaded files
└── exports/             # Exported conversation files
```

## 🛠️ API Reference

### Chat Endpoints

### Chat Endpoints

#### `POST /api/chat`
Send message and get AI response with enhanced citations.

```javascript
// Request
{
  "message": "What is artificial intelligence?",
  "conversationId": "optional-conversation-id",
  "searchStrategy": "hybrid", // semantic, keyword, hybrid, contextual
  "sourceFilter": "all" // all, Atlan, Snowflake, Databricks
}

// Response
{
  "success": true,
  "response": "AI response with context",
  "sources": [
    {
      "url": "https://source.com",
      "title": "Source Title",
      "similarity": 0.85,
      "chunks": 2
    }
  ],
  "citations": {
    "citations": [
      {
        "id": "citation_123",
        "source": {
          "title": "Source Title",
          "url": "https://source.com",
          "type": "documentation",
          "domain": "docs.example.com"
        },
        "content": {
          "text": "Content excerpt...",
          "excerpt": "Highlighted excerpt...",
          "wordCount": 150,
          "chunkIndex": 0,
          "totalChunks": 5
        },
        "relevance": {
          "similarity": 0.85,
          "confidence": 0.92,
          "matchType": "semantic_match",
          "keywords": ["artificial", "intelligence"]
        },
        "highlights": [
          {"word": "artificial", "position": 10, "length": 10}
        ]
      }
    ],
    "summary": {
      "totalSources": 3,
      "uniqueDomains": 2,
      "confidence": 0.89,
      "coverage": 0.75,
      "sourceTypes": {"documentation": 3}
    }
  },
  "retrievedChunks": 5,
  "searchStrategy": "hybrid",
  "conversationId": "chat_123",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "usage": {
    "prompt_tokens": 500,
    "completion_tokens": 100,
    "total_tokens": 600
  },
  "processingTime": 1500
}
```

### Management Endpoints

#### `GET /api/health`
System status and knowledge base metrics with Qdrant health check.

#### `GET /api/stats`
Detailed system statistics including vector database metrics.

#### `GET /api/sources`
Get available sources with brand filtering options.

#### `POST /api/scrape`
Trigger manual content re-scraping with recursive options.

#### `POST /api/add-url`
Add single URL to knowledge base with recursive scraping.

```javascript
// Request
{
  "url": "https://new-source.com"
}

// Response
{
  "success": true,
  "message": "URL and associated links scraped successfully",
  "stats": {
    "url": "https://new-source.com",
    "pagesScraped": 25,
    "totalChunks": 150,
    "wordCount": 45000,
    "pages": [
      {
        "title": "Page Title",
        "url": "https://new-source.com/page",
        "wordCount": 1200,
        "depth": 1
      }
    ]
  }
}
```

#### `POST /api/upload`
Upload and process documents (TXT, DOCX, DOC).

```javascript
// FormData request
const formData = new FormData();
formData.append('file', fileInput.files[0]);

// Response
{
  "success": true,
  "message": "File processed successfully",
  "document": {
    "filename": "document.pdf",
    "type": "application/pdf",
    "size": 1024000,
    "chunks": 15,
    "wordCount": 3000
  }
}
```

#### `GET /api/conversation/:id/export`
Export conversation history in multiple formats.

```javascript
// Query parameters
?format=json|txt|csv|markdown

// Response
{
  "success": true,
  "filename": "conversation_123.json",
  "downloadUrl": "/api/exports/conversation_123.json"
}
```

#### `GET /api/exports`
List all exported conversation files.

#### `GET /api/exports/:filename`
Download exported conversation file.

#### `DELETE /api/exports/:filename`
Delete exported conversation file.

#### `GET /api/url-tracking`
Get URL tracking statistics and tracked URLs.

#### `POST /api/url-tracking/clear`
Clear all tracked URLs.

#### `POST /api/url-tracking/remove`
Remove specific URL from tracking.

#### `POST /api/debug-search`
Debug search with custom threshold.

#### `GET /api/debug-kb`
Debug knowledge base state.

#### `GET /api/debug-qdrant`
Debug Qdrant collection and configuration.

#### `POST /api/recreate-qdrant`
Recreate Qdrant collection (for troubleshooting).

#### `POST /api/test-qdrant-search`
Direct Qdrant search test.

#### `POST /api/test-rag-search`
Direct RAG search test.

#### `POST /api/test-rag-main-search`
Direct main search method test.

## ⚙️ Configuration

### Environment Variables

```bash
# OpenAI Configuration
OPENAI_API_KEY=sk-your-openai-api-key-here

# Server Configuration
PORT=3000
NODE_ENV=development

# Scraping Configuration
SCRAPE_DELAY_MS=1000
MAX_CONTENT_LENGTH=50000
MIN_CONTENT_LENGTH=50
MAX_SCRAPE_DEPTH=3
MAX_SCRAPE_PAGES=100
FOLLOW_SAME_DOMAIN=true

# RAG Configuration (Optimized for Accuracy)
CHUNK_SIZE=750
CHUNK_OVERLAP=100
MAX_CHUNKS_PER_QUERY=7
SIMILARITY_THRESHOLD=0.6

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100000

# Qdrant Configuration (Optional - for vector database)
USE_QDRANT=true
QDRANT_URL=http://localhost:6333
QDRANT_API_KEY=
QDRANT_COLLECTION_NAME=rag_chunks
QDRANT_DISTANCE=Cosine
QDRANT_VECTOR_SIZE=1536

# Logging Configuration
LOG_LEVEL=info
LOG_FILE=logs/combined.log
```

### URL Configuration

Edit `config/urls.js` to customize scraping targets:

```javascript
export const URLS_TO_SCRAPE = [
  'https://docs.atlan.com',
  'https://docs.snowflake.com',
  'https://docs.databricks.com',
  'https://your-company.com/faq',
  'https://your-docs.com/api-reference'
];

// Custom selectors for specific domains
export const DOMAIN_SELECTORS = {
  'docs.atlan.com': {
    content: 'article, .docs-content, main',
    title: 'h1, .page-title, title',
    exclude: '.navigation, .sidebar, .ads'
  },
  'docs.snowflake.com': {
    content: '.content, .main-content, article',
    title: 'h1, .page-title',
    exclude: '.nav, .sidebar, .footer'
  },
  'docs.databricks.com': {
    content: '.content, .main-content, article',
    title: 'h1, .page-title',
    exclude: '.nav, .sidebar, .footer'
  }
};
```

## 🧪 Testing and Development

## 🧪 Testing and Development

### Manual Scraping

Run the manual scraping script to test your configuration:

```bash
# Basic scraping
npm run scrape

# With query testing
node scripts/scrape.js --test --query="What is AI?"
```

### Strategy Testing

Use the dashboard or API to test different retrieval strategies:

```bash
# Test semantic search
curl -X POST http://localhost:3000/api/test-rag-search \
  -H "Content-Type: application/json" \
  -d '{"query": "artificial intelligence", "threshold": 0.3}'

# Test Qdrant directly
curl -X POST http://localhost:3000/api/test-qdrant-search \
  -H "Content-Type: application/json" \
  -d '{"query": "artificial intelligence"}'

# Test main search pipeline
curl -X POST http://localhost:3000/api/test-rag-main-search \
  -H "Content-Type: application/json" \
  -d '{"query": "artificial intelligence"}'
```

### Debugging Tools

Access debugging endpoints for troubleshooting:

```bash
# Check knowledge base state
curl http://localhost:3000/api/debug-kb

# Check Qdrant status
curl http://localhost:3000/api/debug-qdrant

# Test with custom threshold
curl -X POST http://localhost:3000/api/debug-search \
  -H "Content-Type: application/json" \
  -d '{"query": "test query", "threshold": 0.1}'

# Recreate Qdrant collection (if needed)
curl -X POST http://localhost:3000/api/recreate-qdrant
```

### Development Mode

Start with auto-restart for development:

```bash
npm run dev
```

## 🎨 User Interface

## 🎨 User Interface

### Chat Interface Features

- **Real-time Messaging:** Instant responses with typing indicators
- **Enhanced Citations:** Rich citation sidebar with confidence scores and keyword highlighting
- **Source Filtering:** Filter by brand/domain (Atlan, Snowflake, Databricks)
- **Strategy Selection:** Choose retrieval method (semantic/keyword/hybrid/contextual)
- **Conversation History:** Persistent chat sessions with export options
- **File Upload:** Drag-and-drop document processing (TXT, DOCX, DOC)
- **Responsive Design:** Mobile-friendly interface with modern UI
- **Character Limits:** Input validation and word count
- **Citation Export:** Export citations in multiple formats

### Analytics Dashboard

- **System Monitoring:** Health, uptime, memory usage, Qdrant status
- **Knowledge Base Stats:** Chunks, sources, embeddings, vector database metrics
- **Strategy Testing:** Compare retrieval methods with real-time results
- **Manual Management:** Trigger scraping, add URLs, manage sources
- **Real-time Logs:** System activity monitoring with structured logging
- **Debug Tools:** Direct access to debugging endpoints
- **URL Tracking:** Monitor scraped URLs and manage tracking
- **Export Management:** View and manage exported conversation files

## 🚀 Deployment

### Production Startup Scripts

The project includes comprehensive startup scripts for production deployment:

#### `startup.sh` - Main System Controller

```bash
# Start complete system (log manager, Qdrant, application)
./startup.sh start

# Stop services (preserves log manager option)
./startup.sh stop

# Restart entire system
./startup.sh restart

# Check system status
./startup.sh status

# View logs
./startup.sh logs app      # Application logs
./startup.sh logs qdrant   # Qdrant logs
./startup.sh logs manager  # Log manager logs
```

**Features:**
- ✅ **Automated startup order**: Log Manager → Qdrant → Application
- ✅ **Proper shutdown order**: Application → Qdrant → Log Manager (optional)
- ✅ **Conflict detection**: Prevents duplicate services on same ports
- ✅ **Health verification**: Checks both port binding and HTTP health
- ✅ **Docker integration**: Manages Qdrant containers with persistent storage
- ✅ **Process management**: PID files and graceful shutdowns

#### `log-manager.sh` - Log Management Daemon

```bash
# Start log management daemon
./log-manager.sh start

# Stop daemon
./log-manager.sh stop

# Check daemon status
./log-manager.sh status

# Manual log rotation
./log-manager.sh rotate
```

**Features:**
- ✅ **Independent operation**: Runs separately from main application
- ✅ **Automatic rotation**: Every 3 hours with microsecond timestamps
- ✅ **Compression**: Rotated logs are gzipped to save space
- ✅ **Retention policy**: 24-hour automatic cleanup
- ✅ **Conflict prevention**: Lock files prevent simultaneous operations
- ✅ **Zero downtime**: Copy-then-truncate prevents service interruption

### Local Development

```bash
npm run dev
```

### Production

```bash
# Using startup script (recommended)
./startup.sh start

# Or manual mode
export NODE_ENV=production
npm start
```

### Cloud Platforms

#### Vercel

```bash
npm install -g vercel
vercel --prod
```

#### Railway

```bash
npm install -g @railway/cli
railway login
railway deploy
```

#### Heroku

```bash
git add .
git commit -m "Deploy to Heroku"
git push heroku main
```

#### DigitalOcean App Platform

Create `app.yaml`:

```yaml
name: ai-chatbot-rag
services:
- name: web
  source_dir: /
  github:
    repo: your-username/ai-chatbot-rag
    branch: main
  run_command: npm start
  environment_slug: node-js
  instance_count: 1
  instance_size_slug: basic-xxs
  envs:
  - key: OPENAI_API_KEY
    value: ${OPENAI_API_KEY}
```

### Environment Variables for Production

Set these in your hosting platform:

```bash
OPENAI_API_KEY=sk-your-production-key
NODE_ENV=production
PORT=3000
```

## 🔧 Customization

### Adding New Content Sources

1. **Add URLs to config:**
```javascript
// config/urls.js
export const URLS_TO_SCRAPE = [
  ...existing_urls,
  'https://new-source.com'
];
```

2. **Custom selectors (optional):**
```javascript
export const DOMAIN_SELECTORS = {
  'new-source.com': {
    content: '.main-content',
    title: 'h1.title',
    exclude: '.ads, .sidebar'
  }
};
```

3. **Trigger re-scraping:**
```bash
npm run scrape
# or via dashboard
```

### Modifying RAG Behavior

Edit environment variables or update the RAG engine:

```javascript
// src/rag.js
this.chunkSize = 500;              // Adjust chunk size
this.similarityThreshold = 0.7;    // Adjust similarity threshold
```

### Customizing UI

Edit the CSS variables in `public/style.css`:

```css
:root {
  --primary-color: #667eea;    /* Change theme color */
  --border-radius: 8px;        /* Adjust border radius */
  --font-family: 'Your Font';  /* Change font */
}
```

## 📊 Performance Optimization

### Memory Management

- **Embedding Cache:** Automatic caching of computed embeddings
- **Conversation Limits:** Configurable history length
- **Chunk Optimization:** Sentence-boundary aware chunking

### API Efficiency

- **Batch Processing:** Multiple embeddings in single request
- **Rate Limiting:** Configurable per-IP limits
- **Request Caching:** Intelligent caching strategies

### Scaling Considerations

For production deployment with high traffic:

1. **Database Integration:** Replace in-memory storage with Pinecone/Weaviate
2. **Load Balancing:** Multiple server instances
3. **Caching Layer:** Redis for session management
4. **CDN:** Static asset distribution

## 🔒 Security Features

### Built-in Protection

- **Helmet.js:** Security headers and CSP
- **Rate Limiting:** Per-IP request throttling
- **Input Validation:** Message length and content filtering
- **CORS Protection:** Configurable cross-origin policies

### Additional Security

For production deployment:

```javascript
// Add to server.js
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      // ... customize for your needs
    }
  }
}));
```

## 🐛 Troubleshooting

### Common Issues

#### "OpenAI API key not found"
```bash
# Check environment file
cat .env
# Ensure OPENAI_API_KEY is set
```

#### "No documents scraped"
```bash
# Check URL configuration
node scripts/scrape.js
# Verify URLs are accessible
```

#### "High memory usage"
```bash
# Reduce chunk size or clear cache
# Edit .env:
CHUNK_SIZE=300
MAX_CHUNKS_PER_QUERY=3
```

#### "Slow responses"
```bash
# Optimize similarity threshold
SIMILARITY_THRESHOLD=0.8
# Reduce context size
MAX_CHUNKS_PER_QUERY=3
```

### Debug Mode

Enable verbose logging:

```bash
DEBUG=* npm run dev
```

### Health Monitoring

Check system status:

```bash
curl http://localhost:3000/api/health
```

## 🤝 Contributing

### Development Setup

1. Fork the repository
2. Create feature branch: `git checkout -b feature-name`
3. Make changes and test
4. Commit: `git commit -m 'Add feature'`
5. Push: `git push origin feature-name`
6. Submit pull request

### Code Style

- Use ES6 modules
- Follow JSDoc comments
- Maintain consistent formatting
- Add error handling

### Testing

```bash
# Test scraping
npm run scrape -- --test

# Test API endpoints
curl -X POST http://localhost:3000/api/test-search \
  -H "Content-Type: application/json" \
  -d '{"query": "test"}'
```

## 📋 TODO / Roadmap

### ✅ Completed Features

- [x] **Advanced RAG Accuracy Improvements** - Query expansion, result diversity, metadata boosting, BM25 hybrid ranking
- [x] **Qdrant Vector Database Integration** - High-performance vector storage
- [x] **Enhanced Citation System** - Rich citations with confidence scoring
- [x] **Source Filtering** - Brand/domain-based filtering (Atlan, Snowflake, Databricks)
- [x] **Recursive Web Scraping** - Intelligent link following with URL tracking
- [x] **File Upload Support** - TXT, DOCX, DOC, PDF, RTF document processing
- [x] **Conversation Export** - Multiple export formats (JSON, TXT, CSV, Markdown)
- [x] **Multi-Strategy Search** - Semantic, keyword, hybrid, contextual with fallbacks
- [x] **Comprehensive Logging** - Structured logging with Winston
- [x] **Production Security** - Helmet.js, rate limiting, input validation
- [x] **Debug Tools** - Comprehensive debugging endpoints and monitoring

### 🚧 In Progress / Next Phase

- [ ] **User Authentication** - JWT-based authentication and sessions
- [ ] **PDF Processing** - Enhanced PDF document support
- [ ] **Mobile App** - React Native mobile application
- [ ] **Advanced Analytics** - Detailed usage analytics and insights
- [ ] **Webhook Integrations** - Real-time notifications and integrations

### 🔮 Future Enhancements

- [ ] **Multi-modal Processing** - Images, videos, and multimedia content
- [ ] **Real-time Collaboration** - Multi-user chat sessions
- [ ] **Enterprise SSO** - SAML, OAuth, LDAP integration
- [ ] **Custom Model Fine-tuning** - Domain-specific model training
- [ ] **Advanced Caching** - Redis-based intelligent caching
- [ ] **Streaming Responses** - Real-time response streaming
- [ ] **Background Processing** - Queue-based job processing
- [ ] **CDN Integration** - Global content distribution

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **OpenAI** for GPT and embedding models
- **Qdrant** for high-performance vector database
- **Express.js** for the web framework
- **Cheerio** for HTML parsing
- **Winston** for structured logging
- **Helmet.js** for security features
- **Node.js** community for excellent packages

## 📞 Support

For issues and questions:

1. Check the [troubleshooting section](#-troubleshooting)
2. Search existing [GitHub issues](https://github.com/your-repo/issues)
3. Create a new issue with detailed information
4. Join our [community discussions](https://github.com/your-repo/discussions)

---

**Built with ❤️ for the AI community**

*Ready to deploy your own AI-powered knowledge assistant!*