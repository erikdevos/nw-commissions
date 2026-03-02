(function() {
  'use strict';

  const API_BASE_URL = typeof CONFIG !== 'undefined' ? CONFIG.API_BASE_URL : '';

  let currentStatus = 'open';
  let adminCode = null;
  let pendingAdminAction = null;

  const form = document.getElementById('groceryForm');
  const submitBtn = document.getElementById('submitBtn');
  const formMessage = document.getElementById('formMessage');
  const itemsList = document.getElementById('itemsList');
  const listMessage = document.getElementById('listMessage');
  const tabs = document.querySelectorAll('.tab');
  const copyBtn = document.getElementById('copyBtn');
  const deleteClosedBtn = document.getElementById('deleteClosedBtn');
  const deleteAllBtn = document.getElementById('deleteAllBtn');
  const adminModal = document.getElementById('adminModal');
  const adminCodeInput = document.getElementById('adminCodeInput');
  const adminCancelBtn = document.getElementById('adminCancelBtn');
  const adminConfirmBtn = document.getElementById('adminConfirmBtn');

  function init() {
    console.log('[Grocery App] Initializing...');
    console.log('[Grocery App] API Base URL:', API_BASE_URL);
    
    form.addEventListener('submit', handleSubmit);
    tabs.forEach(tab => tab.addEventListener('click', handleTabClick));
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
      const separator = url.includes('?') ? '&' : '?';
      url = `${url}${separator}${params.toString()}`;
      console.log('[API] Request params:', options.body);
    }
    
    console.log('[API] Request:', {
      url,
      method: 'GET'
    });

    try {
      const response = await fetch(url, { method: 'GET' });
      console.log('[API] Response status:', response.status, response.statusText);
      
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
      console.error('[API] Request failed:', error);
      
      if (error.name === 'TypeError' && error.message.includes('fetch')) {
        throw new Error('Network error: Unable to connect to API. Make sure you are accessing the page via HTTP/HTTPS (not file://)');
      }
      
      throw error;
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

  async function handleSubmit(e) {
    e.preventDefault();

    const formData = new FormData(form);
    const data = {
      name: formData.get('name').trim(),
      item: formData.get('item').trim(),
      quantity: formData.get('quantity').trim() || undefined,
      substituteFor: formData.get('substituteFor').trim() || undefined,
      imageUrl: formData.get('imageUrl').trim() || undefined,
      ahUrl: formData.get('ahUrl').trim() || undefined
    };

    if (!data.name || !data.item) {
      showMessage(formMessage, 'Naam en item zijn verplicht', 'error');
      return;
    }

    if (data.imageUrl && !isValidUrl(data.imageUrl)) {
      showMessage(formMessage, 'Ongeldige afbeeldings URL', 'error');
      return;
    }

    if (data.ahUrl && !isValidUrl(data.ahUrl)) {
      showMessage(formMessage, 'Ongeldige AH URL', 'error');
      return;
    }

    Object.keys(data).forEach(key => data[key] === undefined && delete data[key]);

    setButtonLoading(submitBtn, true);
    try {
      await apiRequest('?action=add', {
        body: data
      });

      showMessage(formMessage, 'Item toegevoegd!', 'success');
      form.reset();
      
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

  async function loadItems() {
    itemsList.innerHTML = '<div class="loading"><div class="spinner"></div><p>Lijst laden...</p></div>';

    try {
      const data = await apiRequest(`?action=list&status=${currentStatus}`);
      renderItems(data.items || []);
    } catch (error) {
      itemsList.innerHTML = `<p class="empty-state">Error: ${error.message}</p>`;
    }
  }

  function renderItems(items) {
    if (items.length === 0) {
      itemsList.innerHTML = '<p class="empty-state">Geen items gevonden</p>';
      return;
    }

    itemsList.innerHTML = items.map(item => createItemCard(item)).join('');

    itemsList.querySelectorAll('.close-btn').forEach(btn => {
      btn.addEventListener('click', () => setItemStatus(btn.dataset.id, 'closed'));
    });

    itemsList.querySelectorAll('.reopen-btn').forEach(btn => {
      btn.addEventListener('click', () => setItemStatus(btn.dataset.id, 'open'));
    });

    itemsList.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        console.log('[Event] Individual delete button clicked for item:', btn.dataset.id);
        pendingAdminAction = { type: 'deleteItem', id: btn.dataset.id };
        openAdminModal();
      });
    });
  }

  function createItemCard(item) {
    const imageHtml = item.imageUrl 
      ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.item)}" class="item-image" onerror="this.style.display='none'">`
      : '';

    const quantityHtml = item.quantity 
      ? `<span><strong>${escapeHtml(item.quantity)}</strong></span>` 
      : '';

    const substituteHtml = item.substituteFor 
      ? `<span>(instead of ${escapeHtml(item.substituteFor)})</span>` 
      : '';

    const ahLinkHtml = item.ahUrl 
      ? `<a href="${escapeHtml(item.ahUrl)}" target="_blank" rel="noopener" class="ah-link">Bekijk op AH.nl →</a>` 
      : '';

    const createdAt = formatDate(item.createdAt);

    let actionsHtml = '';
    if (item.status === 'open') {
      actionsHtml = `
        <button class="btn btn-sm btn-secondary close-btn" data-id="${item.id}">Besteld</button>
        <button class="btn btn-sm btn-danger delete-btn" data-id="${item.id}">Verwijderen</button>
      `;
    } else if (item.status === 'closed') {
      actionsHtml = `
        <button class="btn btn-sm btn-secondary reopen-btn" data-id="${item.id}">Openen</button>
        <button class="btn btn-sm btn-danger delete-btn" data-id="${item.id}">Verwijderen</button>
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
            ${ahLinkHtml}
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

  function handleTabClick(e) {
    tabs.forEach(t => t.classList.remove('active'));
    e.target.classList.add('active');
    currentStatus = e.target.dataset.status;
    loadItems();
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
      const data = await apiRequest('?action=list&status=open');
      const items = data.items || [];

      if (items.length === 0) {
        showMessage(listMessage, 'No open items to copy', 'error');
        return;
      }

      const text = items.map(item => {
        let line = '- ';
        if (item.quantity) {
          line += `${item.quantity} `;
        }
        line += item.item;
        if (item.substituteFor) {
          line += ` (instead of ${item.substituteFor})`;
        }
        line += ` (from ${item.name})`;
        return line;
      }).join('\n');

      await navigator.clipboard.writeText(text);
      showMessage(listMessage, 'Copied to clipboard!', 'success');
    } catch (error) {
      showMessage(listMessage, 'Failed to copy: ' + error.message, 'error');
    } finally {
      setButtonLoading(copyBtn, false);
    }
  }

  function requestAdminAction(action) {
    console.log('[requestAdminAction] Called with:', action);
    const bulkAction = action === 'deleteClosed' ? 'deleteClosed' : 'deleteAll';
    console.log('[requestAdminAction] Setting pending action:', { type: 'bulk', action: bulkAction });
    pendingAdminAction = { type: 'bulk', action: bulkAction };
    openAdminModal();
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

  async function confirmAdminAction() {
    const code = adminCodeInput.value.trim();
    console.log('[confirmAdminAction] Admin code entered:', code ? '***' : 'empty');
    
    if (!code) {
      console.log('[confirmAdminAction] No code entered, returning');
      return;
    }

    adminCode = code;
    
    // Store the action before closing modal
    const actionToExecute = pendingAdminAction;
    closeAdminModal();

    if (!actionToExecute) {
      console.log('[confirmAdminAction] No pending action, returning');
      return;
    }

    console.log('[confirmAdminAction] Processing pending action:', actionToExecute);

    const targetBtn = actionToExecute.type === 'bulk' 
      ? (actionToExecute.action === 'deleteClosed' ? deleteClosedBtn : deleteAllBtn)
      : null;
    
    if (targetBtn) {
      console.log('[confirmAdminAction] Setting loading on button:', targetBtn.id);
      setButtonLoading(targetBtn, true);
    }
    
    try {
      if (actionToExecute.type === 'bulk') {
        console.log('[confirmAdminAction] Making bulk API request:', { action: actionToExecute.action, adminCode });
        await apiRequest('?action=bulk', {
          body: { action: actionToExecute.action, adminCode }
        });
        console.log('[confirmAdminAction] Bulk action successful');
        showMessage(listMessage, 'Bulk actie voltooid', 'success');
        loadItems();
      } else if (actionToExecute.type === 'setStatus') {
        console.log('[confirmAdminAction] Calling setItemStatus:', actionToExecute);
        await setItemStatus(actionToExecute.id, actionToExecute.status);
      } else if (actionToExecute.type === 'deleteItem') {
        console.log('[confirmAdminAction] Calling setItemStatus for delete:', actionToExecute.id);
        await setItemStatus(actionToExecute.id, 'deleted');
      }
    } catch (error) {
      console.error('[confirmAdminAction] Error:', error);
      showMessage(listMessage, error.message, 'error');
      if (error.message.includes('admin')) {
        adminCode = null;
      }
    } finally {
      if (targetBtn) {
        console.log('[confirmAdminAction] Removing loading from button:', targetBtn.id);
        setButtonLoading(targetBtn, false);
      }
    }

    console.log('[confirmAdminAction] Clearing pending action');
    pendingAdminAction = null;
  }

  document.addEventListener('DOMContentLoaded', init);
})();
