import fs from 'fs/promises';
import path from 'path';
import logger from './logger.js';

class URLTracker {
  constructor() {
    this.trackedUrlsFile = path.join(process.cwd(), 'data', 'scraped_urls.json');
    this.trackedUrls = new Set();
    this.isInitialized = false;
  }

  async initialize() {
    try {
      // Ensure data directory exists
      const dataDir = path.dirname(this.trackedUrlsFile);
      await fs.mkdir(dataDir, { recursive: true });

      // Load existing tracked URLs
      try {
        const data = await fs.readFile(this.trackedUrlsFile, 'utf8');
        const urls = JSON.parse(data);
        this.trackedUrls = new Set(urls);
        logger.info(`Loaded ${this.trackedUrls.size} tracked URLs from disk`);
      } catch (error) {
        // File doesn't exist yet, start with empty set
        logger.info('No existing URL tracking file found, starting fresh');
        this.trackedUrls = new Set();
      }

      this.isInitialized = true;
    } catch (error) {
      logger.error('Failed to initialize URL tracker', { error: error.message });
      throw error;
    }
  }

  async addUrl(url) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    this.trackedUrls.add(url);
    await this.persistUrls();
    
    logger.debug(`Added URL to tracking: ${url}`);
  }

  async addUrls(urls) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    urls.forEach(url => this.trackedUrls.add(url));
    await this.persistUrls();
    
    logger.info(`Added ${urls.length} URLs to tracking`);
  }

  hasUrl(url) {
    return this.trackedUrls.has(url);
  }

  getTrackedUrls() {
    return Array.from(this.trackedUrls);
  }

  getStats() {
    return {
      totalTrackedUrls: this.trackedUrls.size,
      isInitialized: this.isInitialized,
      trackingFile: this.trackedUrlsFile
    };
  }

  async clearTrackedUrls() {
    this.trackedUrls.clear();
    await this.persistUrls();
    logger.info('Cleared all tracked URLs');
  }

  async removeUrl(url) {
    if (!this.isInitialized) {
      await this.initialize();
    }

    const removed = this.trackedUrls.delete(url);
    if (removed) {
      await this.persistUrls();
      logger.info(`Removed URL from tracking: ${url}`);
    }
    return removed;
  }

  async persistUrls() {
    try {
      const urlsArray = Array.from(this.trackedUrls);
      await fs.writeFile(this.trackedUrlsFile, JSON.stringify(urlsArray, null, 2));
      logger.debug(`Persisted ${urlsArray.length} URLs to disk`);
    } catch (error) {
      logger.error('Failed to persist URLs', { error: error.message });
      throw error;
    }
  }

  // Check if URL was scraped recently (within last N days)
  async wasScrapedRecently(url, daysThreshold = 7) {
    // For now, we'll use a simple approach
    // In the future, we could add timestamps to track when URLs were scraped
    return this.hasUrl(url);
  }

  // Get URLs that haven't been scraped yet
  filterNewUrls(urls) {
    return urls.filter(url => !this.hasUrl(url));
  }
}

export default URLTracker;
