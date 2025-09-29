// URLs to scrape for building the knowledge base
// Add your target websites here

export const URLS_TO_SCRAPE = [
  // Example URLs - replace with your actual target sites
  'https://docs.atlan.com/',
  'https://docs.snowflake.com/index',

  // Add more URLs as needed
  // 'https://your-docs-site.com/api-reference',
  // 'https://your-company.com/faq',
  // 'https://your-blog.com/ai-articles',
];

// URL patterns to exclude during scraping
export const EXCLUDE_PATTERNS = [
  '/admin/',
  '/login/',
  '/signup/',
  '.pdf',
  '.zip',
  '.exe',
  'mailto:',
  'tel:',
  '#'
];

// Custom selectors for specific domains
export const DOMAIN_SELECTORS = {
  'docs.openai.com': {
    content: 'article, .docs-content, main',
    title: 'h1, .page-title',
    exclude: '.navigation, .sidebar, .footer'
  },

  // Add custom selectors for other domains
  // 'your-domain.com': {
  //   content: '.main-content, article',
  //   title: 'h1.title',
  //   exclude: '.ads, .comments'
  // }
};

// Rate limiting configuration per domain
export const DOMAIN_LIMITS = {
  'docs.openai.com': {
    delay: 2000, // 2 seconds between requests
    maxPages: 50
  },

  // Default limits for all other domains
  'default': {
    delay: 1000,
    maxPages: 25
  }
};

export default {
  URLS_TO_SCRAPE,
  EXCLUDE_PATTERNS,
  DOMAIN_SELECTORS,
  DOMAIN_LIMITS
};
