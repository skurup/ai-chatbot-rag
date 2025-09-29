import axios from 'axios';
import * as cheerio from 'cheerio';
import { URL } from 'url';
import URLTracker from './urlTracker.js';

class WebScraper {
  constructor(options = {}) {
    this.delay = options.delay || parseInt(process.env.SCRAPE_DELAY_MS) || 1000;
    this.maxContentLength = options.maxContentLength || parseInt(process.env.MAX_CONTENT_LENGTH) || 50000;
    this.minContentLength = options.minContentLength || parseInt(process.env.MIN_CONTENT_LENGTH) || 50;
    this.timeout = options.timeout || 30000;
    
    // Recursive scraping options
    this.maxDepth = options.maxDepth || parseInt(process.env.MAX_SCRAPE_DEPTH) || 3;
    this.maxPages = options.maxPages || parseInt(process.env.MAX_SCRAPE_PAGES) || 100;
    this.followSameDomain = options.followSameDomain !== false; // Default true
    this.scrapedUrls = new Set(); // Session-level tracking
    this.scrapingQueue = [];
    this.urlTracker = new URLTracker(); // Persistent URL tracking
  }

  async scrapeUrl(url) {
    try {
      console.log(`Scraping: ${url}`);

      const response = await axios.get(url, {
        timeout: this.timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive',
        }
      });

      const $ = cheerio.load(response.data);

      // Remove unwanted elements
      $('script, style, nav, header, footer, aside, .sidebar, .navigation, .menu, .ad, .advertisement').remove();

      // Extract meaningful content
      const title = $('title').text().trim() || $('h1').first().text().trim() || 'Untitled';
      const description = $('meta[name="description"]').attr('content') ||
                         $('meta[property="og:description"]').attr('content') || '';

      // Get main content from common content containers
      const contentSelectors = [
        'main',
        'article',
        '.content',
        '.main-content',
        '.post-content',
        '.entry-content',
        '#content',
        '.container',
        'body'
      ];

      let content = '';
      for (const selector of contentSelectors) {
        const element = $(selector);
        if (element.length > 0) {
          content = element.text().replace(/\s+/g, ' ').trim();
          if (content.length > this.minContentLength) {
            break;
          }
        }
      }

      // Fallback to body text if no content found
      if (content.length < this.minContentLength) {
        content = $('body').text().replace(/\s+/g, ' ').trim();
      }

      // Truncate if too long
      if (content.length > this.maxContentLength) {
        content = content.substring(0, this.maxContentLength) + '...';
      }

      // Validate content quality
      if (content.length < this.minContentLength) {
        throw new Error(`Content too short: ${content.length} characters`);
      }

      const result = {
        url,
        title,
        description,
        content,
        timestamp: new Date().toISOString(),
        wordCount: content.split(/\s+/).length,
        contentLength: content.length
      };

      console.log(`✓ Scraped: ${title} (${result.wordCount} words)`);
      return result;

    } catch (error) {
      console.error(`✗ Failed to scrape ${url}:`, error.message);
      throw new Error(`Scraping failed for ${url}: ${error.message}`);
    }
  }

  async scrapeUrls(urls) {
    const results = [];
    const errors = [];

    // Reset scraped URLs for each batch
    this.resetScraperState();

    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];

      try {
        // Add delay between requests to be respectful
        if (i > 0) {
          await this.sleep(this.delay);
        }

        // Try recursive scraping first, fallback to single URL scraping
        try {
          const result = await this.scrapeUrlRecursively(url);
          if (result && result.length > 0) {
            results.push(...result);
            console.log(`✓ Recursive scraping: ${result.length} pages from ${url}`);
          } else {
            // Fallback to single URL scraping
            console.log(`⚠️ Recursive scraping returned no results, trying single URL scraping for ${url}`);
            const singleResult = await this.scrapeUrl(url);
            if (singleResult) {
              results.push(singleResult);
            }
          }
        } catch (recursiveError) {
          console.log(`⚠️ Recursive scraping failed, trying single URL scraping for ${url}: ${recursiveError.message}`);
          // Fallback to single URL scraping
          const singleResult = await this.scrapeUrl(url);
          if (singleResult) {
            results.push(singleResult);
          }
        }

      } catch (error) {
        console.error(`Failed to scrape ${url}:`, error.message);
        errors.push({ url, error: error.message });
      }
    }

    return { results, errors };
  }

  // Initialize URL tracker
  async initialize() {
    await this.urlTracker.initialize();
  }

  // Reset scraper state for new scraping session
  resetScraperState() {
    this.scrapedUrls.clear();
    this.scrapingQueue = [];
  }

  async isContentAvailable(url) {
    // This method checks if content for a URL is actually available in the system
    if (this.ragEngine) {
      try {
        // Check in-memory knowledge base first
        const hasInMemory = this.ragEngine.knowledgeBase.some(chunk => 
          chunk.metadata?.url === url
        );
        
        if (hasInMemory) {
          console.log(`[DEBUG] Content found in memory for ${url}`);
          return true;
        }
        
        // If using Qdrant, check there too
        if (this.ragEngine.useQdrant && this.ragEngine.isInitialized) {
          try {
            // Query Qdrant for points with this URL
            const searchResult = await this.ragEngine.qdrantService.client.search(
              this.ragEngine.qdrantService.collectionName,
              {
                vector: new Array(1536).fill(0), // Dummy vector
                limit: 1,
                filter: {
                  must: [
                    {
                      key: 'source_url',
                      match: { value: url }
                    }
                  ]
                }
              }
            );
            
            const hasInQdrant = searchResult.length > 0;
            console.log(`[DEBUG] Content availability in Qdrant for ${url}: ${hasInQdrant}`);
            return hasInQdrant;
          } catch (qdrantError) {
            console.log(`[DEBUG] Error checking Qdrant: ${qdrantError.message}`);
            return false;
          }
        }
        
        console.log(`[DEBUG] No content found for ${url}`);
        return false;
      } catch (error) {
        console.log(`[DEBUG] Error checking content availability: ${error.message}`);
        return false;
      }
    }
    
    // If no RAG engine available, assume content is not available
    return false;
  }

  async scrapeUrlRecursively(startUrl, depth = 0) {
    console.log(`[DEBUG] scrapeUrlRecursively called: ${startUrl}, depth: ${depth}, maxDepth: ${this.maxDepth}, scrapedCount: ${this.scrapedUrls.size}, maxPages: ${this.maxPages}`);
    
    if (depth > this.maxDepth || this.scrapedUrls.size >= this.maxPages) {
      console.log(`[DEBUG] Stopping recursion: depth=${depth} > maxDepth=${this.maxDepth} OR scrapedCount=${this.scrapedUrls.size} >= maxPages=${this.maxPages}`);
      return [];
    }

    const results = [];
    const baseUrl = new URL(startUrl);
    
    // Check if URL was already scraped (persistent check)
    if (this.urlTracker.hasUrl(startUrl)) {
      console.log(`[DEBUG] URL already scraped previously: ${startUrl}`);
      
      // Check if content is actually available in memory/Qdrant
      const contentAvailable = await this.isContentAvailable(startUrl);
      if (contentAvailable) {
        console.log(`[DEBUG] Content is available in memory/Qdrant, skipping: ${startUrl}`);
        return [];
      } else {
        console.log(`[DEBUG] URL was scraped but content is missing, re-scraping: ${startUrl}`);
        // Remove from tracking so we can re-scrape
        await this.urlTracker.removeUrl(startUrl);
      }
    }

    // Add to session-level scraped URLs to avoid duplicates in this session
    if (this.scrapedUrls.has(startUrl)) {
      console.log(`[DEBUG] URL already scraped in this session: ${startUrl}`);
      return [];
    }
    this.scrapedUrls.add(startUrl);

    try {
      console.log(`Scraping (depth ${depth}): ${startUrl}`);
      
      const response = await axios.get(startUrl, {
        timeout: this.timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive',
        }
      });

      const $ = cheerio.load(response.data);

      // Remove unwanted elements
      $('script, style, nav, header, footer, aside, .sidebar, .navigation, .menu, .ad, .advertisement').remove();

      // Extract meaningful content
      const title = $('title').text().trim() || $('h1').first().text().trim() || 'Untitled';
      const description = $('meta[name="description"]').attr('content') ||
                         $('meta[property="og:description"]').attr('content') || '';

      // Get main content from common content containers
      const contentSelectors = [
        'main',
        'article',
        '.content',
        '.main-content',
        '.post-content',
        '.entry-content',
        '#content',
        '.container',
        'body'
      ];

      let content = '';
      for (const selector of contentSelectors) {
        const element = $(selector);
        if (element.length > 0) {
          content = element.text().trim();
          break;
        }
      }

      // Clean up content
      content = content
        .replace(/\s+/g, ' ')
        .replace(/\n\s*\n/g, '\n')
        .trim();

      // Check content length
      if (content.length < this.minContentLength) {
        console.log(`Skipping ${startUrl}: content too short (${content.length} chars)`);
        return [];
      }

      // Truncate if too long
      if (content.length > this.maxContentLength) {
        content = content.substring(0, this.maxContentLength) + '...';
      }

      // Create result object
      const result = {
        url: startUrl,
        title: title,
        description: description,
        content: content,
        wordCount: content.split(/\s+/).length,
        timestamp: new Date().toISOString(),
        depth: depth
      };

      results.push(result);
      console.log(`✓ Scraped: ${title} (${result.wordCount} words)`);

      // Track this URL as scraped (persistent)
      await this.urlTracker.addUrl(startUrl);

      // Find and queue related links for next depth level
      if (depth < this.maxDepth && this.scrapedUrls.size < this.maxPages) {
        const links = this.extractRelevantLinks($, baseUrl, startUrl);
        
        for (const link of links.slice(0, 25)) { // Increased from 10 to 25 links per page
          if (!this.scrapedUrls.has(link)) {
            try {
              const subResults = await this.scrapeUrlRecursively(link, depth + 1);
              results.push(...subResults);
              
              // Add delay between sub-requests
              if (this.delay > 0) {
                await this.sleep(this.delay);
              }
            } catch (error) {
              console.log(`Failed to scrape sub-link ${link}: ${error.message}`);
            }
          }
        }
      }

      return results;

    } catch (error) {
      console.error(`Failed to scrape ${startUrl}:`, error.message);
      return [];
    }
  }

  extractRelevantLinks($, baseUrl, currentUrl) {
    const links = [];
    const currentPath = new URL(currentUrl).pathname;

    $('a[href]').each((_, element) => {
      const href = $(element).attr('href');
      if (!href) return;

      try {
        const linkUrl = new URL(href, baseUrl.origin);
        
        // Only follow same domain links
        if (this.followSameDomain && linkUrl.hostname !== baseUrl.hostname) {
          return;
        }

        // Skip certain file types and patterns
        const skipPatterns = [
          /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|zip|rar|tar|gz)$/i,
          /\.(jpg|jpeg|png|gif|svg|webp|ico)$/i,
          /\.(css|js|json|xml)$/i,
          /#/,
          /javascript:/,
          /mailto:/,
          /tel:/
        ];

        if (skipPatterns.some(pattern => pattern.test(linkUrl.href))) {
          return;
        }

        // Skip if already scraped
        if (this.scrapedUrls.has(linkUrl.href)) {
          return;
        }

        // More aggressive link extraction - include most documentation links
        const linkText = $(element).text().trim().toLowerCase();
        const linkPath = linkUrl.pathname.toLowerCase();
        
        // Skip only obvious non-content links
        const skipContentPatterns = [
          /\/api\//,
          /\/download/,
          /\/contact/,
          /\/support/,
          /\/login/,
          /\/signup/,
          /\/pricing/,
          /\/blog\//,
          /\/news\//,
          /\/events\//,
          /\/community\//,
          /\/status\//,
          /\/legal\//,
          /\/privacy\//,
          /\/terms\//,
          /\/cookie/
        ];
        
        const shouldSkip = skipContentPatterns.some(pattern => pattern.test(linkPath));
        
        // Include most links unless they match skip patterns
        if (!shouldSkip) {
          links.push(linkUrl.href);
        }

      } catch (error) {
        // Skip invalid URLs
        return;
      }
    });

    return links;
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  validateUrl(url) {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }

  extractLinks(html, baseUrl) {
    const $ = cheerio.load(html);
    const links = [];

    $('a[href]').each((i, element) => {
      try {
        const href = $(element).attr('href');
        const absoluteUrl = new URL(href, baseUrl).toString();
        const text = $(element).text().trim();

        if (text && this.validateUrl(absoluteUrl)) {
          links.push({ url: absoluteUrl, text });
        }
      } catch (error) {
        // Skip invalid URLs
      }
    });

    return links;
  }

  getStats() {
    return {
      delay: this.delay,
      maxContentLength: this.maxContentLength,
      minContentLength: this.minContentLength,
      timeout: this.timeout
    };
  }
}

export default WebScraper;