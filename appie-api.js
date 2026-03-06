// Appie API Service - Vercel API proxy implementation
class AppieApiService {
  constructor() {
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  async getAnonymousToken() {
    // Return cached token if still valid
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      console.log('[Appie API] Using cached token');
      return this.accessToken;
    }

    try {
      console.log('[Appie API] Requesting new anonymous token...');
      
      const response = await fetch('/api/ah-token', {
        method: 'POST'
      });

      if (!response.ok) {
        throw new Error(`Token request failed: ${response.status}`);
      }

      const data = await response.json();
      this.accessToken = data.access_token;
      
      if (!this.accessToken) {
        throw new Error('No access token in response');
      }

      // Token expires in 1 hour, cache for 55 minutes
      this.tokenExpiry = Date.now() + (55 * 60 * 1000);

      console.log('[Appie API] Token obtained successfully');
      return this.accessToken;
      
    } catch (error) {
      console.error('[Appie API] Token error:', error);
      throw error;
    }
  }

  async searchProducts(query, limit = 10) {
    if (!query || query.trim().length < 2) {
      return [];
    }

    try {
      console.log('[Appie API] Searching for:', query);
      
      // Get token first
      const token = await this.getAnonymousToken();
      
      const params = new URLSearchParams({
        query: query.trim(),
        limit: String(limit)
      });

      const url = `/api/ah-search?${params.toString()}`;
      
      console.log('[Appie API] Search URL:', url);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      console.log('[Appie API] Response status:', response.status);

      if (!response.ok) {
        throw new Error(`Product search failed: ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.products || !Array.isArray(data.products)) {
        return [];
      }

      const products = data.products.map(product => ({
        id: product.webshopId || 0,
        title: product.title || 'Onbekend product',
        brand: product.brand || '',
        imageUrl: product.images?.[0]?.url || null,
        price: product.priceBeforeBonus || product.price?.now || 0,
        oldPrice: product.priceBeforeBonus || 0,
        unitSize: product.salesUnitSize || '',
        isBonus: product.discount?.isBonus || false,
        bonusMechanism: product.discount?.bonusMechanism || '',
        category: product.taxonomies?.[0]?.name || '',
        url: `https://www.ah.nl/producten/product/wi${product.webshopId || 0}`
      }));

      console.log('[Appie API] Found', products.length, 'products');
      return products;
      
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
