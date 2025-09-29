import logger from './logger.js';

class CitationManager {
  constructor() {
    this.citationCache = new Map();
    this.citationStats = {
      totalCitations: 0,
      uniqueSources: new Set(),
      citationTypes: new Map()
    };
  }

  generateCitations(searchResults, query, queryAnalysis) {
    try {
      if (!searchResults || searchResults.length === 0) {
        return {
          citations: [],
          summary: {
            totalSources: 0,
            confidence: 0,
            coverage: 0
          }
        };
      }

      // Process and rank citations
      const processedCitations = this.processCitations(searchResults, query, queryAnalysis);
      
      // Generate citation summary
      const summary = this.generateCitationSummary(processedCitations, queryAnalysis);
      
      // Update stats
      this.updateCitationStats(processedCitations);

      logger.info('Citations generated', {
        query: query,
        resultCount: searchResults.length,
        citationCount: processedCitations.length,
        confidence: summary.confidence
      });

      return {
        citations: processedCitations,
        summary
      };

    } catch (error) {
      logger.error('Citation generation failed', { error: error.message, query });
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

  processCitations(searchResults, query, queryAnalysis) {
    const citations = searchResults.map((result, index) => {
      const citation = this.createCitation(result, index, query, queryAnalysis, searchResults.length);
      return citation;
    });

    // Sort by relevance and confidence
    return citations.sort((a, b) => {
      // Primary sort by confidence
      if (b.confidence !== a.confidence) {
        return b.confidence - a.confidence;
      }
      // Secondary sort by similarity score
      return b.similarity - a.similarity;
    });
  }

  createCitation(result, index, query, queryAnalysis, totalResults) {
    // Handle both legacy source format and new result format
    const title = result.metadata?.title || result.title || 'Unknown Source';
    const url = result.metadata?.url || result.url || '#';
    const similarity = result.similarity || 0.5;
    
    const citation = {
      id: `citation_${Date.now()}_${index}`,
      source: {
        title: title,
        url: url,
        type: this.determineSourceType(url),
        domain: this.extractDomain(url)
      },
      content: {
        text: result.text || result.excerpt || 'No content available',
        excerpt: this.generateExcerpt(result.text || result.excerpt || '', query),
        wordCount: (result.text || result.excerpt || '').split(/\s+/).length,
        chunkIndex: result.metadata?.chunkIndex || 0,
        totalChunks: result.metadata?.totalChunks || result.chunks || 1
      },
      relevance: {
        similarity: similarity,
        confidence: this.calculateConfidence(result, query, queryAnalysis),
        matchType: this.determineMatchType(result.text || result.excerpt || '', query),
        keywords: this.extractMatchingKeywords(result.text || result.excerpt || '', query)
      },
      metadata: {
        timestamp: result.metadata?.timestamp || new Date().toISOString(),
        isManuallyAdded: result.metadata?.isManuallyAdded || false,
        position: index + 1,
        totalResults: totalResults
      },
      highlights: this.generateHighlights(result.text || result.excerpt || '', query),
      context: this.generateContext(result, queryAnalysis)
    };

    return citation;
  }

  determineSourceType(url) {
    if (!url) return 'unknown';
    
    if (url.includes('docs.')) return 'documentation';
    if (url.includes('github.com')) return 'code_repository';
    if (url.includes('stackoverflow.com')) return 'community';
    if (url.includes('medium.com') || url.includes('blog.')) return 'article';
    if (url.startsWith('file://')) return 'uploaded_file';
    
    return 'web_page';
  }

  extractDomain(url) {
    if (!url) return 'unknown';
    
    try {
      if (url.startsWith('file://')) {
        return 'Local File';
      }
      
      const domain = new URL(url).hostname;
      return domain.replace('www.', '');
    } catch (error) {
      return 'unknown';
    }
  }

  generateExcerpt(text, query, maxLength = 200) {
    if (!text || text.trim().length === 0) {
      return 'No content available for this source.';
    }
    
    if (text.length <= maxLength) {
      return text;
    }

    // Try to find the most relevant part of the text
    const queryWords = query.toLowerCase().split(/\s+/);
    const textLower = text.toLowerCase();
    
    // Find the first occurrence of any query word
    let bestIndex = 0;
    let bestScore = 0;
    
    for (let i = 0; i <= text.length - maxLength; i += 50) {
      const excerpt = textLower.substring(i, i + maxLength);
      const score = queryWords.reduce((acc, word) => {
        return acc + (excerpt.includes(word) ? 1 : 0);
      }, 0);
      
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    
    let excerpt = text.substring(bestIndex, bestIndex + maxLength);
    
    // Ensure we don't cut words
    if (bestIndex > 0) {
      const firstSpace = excerpt.indexOf(' ');
      if (firstSpace > 0 && firstSpace < 20) {
        excerpt = excerpt.substring(firstSpace + 1);
      }
    }
    
    if (bestIndex + maxLength < text.length) {
      const lastSpace = excerpt.lastIndexOf(' ');
      if (lastSpace > maxLength - 20) {
        excerpt = excerpt.substring(0, lastSpace);
      }
    }
    
    return excerpt + (excerpt.length < text.length ? '...' : '');
  }

  calculateConfidence(result, query, queryAnalysis) {
    let confidence = result.similarity || 0;
    
    // Ensure confidence is between 0 and 1
    confidence = Math.max(0, Math.min(confidence, 1));
    
    // Boost confidence based on query type
    const text = result.text || result.excerpt || '';
    switch (queryAnalysis.type) {
      case 'definition':
        if (this.isDefinitionMatch(text, query)) {
          confidence += 0.2;
        }
        break;
      case 'how_to':
        if (this.isHowToMatch(text, query)) {
          confidence += 0.15;
        }
        break;
      case 'troubleshooting':
        if (this.isTroubleshootingMatch(text, query)) {
          confidence += 0.1;
        }
        break;
    }
    
    // Boost for exact keyword matches
    const keywordMatches = this.countKeywordMatches(text, query);
    confidence += keywordMatches * 0.05;
    
    // Boost for recent sources
    if (result.metadata?.timestamp) {
      const age = Date.now() - new Date(result.metadata.timestamp).getTime();
      const daysOld = age / (1000 * 60 * 60 * 24);
      if (daysOld < 30) {
        confidence += 0.05;
      }
    }
    
    // Ensure final confidence is between 0 and 1
    return Math.max(0, Math.min(confidence, 1.0));
  }

  determineMatchType(text, query) {
    const textLower = text.toLowerCase();
    const queryLower = query.toLowerCase();
    
    if (textLower.includes(queryLower)) {
      return 'exact_match';
    }
    
    const queryWords = queryLower.split(/\s+/);
    const matchingWords = queryWords.filter(word => textLower.includes(word));
    
    if (matchingWords.length === queryWords.length) {
      return 'all_words_match';
    } else if (matchingWords.length > queryWords.length / 2) {
      return 'partial_match';
    } else {
      return 'semantic_match';
    }
  }

  extractMatchingKeywords(text, query) {
    const textLower = text.toLowerCase();
    const queryWords = query.toLowerCase().split(/\s+/);
    
    return queryWords.filter(word => 
      word.length > 2 && textLower.includes(word)
    );
  }

  generateHighlights(text, query) {
    const highlights = [];
    const queryWords = query.toLowerCase().split(/\s+/).filter(word => word.length > 2);
    
    queryWords.forEach(word => {
      const regex = new RegExp(`(${word})`, 'gi');
      const matches = [...text.matchAll(regex)];
      
      matches.forEach(match => {
        highlights.push({
          word: match[0],
          position: match.index,
          length: match[0].length
        });
      });
    });
    
    return highlights.sort((a, b) => a.position - b.position);
  }

  generateContext(result, queryAnalysis) {
    const context = {
      section: this.determineSection(result.text),
      topic: this.extractTopic(result.text),
      relatedConcepts: this.extractRelatedConcepts(result.text),
      queryRelevance: this.assessQueryRelevance(result.text, queryAnalysis)
    };
    
    return context;
  }

  determineSection(text) {
    // Simple section detection based on common patterns
    if (text.includes('Introduction') || text.includes('Overview')) {
      return 'introduction';
    } else if (text.includes('Example') || text.includes('Sample')) {
      return 'examples';
    } else if (text.includes('Error') || text.includes('Problem')) {
      return 'troubleshooting';
    } else if (text.includes('Step') || text.includes('Process')) {
      return 'procedures';
    } else {
      return 'general';
    }
  }

  extractTopic(text) {
    // Extract main topic from text (simplified)
    const sentences = text.split(/[.!?]+/);
    if (sentences.length > 0) {
      return sentences[0].trim().substring(0, 100);
    }
    return text.substring(0, 100);
  }

  extractRelatedConcepts(text) {
    // Extract related concepts (simplified)
    const concepts = [];
    const conceptPatterns = [
      /(?:related to|similar to|like|such as)\s+([^,.\n]+)/gi,
      /(?:see also|also see|refer to)\s+([^,.\n]+)/gi
    ];
    
    conceptPatterns.forEach(pattern => {
      const matches = [...text.matchAll(pattern)];
      matches.forEach(match => {
        concepts.push(match[1].trim());
      });
    });
    
    return concepts.slice(0, 3); // Limit to 3 concepts
  }

  assessQueryRelevance(text, queryAnalysis) {
    let relevance = 0.5; // Base relevance
    
    // Adjust based on query type
    switch (queryAnalysis.type) {
      case 'definition':
        if (text.includes('is') || text.includes('are') || text.includes('means')) {
          relevance += 0.3;
        }
        break;
      case 'how_to':
        if (text.includes('step') || text.includes('process') || text.includes('how')) {
          relevance += 0.3;
        }
        break;
      case 'troubleshooting':
        if (text.includes('error') || text.includes('problem') || text.includes('fix')) {
          relevance += 0.3;
        }
        break;
    }
    
    return Math.min(relevance, 1.0);
  }

  generateCitationSummary(citations, queryAnalysis) {
    const summary = {
      totalSources: citations.length,
      uniqueDomains: new Set(citations.map(c => c.source.domain)).size,
      confidence: this.calculateOverallConfidence(citations),
      coverage: this.calculateCoverage(citations, queryAnalysis),
      sourceTypes: this.getSourceTypeDistribution(citations),
      topSources: this.getTopSources(citations, 3)
    };
    
    return summary;
  }

  calculateOverallConfidence(citations) {
    if (citations.length === 0) return 0;
    
    const totalConfidence = citations.reduce((sum, citation) => 
      sum + citation.relevance.confidence, 0
    );
    
    return totalConfidence / citations.length;
  }

  calculateCoverage(citations, queryAnalysis) {
    if (citations.length === 0) return 0;
    
    // Calculate how well the citations cover different aspects of the query
    const keywords = queryAnalysis.keywords || [];
    const coveredKeywords = keywords.filter(keyword => 
      citations.some(citation => 
        citation.relevance.keywords.includes(keyword.toLowerCase())
      )
    );
    
    return keywords.length > 0 ? coveredKeywords.length / keywords.length : 0;
  }

  getSourceTypeDistribution(citations) {
    const distribution = {};
    
    citations.forEach(citation => {
      const type = citation.source.type;
      distribution[type] = (distribution[type] || 0) + 1;
    });
    
    return distribution;
  }

  getTopSources(citations, limit = 3) {
    return citations
      .slice(0, limit)
      .map(citation => ({
        title: citation.source.title,
        domain: citation.source.domain,
        confidence: citation.relevance.confidence,
        excerpt: citation.content.excerpt
      }));
  }

  updateCitationStats(citations) {
    this.citationStats.totalCitations += citations.length;
    
    citations.forEach(citation => {
      this.citationStats.uniqueSources.add(citation.source.url);
      
      const type = citation.source.type;
      this.citationStats.citationTypes.set(
        type, 
        (this.citationStats.citationTypes.get(type) || 0) + 1
      );
    });
  }

  getCitationStats() {
    return {
      ...this.citationStats,
      uniqueSources: this.citationStats.uniqueSources.size,
      citationTypes: Object.fromEntries(this.citationStats.citationTypes)
    };
  }

  // Helper methods for confidence calculation
  isDefinitionMatch(text, query) {
    const definitionIndicators = ['is', 'are', 'means', 'refers to', 'defined as'];
    return definitionIndicators.some(indicator => 
      text.toLowerCase().includes(indicator)
    );
  }

  isHowToMatch(text, query) {
    const howToIndicators = ['step', 'process', 'procedure', 'method', 'way to'];
    return howToIndicators.some(indicator => 
      text.toLowerCase().includes(indicator)
    );
  }

  isTroubleshootingMatch(text, query) {
    const troubleshootingIndicators = ['error', 'problem', 'issue', 'fix', 'solution'];
    return troubleshootingIndicators.some(indicator => 
      text.toLowerCase().includes(indicator)
    );
  }

  countKeywordMatches(text, query) {
    const textLower = text.toLowerCase();
    const queryWords = query.toLowerCase().split(/\s+/);
    
    return queryWords.filter(word => 
      word.length > 2 && textLower.includes(word)
    ).length;
  }
}

export default CitationManager;
