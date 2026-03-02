# Shared Grocery Collection Tool

A simple shared grocery submission tool with central storage, soft deletion, audit logging, and export functionality.
https://erikdevos.github.io/nw-commissions/

## Features

- **Submit grocery items** with name, quantity, substitute info, image URL, and AH link
- **View items** by status (Open, Closed, Deleted)
- **Close/Reopen items** to track completion
- **Soft delete** items (requires admin code)
- **Bulk actions** to delete closed or all items
- **Export** via Print or Copy as Text
- **Audit logging** with timestamps, IP, and user agent

## Tech Stack

- **Frontend**: HTML, CSS, Vanilla JavaScript (hosted on GitHub Pages)
- **Backend**: Google Apps Script Web App
- **Database**: Google Sheets

## Setup Instructions

### 1. Create Google Sheet

1. Go to [Google Sheets](https://sheets.google.com) and create a new spreadsheet
2. Name it something like "Grocery List"
3. Note the spreadsheet URL for later

### 2. Set Up Google Apps Script

1. In your Google Sheet, go to **Extensions > Apps Script**
2. Delete any existing code in `Code.gs`
3. Copy the entire contents of `Code.gs` from this repository and paste it
4. Click **Save** (Ctrl+S)

### 3. Set Admin Code

1. In Apps Script, go to **Project Settings** (gear icon)
2. Scroll down to **Script Properties**
3. Click **Add script property**
4. Set:
   - Property: `ADMIN_CODE`
   - Value: Your secret admin code (e.g., `mySecretCode123`)
5. Click **Save**

### 4. Deploy as Web App

1. In Apps Script, click **Deploy > New deployment**
2. Click the gear icon next to "Select type" and choose **Web app**
3. Configure:
   - Description: "Grocery List API"
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Click **Deploy**
5. Authorize the app when prompted
6. Copy the **Web app URL** (looks like `https://script.google.com/macros/s/xxx/exec`)

### 5. Configure Frontend

1. Copy `config.example.js` to `config.js` (if not already done)
2. Edit `config.js` and replace `YOUR_APPS_SCRIPT_URL` with your Web app URL:

```javascript
const CONFIG = {
  API_BASE_URL: "https://script.google.com/macros/s/YOUR_SCRIPT_ID/exec",
};
```

### 6. Deploy to GitHub Pages

1. Push all files to your GitHub repository
2. Go to **Settings > Pages**
3. Under "Source", select **Deploy from a branch**
4. Select **main** branch and **/ (root)** folder
5. Click **Save**
6. Your site will be available at `https://yourusername.github.io/repository-name/`

## Usage

### Adding Items

1. Fill in your name and the item you need
2. Optionally add quantity, substitute info, image URL, or AH link
3. Click "Add to List"

### Managing Items

- **Close**: Mark an item as purchased/completed
- **Reopen**: Move a closed item back to open
- **Delete**: Soft delete an item (requires admin code)

### Bulk Actions

- **Delete Closed Items**: Soft delete all closed items
- **Delete All Items**: Soft delete all open and closed items

Both require the admin code.

### Export

- **Print**: Opens print dialog with a clean layout
- **Copy as Text**: Copies open items to clipboard in a simple format

## API Endpoints

All endpoints use the same base URL with an `action` parameter.

### GET `?action=list&status=open|closed|deleted|all`

Returns items filtered by status (default: open).

### POST `?action=add`

Add a new item. Body:
```json
{
  "name": "John",
  "item": "Milk",
  "quantity": "2 liters",
  "substituteFor": "Oat milk",
  "imageUrl": "https://...",
  "ahUrl": "https://ah.nl/..."
}
```

### POST `?action=setStatus`

Change item status. Body:
```json
{
  "id": "item-id",
  "status": "open|closed|deleted",
  "adminCode": "required-for-delete"
}
```

### POST `?action=bulk`

Bulk status change. Body:
```json
{
  "action": "deleteClosed|deleteAll",
  "adminCode": "required"
}
```

## Data Model

The Google Sheet has these columns:

| Column | Description |
|--------|-------------|
| id | Unique identifier |
| createdAt | ISO timestamp when created |
| updatedAt | ISO timestamp when last modified |
| closedAt | ISO timestamp when closed |
| deletedAt | ISO timestamp when deleted |
| ip | Client IP (best effort) |
| userAgent | Client user agent |
| name | Person who submitted |
| item | Item name |
| quantity | Optional quantity |
| substituteFor | Optional substitute info |
| imageUrl | Optional image URL |
| ahUrl | Optional AH product link |
| status | open, closed, or deleted |

## Security Notes

- Admin code is stored in Apps Script properties (not in code)
- Admin code is never persisted in browser localStorage
- Soft delete only - no data is permanently removed
- All changes are logged with timestamps

## License

MIT
