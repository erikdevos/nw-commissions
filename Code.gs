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
      
      sheet.getRange(rowNum, COLUMNS.updatedAt + 1).setValue(now);
      sheet.getRange(rowNum, COLUMNS.status + 1).setValue(data.status);
      sheet.getRange(rowNum, COLUMNS.ip + 1).setValue(ip);
      sheet.getRange(rowNum, COLUMNS.userAgent + 1).setValue(userAgent);
      
      if (data.status === 'closed') {
        sheet.getRange(rowNum, COLUMNS.closedAt + 1).setValue(now);
      } else if (data.status === 'deleted') {
        sheet.getRange(rowNum, COLUMNS.deletedAt + 1).setValue(now);
      }
      
      return { ok: true };
    }
  }
  
  return { ok: false, error: 'Item not found' };
}

function handleBulk(e) {
  const data = e.parameter;
  
  if (!data.action || !data.adminCode) {
    return { ok: false, error: 'Action and admin code are required' };
  }
  
  if (data.adminCode !== ADMIN_CODE) {
    return { ok: false, error: 'Invalid admin code' };
  }
  
  if (!['deleteClosed', 'deleteAll'].includes(data.action)) {
    return { ok: false, error: 'Invalid action' };
  }
  
  const sheet = getSheet();
  const allData = sheet.getDataRange().getValues();
  const now = new Date().toISOString();
  let affected = 0;
  
  for (let i = 1; i < allData.length; i++) {
    const status = allData[i][COLUMNS.status];
    const rowNum = i + 1;
    let shouldDelete = false;
    
    if (data.action === 'deleteClosed' && status === 'closed') {
      shouldDelete = true;
    } else if (data.action === 'deleteAll' && (status === 'open' || status === 'closed')) {
      shouldDelete = true;
    }
    
    if (shouldDelete) {
      sheet.getRange(rowNum, COLUMNS.updatedAt + 1).setValue(now);
      sheet.getRange(rowNum, COLUMNS.deletedAt + 1).setValue(now);
      sheet.getRange(rowNum, COLUMNS.status + 1).setValue('deleted');
      affected++;
    }
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
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (e) {
    return false;
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
