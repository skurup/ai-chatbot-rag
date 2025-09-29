import OpenAI from 'openai';

class ChatService {
  constructor(ragEngine) {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.ragEngine = ragEngine;
    this.model = 'gpt-3.5-turbo';
    this.conversationHistory = new Map();
    this.maxHistoryLength = 10;
  }

  async generateResponse(message, conversationId = 'default', searchStrategy = 'hybrid', sourceFilter = 'all') {
    try {
      const startTime = Date.now();
      
      // Get conversation history
      const history = this.getConversationHistory(conversationId);

      // Retrieve relevant context using enhanced RAG
      console.log('=== CHAT SERVICE DEBUG ===');
      console.log('Message:', message);
      console.log('Search strategy:', searchStrategy);
      console.log('Source filter:', sourceFilter);
      console.log('Max chunks:', this.ragEngine.maxChunksPerQuery);
      console.log('RAG engine useQdrant:', this.ragEngine.useQdrant);
      console.log('RAG engine initialized:', this.ragEngine.isInitialized);
      
      const retrievedChunks = await this.ragEngine.search(
        message,
        searchStrategy,
        history,
        this.ragEngine.maxChunksPerQuery,
        sourceFilter
      );
      
      console.log('Retrieved chunks count:', retrievedChunks.length);
      console.log('Sample chunks:', retrievedChunks.slice(0, 2));
      console.log('=== CHAT SERVICE DEBUG END ===');

      if (retrievedChunks.length === 0) {
        return {
          response: "I don't have enough information to answer your question. Please try rephrasing it or check if the knowledge base has been properly initialized.",
          sources: [],
          citations: { citations: [], summary: { totalSources: 0, confidence: 0, coverage: 0 } },
          retrievedChunks: 0,
          searchStrategy,
          conversationId,
          timestamp: new Date().toISOString(),
          usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
          processingTime: Date.now() - startTime
        };
      }

      // Generate enhanced citations
      console.log('=== CITATION DEBUG ===');
      console.log('retrievedChunks:', retrievedChunks);
      console.log('retrievedChunks type:', typeof retrievedChunks);
      console.log('retrievedChunks isArray:', Array.isArray(retrievedChunks));
      console.log('retrievedChunks length:', retrievedChunks?.length);
      console.log('message:', message);
      console.log('history:', history);
      console.log('=== CITATION DEBUG END ===');
      
      const citations = this.ragEngine.generateCitations(retrievedChunks, message, history);

      // Build context from retrieved chunks
      const context = this.ragEngine.buildContext(retrievedChunks, 2000);

      // Generate sources for citation (legacy format)
      const sources = this.ragEngine.generateSourceCitations(retrievedChunks);
      
      // Ensure we have citations data
      console.log('Generated citations:', citations);
      console.log('Generated sources:', sources);

      // Create enhanced system prompt with citation context
      const systemPrompt = this.buildEnhancedSystemPrompt(context, citations);

      // Prepare messages for OpenAI
      const messages = [
        { role: 'system', content: systemPrompt },
        ...history.map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content: message }
      ];

      // Generate response
      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: messages,
        temperature: 0.7,
        max_tokens: 1000,
        top_p: 0.9,
        frequency_penalty: 0.1,
        presence_penalty: 0.1
      });

      const response = completion.choices[0].message.content;

      // Update conversation history
      this.addToHistory(conversationId, { role: 'user', content: message });
      this.addToHistory(conversationId, { role: 'assistant', content: response });

      const processingTime = Date.now() - startTime;

      return {
        response,
        sources,
        citations,
        retrievedChunks: retrievedChunks.length,
        searchStrategy,
        conversationId,
        timestamp: new Date().toISOString(),
        usage: completion.usage,
        processingTime
      };

    } catch (error) {
      console.error('Chat generation error:', error.message);

      // Fallback response without RAG
      return await this.generateFallbackResponse(message, conversationId);
    }
  }

  buildSystemPrompt(context) {
    const basePrompt = `You are a helpful AI assistant with access to a knowledge base. Use the provided context to answer questions accurately and cite your sources when possible.

Guidelines:
- Answer based on the provided context when relevant
- If the context doesn't contain enough information, say so clearly
- Be helpful, accurate, and concise
- Maintain a friendly and professional tone
- ALWAYS include citations when using information from the context
- Format citations as: [Source: Document Title (URL)]
- Include citations at the end of relevant sentences or paragraphs
- If asked about topics not covered in the context, provide general knowledge but note the limitation`;

    if (context && context.trim().length > 0) {
      return `${basePrompt}

CONTEXT:
${context}

Please use this context to help answer the user's question. If the context is relevant, reference it in your response.`;
    }

    return `${basePrompt}

No specific context is available for this query. Please provide a helpful response based on your general knowledge.`;
  }

  buildEnhancedSystemPrompt(context, citations) {
    const basePrompt = `You are a helpful AI assistant with access to a knowledge base. Use the provided context to answer questions accurately and cite your sources when possible.

Guidelines:
- Answer based on the provided context when relevant
- If the context doesn't contain enough information, say so clearly
- Be helpful, accurate, and concise
- Maintain a friendly and professional tone
- ALWAYS include citations when using information from the context
- Format citations as: [Source: Document Title (URL)]
- Include citations at the end of relevant sentences or paragraphs
- If asked about topics not covered in the context, provide general knowledge but note the limitation
- Pay attention to citation confidence scores and prioritize high-confidence sources
- When multiple sources conflict, mention the discrepancy`;

    if (context && context.trim().length > 0) {
      let citationInfo = '';
      
      if (citations && citations.citations && citations.citations.length > 0) {
        citationInfo = `

CITATION ANALYSIS:
- Total Sources: ${citations.summary.totalSources}
- Overall Confidence: ${(citations.summary.confidence * 100).toFixed(1)}%
- Coverage: ${(citations.summary.coverage * 100).toFixed(1)}%
- Source Types: ${Object.keys(citations.summary.sourceTypes).join(', ')}

TOP SOURCES:
${citations.summary.topSources.map((source, i) => 
  `${i + 1}. ${source.title} (${source.domain}) - Confidence: ${(source.confidence * 100).toFixed(1)}%`
).join('\n')}`;
      }

      return `${basePrompt}

CONTEXT:
${context}${citationInfo}

Please use this context to help answer the user's question. If the context is relevant, reference it in your response with appropriate citations.`;
    }

    return `${basePrompt}

No specific context is available for this query. Please provide a helpful response based on your general knowledge.`;
  }

  async generateFallbackResponse(message, conversationId) {
    try {
      const history = this.getConversationHistory(conversationId);

      const messages = [
        {
          role: 'system',
          content: 'You are a helpful AI assistant. The knowledge base is currently unavailable, so please provide a response based on your general knowledge. Be honest about this limitation.'
        },
        ...history.map(h => ({ role: h.role, content: h.content })),
        { role: 'user', content: message }
      ];

      const completion = await this.openai.chat.completions.create({
        model: this.model,
        messages: messages,
        temperature: 0.7,
        max_tokens: 500
      });

      const response = completion.choices[0].message.content;

      this.addToHistory(conversationId, { role: 'user', content: message });
      this.addToHistory(conversationId, { role: 'assistant', content: response });

      return {
        response: response + '\n\n*Note: Knowledge base temporarily unavailable. Response based on general knowledge.*',
        sources: [],
        retrievedChunks: 0,
        searchStrategy: 'fallback',
        conversationId,
        timestamp: new Date().toISOString(),
        usage: completion.usage
      };

    } catch (error) {
      console.error('Fallback response error:', error.message);
      return {
        response: 'I apologize, but I\'m experiencing technical difficulties and cannot provide a response at the moment. Please try again later.',
        sources: [],
        retrievedChunks: 0,
        searchStrategy: 'error',
        conversationId,
        timestamp: new Date().toISOString(),
        usage: null
      };
    }
  }

  getConversationHistory(conversationId) {
    return this.conversationHistory.get(conversationId) || [];
  }

  addToHistory(conversationId, message) {
    if (!this.conversationHistory.has(conversationId)) {
      this.conversationHistory.set(conversationId, []);
    }

    const history = this.conversationHistory.get(conversationId);
    history.push({
      ...message,
      timestamp: new Date().toISOString()
    });

    // Trim history if too long
    if (history.length > this.maxHistoryLength * 2) {
      history.splice(0, history.length - this.maxHistoryLength * 2);
    }
  }

  clearHistory(conversationId) {
    if (conversationId) {
      this.conversationHistory.delete(conversationId);
    } else {
      this.conversationHistory.clear();
    }
  }

  exportHistory(conversationId) {
    const history = this.getConversationHistory(conversationId);
    return {
      conversationId,
      messages: history,
      exportedAt: new Date().toISOString()
    };
  }

  async testQuery(query, strategies = ['semantic', 'keyword', 'hybrid', 'contextual']) {
    const results = {};

    for (const strategy of strategies) {
      try {
        const startTime = Date.now();
        const response = await this.generateResponse(query, `test_${Date.now()}`, strategy);
        const endTime = Date.now();

        results[strategy] = {
          ...response,
          responseTime: endTime - startTime
        };

      } catch (error) {
        results[strategy] = {
          error: error.message,
          responseTime: null
        };
      }
    }

    return results;
  }

  getStats() {
    const conversations = this.conversationHistory.size;
    const totalMessages = Array.from(this.conversationHistory.values())
      .reduce((sum, history) => sum + history.length, 0);

    return {
      model: this.model,
      conversations,
      totalMessages,
      maxHistoryLength: this.maxHistoryLength,
      ragStats: this.ragEngine.getStats()
    };
  }

  setModel(model) {
    this.model = model;
  }

  setMaxHistoryLength(length) {
    this.maxHistoryLength = Math.max(1, length);
  }

  async streamResponse(message, conversationId = 'default', searchStrategy = 'hybrid') {
    // This would be used for streaming responses
    // Implementation would depend on your frontend's streaming setup
    return this.generateResponse(message, conversationId, searchStrategy);
  }
}

export default ChatService;