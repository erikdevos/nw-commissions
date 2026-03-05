const SHEET_NAME = 'Items';
const ADMIN_CODE = PropertiesService.getScriptProperties().getProperty('ADMIN_CODE') || 'admin123';

// IP Whitelist - Add authorized IPs here
const ALLOWED_IPS = [
  '185.38.90.170'  // Your IP - add more IPs as needed
];

const COLUMNS = {
  id: 0,
  createdAt: 1,
  updatedAt: 2,
  closedAt: 3,
  deletedAt: 4,
  ip: 5,
  userAgent: 6,
  name: 7,
  item: 8,
  quantity: 9,
  substituteFor: 10,
  imageUrl: 11,
  ahUrl: 12,
  status: 13
};

const HEADERS = ['id', 'createdAt', 'updatedAt', 'closedAt', 'deletedAt', 'ip', 'userAgent', 'name', 'item', 'quantity', 'substituteFor', 'imageUrl', 'ahUrl', 'status'];

function doGet(e) {
  return handleRequest(e);
}

function doPost(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  const action = e.parameter.action || 'list';
  const clientIP = e.parameter.ip || 'unknown';
  
  // Check IP whitelist
  if (!ALLOWED_IPS.includes(clientIP)) {
    Logger.log('Access denied for IP: ' + clientIP);
    return ContentService
      .createTextOutput(JSON.stringify({ 
        ok: false, 
        error: 'Access denied - IP not authorized' 
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  
  try {
    let result;
    
    switch (action) {
      case 'add':
        result = handleAdd(e);
        break;
      case 'list':
        result = handleList(e);
        break;
      case 'setStatus':
        result = handleSetStatus(e);
        break;
      case 'addToArchive':
        result = handleAddToArchive(e);
        break;
      case 'migrateClosedToArchive':
        result = handleMigrateClosedToArchive(e);
        break;
      case 'validateAdmin':
        result = handleValidateAdmin(e);
        break;
      case 'bulk':
        result = handleBulk(e);
        break;
      default:
        result = { ok: false, error: 'Unknown action' };
    }
    
    return jsonResponse(result);
  } catch (error) {
    return jsonResponse({ ok: false, error: error.message });
  }
}

function jsonResponse(data) {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function getSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
  }
  
  return sheet;
}

function generateId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${timestamp}-${random}`;
}

function getClientInfo(e) {
  let ip = 'unknown';
  let userAgent = 'unknown';
  
  try {
    if (e && e.parameter) {
      ip = e.parameter.ip || 'unknown';
      userAgent = e.parameter.userAgent || 'unknown';
    }
  } catch (err) {
    // Ignore errors
  }
  
  return { ip, userAgent };
}

function handleAdd(e) {
  const data = e.parameter;
  
  if (!data.name || !data.item) {
    return { ok: false, error: 'Name and item are required' };
  }
  
  if (data.imageUrl && !isValidUrl(data.imageUrl)) {
    return { ok: false, error: 'Invalid image URL' };
  }
  
  if (data.ahUrl && !isValidUrl(data.ahUrl)) {
    return { ok: false, error: 'Invalid AH URL' };
  }
  
  // Validate quantity
  const quantity = parseInt(data.quantity) || 1;
  if (quantity < 1) {
    return { ok: false, error: 'Quantity must be at least 1' };
  }
  if (quantity > 10) {
    return { ok: false, error: 'Quantity must be at most 10' };
  }
  
  const sheet = getSheet();
  const allData = sheet.getDataRange().getValues();
  const now = new Date().toISOString();
  const id = generateId();
  const { ip, userAgent } = getClientInfo(e);
  
  // Check for duplicates
  for (let i = 1; i < allData.length; i++) {
    const row = allData[i];
    const status = row[COLUMNS.status];
    
    // Skip deleted items from duplicate check
    if (status === 'deleted') continue;
    
    // Check duplicate by AH URL (if provided)
    if (data.ahUrl && row[COLUMNS.ahUrl] === data.ahUrl) {
      return { ok: false, error: 'Dit product is al toegevoegd (zelfde AH link)' };
    }
    
    // Check duplicate by product name (case-insensitive)
    if (row[COLUMNS.item] && row[COLUMNS.item].toLowerCase() === data.item.toLowerCase()) {
      return { ok: false, error: 'Dit product is al toegevoegd (zelfde productnaam)' };
    }
  }
  
  const row = [
    id,
    now,
    now,
    '',
    '',
    ip,
    userAgent,
    data.name,
    data.item,
    quantity,
    data.substituteFor || '',
    data.imageUrl || '',
    data.ahUrl || '',
    'open'
  ];
  
  sheet.appendRow(row);
  
  const item = rowToItem(row);
  
  return { ok: true, item };
}

function handleList(e) {
  const statusFilter = e.parameter.status || 'open';
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  
  if (data.length <= 1) {
    return { ok: true, items: [] };
  }
  
  const items = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const status = row[COLUMNS.status];
    
    if (statusFilter === 'all' || status === statusFilter) {
      items.push(rowToItem(row));
    }
  }
  
  items.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  return { ok: true, items };
}

function handleSetStatus(e) {
  const data = e.parameter;
  
  if (!data.id || !data.status) {
    return { ok: false, error: 'ID and status are required' };
  }
  
  if (!['open', 'closed', 'archive', 'deleted'].includes(data.status)) {
    return { ok: false, error: 'Invalid status' };
  }
  
  if (data.status === 'deleted' && data.adminCode !== ADMIN_CODE) {
    return { ok: false, error: 'Invalid admin code' };
  }
  
  const sheet = getSheet();
  const allData = sheet.getDataRange().getValues();
  const { ip, userAgent } = getClientInfo(e);
  const now = new Date().toISOString();
  
  for (let i = 1; i < allData.length; i++) {
    if (allData[i][COLUMNS.id] === data.id) {
      const rowNum = i + 1;
      
      // Batch update: prepare all values and update in ONE call
      const updates = [
        [COLUMNS.updatedAt + 1, now],
        [COLUMNS.status + 1, data.status],
        [COLUMNS.ip + 1, ip],
        [COLUMNS.userAgent + 1, userAgent]
      ];
      
      if (data.status === 'closed') {
        updates.push([COLUMNS.closedAt + 1, now]);
      } else if (data.status === 'deleted') {
        updates.push([COLUMNS.deletedAt + 1, now]);
      }
      
      // Single batch write instead of 4-5 separate writes
      updates.forEach(([col, val]) => {
        allData[i][col - 1] = val;
      });
      
      // Write the entire row back in one operation
      sheet.getRange(rowNum, 1, 1, allData[i].length).setValues([allData[i]]);
      
      return { ok: true };
    }
  }
  
  return { ok: false, error: 'Item not found' };
}

function handleBulk(e) {
  const data = e.parameter;
  
  if (!data.bulkAction || !data.adminCode) {
    return { ok: false, error: 'Bulk action and admin code are required' };
  }
  
  if (data.adminCode !== ADMIN_CODE) {
    return { ok: false, error: 'Invalid admin code' };
  }
  
  if (!['deleteOpen', 'deleteClosed', 'deleteArchive', 'deleteAll', 'permanentDelete'].includes(data.bulkAction)) {
    return { ok: false, error: 'Invalid action' };
  }
  
  const sheet = getSheet();
  const allData = sheet.getDataRange().getValues();
  const now = new Date().toISOString();
  let affected = 0;
  
  // Handle permanent deletion differently - actually remove rows
  if (data.bulkAction === 'permanentDelete') {
    const rowsToDelete = [];
    
    // Find all rows with deleted status (iterate backwards to collect row numbers)
    for (let i = allData.length - 1; i >= 1; i--) {
      if (allData[i][COLUMNS.status] === 'deleted') {
        rowsToDelete.push(i + 1); // +1 because sheet rows are 1-indexed
        affected++;
      }
    }
    
    // Delete rows one by one (from bottom to top to maintain row numbers)
    rowsToDelete.forEach(rowNum => {
      sheet.deleteRow(rowNum);
    });
    
    return { ok: true, affected };
  }
  
  // For soft deletes (deleteOpen, deleteClosed, deleteAll), mark as deleted
  const rowsToUpdate = [];
  
  for (let i = 1; i < allData.length; i++) {
    const status = allData[i][COLUMNS.status];
    let shouldDelete = false;
    
    if (data.bulkAction === 'deleteOpen' && status === 'open') {
      shouldDelete = true;
    } else if (data.bulkAction === 'deleteClosed' && status === 'closed') {
      shouldDelete = true;
    } else if (data.bulkAction === 'deleteArchive' && status === 'archive') {
      shouldDelete = true;
    } else if (data.bulkAction === 'deleteAll' && (status === 'open' || status === 'closed')) {
      shouldDelete = true;
    }
    
    if (shouldDelete) {
      allData[i][COLUMNS.updatedAt] = now;
      allData[i][COLUMNS.deletedAt] = now;
      allData[i][COLUMNS.status] = 'deleted';
      rowsToUpdate.push(i);
      affected++;
    }
  }
  
  // Batch write: update all modified rows in ONE operation
  if (rowsToUpdate.length > 0) {
    // Write back the entire data range in a single call
    sheet.getRange(2, 1, allData.length - 1, allData[0].length).setValues(allData.slice(1));
  }
  
  return { ok: true, affected };
}

function rowToItem(row) {
  return {
    id: row[COLUMNS.id],
    createdAt: row[COLUMNS.createdAt],
    updatedAt: row[COLUMNS.updatedAt],
    closedAt: row[COLUMNS.closedAt],
    deletedAt: row[COLUMNS.deletedAt],
    name: row[COLUMNS.name],
    item: row[COLUMNS.item],
    quantity: row[COLUMNS.quantity],
    substituteFor: row[COLUMNS.substituteFor],
    imageUrl: row[COLUMNS.imageUrl],
    ahUrl: row[COLUMNS.ahUrl],
    status: row[COLUMNS.status]
  };
}

function isValidUrl(string) {
  if (!string) return false;
  
  // Simple check: just verify it starts with http:// or https://
  const trimmed = string.trim();
  return trimmed.startsWith('http://') || trimmed.startsWith('https://');
}

function handleAddToArchive(e) {
  const data = e.parameter;
  
  if (!data.id || !data.item) {
    return { ok: false, error: 'ID and item are required' };
  }
  
  const sheet = getSheet();
  const allData = sheet.getDataRange().getValues();
  const now = new Date().toISOString();
  
  // Check if item already exists in archive (by item name)
  for (let i = 1; i < allData.length; i++) {
    const row = allData[i];
    if (row[COLUMNS.status] === 'archive' && row[COLUMNS.item] === data.item) {
      return { ok: true, message: 'Item already in archive' };
    }
  }
  
  // Add new archive item
  const archiveRow = [
    data.id || generateId(),
    data.createdAt || now,
    now, // updatedAt
    data.closedAt || now,
    null, // deletedAt
    data.ip || 'unknown',
    data.userAgent || 'unknown',
    data.name || '',
    data.item,
    data.quantity || 1,
    data.substituteFor || '',
    data.imageUrl || '',
    data.ahUrl || '',
    'archive'
  ];
  
  sheet.appendRow(archiveRow);
  
  return { ok: true, message: 'Item added to archive' };
}

function handleMigrateClosedToArchive(e) {
  const sheet = getSheet();
  const allData = sheet.getDataRange().getValues();
  const now = new Date().toISOString();
  let migratedCount = 0;
  
  // Find all closed items
  const closedItems = [];
  for (let i = 1; i < allData.length; i++) {
    const row = allData[i];
    if (row[COLUMNS.status] === 'closed') {
      closedItems.push({
        item: row[COLUMNS.item],
        imageUrl: row[COLUMNS.imageUrl],
        ahUrl: row[COLUMNS.ahUrl],
        ip: row[COLUMNS.ip],
        userAgent: row[COLUMNS.userAgent]
      });
    }
  }
  
  // Check which items don't exist in archive yet
  const existingArchiveItems = new Set();
  for (let i = 1; i < allData.length; i++) {
    const row = allData[i];
    if (row[COLUMNS.status] === 'archive') {
      existingArchiveItems.add(row[COLUMNS.item]);
    }
  }
  
  // Add closed items to archive if they don't exist
  for (const item of closedItems) {
    if (!existingArchiveItems.has(item.item)) {
      const archiveRow = [
        generateId(),
        now, // createdAt
        now, // updatedAt
        now, // closedAt
        null, // deletedAt
        item.ip || 'unknown',
        item.userAgent || 'unknown',
        '', // name (empty for archive)
        item.item,
        1, // quantity
        '', // substituteFor (empty for archive)
        item.imageUrl || '',
        item.ahUrl || '',
        'archive'
      ];
      
      sheet.appendRow(archiveRow);
      existingArchiveItems.add(item.item);
      migratedCount++;
    }
  }
  
  return { ok: true, migrated: migratedCount, message: `Migrated ${migratedCount} items to archive` };
}

function handleValidateAdmin(e) {
  const data = e.parameter;
  
  if (!data.adminCode) {
    return { ok: false, error: 'Admin code is required' };
  }
  
  if (data.adminCode === ADMIN_CODE) {
    return { ok: true, message: 'Admin code is valid' };
  } else {
    return { ok: false, error: 'Invalid admin code' };
  }
}

function setupSheet() {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  
  if (data.length === 0 || data[0][0] !== 'id') {
    sheet.clear();
    sheet.appendRow(HEADERS);
  }
  
  Logger.log('Sheet setup complete');
}
