// Appie API Service - Proxy through Google Apps Script
class AppieApiService {
  constructor() {
    this.apiBaseUrl = typeof CONFIG !== 'undefined' ? CONFIG.API_BASE_URL : '';
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  async getAnonymousToken() {
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      console.log('[Appie API] Using cached token');
      return this.accessToken;
    }

    try {
      console.log('[Appie API] Requesting new anonymous token via proxy...');
      
      const response = await fetch(`${this.apiBaseUrl}?action=proxyAHToken`, {
        method: 'GET'
      });

      if (!response.ok) {
        throw new Error(`Token request failed: ${response.status}`);
      }

      const result = await response.json();
      
      if (!result.ok) {
        throw new Error(result.error || 'Token request failed');
      }

      this.accessToken = result.data.access_token || result.data.accessToken;
      
      if (!this.accessToken) {
        throw new Error('No access token in response');
      }

      const expiresIn = result.data.expires_in || result.data.expiresIn || 3600;
      this.tokenExpiry = Date.now() + (expiresIn * 1000) - 60000;

      console.log('[Appie API] Token obtained, expires in', expiresIn, 'seconds');
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
      const token = await this.getAnonymousToken();
      
      console.log('[Appie API] Searching for:', query);
      
      const params = new URLSearchParams({
        action: 'proxyAHSearch',
        query: query.trim(),
        token: token,
        size: String(limit)
      });

      const response = await fetch(`${this.apiBaseUrl}?${params.toString()}`, {
        method: 'GET'
      });

      if (!response.ok) {
        throw new Error(`Product search failed: ${response.status}`);
      }

      const result = await response.json();
      
      if (!result.ok) {
        throw new Error(result.error || 'Search request failed');
      }

      const data = result.data;
      
      if (!data.products || !Array.isArray(data.products)) {
        return [];
      }

      const products = data.products.map(product => ({
        id: product.webshopId || 0,
        title: product.title || 'Onbekend product',
        brand: product.brand || '',
        imageUrl: product.images?.[0]?.url || null,
        price: product.currentPrice || product.priceBeforeBonus || 0,
        oldPrice: product.priceBeforeBonus || 0,
        unitSize: product.salesUnitSize || '',
        isBonus: product.isBonus || false,
        bonusMechanism: product.bonusMechanism || '',
        category: product.mainCategory || '',
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
