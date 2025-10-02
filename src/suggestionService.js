import OpenAI from 'openai';
import logger from './logger.js';

class SuggestionService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY
    });

    this.maxSuggestions = 3;
    this.suggestionCache = new Map();
    this.cacheTimeout = 30 * 60 * 1000; // 30 minutes

    // Clear cache periodically
    setInterval(() => this.clearExpiredCache(), 10 * 60 * 1000);
  }

  async generateSuggestions(userMessage, botResponse, conversationContext = [], sources = []) {
    try {
      const cacheKey = this.generateCacheKey(userMessage, botResponse);
      const cached = this.suggestionCache.get(cacheKey);

      if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
        logger.debug('Using cached suggestions', { cacheKey });
        return cached.suggestions;
      }

      const suggestions = await this.generateFreshSuggestions(
        userMessage,
        botResponse,
        conversationContext,
        sources
      );

      // Cache the results
      this.suggestionCache.set(cacheKey, {
        suggestions,
        timestamp: Date.now()
      });

      return suggestions;
    } catch (error) {
      logger.error('Failed to generate suggestions', {
        error: error.message,
        userMessage: userMessage?.substring(0, 100)
      });
      return this.getFallbackSuggestions(userMessage, sources);
    }
  }

  async generateFreshSuggestions(userMessage, botResponse, conversationContext, sources) {
    const prompt = this.buildSuggestionPrompt(userMessage, botResponse, conversationContext, sources);

    const response = await this.openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
      messages: [
        {
          role: 'system',
          content: `You are an expert at generating helpful follow-up questions for conversations.
Your goal is to suggest 3 specific, actionable questions that would naturally follow from the current conversation.

Guidelines:
- Generate exactly 3 questions
- Make them specific and actionable
- Consider the conversation context and available sources
- Focus on practical next steps or deeper exploration
- Keep questions concise (under 80 characters each)
- Make them feel natural and conversational
- Avoid generic questions like "Tell me more"

Format your response as a JSON array of strings, like:
["How do I implement this feature?", "What are the best practices?", "Are there any common pitfalls?"]`
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      temperature: 0.7,
      max_tokens: 300
    });

    const content = response.choices[0]?.message?.content?.trim();
    if (!content) {
      throw new Error('Empty response from OpenAI');
    }

    // Parse the JSON response
    try {
      const suggestions = JSON.parse(content);
      if (Array.isArray(suggestions) && suggestions.length > 0) {
        return suggestions.slice(0, this.maxSuggestions).map(s => s.trim());
      }
    } catch (parseError) {
      // If JSON parsing fails, try to extract questions from text
      return this.extractQuestionsFromText(content);
    }

    throw new Error('Invalid response format');
  }

  buildSuggestionPrompt(userMessage, botResponse, conversationContext, sources) {
    let prompt = `Current conversation:
User asked: "${userMessage}"
Bot responded: "${botResponse.substring(0, 500)}${botResponse.length > 500 ? '...' : ''}"`;

    // Add conversation context if available
    if (conversationContext && conversationContext.length > 0) {
      prompt += '\n\nPrevious conversation context:\n';
      const recentContext = conversationContext.slice(-4); // Last 2 exchanges
      for (const msg of recentContext) {
        prompt += `${msg.role}: ${msg.content.substring(0, 200)}${msg.content.length > 200 ? '...' : ''}\n`;
      }
    }

    // Add source information if available
    if (sources && sources.length > 0) {
      prompt += '\n\nAvailable sources that can provide more information:\n';
      sources.slice(0, 3).forEach((source, i) => {
        prompt += `${i + 1}. ${source.title} - ${source.url}\n`;
      });
    }

    prompt += '\n\nGenerate 3 helpful follow-up questions as a JSON array of strings.';
    return prompt;
  }

  extractQuestionsFromText(text) {
    // Try to extract questions from free-form text
    const lines = text.split('\n').filter(line => line.trim());
    const questions = [];

    for (const line of lines) {
      const trimmed = line.trim();
      // Look for numbered lists, bullet points, or questions
      if (trimmed.match(/^\d+\.|\*|\-|•/) || trimmed.endsWith('?')) {
        let question = trimmed.replace(/^\d+\.|\*|\-|•/, '').trim();
        if (question.length > 10 && question.length < 200) {
          questions.push(question);
        }
      }
    }

    return questions.slice(0, this.maxSuggestions);
  }

  getFallbackSuggestions(userMessage, sources) {
    const fallbacks = [
      'Can you explain this in more detail?',
      'What are the key points I should remember?',
      'Are there any examples or use cases?'
    ];

    // Try to make fallbacks more contextual
    if (userMessage.toLowerCase().includes('how')) {
      fallbacks[0] = 'What are the step-by-step instructions?';
      fallbacks[1] = 'Are there any prerequisites I should know?';
      fallbacks[2] = 'What tools or resources do I need?';
    } else if (userMessage.toLowerCase().includes('what')) {
      fallbacks[0] = 'How does this work in practice?';
      fallbacks[1] = 'What are some real-world examples?';
      fallbacks[2] = 'What should I consider when implementing this?';
    } else if (userMessage.toLowerCase().includes('why')) {
      fallbacks[0] = 'What are the benefits of this approach?';
      fallbacks[1] = 'Are there alternative solutions?';
      fallbacks[2] = 'How does this compare to other options?';
    }

    // Add source-specific suggestions if available
    if (sources && sources.length > 0) {
      fallbacks.push('What other information is available from these sources?');
    }

    return fallbacks.slice(0, this.maxSuggestions);
  }

  generateCacheKey(userMessage, botResponse) {
    // Create a simple hash-like key
    const combined = userMessage + '|' + botResponse.substring(0, 200);
    return Buffer.from(combined).toString('base64').substring(0, 32);
  }

  clearExpiredCache() {
    const now = Date.now();
    let cleared = 0;

    for (const [key, value] of this.suggestionCache.entries()) {
      if (now - value.timestamp > this.cacheTimeout) {
        this.suggestionCache.delete(key);
        cleared++;
      }
    }

    if (cleared > 0) {
      logger.debug('Cleared expired suggestion cache entries', { cleared });
    }
  }

  async generateContextualSuggestions(conversationHistory, currentTopic) {
    try {
      // Generate suggestions based on conversation flow and topic
      const recentMessages = conversationHistory.slice(-6); // Last 3 exchanges
      const topics = this.extractTopics(recentMessages);

      const suggestions = [];

      // Topic-based suggestions
      if (topics.includes('implementation') || topics.includes('how-to')) {
        suggestions.push(
          'What are the best practices for this?',
          'Are there any common mistakes to avoid?',
          'How can I test this implementation?'
        );
      } else if (topics.includes('comparison') || topics.includes('options')) {
        suggestions.push(
          'What are the pros and cons of each option?',
          'Which approach is recommended for beginners?',
          'How do I choose the best solution for my needs?'
        );
      } else if (topics.includes('troubleshooting') || topics.includes('error')) {
        suggestions.push(
          'How can I debug this issue?',
          'What are common causes of this problem?',
          'Are there any diagnostic tools I can use?'
        );
      } else {
        // General suggestions
        suggestions.push(
          'Can you provide a practical example?',
          'What should I learn next about this topic?',
          'Where can I find more detailed information?'
        );
      }

      return suggestions.slice(0, this.maxSuggestions);
    } catch (error) {
      logger.error('Failed to generate contextual suggestions', {
        error: error.message
      });
      return this.getFallbackSuggestions('', []);
    }
  }

  extractTopics(messages) {
    const topicKeywords = {
      'implementation': ['implement', 'build', 'create', 'develop', 'code'],
      'how-to': ['how', 'steps', 'process', 'procedure', 'method'],
      'comparison': ['compare', 'vs', 'versus', 'difference', 'better'],
      'options': ['options', 'alternatives', 'choices', 'solutions'],
      'troubleshooting': ['error', 'problem', 'issue', 'fix', 'debug'],
      'explanation': ['what', 'why', 'explain', 'understand', 'meaning']
    };

    const topics = [];
    const text = messages.map(m => m.content.toLowerCase()).join(' ');

    for (const [topic, keywords] of Object.entries(topicKeywords)) {
      if (keywords.some(keyword => text.includes(keyword))) {
        topics.push(topic);
      }
    }

    return topics;
  }

  getStats() {
    return {
      cacheSize: this.suggestionCache.size,
      maxSuggestions: this.maxSuggestions,
      cacheTimeout: this.cacheTimeout
    };
  }
}

export default SuggestionService;