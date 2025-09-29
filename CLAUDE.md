# Claude Code Assistant Instructions

This file contains instructions for Claude Code to help with this AI Chatbot RAG project.

## Project Commands

### Development Commands
- `npm run dev` - Start development server with auto-restart
- `npm start` - Start production server
- `npm run scrape` - Run manual scraping script

### Testing Commands
- `node scripts/scrape.js --test` - Test scraping with sample query
- `node scripts/scrape.js --test --query="your question"` - Test with custom query

### Linting and Type Checking
- No specific linting commands configured
- This is a pure JavaScript project (no TypeScript)
- Add linting commands here if they are set up later

## Environment Setup

1. Copy `.env.example` to `.env`
2. Add your OpenAI API key to `.env`
3. Configure URLs in `config/urls.js`
4. Run `npm install` to install dependencies

## Key Files to Know About

### Backend Core
- `server.js` - Main Express server
- `src/scraper.js` - Web scraping functionality
- `src/embeddings.js` - OpenAI embeddings handling
- `src/rag.js` - RAG engine with multiple search strategies
- `src/chat.js` - Chat service with OpenAI integration

### Frontend
- `public/index.html` - Main chat interface
- `public/rag-dashboard.html` - Analytics dashboard
- `public/style.css` - Responsive styling
- `public/script.js` - Frontend JavaScript

### Configuration
- `config/urls.js` - URLs to scrape for knowledge base
- `.env` - Environment variables
- `package.json` - Dependencies and scripts

### Scripts
- `scripts/scrape.js` - Manual scraping utility

## Common Development Tasks

### Adding New Content Sources
1. Edit `config/urls.js` to add new URLs
2. Optionally add custom selectors for specific domains
3. Run `npm run scrape` to re-index content

### Modifying RAG Behavior
- Edit environment variables in `.env`
- Modify settings in `src/rag.js`
- Adjust chunk size, overlap, similarity thresholds

### Updating UI
- Edit `public/style.css` for styling changes
- Modify `public/index.html` for structure changes
- Update `public/script.js` for functionality changes

### API Endpoints
- `POST /api/chat` - Send message, get response
- `GET /api/health` - System health check
- `POST /api/scrape` - Trigger manual scraping
- `POST /api/add-url` - Add single URL
- `GET /api/stats` - System statistics

## Troubleshooting

### Common Issues
1. **OpenAI API errors** - Check API key in `.env`
2. **No content scraped** - Verify URLs in `config/urls.js`
3. **High memory usage** - Reduce chunk size or clear cache
4. **Slow responses** - Adjust similarity threshold

### Debug Commands
- `DEBUG=* npm run dev` - Enable verbose logging
- `curl http://localhost:3000/api/health` - Check system health

## Project Architecture

This is a Node.js application using:
- Express.js for the web server
- OpenAI API for embeddings and chat completion
- Axios + Cheerio for web scraping
- In-memory storage for vector embeddings
- Modern vanilla JavaScript frontend

The RAG pipeline:
1. Scrapes websites for content
2. Chunks text and creates embeddings
3. Stores in memory vector database
4. Retrieves relevant chunks for user queries
5. Generates responses with source attribution

## When Making Changes

Always:
1. Test scraping with `npm run scrape -- --test`
2. Verify health endpoint: `curl http://localhost:3000/api/health`
3. Test chat functionality in the web interface
4. Check the dashboard for system metrics

## Performance Notes

- In-memory storage limits scalability
- Embedding cache helps reduce API calls
- Rate limiting protects against abuse
- Consider external vector DB for production scale