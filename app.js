// Alpine.js Grocery App
function groceryApp() {
  return {
    // API Configuration
    API_BASE_URL: typeof CONFIG !== 'undefined' ? CONFIG.API_BASE_URL : '',
    
    // State
    currentStatus: 'archive',
    loading: false,
    formLoading: false,
    bulkLoading: false,
    copyLoading: false,
    
    // Data
    items: {
      open: [],
      closed: [],
      archive: [],
      deleted: []
    },
    
    // Form
    form: {
      ahUrl: '',
      item: '',
      imageUrl: '',
      quantity: 1,
      substituteFor: '',
      name: ''
    },
    
    // Messages
    formMessage: { text: '', type: '' },
    listMessage: { text: '', type: '' },
    
    // Notification system
    notifications: [],
    
    // Admin
    showAdminModal: false,
    adminCodeInput: '',
    adminCode: null,
    pendingAdminAction: null,
    
    // Cache
    cache: new Map(),
    lastFetch: new Map(),
    cacheExpiry: 5 * 60 * 1000, // 5 minutes
    
    // Constants
    ADMIN_CODE_STORAGE_KEY: 'grocery_admin_code',
    ADMIN_CODE_EXPIRY_DAYS: 30,
    
    // Computed
    get currentItems() {
      return this.items[this.currentStatus] || [];
    },
    
    get isAdmin() {
      return !!this.adminCode;
    },
    
    get deleteButtonText() {
      if (this.currentStatus === 'open') return 'Verwijder alle verzoeken';
      if (this.currentStatus === 'closed') return 'Verwijder bestelde items';
      if (this.currentStatus === 'archive') return 'Verwijder archief';
      if (this.currentStatus === 'deleted') return 'Prullenbak legen';
      return 'Verwijder items';
    },
    
    // Lifecycle
    init() {
      console.log('[Alpine App] Initializing...');
      console.log('[Alpine App] API Base URL:', this.API_BASE_URL);
      
      // Load stored admin code
      this.adminCode = this.getStoredAdminCode();
      
      // Run one-time migration to populate archive
      this.migrateClosedToArchive();
      
      // Load initial items
      this.loadItems();
      
      // Preload other tabs
      setTimeout(() => this.preloadTabs(), 1000);
    },
    
    // API Methods
    async apiRequest(endpoint, options = {}) {
      const startTime = performance.now();
      console.log('[API] Request:', endpoint);
      
      try {
        const clientIP = await this.getClientIP();
        const userAgent = navigator.userAgent;
        
        const params = new URLSearchParams({
          ip: clientIP,
          userAgent: userAgent,
          ...options.params
        });
        
        const url = `${this.API_BASE_URL}${endpoint}&${params.toString()}`;
        
        const response = await fetch(url, { method: 'GET' });
        const duration = performance.now() - startTime;
        
        console.log(`[API] Request completed in ${duration.toFixed(0)}ms`);
        
        if (!response.ok) {
          if (response.status === 403) {
            document.body.innerHTML = `
              <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; font-family: 'Poppins', sans-serif; background: #efeeff;">
                <div style="text-align: center; padding: 2rem; background: white; border-radius: 10px; box-shadow: 0 2px 8px rgba(28, 39, 79, 0.08); max-width: 500px;">
                  <h1 style="color: #a73232; margin-bottom: 1rem;">Access Denied</h1>
                  <p style="color: #6b7280; margin-bottom: 0.5rem;">Your IP address is not authorized to access this page.</p>
                  <p style="color: #6b7280; font-size: 0.875rem;">Contact the administrator if you believe this is an error.</p>
                </div>
              </div>
            `;
            throw new Error('Access denied - IP not authorized');
          }
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (!data.ok) {
          if (data.error && data.error.includes('IP not authorized')) {
            document.body.innerHTML = `
              <div style="display: flex; align-items: center; justify-content: center; min-height: 100vh; font-family: 'Poppins', sans-serif; background: #efeeff;">
                <div style="text-align: center; padding: 2rem; background: white; border-radius: 10px; box-shadow: 0 2px 8px rgba(28, 39, 79, 0.08); max-width: 500px;">
                  <h1 style="color: #a73232; margin-bottom: 1rem;">Access Denied</h1>
                  <p style="color: #6b7280; margin-bottom: 0.5rem;">Your IP address is not authorized to access this page.</p>
                  <p style="color: #6b7280; font-size: 0.875rem;">Contact the administrator if you believe this is an error.</p>
                </div>
              </div>
            `;
          }
          throw new Error(data.error || 'Request failed');
        }
        
        return data;
      } catch (error) {
        console.error('[API] Request failed:', error);
        throw error;
      }
    },
    
    async getClientIP() {
      try {
        const response = await fetch('https://api.ipify.org?format=json');
        const data = await response.json();
        return data.ip;
      } catch (error) {
        console.error('[getClientIP] Error:', error);
        return 'unknown';
      }
    },
    
    // Cache Methods
    getCachedItems(status) {
      const cached = this.cache.get(status);
      const lastFetch = this.lastFetch.get(status) || 0;
      
      if (cached && (Date.now() - lastFetch) < this.cacheExpiry) {
        console.log('[Cache] Hit for status:', status);
        return cached;
      }
      
      console.log('[Cache] Miss for status:', status);
      return null;
    },
    
    setCachedItems(status, items) {
      this.cache.set(status, items);
      this.lastFetch.set(status, Date.now());
      console.log('[Cache] Set for status:', status, 'with', items.length, 'items');
    },
    
    invalidateCache(status) {
      this.cache.delete(status);
      this.lastFetch.delete(status);
      console.log('[Cache] Invalidated for status:', status);
    },
    
    clearCache() {
      this.cache.clear();
      this.lastFetch.clear();
      console.log('[Cache] Cleared all');
    },
    
    // Data Loading
    async loadItems() {
      console.log('[loadItems] Loading items for status:', this.currentStatus);
      
      this.loading = true;
      
      // Check cache first
      const cachedItems = this.getCachedItems(this.currentStatus);
      if (cachedItems) {
        console.log('[loadItems] Using cached items for', this.currentStatus, ':', cachedItems.length, 'items');
        this.items[this.currentStatus] = cachedItems;
        this.loading = false;
        return;
      }
      
      try {
        console.log('[loadItems] No cache found, fetching from API for', this.currentStatus);
        const data = await this.apiRequest(`?action=list&status=${this.currentStatus}`);
        this.items[this.currentStatus] = data.items || [];
        this.setCachedItems(this.currentStatus, this.items[this.currentStatus]);
        console.log('[loadItems] Loaded', this.items[this.currentStatus].length, 'items for', this.currentStatus);
      } catch (error) {
        console.error('[loadItems] Error:', error);
        this.showNotification(error.message, 'error');
      } finally {
        this.loading = false;
      }
    },
    
    async refreshItems() {
      console.log('[refreshItems] Force refreshing items for status:', this.currentStatus);
      
      this.loading = true;
            
      const startTime = Date.now();
      
      try {
        // Invalidate cache first
        this.invalidateCache(this.currentStatus);
        
        const data = await this.apiRequest(`?action=list&status=${this.currentStatus}`);
        this.items[this.currentStatus] = data.items || [];
        this.setCachedItems(this.currentStatus, this.items[this.currentStatus]);
        console.log('[refreshItems] Refreshed', this.items[this.currentStatus].length, 'items');
      } catch (error) {
        console.error('[refreshItems] Error:', error);
        this.showNotification(error.message, 'error');
      } finally {
        // Ensure minimum loading time of 500ms for better UX
        const elapsed = Date.now() - startTime;
        if (elapsed < 500) {
          setTimeout(() => {
            this.loading = false;
          }, 500 - elapsed);
        } else {
          this.loading = false;
        }
      }
    },
    
    async preloadTabs() {
      const statuses = ['open', 'closed', 'archive', 'deleted'].filter(s => s !== this.currentStatus);
      
      for (const status of statuses) {
        if (!this.getCachedItems(status)) {
          try {
            console.log(`[Preload] Loading ${status} items...`);
            const data = await this.apiRequest(`?action=list&status=${status}`);
            this.items[status] = data.items || [];
            this.setCachedItems(status, this.items[status]);
          } catch (error) {
            console.error(`[Preload] Failed to load ${status}:`, error);
          }
        }
      }
    },
    
    // Tab Switching
    switchTab(status) {
      console.log('[switchTab] Switching to:', status);
      this.currentStatus = status;
      console.log('[switchTab] Current status set, calling loadItems...');
      this.loadItems();
    },
    
    // Form Handling
    async handleSubmit() {
      console.log('[handleSubmit] Submitting form');
      
      this.formLoading = true;
      this.formMessage = { text: '', type: '' };
      
      try {
        // Validate quantity
        const quantity = parseInt(this.form.quantity) || 1;
        if (quantity < 1) {
          this.formMessage = { text: 'Hoeveelheid moet minimaal 1 zijn', type: 'error' };
          this.formLoading = false;
          return;
        }
        if (quantity > 10) {
          this.formMessage = { text: 'Hoeveelheid mag maximaal 10 zijn', type: 'error' };
          this.formLoading = false;
          return;
        }
        
        // Check for duplicates in frontend (for immediate feedback)
        const allItems = [...this.items.open, ...this.items.closed];
        
        // Check duplicate by AH URL
        if (this.form.ahUrl) {
          const urlDuplicate = allItems.find(item => item.ahUrl === this.form.ahUrl);
          if (urlDuplicate) {
            this.formMessage = { text: 'Dit product is al toegevoegd (zelfde AH link)', type: 'error' };
            this.formLoading = false;
            return;
          }
        }
        
        // Check duplicate by product name (case-insensitive)
        const nameDuplicate = allItems.find(item => 
          item.item && item.item.toLowerCase() === this.form.item.toLowerCase()
        );
        if (nameDuplicate) {
          this.formMessage = { text: 'Dit product is al toegevoegd (zelfde productnaam)', type: 'error' };
          this.formLoading = false;
          return;
        }
        
        const formData = {
          ahUrl: this.form.ahUrl,
          item: this.form.item,
          imageUrl: this.form.imageUrl,
          quantity: quantity,
          substituteFor: this.form.substituteFor,
          name: this.form.name
        };
        
        await this.apiRequest('?action=add', { params: formData });
        
        this.showNotification('Product toegevoegd!', 'success');
        this.clearForm();
        
        // Invalidate cache and reload
        this.invalidateCache('open');
        this.loadItems();
        
      } catch (error) {
        console.error('[handleSubmit] Error:', error);
        this.showNotification(error.message, 'error');
      } finally {
        this.formLoading = false;
      }
    },
    
    clearForm() {
      this.form = {
        ahUrl: '',
        item: '',
        imageUrl: '',
        quantity: 1,
        substituteFor: '',
        name: ''
      };
    },
    
    // Item Actions
    async migrateClosedToArchive() {
      console.log('[migrateClosedToArchive] Starting migration...');
      
      try {
        const data = await this.apiRequest('?action=migrateClosedToArchive');
        console.log('[migrateClosedToArchive] Migration complete:', data);
        
        if (data.migrated > 0) {
          // Invalidate archive cache to force reload
          this.invalidateCache('archive');
          console.log(`[migrateClosedToArchive] Migrated ${data.migrated} items to archive`);
        }
      } catch (error) {
        console.error('[migrateClosedToArchive] Error:', error);
        // Don't show error notification - this is a background operation
      }
    },
    
    async addArchiveItemToList(item) {
      console.log('[addArchiveItemToList] Adding archive item to list:', item);
      
      this.formLoading = true;
      
      try {
        const formData = {
          ahUrl: item.ahUrl || '',
          item: item.item,
          imageUrl: item.imageUrl || '',
          quantity: 1,
          substituteFor: '',
          name: ''
        };
        
        await this.apiRequest('?action=add', { params: formData });
        
        this.showNotification('Product toegevoegd aan verzoeken!', 'success');
        
        // Invalidate cache and reload
        this.invalidateCache('open');
        if (this.currentStatus === 'open') {
          await this.loadItems();
        }
        
      } catch (error) {
        console.error('[addArchiveItemToList] Error:', error);
        this.showNotification(error.message, 'error');
      } finally {
        this.formLoading = false;
      }
    },
    
    async addItemToArchive(id) {
      console.log('[addItemToArchive] Adding item to archive:', id);
      
      try {
        // Get the current item data
        const item = this.items.closed.find(item => item.id === id);
        if (!item) {
          console.error('[addItemToArchive] Item not found in closed items');
          return;
        }
        
        // Create archive version of the item (without date/name metadata)
        const archiveItem = {
          id: Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 8), // Generate new unique ID
          item: item.item,
          imageUrl: item.imageUrl || '',
          ahUrl: item.ahUrl || '',
          status: 'archive',
          createdAt: new Date().toISOString(), // New creation time for archive
          updatedAt: new Date().toISOString(),
          closedAt: new Date().toISOString(),
          deletedAt: null,
          ip: item.ip,
          userAgent: item.userAgent,
          name: '', // Remove name for archive
          quantity: 1, // Reset to default quantity
          substituteFor: '' // Remove substitute for archive
        };
        
        // Add to archive via API
        await this.apiRequest('?action=addToArchive', {
          params: archiveItem
        });
        
        console.log('[addItemToArchive] Successfully added to archive');
        
      } catch (error) {
        console.error('[addItemToArchive] Error:', error);
        // Don't show error notification since this is background operation
      }
    },
    
    async setItemStatus(id, status, buttonEl) {
      console.log('[setItemStatus] Setting item', id, 'to', status);
      
      const requiresAdmin = status === 'deleted';
      
      if (requiresAdmin && !this.adminCode) {
        this.pendingAdminAction = { type: 'setStatus', id, status };
        this.openAdminModal();
        return;
      }
      
      if (buttonEl) buttonEl.classList.add('loading');
      
      try {
        await this.apiRequest('?action=setStatus', {
          params: {
            id,
            status,
            adminCode: requiresAdmin ? this.adminCode : undefined
          }
        });
        
        // If item was marked as closed (ordered), also add it to archive
        if (status === 'closed') {
          console.log('[setItemStatus] Adding ordered item to archive...');
          await this.addItemToArchive(id);
          
          // Force reload archive data if user is on archive tab
          if (this.currentStatus === 'archive') {
            console.log('[setItemStatus] User is on archive tab, reloading archive...');
            this.invalidateCache('archive');
            const data = await this.apiRequest(`?action=list&status=archive`);
            console.log('[setItemStatus] Archive data loaded:', data);
            this.items.archive = data.items || [];
            this.setCachedItems('archive', this.items.archive);
            console.log('[setItemStatus] Archive items updated:', this.items.archive);
          }
        }
        
        // Invalidate other caches
        this.invalidateCache('open');
        this.invalidateCache('closed');
        this.invalidateCache('deleted');
        
        // Load current tab items
        await this.loadItems();
      } catch (error) {
        console.error('[setItemStatus] Error:', error);
        this.showNotification(error.message, 'error');
        if (error.message.includes('admin')) {
          this.adminCode = null;
        }
      } finally {
        if (buttonEl) buttonEl.classList.remove('loading');
      }
    },
    
    deleteItem(id, buttonEl) {
      console.log('[deleteItem] Deleting item:', id);
      
      const storedCode = this.getStoredAdminCode();
      if (storedCode) {
        this.adminCode = storedCode;
        if (confirm('Weet je zeker dat je dit item wilt verwijderen?')) {
          this.setItemStatus(id, 'deleted', buttonEl);
        }
      } else {
        this.pendingAdminAction = { type: 'deleteItem', id };
        this.openAdminModal();
      }
    },
    
    // Bulk Actions
    async handleDeleteTabItems() {
      let action;
      if (this.currentStatus === 'open') action = 'deleteOpen';
      else if (this.currentStatus === 'closed') action = 'deleteClosed';
      else if (this.currentStatus === 'archive') action = 'deleteArchive';
      else if (this.currentStatus === 'deleted') action = 'permanentDelete';
      
      const storedCode = this.getStoredAdminCode();
      if (storedCode) {
        this.adminCode = storedCode;
        
        let confirmMessage;
        if (action === 'deleteOpen') {
          confirmMessage = 'Weet je zeker dat je alle open items wilt verwijderen?\n\nDeze items worden verplaatst naar de prullenbak.';
        } else if (action === 'deleteClosed') {
          confirmMessage = 'Weet je zeker dat je alle bestelde items wilt verwijderen?\n\nDeze items worden verplaatst naar de prullenbak.';
        } else if (action === 'deleteArchive') {
          confirmMessage = 'Weet je zeker dat je alle archief items wilt verwijderen?\n\nDeze items worden verplaatst naar de prullenbak.';
        } else if (action === 'permanentDelete') {
          confirmMessage = '⚠️ WAARSCHUWING: Dit verwijdert alle items in de prullenbak PERMANENT!\n\nDeze actie kan NIET ongedaan worden gemaakt.\n\nWeet je zeker dat je door wilt gaan?';
        }
        
        if (confirm(confirmMessage)) {
          await this.executeBulkAction(action);
        }
      } else {
        this.pendingAdminAction = { type: 'bulk', action };
        this.openAdminModal();
      }
    },
    
    async executeBulkAction(action) {
      this.bulkLoading = true;
      
      try {
        await this.apiRequest(`?action=bulk&bulkAction=${action}`, {
          params: { adminCode: this.adminCode }
        });
        
        const successMessage = action === 'permanentDelete' ? 'Prullenbak geleegd' : 'Items verwijderd';
        this.showNotification(successMessage, 'success');
        
        this.clearCache();
        await this.loadItems();
      } catch (error) {
        console.error('[executeBulkAction] Error:', error);
        this.showNotification(error.message, 'error');
      } finally {
        this.bulkLoading = false;
      }
    },
    
    // Copy to Clipboard
    async handleCopyText() {
      this.copyLoading = true;
      
      const startTime = Date.now();
      
      try {
        let items = this.getCachedItems('open') || this.items.open;
        
        if (!items || items.length === 0) {
          const data = await this.apiRequest('?action=list&status=open');
          items = data.items || [];
        }
        
        if (items.length === 0) {
          this.showNotification('Geen open items om te kopiëren', 'error');
          this.copyLoading = false;
          return;
        }
        
        const text = items.map(item => {
          let line = '';
          if (item.quantity) line += `${item.quantity}x `;
          line += item.item;
          if (item.substituteFor) line += ` (in plaats van ${item.substituteFor})`;
          line += ` - ${item.name}`;
          return line;
        }).join('\n');
        
        await navigator.clipboard.writeText(text);
        this.showNotification('Lijst gekopieerd naar klembord!', 'success');
      } catch (error) {
        this.showNotification('Kopiëren mislukt: ' + error.message, 'error');
      } finally {
        // Ensure minimum loading time of 800ms for better UX
        const elapsed = Date.now() - startTime;
        if (elapsed < 800) {
          setTimeout(() => {
            this.copyLoading = false;
          }, 800 - elapsed);
        } else {
          this.copyLoading = false;
        }
      }
    },
    
    // Admin Modal
    openAdminModal() {
      this.showAdminModal = true;
      this.$nextTick(() => {
        this.$refs.adminInput?.focus();
      });
    },
    
    closeAdminModal() {
      this.showAdminModal = false;
      this.adminCodeInput = '';
      this.pendingAdminAction = null;
    },
    
    logoutAdmin() {
      this.adminCode = null;
      localStorage.removeItem(this.ADMIN_CODE_STORAGE_KEY);
      this.showNotification('Uitgelogd als admin', 'success');
      
      // If on deleted tab, switch to archive tab
      if (this.currentStatus === 'deleted') {
        this.switchTab('archive');
      }
    },
    
    async confirmAdminAction() {
      const code = this.adminCodeInput.trim();
      
      if (!code) return;
      
      this.adminCode = code;
      this.storeAdminCode(code);
      
      const actionToExecute = this.pendingAdminAction;
      this.closeAdminModal();
      
      if (!actionToExecute) return;
      
      if (actionToExecute.type === 'bulk') {
        await this.executeBulkAction(actionToExecute.action);
      } else if (actionToExecute.type === 'deleteItem') {
        await this.setItemStatus(actionToExecute.id, 'deleted');
      } else if (actionToExecute.type === 'setStatus') {
        await this.setItemStatus(actionToExecute.id, actionToExecute.status);
      }
    },
    
    // Admin Code Storage
    getStoredAdminCode() {
      try {
        const stored = localStorage.getItem(this.ADMIN_CODE_STORAGE_KEY);
        if (!stored) return null;
        
        const { code, expiry } = JSON.parse(stored);
        if (Date.now() > expiry) {
          localStorage.removeItem(this.ADMIN_CODE_STORAGE_KEY);
          return null;
        }
        
        return code;
      } catch (e) {
        console.error('[getStoredAdminCode] Error:', e);
        return null;
      }
    },
    
    storeAdminCode(code) {
      try {
        const expiry = Date.now() + (this.ADMIN_CODE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
        localStorage.setItem(this.ADMIN_CODE_STORAGE_KEY, JSON.stringify({ code, expiry }));
        console.log('[storeAdminCode] Admin code stored for 30 days');
      } catch (e) {
        console.error('[storeAdminCode] Error:', e);
      }
    },
    
    // Notification System
    showNotification(text, type = 'success', duration = 4000) {
      const index = this.notifications.length;
      const notification = {
        id: Date.now() + Math.random(),
        text,
        type,
        hiding: false,
        index: index
      };
      
      this.notifications.push(notification);
      
      // Auto-remove after duration
      setTimeout(() => {
        this.hideNotification(notification.id);
      }, duration);
    },
    
    hideNotification(id) {
      const notification = this.notifications.find(n => n.id === id);
      if (notification) {
        notification.hiding = true;
        
        // Remove from DOM after fade animation
        setTimeout(() => {
          this.notifications = this.notifications.filter(n => n.id !== id);
        }, 300);
      }
    },
    
    // Formatting Helpers
    formatDate(isoString) {
      if (!isoString) return '';
      try {
        const date = new Date(isoString);
        return date.toLocaleDateString('nl-NL', {
          day: 'numeric',
          month: 'long',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        });
      } catch {
        return isoString;
      }
    },
    
    formatDateOnly(isoString) {
      if (!isoString) return '';
      try {
        const date = new Date(isoString);
        return date.toLocaleDateString('nl-NL', {
          day: '2-digit',
          month: '2-digit'
        });
      } catch {
        return isoString;
      }
    }
  };
}
