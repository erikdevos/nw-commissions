(function() {
  'use strict';

  const API_BASE_URL = typeof CONFIG !== 'undefined' ? CONFIG.API_BASE_URL : '';

  let currentStatus = 'open';
  let pendingAdminAction = null;
  let adminCode = null;
  
  // Caching system
  const cache = {
    items: new Map(),
    lastFetch: new Map(),
    cacheExpiry: 5 * 60 * 1000, // 5 minutes
    
    get(status) {
      const cached = this.items.get(status);
      const lastFetch = this.lastFetch.get(status) || 0;
      
      if (cached && (Date.now() - lastFetch) < this.cacheExpiry) {
        console.log('[Cache] Hit for status:', status);
        return cached;
      }
      
      console.log('[Cache] Miss for status:', status);
      return null;
    },
    
    set(status, items) {
      this.items.set(status, items);
      this.lastFetch.set(status, Date.now());
      console.log('[Cache] Set for status:', status, 'with', items.length, 'items');
    },
    
    invalidate(status) {
      this.items.delete(status);
      this.lastFetch.delete(status);
      console.log('[Cache] Invalidated for status:', status);
    },
    
    clear() {
      this.items.clear();
      this.lastFetch.clear();
      console.log('[Cache] Cleared all');
    }
  };
  
  const ADMIN_CODE_STORAGE_KEY = 'grocery_admin_code';
  const ADMIN_CODE_EXPIRY_DAYS = 30;

  const form = document.getElementById('groceryForm');
  const submitBtn = document.getElementById('submitBtn');
  const formMessage = document.getElementById('formMessage');
  const itemsList = document.getElementById('itemsList');
  const listMessage = document.getElementById('listMessage');
  const tabs = document.querySelectorAll('.tab');
  const copyBtn = document.getElementById('copyBtn');
  const deleteClosedBtn = document.getElementById('deleteClosedBtn');
  const deleteAllBtn = document.getElementById('deleteAllBtn');
  const refreshBtn = document.getElementById('refreshBtn');
  const adminModal = document.getElementById('adminModal');
  const adminCodeInput = document.getElementById('adminCodeInput');
  const adminCancelBtn = document.getElementById('adminCancelBtn');
  const adminConfirmBtn = document.getElementById('adminConfirmBtn');
  
  // Form fields for auto-fill
  const ahUrlInput = document.getElementById('ahUrl');
  const itemInput = document.getElementById('item');
  const imageUrlInput = document.getElementById('imageUrl');

  function init() {
    console.log('[Grocery App] Initializing...');
    console.log('[Grocery App] API Base URL:', API_BASE_URL);
    
    form.addEventListener('submit', handleSubmit);
    tabs.forEach(tab => tab.addEventListener('click', handleTabClickDebounced));
    copyBtn.addEventListener('click', handleCopyText);
    deleteClosedBtn.addEventListener('click', () => {
      console.log('[Event] Delete Closed button clicked');
      requestAdminAction('deleteClosed');
    });
    deleteAllBtn.addEventListener('click', () => {
      console.log('[Event] Delete All button clicked');
      requestAdminAction('deleteAll');
    });
    adminCancelBtn.addEventListener('click', () => {
      console.log('[Event] Admin cancel clicked, clearing pending action');
      pendingAdminAction = null;
      closeAdminModal();
    });
    adminConfirmBtn.addEventListener('click', confirmAdminAction);
    adminCodeInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') confirmAdminAction();
    });
    
    // Refresh button
    refreshBtn.addEventListener('click', () => {
      setButtonLoading(refreshBtn, true);
      cache.clear();
      loadItems(true).finally(() => {
        setButtonLoading(refreshBtn, false);
      });
    });
    
    // Auto-fill when AH URL changes
    let autoFillTimeout;
    if (ahUrlInput) {
      ahUrlInput.addEventListener('input', (e) => {
        clearTimeout(autoFillTimeout);
        const url = e.target.value.trim();
        
        if (url.length > 10) { // Only trigger if there's substantial input
          autoFillTimeout = setTimeout(() => {
            handleAhUrlInput(url);
          }, 1000); // Wait 1 second after user stops typing
        }
      });
    }

    loadItems();
  }

  async function apiRequest(endpoint, options = {}) {
    if (!API_BASE_URL) {
      console.error('[API] API_BASE_URL not configured');
      throw new Error('API_BASE_URL not configured. Please set up config.js');
    }

    let url = `${API_BASE_URL}${endpoint}`;
    
    if (options.body && typeof options.body === 'object') {
      const params = new URLSearchParams();
      Object.keys(options.body).forEach(key => {
        if (options.body[key] !== undefined && options.body[key] !== null) {
          params.append(key, options.body[key]);
        }
      });
      
      // Add client info automatically
      params.append('ip', await getClientIP());
      params.append('userAgent', navigator.userAgent);
      
      const separator = url.includes('?') ? '&' : '?';
      url = `${url}${separator}${params.toString()}`;
      console.log('[API] Request params:', options.body);
    } else {
      // Add client info for GET requests too
      const separator = url.includes('?') ? '&' : '?';
      url = `${url}${separator}ip=${encodeURIComponent(await getClientIP())}&userAgent=${encodeURIComponent(navigator.userAgent)}`;
    }
    
    console.log('[API] Request:', {
      url,
      method: 'GET'
    });

    const startTime = performance.now();

    try {
      const response = await fetch(url, { method: 'GET' });
      const endTime = performance.now();
      const duration = endTime - startTime;
      
      console.log('[API] Response status:', response.status, response.statusText);
      console.log(`[API] Request completed in ${duration.toFixed(0)}ms`);
      
      // Log slow requests
      if (duration > 3000) {
        console.warn(`[API] Slow request detected: ${duration.toFixed(0)}ms for ${endpoint}`);
      }
      
      if (!response.ok) {
        console.error('[API] HTTP error:', response.status, response.statusText);
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('[API] Response data:', data);

      if (!data.ok) {
        console.error('[API] API error:', data.error);
        throw new Error(data.error || 'Request failed');
      }

      return data;
    } catch (error) {
      const endTime = performance.now();
      const duration = endTime - startTime;
      console.error('[API] Request failed after', duration.toFixed(0), 'ms:', error);
      
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        throw new Error('Network error: Unable to connect to API. Make sure you are accessing the page via HTTP/HTTPS (not file://)');
      }
      
      throw error;
    }
  }

  async function getClientIP() {
    try {
      const response = await fetch('https://api.ipify.org?format=json');
      const data = await response.json();
      return data.ip;
    } catch (error) {
      console.warn('[Client] Could not fetch IP address:', error);
      return 'unknown';
    }
  }

  function showMessage(element, text, type) {
    element.textContent = text;
    element.className = `message ${type}`;
    element.classList.remove('hidden');

    setTimeout(() => {
      element.classList.add('hidden');
    }, 3000);
  }

  async function handleAhUrlInput(url) {
    // Normalize AH URL
    let normalizedUrl = url;
    if (!url.startsWith('http')) {
      normalizedUrl = 'https://www.ah.nl' + (url.startsWith('/') ? url : '/' + url);
    }
    
    if (!isValidAhUrl(normalizedUrl)) {
      return;
    }
    
    // Show loading state
    ahUrlInput.style.borderColor = 'var(--primary)';
    
    try {
      const extracted = await extractImageFromAhUrl(normalizedUrl);
      
      // Auto-fill product name if empty
      if (!itemInput.value.trim() || itemInput.value.toLowerCase() === 'welk product?') {
        if (extracted.title) {
          itemInput.value = extracted.title;
        }
      }
      
      // Update the input field with normalized URL
      ahUrlInput.value = normalizedUrl;
      
      // Show success feedback
      if (extracted.title) {
        ahUrlInput.style.borderColor = 'var(--success)';
      } else {
        ahUrlInput.style.borderColor = 'orange';
      }
      
      setTimeout(() => {
        ahUrlInput.style.borderColor = '';
      }, 2000);
      
    } catch (error) {
      ahUrlInput.style.borderColor = 'var(--danger)';
      setTimeout(() => {
        ahUrlInput.style.borderColor = '';
      }, 2000);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();

    // Show loader immediately
    setButtonLoading(submitBtn, true);

    const formData = new FormData(form);
    let ahUrl = formData.get('ahUrl').trim();
    const data = {
      name: formData.get('name').trim(),
      item: formData.get('item').trim(),
      quantity: formData.get('quantity') ? parseInt(formData.get('quantity')) : undefined,
      substituteFor: formData.get('substituteFor').trim() || undefined,
      imageUrl: formData.get('imageUrl').trim() || undefined,
      ahUrl: ahUrl || undefined
    };

    if (!data.name || !data.item) {
      setButtonLoading(submitBtn, false);
      showMessage(formMessage, 'Naam en item zijn verplicht', 'error');
      return;
    }

    // Validate quantity range
    if (data.quantity !== undefined && (data.quantity < 1 || data.quantity > 10)) {
      setButtonLoading(submitBtn, false);
      showMessage(formMessage, 'Hoeveelheid moet tussen 1 en 10 zijn', 'error');
      return;
    }

    // AH URL validation and normalization
    if (!ahUrl) {
      setButtonLoading(submitBtn, false);
      showMessage(formMessage, 'AH link is verplicht', 'error');
      return;
    }

    // Check for duplicates
    try {
      const existingData = await apiRequest('?action=list&status=open');
      const existingItems = existingData.items || [];
      
      const duplicateByUrl = existingItems.find(item => item.ahUrl === ahUrl);
      const duplicateByName = existingItems.find(item => 
        item.item.toLowerCase() === data.item.toLowerCase()
      );
      
      if (duplicateByUrl) {
        setButtonLoading(submitBtn, false);
        showMessage(formMessage, 'Product staat al op de verzoeklijst', 'error');
        return;
      }
      
      if (duplicateByName) {
        setButtonLoading(submitBtn, false);
        showMessage(formMessage, 'Product met dezelfde naam staat al op de verzoeklijst', 'error');
        return;
      }
    } catch (error) {
      console.error('[handleSubmit] Error checking duplicates:', error);
      // Continue with submission if duplicate check fails
    }

    // Normalize AH URL
    if (!ahUrl.startsWith('http')) {
      ahUrl = 'https://www.ah.nl' + (ahUrl.startsWith('/') ? ahUrl : '/' + ahUrl);
    }
    
    if (!isValidAhUrl(ahUrl)) {
      setButtonLoading(submitBtn, false);
      showMessage(formMessage, 'Ongeldige AH URL. Gebruik een geldige ah.nl link', 'error');
      return;
    }
    
    data.ahUrl = ahUrl;

    Object.keys(data).forEach(key => data[key] === undefined && delete data[key]);

    try {
      await apiRequest('?action=add', {
        body: data
      });

      showMessage(formMessage, 'Item toegevoegd!', 'success');
      form.reset();
      
      // Optimistic update: clear cache and refresh
      cache.invalidate('open');
      if (currentStatus === 'open') {
        loadItems();
      }
    } catch (error) {
      showMessage(formMessage, error.message, 'error');
    } finally {
      setButtonLoading(submitBtn, false);
    }
  }

  function isValidUrl(string) {
    try {
      const url = new URL(string);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  }

  function isValidAhUrl(url) {
    try {
      const urlObj = new URL(url);
      return (urlObj.hostname === 'ah.nl' || urlObj.hostname === 'www.ah.nl') && urlObj.protocol === 'https:';
    } catch {
      return false;
    }
  }

  // Extract product ID from AH URL (webshop ID format: wi123456)
  function extractProductIdFromUrl(ahUrl) {
    try {
      const urlPath = new URL(ahUrl).pathname;
      const pathParts = urlPath.split('/').filter(part => part.length > 0);
      
      // AH URLs can have formats:
      // /producten/product/wi123456/product-name OR /producten/product/product-name/wi123456
      // Find any part that starts with 'wi' followed by digits
      for (const part of pathParts) {
        if (part.match(/^wi\d+$/)) {
          console.log('[extractProductId] Found product ID:', part);
          return part;
        }
      }
      
      console.log('[extractProductId] No product ID found in URL parts:', pathParts);
    } catch (e) {
      console.error('[extractProductId] Error:', e);
    }
    return null;
  }

  
  async function extractImageFromAhUrl(ahUrl) {
    try {
      console.log('[extractFromAh] Processing AH URL:', ahUrl);
      
      // Extract product name from URL path
      let productTitle = null;
      let imageUrl = null;
      
      try {
        const urlPath = new URL(ahUrl).pathname;
        const pathParts = urlPath.split('/').filter(part => part.length > 0);
        
        if (pathParts.length >= 2) {
          // Find the product name slug (not the wi123456 ID)
          let productNameSlug = null;
          for (const part of pathParts) {
            if (!part.match(/^wi\d+$/)) {
              productNameSlug = part;
            }
          }
          
          if (productNameSlug) {
            // Convert slug to readable name
            productTitle = productNameSlug
              .replace(/-/g, ' ')
              .replace(/\b\w/g, l => l.toUpperCase());
            
            console.log('[extractFromAh] Extracted product name:', productTitle);
          }
        }
      } catch (urlError) {
        console.log('[extractFromAh] URL parsing failed:', urlError);
      }
      
      console.log('[extractFromAh] Final result:', { title: productTitle, image: imageUrl });
      return { title: productTitle, image: imageUrl };
      
    } catch (error) {
      console.error('[extractImageFromAhUrl] Error:', error);
      return { title: null, image: null };
    }
  }

  async function loadItems(forceRefresh = false) {
    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const cachedItems = cache.get(currentStatus);
      if (cachedItems) {
        renderItems(cachedItems);
        return;
      }
    }

    itemsList.innerHTML = '<div class="loading"><div class="spinner"></div><p>Lijst laden...</p></div>';

    try {
      const data = await apiRequest(`?action=list&status=${currentStatus}`);
      const items = data.items || [];
      
      // Update cache
      cache.set(currentStatus, items);
      
      renderItems(items);
      
      // Update bulk actions visibility
      updateBulkActionsVisibility(currentStatus);
      
      // Preload other tabs immediately after first successful load
      if (!forceRefresh && !window.hasPreloaded) {
        window.hasPreloaded = true;
        setTimeout(() => {
          preloadAllTabs();
        }, 500); // Shorter delay, but after initial render
      }
    } catch (error) {
      itemsList.innerHTML = `<p class="empty-state">Error: ${error.message}</p>`;
    }
  }

  // Preload all tab data to prevent subsequent API calls
  let isPreloading = false;
  async function preloadAllTabs() {
    if (isPreloading) {
      console.log('[Preload] Already preloading, skipping...');
      return;
    }
    
    isPreloading = true;
    const statuses = ['closed', 'deleted']; // Only preload non-current tabs
    
    console.log('[Preload] Starting preload for tabs...');
    
    try {
      // Load both tabs in parallel for maximum speed
      const promises = statuses.map(async (status) => {
        if (!cache.get(status)) {
          try {
            console.log(`[Preload] Loading ${status} items...`);
            const data = await apiRequest(`?action=list&status=${status}`);
            cache.set(status, data.items || []);
            console.log(`[Preload] ${status} items cached:`, data.items?.length || 0);
          } catch (error) {
            console.error(`[Preload] Failed to load ${status}:`, error);
          }
        } else {
          console.log(`[Preload] ${status} already cached`);
        }
      });
      
      await Promise.all(promises);
    } finally {
      isPreloading = false;
      console.log('[Preload] Preload complete');
    }
  }

  function renderItems(items) {
    if (items.length === 0) {
      itemsList.innerHTML = '<p class="empty-state">Geen items gevonden</p>';
      return;
    }

    itemsList.innerHTML = items.map(item => createItemCard(item)).join('');

    itemsList.querySelectorAll('.close-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        setButtonLoading(btn, true);
        await setItemStatus(btn.dataset.id, 'closed');
        setButtonLoading(btn, false);
      });
    });

    itemsList.querySelectorAll('.reopen-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        setButtonLoading(btn, true);
        await setItemStatus(btn.dataset.id, 'open');
        setButtonLoading(btn, false);
      });
    });

    itemsList.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        console.log('[Event] Individual delete button clicked for item:', btn.dataset.id);
        pendingAdminAction = { type: 'deleteItem', id: btn.dataset.id };
        
        // Check if we have a stored admin code
        const storedCode = getStoredAdminCode();
        if (storedCode) {
          console.log('[Event] Using stored admin code for delete');
          adminCode = storedCode;
          
          // Show confirmation dialog
          if (confirm('Weet je zeker dat je dit item wilt verwijderen?')) {
            executeAdminAction(pendingAdminAction);
          } else {
            pendingAdminAction = null;
          }
        } else {
          openAdminModal();
        }
      });
    });

    itemsList.querySelectorAll('.add-back-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        setButtonLoading(btn, true);
        await setItemStatus(btn.dataset.id, 'open');
        setButtonLoading(btn, false);
      });
    });
  }

  function createItemCard(item) {
    const imageHtml = item.ahUrl 
      ? `<a href="${escapeHtml(item.ahUrl)}" target="_blank" rel="noopener" class="item-image-link">
          <img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.item)}" class="item-image" onerror="this.style.display='none'">
        </a>`
      : `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.item)}" class="item-image" onerror="this.style.display='none'">`;

    const quantityHtml = item.quantity 
      ? `<div class="item-quantity"><strong>${escapeHtml(item.quantity)}</strong>x</div>` 
      : '';

    const substituteHtml = item.substituteFor 
      ? `<div class="item-substitute">In plaats van ${escapeHtml(item.substituteFor)}</div>` 
      : '';

    const ahLinkHtml = item.ahUrl 
      ? `<a href="${escapeHtml(item.ahUrl)}" target="_blank" rel="noopener" class="btn btn-sm btn-secondary">Ga naar AH</a>` 
      : '';

    const createdAt = formatDate(item.createdAt);
    
    // Add date line for closed and deleted items
    let statusDateHtml = '';
    if (item.status === 'closed' && item.closedAt) {
      statusDateHtml = `<div class="item-ordered">Besteld ${formatDateOnly(item.closedAt)}</div>`;
    } else if (item.status === 'deleted' && item.deletedAt) {
      statusDateHtml = `<div class="item-deleted">Verwijderd ${formatDateOnly(item.deletedAt)}</div>`;
    }

    let actionsHtml = '';
    if (item.status === 'open') {
      actionsHtml = `
        <button class="btn btn-sm btn-secondary close-btn" data-id="${item.id}">
          <span class="btn-text">Besteld?</span>
          <span class="btn-loader">Bezig...</span>
        </button>
        ${ahLinkHtml}
        <button class="btn btn-sm btn-danger delete-btn" data-id="${item.id}">
          <span class="btn-text">Verwijderen</span>
          <span class="btn-loader">Bezig...</span>
        </button>
      `;
    } else if (item.status === 'closed') {
      actionsHtml = `
        <button class="btn btn-sm btn-primary add-back-btn" data-id="${item.id}">
          <span class="btn-text">Toevoegen</span>
          <span class="btn-loader">Bezig...</span>
        </button>
        ${ahLinkHtml}
        <button class="btn btn-sm btn-danger delete-btn" data-id="${item.id}">
          <span class="btn-text">Verwijderen</span>
          <span class="btn-loader">Bezig...</span>
        </button>
      `;
    } else if (item.status === 'deleted') {
      actionsHtml = `
        <button class="btn btn-sm btn-primary add-back-btn" data-id="${item.id}">
          <span class="btn-text">Opnieuw bestellen</span>
          <span class="btn-loader">Bezig...</span>
        </button>
        ${ahLinkHtml}
      `;
    }

    return `
      <div class="item-card ${item.status}">
        ${imageHtml}
        <div class="item-content">
          <div class="item-name">${escapeHtml(item.item)}</div>
          <div class="item-details">
            ${quantityHtml}
            ${substituteHtml}
            ${statusDateHtml}
          </div>
          <div class="item-meta">
            Toegevoegd door ${escapeHtml(item.name)} • ${createdAt}
          </div>
        </div>
        <div class="item-actions">
          ${actionsHtml}
        </div>
      </div>
    `;
  }

  function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function formatDate(isoString) {
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
  }

  function formatDateOnly(isoString) {
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

  function handleTabClick(e) {
    tabs.forEach(t => t.classList.remove('active'));
    e.target.classList.add('active');
    currentStatus = e.target.dataset.status;
    loadItems();
  }

  // Debounced tab switching to prevent rapid API calls
  let debouncedLoadTimeout;
  
  function handleTabClickDebounced(e) {
    tabs.forEach(t => t.classList.remove('active'));
    e.target.classList.add('active');
    const newStatus = e.target.dataset.status;
    
    // Update bulk actions visibility
    updateBulkActionsVisibility(newStatus);
    
    // Check if we have cached data
    const cachedItems = cache.get(newStatus);
    if (cachedItems) {
      console.log(`[Tab] Loading ${newStatus} from cache (${cachedItems.length} items)`);
      currentStatus = newStatus;
      // Load immediately from cache, no delay needed
      loadItems();
      return;
    } else {
      console.log(`[Tab] Loading ${newStatus} from API`);
      // Show loading state immediately for better UX
      itemsList.innerHTML = '<div class="loading"><div class="spinner"></div><p>Lijst laden...</p></div>';
    }
    
    currentStatus = newStatus;
    
    clearTimeout(debouncedLoadTimeout);
    debouncedLoadTimeout = setTimeout(() => {
      loadItems();
    }, 100);
  }

  function updateBulkActionsVisibility(status) {
    // Show deleteClosedBtn only on 'closed' tab
    if (deleteClosedBtn) {
      if (status === 'closed') {
        deleteClosedBtn.style.display = 'inline-flex';
        console.log('[Bulk Actions] Showing delete closed button');
      } else {
        deleteClosedBtn.style.display = 'none';
        console.log('[Bulk Actions] Hiding delete closed button');
      }
    }

    // Show copyBtn only on 'open' tab
    if (copyBtn) {
      if (status === 'open') {
        copyBtn.style.display = 'inline-flex';
        console.log('[Bulk Actions] Showing copy button');
      } else {
        copyBtn.style.display = 'none';
        console.log('[Bulk Actions] Hiding copy button');
      }
    }
  }

  async function setItemStatus(id, status) {
    console.log('[setItemStatus] Called with:', { id, status, hasAdminCode: !!adminCode });
    const requiresAdmin = status === 'deleted';
    
    if (requiresAdmin && !adminCode) {
      console.log('[setItemStatus] Admin code required, opening modal');
      pendingAdminAction = { type: 'setStatus', id, status };
      openAdminModal();
      return;
    }

    try {
      console.log('[setItemStatus] Making API request:', { id, status, adminCode: requiresAdmin ? adminCode : 'none' });
      await apiRequest('?action=setStatus', {
        body: { id, status, adminCode: requiresAdmin ? adminCode : undefined }
      });
      console.log('[setItemStatus] API request successful, reloading items');
      
      // Invalidate all relevant caches
      cache.invalidate('open');
      cache.invalidate('closed');
      cache.invalidate('deleted');
      
      loadItems();
    } catch (error) {
      console.error('[setItemStatus] Error:', error);
      showMessage(listMessage, error.message, 'error');
      if (error.message.includes('admin')) {
        adminCode = null;
      }
    }
  }

  function setButtonLoading(button, isLoading) {
    if (isLoading) {
      button.classList.add('loading');
      button.disabled = true;
    } else {
      button.classList.remove('loading');
      button.disabled = false;
    }
  }

  async function handleCopyText() {
    setButtonLoading(copyBtn, true);
    try {
      // Try cache first
      let items = cache.get('open');
      
      if (!items) {
        const data = await apiRequest('?action=list&status=open');
        items = data.items || [];
        cache.set('open', items);
      }

      if (items.length === 0) {
        showMessage(listMessage, 'Geen open items om te kopiëren', 'error');
        return;
      }

      const text = items.map(item => {
        let line = '';
        if (item.quantity) {
          line += `${item.quantity}x `;
        }
        line += item.item;
        if (item.substituteFor) {
          line += ` (in plaats van ${item.substituteFor})`;
        }
        line += ` - ${item.name}`;
        return line;
      }).join('\n');

      await navigator.clipboard.writeText(text);
      showMessage(listMessage, 'Lijst gekopieerd naar klembord!', 'success');
    } catch (error) {
      showMessage(listMessage, 'Kopiëren mislukt: ' + error.message, 'error');
    } finally {
      setButtonLoading(copyBtn, false);
    }
  }

  function getStoredAdminCode() {
    try {
      const stored = localStorage.getItem(ADMIN_CODE_STORAGE_KEY);
      if (!stored) return null;
      
      const { code, expiry } = JSON.parse(stored);
      if (Date.now() > expiry) {
        localStorage.removeItem(ADMIN_CODE_STORAGE_KEY);
        return null;
      }
      
      return code;
    } catch (e) {
      console.error('[getStoredAdminCode] Error:', e);
      return null;
    }
  }
  
  function storeAdminCode(code) {
    try {
      const expiry = Date.now() + (ADMIN_CODE_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
      localStorage.setItem(ADMIN_CODE_STORAGE_KEY, JSON.stringify({ code, expiry }));
      console.log('[storeAdminCode] Admin code stored for 30 days');
    } catch (e) {
      console.error('[storeAdminCode] Error:', e);
    }
  }
  
  function requestAdminAction(action) {
    console.log('[requestAdminAction] Called with:', action);
    const bulkAction = action === 'deleteClosed' ? 'deleteClosed' : 'deleteAll';
    console.log('[requestAdminAction] Setting pending action:', { type: 'bulk', action: bulkAction });
    pendingAdminAction = { type: 'bulk', action: bulkAction };
    
    // Check if we have a stored admin code
    const storedCode = getStoredAdminCode();
    if (storedCode) {
      console.log('[requestAdminAction] Using stored admin code');
      adminCode = storedCode;
      
      // Show confirmation dialog instead of admin modal
      const actionName = bulkAction === 'deleteClosed' ? 'bestelde items' : 'alle items';
      if (confirm(`Weet je zeker dat je ${actionName} wilt verwijderen?`)) {
        executeAdminAction(pendingAdminAction);
      } else {
        pendingAdminAction = null;
      }
    } else {
      openAdminModal();
    }
  }

  function openAdminModal() {
    adminModal.classList.remove('hidden');
    adminCodeInput.value = '';
    adminCodeInput.focus();
  }

  function closeAdminModal() {
    adminModal.classList.add('hidden');
    adminCodeInput.value = '';
  }

  async function executeAdminAction(actionToExecute) {
    if (!actionToExecute) {
      console.log('[executeAdminAction] No action to execute');
      return;
    }

    console.log('[executeAdminAction] Processing action:', actionToExecute);

    const targetBtn = actionToExecute.type === 'bulk' 
      ? (actionToExecute.action === 'deleteClosed' ? deleteClosedBtn : deleteAllBtn)
      : actionToExecute.type === 'deleteItem' 
        ? document.querySelector(`.delete-btn[data-id="${actionToExecute.id}"]`)
        : null;

    if (targetBtn) {
      setButtonLoading(targetBtn, true);
    }

    try {
      if (actionToExecute.type === 'bulk') {
        console.log('[executeAdminAction] Bulk action:', actionToExecute.action);
        const endpoint = actionToExecute.action === 'deleteClosed' 
          ? '?action=deleteClosed' 
          : '?action=deleteAll';
        
        console.log('[executeAdminAction] Calling API with endpoint:', endpoint);
        await apiRequest(endpoint, {
          body: { adminCode }
        });
        
        showMessage(listMessage, 'Items verwijderd', 'success');
        
        // Clear all caches after bulk operations
        cache.clear();
        loadItems();
      } else if (actionToExecute.type === 'deleteItem') {
        console.log('[executeAdminAction] Delete item:', actionToExecute.id);
        await apiRequest('?action=setStatus', {
          body: { id: actionToExecute.id, status: 'deleted', adminCode }
        });
        
        showMessage(listMessage, 'Item verwijderd', 'success');
        
        // Invalidate relevant caches
        cache.invalidate('open');
        cache.invalidate('closed');
        cache.invalidate('deleted');
        
        loadItems();
      }
    } catch (error) {
      console.error('[executeAdminAction] Error:', error);
      showMessage(listMessage, error.message, 'error');
    } finally {
      if (targetBtn) {
        setButtonLoading(targetBtn, false);
      }
      pendingAdminAction = null;
    }
  }
  
  async function confirmAdminAction() {
    const code = adminCodeInput.value.trim();
    console.log('[confirmAdminAction] Admin code entered:', code ? '***' : 'empty');
    
    if (!code) {
      console.log('[confirmAdminAction] No code entered, returning');
      return;
    }

    adminCode = code;
    
    // Store the admin code for 30 days
    storeAdminCode(code);
    
    // Store the action before closing modal
    const actionToExecute = pendingAdminAction;
    closeAdminModal();

    if (!actionToExecute) {
      console.log('[confirmAdminAction] No pending action, returning');
      return;
    }

    await executeAdminAction(actionToExecute);
    pendingAdminAction = null;
  }

  document.addEventListener('DOMContentLoaded', init);
})();
