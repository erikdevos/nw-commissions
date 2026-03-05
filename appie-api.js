// Appie API Service - Direct JavaScript implementation
class AppieApiService {
  constructor() {
    this.baseUrl = 'https://api.ah.nl';
    this.clientId = 'appie-ios';
    this.clientVersion = '9.28';
    this.userAgent = 'Appie/9.28 (iPhone17,3; iPhone; CPU OS 26_1 like Mac OS X)';
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  getHeaders(token) {
    const headers = {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': this.userAgent,
      'x-client-name': this.clientId,
      'x-client-version': this.clientVersion,
      'x-application': 'AHWEBSHOP'
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return headers;
  }

  async getAnonymousToken() {
    if (this.accessToken && this.tokenExpiry && Date.now() < this.tokenExpiry) {
      console.log('[Appie API] Using cached token');
      return this.accessToken;
    }

    try {
      console.log('[Appie API] Requesting new anonymous token...');
      
      const response = await fetch(`${this.baseUrl}/mobile-auth/v1/auth/token/anonymous`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({ clientId: this.clientId })
      });

      if (!response.ok) {
        throw new Error(`Token request failed: ${response.status}`);
      }

      const data = await response.json();
      this.accessToken = data.access_token || data.accessToken;
      
      if (!this.accessToken) {
        throw new Error('No access token in response');
      }

      const expiresIn = data.expires_in || data.expiresIn || 3600;
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
      
      const params = new URLSearchParams({
        query: query.trim(),
        page: '0',
        size: String(limit),
        sortOn: 'RELEVANCE'
      });

      const url = `${this.baseUrl}/mobile-services/product/search/v2?${params.toString()}`;
      
      console.log('[Appie API] Searching for:', query);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(token)
      });

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
