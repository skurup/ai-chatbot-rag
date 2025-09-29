import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';
import { v4 as uuidv4 } from 'uuid';

class FileProcessor {
  constructor() {
    this.supportedTypes = {
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': this.processDOCX,
      'application/msword': this.processDOC,
      'text/plain': this.processTXT
    };
    
    this.maxFileSize = parseInt(process.env.MAX_FILE_SIZE) || 10 * 1024 * 1024; // 10MB default
  }

  async processFile(file) {
    try {
      if (!this.supportedTypes[file.mimetype]) {
        throw new Error(`Unsupported file type: ${file.mimetype}`);
      }

      if (file.size > this.maxFileSize) {
        throw new Error(`File too large. Maximum size: ${this.maxFileSize / (1024 * 1024)}MB`);
      }

      const processor = this.supportedTypes[file.mimetype];
      const content = await processor(file);

      return {
        id: uuidv4(),
        title: this.extractTitle(file.originalname, content),
        content: content,
        url: `file://${file.originalname}`,
        description: `Uploaded file: ${file.originalname}`,
        timestamp: new Date().toISOString(),
        wordCount: content.split(/\s+/).length,
        fileType: file.mimetype,
        fileName: file.originalname,
        fileSize: file.size,
        isManuallyAdded: true
      };

    } catch (error) {
      throw new Error(`Failed to process file: ${error.message}`);
    }
  }


  async processDOCX(file) {
    try {
      const result = await mammoth.extractRawText({ path: file.path });
      return result.value;
    } catch (error) {
      throw new Error(`DOCX processing failed: ${error.message}`);
    }
  }

  async processDOC(file) {
    try {
      // For .doc files, we'll try to extract text using mammoth
      // Note: This might not work perfectly for all .doc files
      const result = await mammoth.extractRawText({ path: file.path });
      return result.value;
    } catch (error) {
      throw new Error(`DOC processing failed: ${error.message}`);
    }
  }

  async processTXT(file) {
    try {
      return fs.readFileSync(file.path, 'utf8');
    } catch (error) {
      throw new Error(`TXT processing failed: ${error.message}`);
    }
  }

  extractTitle(filename, content) {
    // Try to extract title from content first
    const lines = content.split('\n').filter(line => line.trim().length > 0);
    if (lines.length > 0) {
      const firstLine = lines[0].trim();
      if (firstLine.length > 5 && firstLine.length < 100) {
        return firstLine;
      }
    }

    // Fallback to filename without extension
    return path.parse(filename).name;
  }

  cleanup(file) {
    try {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    } catch (error) {
      console.error('Failed to cleanup file:', error.message);
    }
  }

  getSupportedTypes() {
    return Object.keys(this.supportedTypes);
  }
}

export default FileProcessor;
