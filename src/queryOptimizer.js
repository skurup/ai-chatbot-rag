import logger from './logger.js';

class QueryOptimizer {
  constructor() {
    this.stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'is', 'are', 'was', 'were', 'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
      'will', 'would', 'could', 'should', 'may', 'might', 'must', 'can', 'this', 'that', 'these',
      'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them'
    ]);
    
    this.queryTypes = {
      DEFINITION: 'definition',
      HOW_TO: 'how_to',
      COMPARISON: 'comparison',
      TROUBLESHOOTING: 'troubleshooting',
      EXAMPLE: 'example',
      GENERAL: 'general'
    };
  }

  preprocessQuery(query) {
    try {
      const originalQuery = query.trim();
      
      // Extract key information
      const analysis = this.analyzeQuery(originalQuery);
      
      // Optimize query based on type
      const optimizedQuery = this.optimizeQuery(originalQuery, analysis);
      
      // Generate search strategies
      const strategies = this.generateSearchStrategies(analysis);
      
      logger.info('Query preprocessing completed', {
        original: originalQuery,
        optimized: optimizedQuery,
        type: analysis.type,
        keywords: analysis.keywords,
        strategies: strategies
      });

      return {
        original: originalQuery,
        optimized: optimizedQuery,
        analysis,
        strategies
      };

    } catch (error) {
      logger.error('Query preprocessing failed', { error: error.message, query });
      return {
        original: query,
        optimized: query,
        analysis: { type: 'general', keywords: [] },
        strategies: ['hybrid']
      };
    }
  }

  analyzeQuery(query) {
    const lowerQuery = query.toLowerCase();
    const words = this.extractWords(query);
    const keywords = words.filter(word => !this.stopWords.has(word));
    
    // Determine query type
    let type = this.queryTypes.GENERAL;
    
    if (this.isDefinitionQuery(lowerQuery)) {
      type = this.queryTypes.DEFINITION;
    } else if (this.isHowToQuery(lowerQuery)) {
      type = this.queryTypes.HOW_TO;
    } else if (this.isComparisonQuery(lowerQuery)) {
      type = this.queryTypes.COMPARISON;
    } else if (this.isTroubleshootingQuery(lowerQuery)) {
      type = this.queryTypes.TROUBLESHOOTING;
    } else if (this.isExampleQuery(lowerQuery)) {
      type = this.queryTypes.EXAMPLE;
    }

    return {
      type,
      keywords,
      wordCount: words.length,
      hasQuestionMark: query.includes('?'),
      isShort: words.length <= 3,
      isLong: words.length > 10
    };
  }

  optimizeQuery(query, analysis) {
    let optimized = query;

    switch (analysis.type) {
      case this.queryTypes.DEFINITION:
        // For definitions, focus on the main term
        optimized = this.extractMainTerm(query);
        break;
        
      case this.queryTypes.HOW_TO:
        // For how-to queries, extract action and object
        optimized = this.extractActionAndObject(query);
        break;
        
      case this.queryTypes.COMPARISON:
        // For comparisons, extract entities being compared
        optimized = this.extractComparisonTerms(query);
        break;
        
      case this.queryTypes.TROUBLESHOOTING:
        // For troubleshooting, focus on error/problem terms
        optimized = this.extractProblemTerms(query);
        break;
        
      case this.queryTypes.EXAMPLE:
        // For examples, focus on the concept
        optimized = this.extractConceptTerm(query);
        break;
        
      default:
        // For general queries, remove stop words and focus on keywords
        optimized = analysis.keywords.join(' ');
    }

    return optimized || query;
  }

  generateSearchStrategies(analysis) {
    const strategies = [];

    switch (analysis.type) {
      case this.queryTypes.DEFINITION:
        strategies.push('semantic', 'keyword');
        break;
        
      case this.queryTypes.HOW_TO:
        strategies.push('hybrid', 'contextual');
        break;
        
      case this.queryTypes.COMPARISON:
        strategies.push('semantic', 'hybrid');
        break;
        
      case this.queryTypes.TROUBLESHOOTING:
        strategies.push('keyword', 'hybrid');
        break;
        
      case this.queryTypes.EXAMPLE:
        strategies.push('contextual', 'semantic');
        break;
        
      default:
        strategies.push('hybrid', 'semantic', 'contextual');
    }

    return strategies;
  }

  isDefinitionQuery(query) {
    const definitionPatterns = [
      /what is/,
      /what are/,
      /define/,
      /definition/,
      /meaning of/,
      /explain what/
    ];
    return definitionPatterns.some(pattern => pattern.test(query));
  }

  isHowToQuery(query) {
    const howToPatterns = [
      /how to/,
      /how do/,
      /how can/,
      /steps to/,
      /process of/,
      /way to/
    ];
    return howToPatterns.some(pattern => pattern.test(query));
  }

  isComparisonQuery(query) {
    const comparisonPatterns = [
      /vs/,
      /versus/,
      /compare/,
      /difference between/,
      /better than/,
      /advantages of/
    ];
    return comparisonPatterns.some(pattern => pattern.test(query));
  }

  isTroubleshootingQuery(query) {
    const troubleshootingPatterns = [
      /error/,
      /problem/,
      /issue/,
      /fix/,
      /solve/,
      /troubleshoot/,
      /debug/,
      /not working/
    ];
    return troubleshootingPatterns.some(pattern => pattern.test(query));
  }

  isExampleQuery(query) {
    const examplePatterns = [
      /example/,
      /sample/,
      /instance/,
      /case/,
      /show me/,
      /demonstrate/
    ];
    return examplePatterns.some(pattern => pattern.test(query));
  }

  extractWords(query) {
    return query.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 0);
  }

  extractMainTerm(query) {
    // Extract the main term after "what is" or similar patterns
    const patterns = [
      /what is (?:a |an |the )?([^?]+)/i,
      /define (?:a |an |the )?([^?]+)/i,
      /meaning of (?:a |an |the )?([^?]+)/i
    ];
    
    for (const pattern of patterns) {
      const match = query.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }
    
    return query;
  }

  extractActionAndObject(query) {
    // Extract action and object from how-to queries
    const patterns = [
      /how to ([^?]+)/i,
      /how do (?:you |I )?([^?]+)/i,
      /steps to ([^?]+)/i
    ];
    
    for (const pattern of patterns) {
      const match = query.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }
    
    return query;
  }

  extractComparisonTerms(query) {
    // Extract terms being compared
    const patterns = [
      /([^vs]+) vs ([^?]+)/i,
      /([^versus]+) versus ([^?]+)/i,
      /compare ([^?]+)/i,
      /difference between ([^?]+)/i
    ];
    
    for (const pattern of patterns) {
      const match = query.match(pattern);
      if (match) {
        return match[1] ? `${match[1]} ${match[2]}`.trim() : match[2].trim();
      }
    }
    
    return query;
  }

  extractProblemTerms(query) {
    // Extract problem-related terms
    const problemWords = ['error', 'problem', 'issue', 'fix', 'solve', 'troubleshoot', 'debug'];
    const words = this.extractWords(query);
    const problemTerms = words.filter(word => 
      problemWords.some(problem => word.includes(problem))
    );
    
    return problemTerms.length > 0 ? problemTerms.join(' ') : query;
  }

  extractConceptTerm(query) {
    // Extract the concept for which examples are requested
    const patterns = [
      /example of ([^?]+)/i,
      /sample of ([^?]+)/i,
      /show me ([^?]+)/i,
      /demonstrate ([^?]+)/i
    ];
    
    for (const pattern of patterns) {
      const match = query.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }
    
    return query;
  }

  generateContextualQuery(query, conversationHistory) {
    if (!conversationHistory || conversationHistory.length === 0) {
      return query;
    }

    // Extract relevant context from recent messages
    const recentContext = conversationHistory
      .slice(-3) // Last 3 exchanges
      .map(msg => msg.content)
      .join(' ')
      .toLowerCase();

    // Find common terms between query and context
    const queryWords = this.extractWords(query);
    const contextWords = this.extractWords(recentContext);
    const commonTerms = queryWords.filter(word => 
      contextWords.includes(word) && !this.stopWords.has(word)
    );

    if (commonTerms.length > 0) {
      return `${query} ${commonTerms.join(' ')}`;
    }

    return query;
  }
}

export default QueryOptimizer;
