const SHEET_NAME = 'Items';
const ADMIN_CODE = PropertiesService.getScriptProperties().getProperty('ADMIN_CODE') || 'admin123';

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
  
  const sheet = getSheet();
  const now = new Date().toISOString();
  const id = generateId();
  const { ip, userAgent } = getClientInfo(e);
  
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
    data.quantity || '',
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
  
  if (!['open', 'closed', 'deleted'].includes(data.status)) {
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
  
  if (!['deleteOpen', 'deleteClosed', 'deleteAll', 'permanentDelete'].includes(data.bulkAction)) {
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

function setupSheet() {
  const sheet = getSheet();
  const data = sheet.getDataRange().getValues();
  
  if (data.length === 0 || data[0][0] !== 'id') {
    sheet.clear();
    sheet.appendRow(HEADERS);
  }
  
  Logger.log('Sheet setup complete');
}
