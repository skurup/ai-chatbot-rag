# AI Chatbot with Advanced RAG 🤖

A production-ready conversational AI chatbot built with **Retrieval-Augmented Generation (RAG)** capabilities. The system scrapes websites, processes content into vector embeddings, and uses advanced retrieval strategies to provide accurate, context-aware responses with source attribution.

[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![OpenAI](https://img.shields.io/badge/OpenAI-API-blue.svg)](https://openai.com/)
[![Express.js](https://img.shields.io/badge/Express.js-4.18+-lightgrey.svg)](https://expressjs.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 🚀 Quick Start

### Prerequisites

- **Node.js 18+** with ES6 module support
- **OpenAI API key** with sufficient credits
- **512MB+ RAM** for embedding storage
- **Internet connection** for web scraping

### Installation

1. **Clone and setup:**
```bash
git clone <your-repo-url>
cd ai-chatbot-rag
npm install
```

2. **Configure environment:**
```bash
cp .env.example .env
# Edit .env with your OpenAI API key
```

3. **Configure URLs to scrape:**
```javascript
// Edit config/urls.js
export const URLS_TO_SCRAPE = [
  'https://your-docs.com',
  'https://your-faq.com'
];
```

4. **Start the application:**
```bash
# Development mode with auto-restart
npm run dev

# Production mode
npm start
```

5. **Access the application:**
- **Chat Interface:** http://localhost:3000
- **Analytics Dashboard:** http://localhost:3000/dashboard
- **Health Check:** http://localhost:3000/api/health

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
│   (Metadata)    │    │  (Embeddings)   │    │    History      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### RAG Pipeline

```
1. Content Ingestion → Web scraping with intelligent extraction
2. Text Processing  → Smart chunking with sentence boundaries
3. Embedding        → OpenAI text-embedding-ada-002
4. Storage          → In-memory vector store
5. Retrieval        → Multi-strategy search (semantic/keyword/hybrid/contextual)
6. Generation       → OpenAI GPT with context-augmented prompts
7. Response         → Formatted output with source citations
```

## 🧠 RAG Capabilities

### Multiple Retrieval Strategies

| Strategy | Description | Best For |
|----------|-------------|----------|
| **Semantic** | Vector similarity search | Conceptual understanding |
| **Keyword** | Term frequency matching | Exact term matches |
| **Hybrid** | Combined semantic + keyword (70%/30%) | Balanced accuracy |
| **Contextual** | Conversation history-aware | Follow-up questions |

### Advanced Features

- **Smart Chunking:** Sentence-boundary aware with configurable overlap
- **Content Filtering:** Removes navigation, ads, and irrelevant elements
- **Source Attribution:** Automatic citation with relevance scores
- **Context Assembly:** Token-aware context building from retrieved chunks
- **Conversation Memory:** Maintains context across multiple exchanges

## 📁 Project Structure

```
ai-chatbot-rag/
├── server.js              # Main Express server with RAG integration
├── package.json           # Dependencies and scripts
├── .env.example           # Environment configuration template
├── src/                   # Core backend modules
│   ├── scraper.js         # Web scraping with content extraction
│   ├── embeddings.js      # Vector embedding creation and similarity
│   ├── rag.js            # Advanced RAG engine with multiple strategies
│   └── chat.js           # Chat logic with OpenAI integration
├── config/
│   └── urls.js           # Configurable URLs for scraping
├── scripts/
│   └── scrape.js         # Manual scraping utility
└── public/               # Frontend assets
    ├── index.html        # Main chat interface
    ├── style.css         # Complete responsive styling
    ├── script.js         # Frontend JavaScript logic
    └── rag-dashboard.html # Analytics and testing dashboard
```

## 🛠️ API Reference

### Chat Endpoints

#### `POST /api/chat`
Send message and get AI response with sources.

```javascript
// Request
{
  "message": "What is artificial intelligence?",
  "conversationId": "optional-conversation-id",
  "searchStrategy": "hybrid" // semantic, keyword, hybrid, contextual
}

// Response
{
  "success": true,
  "response": "AI response with context",
  "sources": [
    {
      "url": "https://source.com",
      "title": "Source Title",
      "similarity": 0.85
    }
  ],
  "retrievedChunks": 5,
  "searchStrategy": "hybrid",
  "conversationId": "chat_123",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

### Management Endpoints

#### `GET /api/health`
System status and knowledge base metrics.

#### `POST /api/scrape`
Trigger manual content re-scraping.

#### `POST /api/add-url`
Add single URL to knowledge base.

```javascript
// Request
{
  "url": "https://new-source.com"
}
```

#### `POST /api/test-search`
Test different search strategies.

```javascript
// Request
{
  "query": "test query",
  "strategies": ["semantic", "keyword", "hybrid"]
}
```

#### `GET /api/stats`
Detailed system statistics.

#### `GET /api/conversation/:id`
Export conversation history.

#### `DELETE /api/conversation/:id`
Clear conversation history.

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
MAX_CONTENT_LENGTH=10000
MIN_CONTENT_LENGTH=100

# RAG Configuration
CHUNK_SIZE=500
CHUNK_OVERLAP=50
MAX_CHUNKS_PER_QUERY=5
SIMILARITY_THRESHOLD=0.7

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
```

### URL Configuration

Edit `config/urls.js` to customize scraping targets:

```javascript
export const URLS_TO_SCRAPE = [
  'https://docs.openai.com/docs/introduction',
  'https://your-company.com/faq',
  'https://your-docs.com/api-reference'
];

// Custom selectors for specific domains
export const DOMAIN_SELECTORS = {
  'docs.openai.com': {
    content: 'article, .docs-content',
    title: 'h1, .page-title',
    exclude: '.navigation, .sidebar'
  }
};
```

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
curl -X POST http://localhost:3000/api/test-search \
  -H "Content-Type: application/json" \
  -d '{"query": "artificial intelligence"}'
```

### Development Mode

Start with auto-restart for development:

```bash
npm run dev
```

## 🎨 User Interface

### Chat Interface Features

- **Real-time Messaging:** Instant responses with typing indicators
- **Source Citations:** Clickable links with relevance scores
- **Strategy Selection:** Choose retrieval method (semantic/keyword/hybrid/contextual)
- **Conversation History:** Persistent chat sessions
- **Responsive Design:** Mobile-friendly interface
- **Character Limits:** Input validation and word count

### Analytics Dashboard

- **System Monitoring:** Health, uptime, memory usage
- **Knowledge Base Stats:** Chunks, sources, embeddings
- **Strategy Testing:** Compare retrieval methods
- **Manual Management:** Trigger scraping, add URLs
- **Real-time Logs:** System activity monitoring

## 🚀 Deployment

### Local Development

```bash
npm run dev
```

### Production

```bash
# Set production environment
export NODE_ENV=production

# Start server
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

### Immediate Enhancements

- [ ] Vector database integration (Pinecone, Weaviate)
- [ ] User authentication and sessions
- [ ] File upload capabilities (PDF, DOCX)
- [ ] Conversation export/import
- [ ] Mobile app (React Native)

### Advanced Features

- [ ] Multi-modal content processing (images, videos)
- [ ] Real-time collaborative features
- [ ] Advanced analytics and insights
- [ ] Enterprise SSO integration
- [ ] Custom model fine-tuning
- [ ] Webhook integrations

### Performance & Scaling

- [ ] Horizontal scaling support
- [ ] Advanced caching strategies
- [ ] Streaming responses
- [ ] Background job processing
- [ ] Database optimization
- [ ] CDN integration

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **OpenAI** for GPT and embedding models
- **Express.js** for the web framework
- **Cheerio** for HTML parsing
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