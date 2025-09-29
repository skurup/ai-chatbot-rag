import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

class ConversationExport {
  constructor() {
    this.exportDir = path.join(__dirname, '../exports');
    this.ensureExportDirectory();
  }

  ensureExportDirectory() {
    if (!fs.existsSync(this.exportDir)) {
      fs.mkdirSync(this.exportDir, { recursive: true });
    }
  }

  exportConversation(conversationId, messages, format = 'json') {
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const filename = `conversation_${conversationId}_${timestamp}`;
      
      const exportData = {
        conversationId,
        exportedAt: new Date().toISOString(),
        messageCount: messages.length,
        messages: messages.map(msg => ({
          role: msg.role,
          content: msg.content,
          timestamp: msg.timestamp
        }))
      };

      let filePath, content;

      switch (format.toLowerCase()) {
        case 'json':
          filePath = path.join(this.exportDir, `${filename}.json`);
          content = JSON.stringify(exportData, null, 2);
          break;

        case 'txt':
          filePath = path.join(this.exportDir, `${filename}.txt`);
          content = this.formatAsText(exportData);
          break;

        case 'csv':
          filePath = path.join(this.exportDir, `${filename}.csv`);
          content = this.formatAsCSV(exportData);
          break;

        case 'md':
          filePath = path.join(this.exportDir, `${filename}.md`);
          content = this.formatAsMarkdown(exportData);
          break;

        default:
          throw new Error(`Unsupported export format: ${format}`);
      }

      fs.writeFileSync(filePath, content, 'utf8');

      return {
        success: true,
        filename: path.basename(filePath),
        filePath,
        size: fs.statSync(filePath).size,
        format,
        messageCount: messages.length
      };

    } catch (error) {
      throw new Error(`Export failed: ${error.message}`);
    }
  }

  formatAsText(data) {
    let content = `Conversation Export\n`;
    content += `==================\n\n`;
    content += `Conversation ID: ${data.conversationId}\n`;
    content += `Exported: ${data.exportedAt}\n`;
    content += `Messages: ${data.messageCount}\n\n`;
    content += `Messages:\n`;
    content += `---------\n\n`;

    data.messages.forEach((msg, index) => {
      content += `${index + 1}. [${msg.role.toUpperCase()}] ${msg.timestamp}\n`;
      content += `${msg.content}\n\n`;
    });

    return content;
  }

  formatAsCSV(data) {
    let content = 'Role,Timestamp,Content\n';
    
    data.messages.forEach(msg => {
      const escapedContent = `"${msg.content.replace(/"/g, '""')}"`;
      content += `${msg.role},${msg.timestamp},${escapedContent}\n`;
    });

    return content;
  }

  formatAsMarkdown(data) {
    let content = `# Conversation Export\n\n`;
    content += `**Conversation ID:** ${data.conversationId}\n\n`;
    content += `**Exported:** ${data.exportedAt}\n\n`;
    content += `**Messages:** ${data.messageCount}\n\n`;
    content += `---\n\n`;

    data.messages.forEach((msg, index) => {
      const roleIcon = msg.role === 'user' ? '👤' : '🤖';
      content += `## ${roleIcon} ${msg.role.charAt(0).toUpperCase() + msg.role.slice(1)} (${msg.timestamp})\n\n`;
      content += `${msg.content}\n\n`;
    });

    return content;
  }

  importConversation(filePath) {
    try {
      if (!fs.existsSync(filePath)) {
        throw new Error('File not found');
      }

      const content = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(content);

      if (!data.messages || !Array.isArray(data.messages)) {
        throw new Error('Invalid conversation format');
      }

      return {
        success: true,
        conversationId: data.conversationId || 'imported',
        messages: data.messages,
        importedAt: new Date().toISOString(),
        messageCount: data.messages.length
      };

    } catch (error) {
      throw new Error(`Import failed: ${error.message}`);
    }
  }

  getExportHistory() {
    try {
      const files = fs.readdirSync(this.exportDir);
      return files
        .filter(file => file.startsWith('conversation_'))
        .map(file => {
          const filePath = path.join(this.exportDir, file);
          const stats = fs.statSync(filePath);
          return {
            filename: file,
            filePath,
            size: stats.size,
            created: stats.birthtime,
            modified: stats.mtime
          };
        })
        .sort((a, b) => b.created - a.created);
    } catch (error) {
      return [];
    }
  }

  deleteExport(filename) {
    try {
      const filePath = path.join(this.exportDir, filename);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        return { success: true };
      }
      throw new Error('File not found');
    } catch (error) {
      throw new Error(`Delete failed: ${error.message}`);
    }
  }
}

export default ConversationExport;
