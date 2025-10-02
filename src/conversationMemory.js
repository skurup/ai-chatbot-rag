import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ConversationMemory {
  constructor() {
    this.conversations = new Map();
    this.dataDir = path.join(__dirname, '..', 'data', 'conversations');
    this.maxHistoryLength = parseInt(process.env.MAX_CONVERSATION_HISTORY) || 50;
    this.maxConversations = parseInt(process.env.MAX_STORED_CONVERSATIONS) || 1000;

    this.ensureDataDirectory();
    this.loadConversations();

    // Auto-save every 5 minutes
    setInterval(() => this.saveAllConversations(), 5 * 60 * 1000);
  }

  ensureDataDirectory() {
    try {
      if (!fs.existsSync(this.dataDir)) {
        fs.mkdirSync(this.dataDir, { recursive: true });
        logger.info('Created conversations directory', { path: this.dataDir });
      }
    } catch (error) {
      logger.error('Failed to create conversations directory', {
        error: error.message,
        path: this.dataDir
      });
    }
  }

  loadConversations() {
    try {
      const files = fs.readdirSync(this.dataDir).filter(file => file.endsWith('.json'));

      for (const file of files) {
        try {
          const filePath = path.join(this.dataDir, file);
          const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
          const conversationId = path.basename(file, '.json');

          this.conversations.set(conversationId, {
            id: conversationId,
            messages: data.messages || [],
            metadata: {
              created: data.metadata?.created || new Date().toISOString(),
              lastUpdated: data.metadata?.lastUpdated || new Date().toISOString(),
              messageCount: data.messages?.length || 0,
              title: data.metadata?.title || 'Untitled Conversation'
            }
          });
        } catch (fileError) {
          logger.warn('Failed to load conversation file', {
            file,
            error: fileError.message
          });
        }
      }

      logger.info('Loaded conversations from disk', {
        count: this.conversations.size
      });
    } catch (error) {
      logger.warn('Failed to load conversations', { error: error.message });
    }
  }

  saveConversation(conversationId) {
    try {
      const conversation = this.conversations.get(conversationId);
      if (!conversation) return false;

      const filePath = path.join(this.dataDir, `${conversationId}.json`);
      const data = {
        id: conversationId,
        messages: conversation.messages,
        metadata: {
          ...conversation.metadata,
          lastUpdated: new Date().toISOString()
        }
      };

      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      return true;
    } catch (error) {
      logger.error('Failed to save conversation', {
        conversationId,
        error: error.message
      });
      return false;
    }
  }

  saveAllConversations() {
    let saved = 0;
    let failed = 0;

    for (const conversationId of this.conversations.keys()) {
      if (this.saveConversation(conversationId)) {
        saved++;
      } else {
        failed++;
      }
    }

    if (saved > 0 || failed > 0) {
      logger.info('Auto-saved conversations', { saved, failed });
    }
  }

  addMessage(conversationId, message, response, sources = [], ratings = null, suggestedQuestions = []) {
    try {
      if (!this.conversations.has(conversationId)) {
        this.createConversation(conversationId, message);
      }

      const conversation = this.conversations.get(conversationId);
      const timestamp = new Date().toISOString();

      // Add user message
      conversation.messages.push({
        id: this.generateMessageId(),
        type: 'user',
        content: message,
        timestamp,
        metadata: {}
      });

      // Add bot response
      conversation.messages.push({
        id: this.generateMessageId(),
        type: 'bot',
        content: response,
        timestamp,
        metadata: {
          sources: sources || [],
          suggestedQuestions: suggestedQuestions || [],
          rating: ratings || null
        }
      });

      // Trim history if too long
      if (conversation.messages.length > this.maxHistoryLength * 2) {
        const excess = conversation.messages.length - this.maxHistoryLength * 2;
        conversation.messages.splice(0, excess);
        logger.debug('Trimmed conversation history', {
          conversationId,
          removedMessages: excess
        });
      }

      // Update metadata
      conversation.metadata.lastUpdated = timestamp;
      conversation.metadata.messageCount = conversation.messages.length;

      // Update title if this is early in the conversation
      if (conversation.messages.length <= 4) {
        conversation.metadata.title = this.generateTitle(message);
      }

      // Save to disk
      this.saveConversation(conversationId);

      logger.debug('Added message to conversation', {
        conversationId,
        messageCount: conversation.messages.length
      });

      return true;
    } catch (error) {
      logger.error('Failed to add message to conversation', {
        conversationId,
        error: error.message
      });
      return false;
    }
  }

  createConversation(conversationId, initialMessage = '') {
    try {
      // Check if we need to remove old conversations
      if (this.conversations.size >= this.maxConversations) {
        this.cleanupOldConversations();
      }

      const conversation = {
        id: conversationId,
        messages: [],
        metadata: {
          created: new Date().toISOString(),
          lastUpdated: new Date().toISOString(),
          messageCount: 0,
          title: this.generateTitle(initialMessage)
        }
      };

      this.conversations.set(conversationId, conversation);

      logger.info('Created new conversation', { conversationId });
      return conversation;
    } catch (error) {
      logger.error('Failed to create conversation', {
        conversationId,
        error: error.message
      });
      return null;
    }
  }

  getConversation(conversationId) {
    return this.conversations.get(conversationId) || null;
  }

  getConversationHistory(conversationId, limit = null) {
    const conversation = this.conversations.get(conversationId);
    if (!conversation) return [];

    let messages = conversation.messages;
    if (limit && messages.length > limit) {
      messages = messages.slice(-limit);
    }

    return messages;
  }

  getContextMessages(conversationId, maxTokens = 4000) {
    const conversation = this.conversations.get(conversationId);
    if (!conversation || conversation.messages.length === 0) return [];

    // Estimate tokens (rough approximation: 1 token ≈ 4 characters)
    const messages = [];
    let tokenCount = 0;

    // Start from the most recent messages and work backwards
    for (let i = conversation.messages.length - 1; i >= 0; i--) {
      const message = conversation.messages[i];
      const messageTokens = Math.ceil(message.content.length / 4);

      if (tokenCount + messageTokens > maxTokens && messages.length > 0) {
        break;
      }

      messages.unshift({
        role: message.type === 'user' ? 'user' : 'assistant',
        content: message.content,
        timestamp: message.timestamp
      });

      tokenCount += messageTokens;
    }

    return messages;
  }

  searchConversations(query, limit = 10) {
    const results = [];
    const queryLower = query.toLowerCase();

    for (const conversation of this.conversations.values()) {
      let relevanceScore = 0;
      const matchingMessages = [];

      // Search in title
      if (conversation.metadata.title.toLowerCase().includes(queryLower)) {
        relevanceScore += 10;
      }

      // Search in messages
      for (const message of conversation.messages) {
        if (message.content.toLowerCase().includes(queryLower)) {
          relevanceScore += message.type === 'user' ? 2 : 1;
          matchingMessages.push({
            ...message,
            excerpt: this.extractExcerpt(message.content, query)
          });
        }
      }

      if (relevanceScore > 0) {
        results.push({
          conversation: {
            id: conversation.id,
            title: conversation.metadata.title,
            lastUpdated: conversation.metadata.lastUpdated,
            messageCount: conversation.metadata.messageCount
          },
          relevanceScore,
          matchingMessages: matchingMessages.slice(0, 3) // Limit excerpts
        });
      }
    }

    // Sort by relevance and limit results
    return results
      .sort((a, b) => b.relevanceScore - a.relevanceScore)
      .slice(0, limit);
  }

  rateResponse(conversationId, messageId, rating, feedback = '') {
    try {
      const conversation = this.conversations.get(conversationId);
      if (!conversation) return false;

      const message = conversation.messages.find(m => m.id === messageId);
      if (!message || message.type !== 'bot') return false;

      message.metadata.rating = {
        score: rating, // 1 for thumbs up, -1 for thumbs down
        feedback: feedback,
        timestamp: new Date().toISOString()
      };

      this.saveConversation(conversationId);

      logger.info('Response rated', {
        conversationId,
        messageId,
        rating
      });

      return true;
    } catch (error) {
      logger.error('Failed to rate response', {
        conversationId,
        messageId,
        error: error.message
      });
      return false;
    }
  }

  deleteConversation(conversationId) {
    try {
      this.conversations.delete(conversationId);

      const filePath = path.join(this.dataDir, `${conversationId}.json`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }

      logger.info('Deleted conversation', { conversationId });
      return true;
    } catch (error) {
      logger.error('Failed to delete conversation', {
        conversationId,
        error: error.message
      });
      return false;
    }
  }

  cleanupOldConversations() {
    try {
      const conversations = Array.from(this.conversations.values());
      conversations.sort((a, b) =>
        new Date(a.metadata.lastUpdated) - new Date(b.metadata.lastUpdated)
      );

      const toRemove = conversations.slice(0, Math.floor(this.maxConversations * 0.1));

      for (const conversation of toRemove) {
        this.deleteConversation(conversation.id);
      }

      logger.info('Cleaned up old conversations', {
        removed: toRemove.length
      });
    } catch (error) {
      logger.error('Failed to cleanup old conversations', {
        error: error.message
      });
    }
  }

  generateMessageId() {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  generateTitle(message) {
    if (!message || message.length === 0) return 'New Conversation';

    // Take first 50 characters and clean up
    let title = message.substring(0, 50).trim();

    // Remove question marks and clean up
    title = title.replace(/[?!]+$/, '');

    // Add ellipsis if truncated
    if (message.length > 50) {
      title += '...';
    }

    return title || 'New Conversation';
  }

  extractExcerpt(text, query, contextLength = 100) {
    const queryLower = query.toLowerCase();
    const textLower = text.toLowerCase();
    const index = textLower.indexOf(queryLower);

    if (index === -1) return text.substring(0, contextLength) + '...';

    const start = Math.max(0, index - contextLength / 2);
    const end = Math.min(text.length, index + query.length + contextLength / 2);

    let excerpt = text.substring(start, end);
    if (start > 0) excerpt = '...' + excerpt;
    if (end < text.length) excerpt = excerpt + '...';

    return excerpt;
  }

  getStats() {
    const conversations = Array.from(this.conversations.values());
    const totalMessages = conversations.reduce((sum, conv) => sum + conv.metadata.messageCount, 0);

    return {
      totalConversations: conversations.length,
      totalMessages,
      averageMessagesPerConversation: conversations.length > 0 ? totalMessages / conversations.length : 0,
      oldestConversation: conversations.length > 0 ?
        Math.min(...conversations.map(c => new Date(c.metadata.created).getTime())) : null,
      newestConversation: conversations.length > 0 ?
        Math.max(...conversations.map(c => new Date(c.metadata.lastUpdated).getTime())) : null
    };
  }

  // Get all conversations for export/backup
  getAllConversations() {
    return Array.from(this.conversations.values()).map(conv => ({
      ...conv,
      metadata: { ...conv.metadata }
    }));
  }
}

export default ConversationMemory;