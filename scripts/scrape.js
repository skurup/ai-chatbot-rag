#!/usr/bin/env node

import dotenv from 'dotenv';
import WebScraper from '../src/scraper.js';
import RAGEngine from '../src/rag.js';
import { URLS_TO_SCRAPE } from '../config/urls.js';

// Load environment variables
dotenv.config();

class ScrapingScript {
    constructor() {
        this.scraper = new WebScraper();
        this.ragEngine = new RAGEngine();
        this.startTime = Date.now();
    }

    async run() {
        console.log('🚀 AI Chatbot RAG - Manual Scraping Script');
        console.log('==========================================\n');

        try {
            await this.validateEnvironment();
            await this.performScraping();
            await this.generateReport();

        } catch (error) {
            console.error('❌ Scraping script failed:', error.message);
            process.exit(1);
        }
    }

    async validateEnvironment() {
        console.log('🔍 Validating environment...');

        // Check OpenAI API key
        if (!process.env.OPENAI_API_KEY) {
            throw new Error('OPENAI_API_KEY environment variable is required');
        }

        // Check URLs configuration
        if (!URLS_TO_SCRAPE || URLS_TO_SCRAPE.length === 0) {
            throw new Error('No URLs configured in config/urls.js');
        }

        console.log(`✅ OpenAI API key configured`);
        console.log(`✅ ${URLS_TO_SCRAPE.length} URLs configured for scraping\n`);
    }

    async performScraping() {
        console.log('📥 Starting scraping process...');

        // Scrape all URLs
        const { results, errors } = await this.scraper.scrapeUrls(URLS_TO_SCRAPE);

        if (results.length === 0) {
            throw new Error('No documents were successfully scraped');
        }

        console.log(`✅ Successfully scraped ${results.length} documents`);
        if (errors.length > 0) {
            console.log(`⚠️  ${errors.length} URLs failed to scrape:`);
            errors.forEach(error => {
                console.log(`   - ${error.url}: ${error.error}`);
            });
        }

        // Process documents with RAG engine
        console.log('\n🧠 Processing documents with RAG engine...');
        const { totalChunks, errors: ragErrors } = await this.ragEngine.addDocuments(results);

        console.log(`✅ Generated ${totalChunks} text chunks`);
        if (ragErrors.length > 0) {
            console.log(`⚠️  ${ragErrors.length} documents failed to process:`);
            ragErrors.forEach(error => {
                console.log(`   - ${error.document}: ${error.error}`);
            });
        }

        this.scrapingResults = {
            documentsScraped: results.length,
            scrapingErrors: errors.length,
            totalChunks,
            processingErrors: ragErrors.length,
            documents: results
        };
    }

    async generateReport() {
        const endTime = Date.now();
        const duration = (endTime - this.startTime) / 1000;

        console.log('\n📊 Scraping Report');
        console.log('==================');
        console.log(`⏱️  Total time: ${duration.toFixed(2)} seconds`);
        console.log(`📄 Documents scraped: ${this.scrapingResults.documentsScraped}`);
        console.log(`❌ Scraping errors: ${this.scrapingResults.scrapingErrors}`);
        console.log(`🧩 Text chunks generated: ${this.scrapingResults.totalChunks}`);
        console.log(`❌ Processing errors: ${this.scrapingResults.processingErrors}`);

        // Document details
        console.log('\n📋 Document Details:');
        this.scrapingResults.documents.forEach((doc, index) => {
            console.log(`   ${index + 1}. ${doc.title}`);
            console.log(`      URL: ${doc.url}`);
            console.log(`      Word count: ${doc.wordCount}`);
            console.log(`      Content length: ${doc.contentLength} chars`);
        });

        // RAG engine stats
        console.log('\n🔧 RAG Engine Configuration:');
        const stats = this.ragEngine.getStats();
        console.log(`   Chunk size: ${stats.chunkSize}`);
        console.log(`   Chunk overlap: ${stats.chunkOverlap}`);
        console.log(`   Similarity threshold: ${stats.similarityThreshold}`);
        console.log(`   Embedding cache size: ${stats.embeddingStats.cacheSize}`);

        console.log('\n✅ Scraping completed successfully!');
        console.log('   Your knowledge base is ready for use.');
        console.log('   Start the server with: npm start');
    }

    async testQuery(query = 'What is artificial intelligence?') {
        console.log(`\n🧪 Testing query: "${query}"`);

        try {
            const results = await this.ragEngine.search(query, 'hybrid', [], 3);

            console.log(`✅ Found ${results.length} relevant chunks:`);
            results.forEach((chunk, index) => {
                console.log(`   ${index + 1}. Similarity: ${(chunk.similarity * 100).toFixed(1)}%`);
                console.log(`      Source: ${chunk.metadata.title}`);
                console.log(`      Preview: ${chunk.text.substring(0, 100)}...`);
            });

        } catch (error) {
            console.log(`❌ Query test failed: ${error.message}`);
        }
    }
}

// Handle command line arguments
const args = process.argv.slice(2);
const shouldTest = args.includes('--test');
const testQuery = args.find(arg => arg.startsWith('--query='))?.split('=')[1];

// Run the script
async function main() {
    const script = new ScrapingScript();

    try {
        await script.run();

        if (shouldTest) {
            await script.testQuery(testQuery);
        }

    } catch (error) {
        console.error('Script execution failed:', error);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n🛑 Scraping interrupted by user');
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('\n🛑 Scraping terminated');
    process.exit(0);
});

// Execute if this file is run directly
if (import.meta.url === `file://${process.argv[1]}`) {
    main();
}

export default ScrapingScript;