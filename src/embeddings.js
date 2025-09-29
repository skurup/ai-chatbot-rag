import OpenAI from 'openai';

class EmbeddingService {
  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
    this.model = 'text-embedding-ada-002';
    this.embeddingCache = new Map();
  }

  async createEmbedding(text) {
    if (!text || text.trim().length === 0) {
      throw new Error('Text cannot be empty');
    }

    // Check cache first
    const cacheKey = this.hashText(text);
    if (this.embeddingCache.has(cacheKey)) {
      return this.embeddingCache.get(cacheKey);
    }

    try {
      const response = await this.openai.embeddings.create({
        model: this.model,
        input: text.trim()
      });

      const embedding = response.data[0].embedding;

      // Cache the result
      this.embeddingCache.set(cacheKey, embedding);

      return embedding;
    } catch (error) {
      console.error('OpenAI embedding error:', error.message);
      throw new Error(`Failed to create embedding: ${error.message}`);
    }
  }

  async createEmbeddings(texts) {
    if (!Array.isArray(texts) || texts.length === 0) {
      throw new Error('Texts must be a non-empty array');
    }

    // Filter out empty texts
    const validTexts = texts.filter(text => text && text.trim().length > 0);

    if (validTexts.length === 0) {
      throw new Error('No valid texts provided');
    }

    try {
      // Process in batches to avoid API limits
      const batchSize = 20;
      const embeddings = [];

      for (let i = 0; i < validTexts.length; i += batchSize) {
        const batch = validTexts.slice(i, i + batchSize);

        const response = await this.openai.embeddings.create({
          model: this.model,
          input: batch.map(text => text.trim())
        });

        const batchEmbeddings = response.data.map(item => item.embedding);
        embeddings.push(...batchEmbeddings);

        // Add small delay between batches
        if (i + batchSize < validTexts.length) {
          await this.sleep(100);
        }
      }

      return embeddings;
    } catch (error) {
      console.error('OpenAI batch embeddings error:', error.message);
      throw new Error(`Failed to create embeddings: ${error.message}`);
    }
  }

  cosineSimilarity(vectorA, vectorB) {
    if (!vectorA || !vectorB || vectorA.length !== vectorB.length) {
      throw new Error('Vectors must be of equal length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vectorA.length; i++) {
      dotProduct += vectorA[i] * vectorB[i];
      normA += vectorA[i] * vectorA[i];
      normB += vectorB[i] * vectorB[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }

  findSimilarEmbeddings(queryEmbedding, embeddings, topK = 5, threshold = 0.7) {
    if (!queryEmbedding || !Array.isArray(embeddings)) {
      throw new Error('Invalid input parameters');
    }

    const similarities = embeddings.map((embedding, index) => ({
      index,
      similarity: this.cosineSimilarity(queryEmbedding, embedding.vector),
      embedding
    }));

    return similarities
      .filter(item => item.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, topK);
  }

  euclideanDistance(vectorA, vectorB) {
    if (!vectorA || !vectorB || vectorA.length !== vectorB.length) {
      throw new Error('Vectors must be of equal length');
    }

    let sum = 0;
    for (let i = 0; i < vectorA.length; i++) {
      sum += Math.pow(vectorA[i] - vectorB[i], 2);
    }

    return Math.sqrt(sum);
  }

  dotProduct(vectorA, vectorB) {
    if (!vectorA || !vectorB || vectorA.length !== vectorB.length) {
      throw new Error('Vectors must be of equal length');
    }

    let product = 0;
    for (let i = 0; i < vectorA.length; i++) {
      product += vectorA[i] * vectorB[i];
    }

    return product;
  }

  normalize(vector) {
    const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    return magnitude === 0 ? vector : vector.map(val => val / magnitude);
  }

  hashText(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString();
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  getStats() {
    return {
      model: this.model,
      cacheSize: this.embeddingCache.size,
      cacheKeys: Array.from(this.embeddingCache.keys()).slice(0, 10) // Show first 10 cache keys
    };
  }

  clearCache() {
    this.embeddingCache.clear();
  }

  getCacheSize() {
    return this.embeddingCache.size;
  }
}

export default EmbeddingService;