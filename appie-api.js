// Appie API Service - Backend proxy implementation
class AppieApiService {
  constructor() {
    this.apiBaseUrl = typeof CONFIG !== 'undefined' ? CONFIG.API_BASE_URL : '';
  }

  async searchProducts(query, limit = 10) {
    if (!query || query.trim().length < 2) {
      return [];
    }

    try {
      console.log('[Appie API] Searching for:', query);
      
      const params = new URLSearchParams({
        query: query.trim(),
        limit: String(limit),
        _t: Date.now() // Cache busting parameter
      });

      const url = `${this.apiBaseUrl}?action=ahSearch&${params.toString()}`;
      
      const response = await fetch(url, {
        method: 'GET',
        cache: 'no-store' // Disable browser caching
      });

      if (!response.ok) {
        throw new Error(`Product search failed: ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.ok) {
        throw new Error(data.error || 'Search failed');
      }
      
      if (!data.products || !Array.isArray(data.products)) {
        return [];
      }

      console.log('[Appie API] Found', data.products.length, 'products');
      return data.products;
      
    } catch (error) {
      console.error('[Appie API] Search error:', error);
      throw error;
    }
  }

  formatPrice(price) {
    return new Intl.NumberFormat('nl-NL', {
      style: 'currency',
      currency: 'EUR'
    }).format(price);
  }
}

const appieApi = new AppieApiService();
