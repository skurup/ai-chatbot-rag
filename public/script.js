class ChatInterface {
    constructor() {
        this.conversationId = this.generateConversationId();
        this.isLoading = false;
        this.messageHistory = [];

        this.initializeElements();
        this.attachEventListeners();
        this.checkSystemHealth();
        this.loadAvailableSources();
        this.autoResizeTextarea();
    }

    initializeElements() {
        this.elements = {
            chatMessages: document.getElementById('chatMessages'),
            messageInput: document.getElementById('messageInput'),
            sendBtn: document.getElementById('sendBtn'),
            clearBtn: document.getElementById('clearBtn'),
            dashboardBtn: document.getElementById('dashboardBtn'),
            searchStrategy: document.getElementById('searchStrategy'),
            sourceFilter: document.getElementById('sourceFilter'),
            charCount: document.getElementById('charCount'),
            statusText: document.getElementById('statusText'),
            chunkCount: document.getElementById('chunkCount'),
            sourceCount: document.getElementById('sourceCount'),
            typingIndicator: document.getElementById('typingIndicator'),
            toast: document.getElementById('toast'),
            loadingOverlay: document.getElementById('loadingOverlay'),
            citationsContainer: document.getElementById('citationsContainer'),
            citationSummary: document.getElementById('citationSummary'),
            citationFilters: document.getElementById('citationFilters'),
            toggleCitations: document.getElementById('toggleCitations'),
            exportCitations: document.getElementById('exportCitations'),
            confidenceFilter: document.getElementById('confidenceFilter'),
            confidenceValue: document.getElementById('confidenceValue'),
            sourceTypeFilter: document.getElementById('sourceTypeFilter'),
            totalSources: document.getElementById('totalSources'),
            avgConfidence: document.getElementById('avgConfidence'),
            coverage: document.getElementById('coverage'),
            exportConversationBtn: document.getElementById('exportConversationBtn'),
            exportFormat: document.getElementById('exportFormat')
        };
    }

    attachEventListeners() {
        // Send message
        this.elements.sendBtn.addEventListener('click', () => this.sendMessage());

        // Keyboard shortcuts
        this.elements.messageInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                this.sendMessage();
            }
        });

        // Input validation
        this.elements.messageInput.addEventListener('input', () => {
            this.updateCharCount();
            this.toggleSendButton();
        });

        // Clear chat
        this.elements.clearBtn.addEventListener('click', () => this.clearChat());

        // Dashboard
        this.elements.dashboardBtn.addEventListener('click', () => {
            window.open('/dashboard', '_blank');
        });

        // Export conversation
        if (this.elements.exportConversationBtn) {
            this.elements.exportConversationBtn.addEventListener('click', () => this.exportConversation());
        }

        // Citation controls
        if (this.elements.toggleCitations) {
            this.elements.toggleCitations.addEventListener('click', () => this.toggleCitationDetails());
        }

        if (this.elements.exportCitations) {
            this.elements.exportCitations.addEventListener('click', () => this.exportCitations());
        }

        // Citation filters
        if (this.elements.confidenceFilter) {
            this.elements.confidenceFilter.addEventListener('input', (e) => {
                this.elements.confidenceValue.textContent = `${e.target.value}%`;
                this.filterCitations();
            });
        }

        if (this.elements.sourceTypeFilter) {
            this.elements.sourceTypeFilter.addEventListener('change', () => this.filterCitations());
        }

        // Auto-resize textarea
        this.elements.messageInput.addEventListener('input', () => this.autoResizeTextarea());

        // Citation action buttons (event delegation)
        document.addEventListener('click', (e) => {
            if (e.target.closest('.view-source-btn')) {
                e.preventDefault();
                const button = e.target.closest('.view-source-btn');
                const url = button.dataset.url;
                if (url) {
                    console.log('Opening source URL:', url);
                    window.open(url, '_blank');
                } else {
                    console.error('No URL found for view source button');
                }
            }
            
            if (e.target.closest('.copy-excerpt-btn')) {
                e.preventDefault();
                const button = e.target.closest('.copy-excerpt-btn');
                const excerpt = button.dataset.excerpt;
                if (excerpt) {
                    navigator.clipboard.writeText(excerpt).then(() => {
                        this.showToast('Excerpt copied to clipboard!', 'success');
                    }).catch(err => {
                        console.error('Failed to copy excerpt:', err);
                        this.showToast('Failed to copy excerpt', 'error');
                    });
                } else {
                    console.error('No excerpt found for copy button');
                }
            }
        });
    }

    generateConversationId() {
        return `chat_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    updateCharCount() {
        const length = this.elements.messageInput.value.length;
        this.elements.charCount.textContent = `${length}/1000`;

        if (length > 900) {
            this.elements.charCount.style.color = 'var(--error-color)';
        } else if (length > 700) {
            this.elements.charCount.style.color = 'var(--warning-color)';
        } else {
            this.elements.charCount.style.color = 'var(--text-muted)';
        }
    }

    toggleSendButton() {
        const hasText = this.elements.messageInput.value.trim().length > 0;
        this.elements.sendBtn.disabled = !hasText || this.isLoading;
    }

    autoResizeTextarea() {
        const textarea = this.elements.messageInput;
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
    }

    async checkSystemHealth() {
        try {
            const response = await fetch('/api/health');
            const health = await response.json();

            if (health.initialized) {
                this.elements.statusText.textContent = 'Ready';
                this.elements.chunkCount.textContent = `Chunks: ${health.services.rag.totalChunks}`;
                this.elements.sourceCount.textContent = `Sources: ${health.services.rag.totalSources}`;
                this.hideLoadingDots();
            } else {
                this.elements.statusText.textContent = 'Initializing knowledge base...';
                this.showLoadingDots();

                // Check again in 3 seconds
                setTimeout(() => this.checkSystemHealth(), 3000);
            }
        } catch (error) {
            console.error('Health check failed:', error);
            this.elements.statusText.textContent = 'System offline';
            this.hideLoadingDots();
            this.showToast('System health check failed', 'error');
        }
    }

    async loadAvailableSources() {
        try {
            const response = await fetch('/api/sources');
            const data = await response.json();

            if (data.success && data.sources) {
                this.updateSourceFilter(data.sources);
            }
        } catch (error) {
            console.error('Failed to load sources:', error);
        }
    }

    updateSourceFilter(sources) {
        const sourceFilter = this.elements.sourceFilter;

        // Clear existing options except "All Sources"
        sourceFilter.innerHTML = '<option value="all">📚 All Sources</option>';

        // Add source options
        sources.forEach(source => {
            const option = document.createElement('option');
            option.value = source.title;
            option.textContent = `📄 ${source.title} (${source.chunkCount} chunks)`;
            if (source.isManuallyAdded) {
                option.textContent += ' 🔖';
            }
            sourceFilter.appendChild(option);
        });
    }

    showLoadingDots() {
        const dots = document.querySelector('.loading-dots');
        if (dots) dots.style.display = 'flex';
    }

    hideLoadingDots() {
        const dots = document.querySelector('.loading-dots');
        if (dots) dots.style.display = 'none';
    }

    suggestSearchStrategy(message) {
        const msg = message.toLowerCase();

        // Auto-select contextual for follow-up questions
        if (this.messageHistory.length > 0 &&
            (msg.includes('what about') || msg.includes('tell me more') ||
             msg.includes('also') || msg.includes('additionally') ||
             msg.includes('furthermore') || msg.startsWith('and ') ||
             msg.includes('follow up') || msg.includes('continue'))) {
            return 'contextual';
        }

        // Auto-select exact search for specific lookups
        if (msg.includes('exact') || msg.includes('specific') ||
            msg.includes('definition of') || msg.includes('what is') ||
            msg.match(/["'].*["']/) || // quoted terms
            msg.includes('api key') || msg.includes('error code') ||
            msg.includes('version') || msg.includes('id:') ||
            msg.includes('name:')) {
            return 'keyword';
        }

        // Auto-select concept search for broad topics
        if (msg.includes('explain') || msg.includes('understand') ||
            msg.includes('concept') || msg.includes('how does') ||
            msg.includes('why') || msg.includes('compare') ||
            msg.includes('difference between') || msg.includes('similar to')) {
            return 'semantic';
        }

        // Default to hybrid for everything else
        return 'hybrid';
    }

    async sendMessage() {
        const message = this.elements.messageInput.value.trim();
        if (!message || this.isLoading) return;

        // Suggest optimal search strategy if user hasn't manually changed it
        const suggestedStrategy = this.suggestSearchStrategy(message);
        if (this.elements.searchStrategy.value === 'hybrid' || this.messageHistory.length === 0) {
            this.elements.searchStrategy.value = suggestedStrategy;
        }

        this.isLoading = true;
        this.toggleSendButton();

        // Add user message to UI
        this.addMessage(message, 'user');

        // Clear input
        this.elements.messageInput.value = '';
        this.updateCharCount();
        this.autoResizeTextarea();

        // Show typing indicator
        this.showTypingIndicator();

        try {
            const response = await fetch('/api/chat', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    message,
                    conversationId: this.conversationId,
                    searchStrategy: this.elements.searchStrategy.value,
                    sourceFilter: this.elements.sourceFilter.value
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            if (data.success) {
                // Use the messageId provided by the backend for the bot response
                const botMessageId = this.addMessage(data.response, 'bot', data.suggestedQuestions, data.messageId);
                console.log('[CITATIONS DEBUG] Sources received:', data.sources);
                console.log('[CITATIONS DEBUG] Enhanced citations received:', data.citations);
                console.log('[MESSAGE ID DEBUG] Backend provided messageId:', data.messageId);
                this.updateCitations(data.sources || [], data.citations);
                this.messageHistory.push({ user: message, bot: data.response });

                // Show suggested questions if available
                if (data.suggestedQuestions && data.suggestedQuestions.length > 0) {
                    this.showSuggestions(data.suggestedQuestions);
                }

                // Update stats if available
                if (data.retrievedChunks !== undefined) {
                    this.showToast(`Found ${data.retrievedChunks} relevant chunks using ${data.searchStrategy} search`, 'success');
                }
            } else {
                throw new Error(data.error || 'Unknown error occurred');
            }

        } catch (error) {
            console.error('Send message error:', error);
            this.addMessage(
                'I apologize, but I encountered an error processing your request. Please try again.',
                'bot'
            );
            this.showToast(`Error: ${error.message}`, 'error');
        } finally {
            this.isLoading = false;
            this.hideTypingIndicator();
            this.toggleSendButton();
        }
    }

    addMessage(content, sender, suggestedQuestions = [], providedMessageId = null) {
        // Use provided messageId from backend if available, otherwise generate one
        const messageId = providedMessageId || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${sender}-message`;
        messageDiv.dataset.messageId = messageId;

        const avatar = document.createElement('div');
        avatar.className = 'message-avatar';
        avatar.innerHTML = sender === 'user'
            ? '<i class="fas fa-user"></i>'
            : '<i class="fas fa-robot"></i>';

        const messageContent = document.createElement('div');
        messageContent.className = 'message-content';

        const bubble = document.createElement('div');
        bubble.className = 'message-bubble';

        // Process content for better formatting
        const formattedContent = this.formatMessageContent(content);
        bubble.innerHTML = formattedContent;

        messageContent.appendChild(bubble);

        // Add rating buttons for bot messages
        if (sender === 'bot') {
            const ratingDiv = this.createRatingButtons(messageId);
            messageContent.appendChild(ratingDiv);
        }

        messageDiv.appendChild(avatar);
        messageDiv.appendChild(messageContent);

        // Remove welcome message if this is the first real message
        const welcomeMessage = this.elements.chatMessages.querySelector('.welcome-message');
        if (welcomeMessage && sender === 'user') {
            welcomeMessage.remove();
        }

        this.elements.chatMessages.appendChild(messageDiv);
        this.scrollToBottom();

        return messageId;
    }

    formatMessageContent(content) {
        // Convert markdown-like formatting to HTML
        return content
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.*?)\*/g, '<em>$1</em>')
            .replace(/`(.*?)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>')
            .replace(/^- (.+)$/gm, '<li>$1</li>')
            .replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>');
    }

    updateCitations(sources, enhancedCitations = null) {
        console.log('[CITATIONS DEBUG] updateCitations called with:', sources, enhancedCitations);
        const citationsContainer = this.elements.citationsContainer;
        console.log('[CITATIONS DEBUG] citationsContainer element:', citationsContainer);

        if (!citationsContainer) {
            console.error('[CITATIONS DEBUG] citationsContainer element not found!');
            return;
        }

        // Store current citations for filtering
        this.currentCitations = enhancedCitations || { citations: [], summary: { totalSources: 0, confidence: 0, coverage: 0 } };

        // Fallback: if no enhanced citations but we have sources, create basic citations
        if ((!enhancedCitations || !enhancedCitations.citations || enhancedCitations.citations.length === 0) && sources && sources.length > 0) {
            console.log('[CITATIONS DEBUG] Creating fallback citations from sources');
            this.currentCitations = {
                citations: sources.map((source, index) => ({
                    id: `fallback_${index}`,
                    source: {
                        title: source.title || 'Untitled Source',
                        url: source.url,
                        type: 'web_page',
                        domain: this.extractDomain(source.url)
                    },
                    content: {
                        excerpt: source.excerpt || 'No excerpt available',
                        wordCount: 0
                    },
                    relevance: {
                        confidence: source.similarity || 0.5,
                        similarity: source.similarity || 0.5,
                        matchType: 'semantic_match',
                        keywords: []
                    },
                    metadata: {
                        position: index + 1,
                        totalResults: sources.length
                    },
                    highlights: []
                })),
                summary: {
                    totalSources: sources.length,
                    confidence: sources.reduce((sum, s) => sum + (s.similarity || 0.5), 0) / sources.length,
                    coverage: 1.0
                }
            };
        }

        if (!sources || sources.length === 0) {
            console.log('[CITATIONS DEBUG] No sources, showing placeholder');
            this.showNoCitations();
            return;
        }

        // Update citation summary
        this.updateCitationSummary(this.currentCitations.summary);

        // Show citation filters if we have citations
        if (this.currentCitations.citations && this.currentCitations.citations.length > 0) {
            this.showCitationFilters();
        }

        // Create enhanced citations list
        this.renderEnhancedCitations(this.currentCitations.citations);
    }

    extractDomain(url) {
        try {
            if (url.startsWith('file://')) return 'Local File';
            const domain = new URL(url).hostname;
            return domain.replace('www.', '');
        } catch (error) {
            return 'unknown';
        }
    }

    showNoCitations() {
        this.elements.citationsContainer.innerHTML = `
            <div class="no-citations">
                <i class="fas fa-book-open"></i>
                <p>No citations available for this response.</p>
                <p>The AI provided a general response without specific source references.</p>
            </div>
        `;
        
        // Hide summary and filters
        if (this.elements.citationSummary) {
            this.elements.citationSummary.style.display = 'none';
        }
        if (this.elements.citationFilters) {
            this.elements.citationFilters.style.display = 'none';
        }
    }

    updateCitationSummary(summary) {
        if (!this.elements.citationSummary) return;

        this.elements.citationSummary.style.display = 'block';
        
        if (this.elements.totalSources) {
            this.elements.totalSources.textContent = summary.totalSources || 0;
        }
        
        if (this.elements.avgConfidence) {
            this.elements.avgConfidence.textContent = `${((summary.confidence || 0) * 100).toFixed(1)}%`;
        }
        
        if (this.elements.coverage) {
            this.elements.coverage.textContent = `${((summary.coverage || 0) * 100).toFixed(1)}%`;
        }
    }

    showCitationFilters() {
        if (this.elements.citationFilters) {
            this.elements.citationFilters.style.display = 'block';
        }
    }

    renderEnhancedCitations(citations) {
        if (!citations || citations.length === 0) {
            this.showNoCitations();
            return;
        }

        const citationsList = document.createElement('div');
        citationsList.className = 'citations-list';

        citations.forEach((citation, index) => {
            const citationItem = document.createElement('div');
            citationItem.className = 'citation-item';
            citationItem.dataset.confidence = Math.round(citation.relevance.confidence * 100);
            citationItem.dataset.sourceType = citation.source.type;

            const confidenceClass = this.getConfidenceClass(citation.relevance.confidence);
            const highlights = citation.highlights ? citation.highlights.map(h => h.word).slice(0, 5) : [];

            citationItem.innerHTML = `
                <div class="citation-header">
                    <h4 class="citation-title">${citation.source.title}</h4>
                    <span class="citation-confidence ${confidenceClass}">
                        ${Math.round(citation.relevance.confidence * 100)}%
                    </span>
                </div>
                
                <div class="citation-meta">
                    <div class="citation-domain">
                        <i class="fas fa-globe"></i>
                        <span>${citation.source.domain}</span>
                    </div>
                    <span class="citation-type">${citation.source.type}</span>
                    <span class="citation-position">#${citation.metadata.position}</span>
                </div>

                <div class="citation-excerpt">
                    ${citation.content.excerpt}
                </div>

                ${highlights.length > 0 ? `
                    <div class="citation-highlights">
                        ${highlights.map(highlight => `<span class="highlight-tag">${highlight}</span>`).join('')}
                    </div>
                ` : ''}

                <div class="citation-actions">
                    <button class="citation-action primary view-source-btn" data-url="${citation.source.url}">
                        <i class="fas fa-external-link-alt"></i>
                        View Source
                    </button>
                    <button class="citation-action copy-excerpt-btn" data-excerpt="${citation.content.excerpt.replace(/"/g, '&quot;')}">
                        <i class="fas fa-copy"></i>
                        Copy Excerpt
                    </button>
                </div>
                <!-- Debug info -->
                <div style="font-size: 0.7rem; color: #666; margin-top: 0.5rem;">
                    URL: ${citation.source.url}
                </div>
            `;

            citationsList.appendChild(citationItem);
        });

        this.elements.citationsContainer.innerHTML = '';
        this.elements.citationsContainer.appendChild(citationsList);
    }

    getConfidenceClass(confidence) {
        if (confidence >= 0.8) return 'high';
        if (confidence >= 0.6) return 'medium';
        return 'low';
    }

    toggleCitationDetails() {
        const filters = this.elements.citationFilters;
        if (filters) {
            const isVisible = filters.style.display !== 'none';
            filters.style.display = isVisible ? 'none' : 'block';
        }
    }

    exportCitations() {
        if (!this.currentCitations || !this.currentCitations.citations) {
            this.showToast('No citations to export', 'warning');
            return;
        }

        const exportData = {
            timestamp: new Date().toISOString(),
            summary: this.currentCitations.summary,
            citations: this.currentCitations.citations.map(citation => ({
                title: citation.source.title,
                url: citation.source.url,
                domain: citation.source.domain,
                type: citation.source.type,
                confidence: citation.relevance.confidence,
                excerpt: citation.content.excerpt,
                highlights: citation.highlights?.map(h => h.word) || []
            }))
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `citations_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.showToast('Citations exported successfully', 'success');
    }

    async exportConversation() {
        if (this.messageHistory.length === 0) {
            this.showToast('No conversation to export', 'warning');
            return;
        }

        try {
            const format = this.elements.exportFormat?.value || 'json';

            // Show loading state
            this.elements.exportConversationBtn.disabled = true;
            this.elements.exportConversationBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Exporting...';

            const response = await fetch(`/api/conversation/${this.conversationId}/export?format=${format}`);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            if (data.success) {
                // Trigger download using the backend-provided download URL
                const downloadUrl = data.downloadUrl;

                console.log('[EXPORT DEBUG] Export successful:', data);
                console.log('[EXPORT DEBUG] Download URL:', downloadUrl);
                console.log('[EXPORT DEBUG] Filename:', data.filename);

                // Create download link with proper attributes
                const a = document.createElement('a');
                a.href = downloadUrl;
                a.download = data.filename;
                a.style.display = 'none';
                a.setAttribute('target', '_blank');

                document.body.appendChild(a);
                console.log('[EXPORT DEBUG] Download link created and added to DOM');

                // Add a small delay to ensure the element is in the DOM
                setTimeout(() => {
                    console.log('[EXPORT DEBUG] Triggering download click');

                    try {
                        // Primary method: programmatic click
                        a.click();
                    } catch (error) {
                        console.warn('[EXPORT DEBUG] Primary download failed, trying fallback:', error);

                        // Fallback method: open in new window
                        try {
                            window.open(downloadUrl, '_blank');
                        } catch (fallbackError) {
                            console.error('[EXPORT DEBUG] Fallback download also failed:', fallbackError);
                            this.showToast('Download failed. Please check browser settings.', 'error');
                        }
                    }

                    // Clean up after a delay
                    setTimeout(() => {
                        if (document.body.contains(a)) {
                            document.body.removeChild(a);
                            console.log('[EXPORT DEBUG] Download link removed from DOM');
                        }
                    }, 100);
                }, 10);

                this.showToast(`Conversation exported as ${format.toUpperCase()}`, 'success');
            } else {
                throw new Error(data.error || 'Export failed');
            }

        } catch (error) {
            console.error('Export conversation error:', error);
            this.showToast(`Export failed: ${error.message}`, 'error');
        } finally {
            // Reset button state
            this.elements.exportConversationBtn.disabled = false;
            this.elements.exportConversationBtn.innerHTML = '<i class="fas fa-file-export"></i> Export Chat';
        }
    }

    filterCitations() {
        if (!this.currentCitations || !this.currentCitations.citations) return;

        const minConfidence = parseInt(this.elements.confidenceFilter?.value || 0);
        const sourceType = this.elements.sourceTypeFilter?.value || 'all';

        const filteredCitations = this.currentCitations.citations.filter(citation => {
            const confidenceMatch = Math.round(citation.relevance.confidence * 100) >= minConfidence;
            const typeMatch = sourceType === 'all' || citation.source.type === sourceType;
            return confidenceMatch && typeMatch;
        });

        this.renderEnhancedCitations(filteredCitations);
    }

    showTypingIndicator() {
        this.elements.typingIndicator.classList.add('show');
        this.scrollToBottom();
    }

    hideTypingIndicator() {
        this.elements.typingIndicator.classList.remove('show');
    }

    scrollToBottom() {
        setTimeout(() => {
            this.elements.chatMessages.scrollTop = this.elements.chatMessages.scrollHeight;
        }, 100);
    }

    clearChat() {
        if (confirm('Are you sure you want to clear the chat history?')) {
            // Clear chat messages
            const chatContainer = this.elements.chatMessages;
            const userMessages = chatContainer.querySelectorAll('.user-message, .bot-message:not(.welcome-message .bot-message)');
            userMessages.forEach(message => message.remove());

            // Show the welcome message again
            const welcomeMessage = chatContainer.querySelector('.welcome-message');
            if (welcomeMessage) {
                welcomeMessage.style.display = 'block';
            }

            // Clear citations
            this.elements.citationsContainer.innerHTML = `
                <div class="no-citations">
                    <i class="fas fa-book-open"></i>
                    <p>Citations will appear here when you ask questions.</p>
                    <p>Sources used to generate responses will be listed with relevance scores.</p>
                </div>
            `;

            // Reset state
            this.messageHistory = [];
            this.conversationId = this.generateConversationId();

            // Clear any typing indicators
            this.hideTypingIndicator();

            // Clear server-side history
            fetch(`/api/conversation/${this.conversationId}`, {
                method: 'DELETE'
            }).catch(error => {
                console.error('Failed to clear server history:', error);
            });

            this.showToast('Chat history cleared', 'success');

            // Focus on input
            this.elements.messageInput.focus();
        }
    }

    showToast(message, type = 'info') {
        this.elements.toast.textContent = message;
        this.elements.toast.className = `toast ${type}`;
        this.elements.toast.classList.add('show');

        setTimeout(() => {
            this.elements.toast.classList.remove('show');
        }, 4000);
    }

    showLoadingOverlay(show = true) {
        if (show) {
            this.elements.loadingOverlay.classList.add('show');
        } else {
            this.elements.loadingOverlay.classList.remove('show');
        }
    }

    // New methods for enhanced features
    createRatingButtons(messageId) {
        const ratingDiv = document.createElement('div');
        ratingDiv.className = 'message-rating';
        ratingDiv.innerHTML = `
            <div class="rating-buttons">
                <button class="rating-btn thumbs-up" data-message-id="${messageId}" data-rating="1" title="Helpful">
                    <i class="fas fa-thumbs-up"></i>
                </button>
                <button class="rating-btn thumbs-down" data-message-id="${messageId}" data-rating="-1" title="Not helpful">
                    <i class="fas fa-thumbs-down"></i>
                </button>
            </div>
            <span class="rating-text">Was this helpful?</span>
        `;

        // Add event listeners
        const thumbsUp = ratingDiv.querySelector('.thumbs-up');
        const thumbsDown = ratingDiv.querySelector('.thumbs-down');

        thumbsUp.addEventListener('click', () => this.rateMessage(messageId, 1, thumbsUp, thumbsDown));
        thumbsDown.addEventListener('click', () => this.rateMessage(messageId, -1, thumbsUp, thumbsDown));

        return ratingDiv;
    }

    async rateMessage(messageId, rating, thumbsUpBtn, thumbsDownBtn) {
        try {
            const response = await fetch(`/api/conversation/${this.conversationId}/rate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    messageId,
                    rating
                })
            });

            const data = await response.json();

            if (data.success) {
                // Update UI to show the rating
                thumbsUpBtn.classList.toggle('active', rating === 1);
                thumbsDownBtn.classList.toggle('active', rating === -1);

                // Update the text
                const ratingText = thumbsUpBtn.closest('.message-rating').querySelector('.rating-text');
                ratingText.textContent = rating === 1 ? 'Thanks for your feedback!' : 'Thanks, we\'ll improve!';

                this.showToast('Feedback recorded', 'success');
            } else {
                throw new Error(data.error || 'Failed to save rating');
            }
        } catch (error) {
            console.error('Rating error:', error);
            this.showToast('Failed to save rating', 'error');
        }
    }

    showSuggestions(suggestions) {
        const container = document.getElementById('suggestionsContainer');
        const list = document.getElementById('suggestionsList');

        if (!container || !list || !suggestions || suggestions.length === 0) {
            return;
        }

        // Clear existing suggestions
        list.innerHTML = '';

        // Add new suggestions
        suggestions.forEach((suggestion, index) => {
            const suggestionDiv = document.createElement('div');
            suggestionDiv.className = 'suggestion-item';
            suggestionDiv.innerHTML = `
                <i class="fas fa-lightbulb"></i>
                <span class="suggestion-text">${suggestion}</span>
            `;

            suggestionDiv.addEventListener('click', () => {
                this.elements.messageInput.value = suggestion;
                this.updateCharCount();
                this.toggleSendButton();
                this.hideSuggestions();
                this.elements.messageInput.focus();
            });

            list.appendChild(suggestionDiv);
        });

        // Show the container
        container.style.display = 'block';

        // Add hide button functionality
        const hideBtn = document.getElementById('hideSuggestions');
        if (hideBtn) {
            hideBtn.onclick = () => this.hideSuggestions();
        }
    }

    hideSuggestions() {
        const container = document.getElementById('suggestionsContainer');
        if (container) {
            container.style.display = 'none';
        }
    }

    async loadConversationHistory() {
        try {
            const response = await fetch('/api/conversations?limit=10');
            const data = await response.json();

            if (data.success && data.conversations.length > 0) {
                // Auto-load the most recent conversation if it exists
                const recentConversation = data.conversations[0];
                if (recentConversation.messageCount > 0) {
                    this.loadConversation(recentConversation.id);
                }
            }
        } catch (error) {
            console.error('Failed to load conversation history:', error);
        }
    }

    async loadConversation(conversationId) {
        try {
            const response = await fetch(`/api/conversation/${conversationId}/details`);
            const data = await response.json();

            if (data.success && data.conversation) {
                this.conversationId = conversationId;
                this.displayConversation(data.conversation);
            }
        } catch (error) {
            console.error('Failed to load conversation:', error);
        }
    }

    displayConversation(conversation) {
        // Clear current messages
        this.elements.chatMessages.innerHTML = '';

        // Display conversation messages
        conversation.messages.forEach(message => {
            this.addMessage(message.content, message.type, message.metadata?.suggestedQuestions || []);
        });

        this.scrollToBottom();
    }

    async searchConversations(query) {
        try {
            const response = await fetch(`/api/conversations/search?query=${encodeURIComponent(query)}&limit=10`);
            const data = await response.json();

            if (data.success) {
                return data.results;
            }
        } catch (error) {
            console.error('Search conversations error:', error);
        }
        return [];
    }

}

// Utility functions
class APIClient {
    static async request(endpoint, options = {}) {
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
            },
        };

        const response = await fetch(endpoint, { ...defaultOptions, ...options });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return response.json();
    }

    static async get(endpoint) {
        return this.request(endpoint);
    }

    static async post(endpoint, data) {
        return this.request(endpoint, {
            method: 'POST',
            body: JSON.stringify(data),
        });
    }

    static async delete(endpoint) {
        return this.request(endpoint, { method: 'DELETE' });
    }
}

// Enhanced error handling
window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
});

window.addEventListener('unhandledrejection', (event) => {
    console.error('Unhandled promise rejection:', event.reason);
});

// Performance monitoring
const performanceObserver = new PerformanceObserver((list) => {
    list.getEntries().forEach((entry) => {
        if (entry.entryType === 'navigation') {
            console.log(`Page load time: ${entry.loadEventEnd - entry.loadEventStart}ms`);
        }
    });
});

if ('PerformanceObserver' in window) {
    performanceObserver.observe({ entryTypes: ['navigation'] });
}


// Initialize the chat interface when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded: Initializing chat interface...');

    const chatInterface = new ChatInterface();
    console.log('DOMContentLoaded: ChatInterface created');

    // Make it globally accessible for debugging
    window.chatInterface = chatInterface;

    console.log('AI Chatbot with RAG initialized successfully');
    console.log('Available global objects:', {
        chatInterface: !!window.chatInterface
    });
});

// Service worker registration for PWA capabilities (optional)
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        // Uncomment to enable service worker
        // navigator.serviceWorker.register('/sw.js')
        //     .then((registration) => {
        //         console.log('SW registered: ', registration);
        //     })
        //     .catch((registrationError) => {
        //         console.log('SW registration failed: ', registrationError);
        //     });
    });
}