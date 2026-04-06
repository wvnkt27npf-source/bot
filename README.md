# AlgoX Trading Automation System

A full-stack automation system that receives trading signals from TradingView's ALGOX V6 indicator via webhook, displays them on a dashboard, and uses a Chrome extension to automatically place orders on XM broker.

---

## System Overview

```
TradingView (ALGOX V6 Indicator)
        │
        │  POST /api/webhook
        │  Bearer Token Auth
        ▼
API Server (Express + PostgreSQL)
        │
        ├─── Signals stored in DB
        │
        ├─── GET /api/signals/latest  ◄──── Chrome Extension (polls every 3s)
        │                                        │
        │                                        │ Opens XM tab, clicks BUY/SELL
        │                                        ▼
        │                               XM Broker (my.xm.com)
        │
        └─── Trading Dashboard (React)
             - Monitor signals live
             - Manage symbols
             - Configure TP/SL settings
```

**Signal flow:**
1. ALGOX V6 fires an alert on TradingView → sends JSON payload to your server webhook URL
2. Server validates the secret token, stores the signal in the database
3. Chrome extension polls the server every 3 seconds for new unprocessed signals
4. When a signal is found, the extension opens the correct XM symbol page and automatically places the BUY or SELL order
5. The signal is marked as processed so it is not repeated

---

## Prerequisites

Before starting, make sure you have:

- **XM Account** — Logged in at [my.xm.com](https://my.xm.com) with trading enabled
- **TradingView Account** — With access to the ALGOX V6 indicator (Pro plan or higher for webhook alerts)
- **Google Chrome** — Required for the Chrome extension
- **Deployed Server URL** — A publicly accessible URL for your API server (see Step 1). TradingView cannot reach `localhost`.
- **Node.js 18+** and **pnpm** — For running the project locally

---

## Step 1: Server Setup

### 1.1 Install dependencies

```bash
pnpm install
```

### 1.2 Set up the database

The project uses a PostgreSQL database. Create your database and set the connection string:

```bash
# Set the database connection string
DATABASE_URL=postgresql://user:password@host:5432/dbname
```

Run database migrations to create the required tables:

```bash
pnpm --filter @workspace/db push
```

### 1.3 Set environment variables

Create a `.env` file in `artifacts/api-server/` (or set these as environment variables in your hosting provider):

```env
# Required: Secret token for webhook authentication
WEBHOOK_SECRET=your_secret_token_here

# Required: PostgreSQL connection string
DATABASE_URL=postgresql://user:password@host:5432/dbname

# Optional: Port (defaults to the PORT env var or 3000)
PORT=3000
```

**Choosing a `WEBHOOK_SECRET`:** Use a long, random string (e.g., generate with `openssl rand -hex 32`). You will paste this into TradingView alert settings later.

### 1.4 Start the server

```bash
pnpm --filter @workspace/api-server dev
```

The API server will start and be available at your configured port. For production, deploy to any cloud provider (Railway, Render, Fly.io, etc.) and note your public URL — you will need it in the next steps.

### 1.5 Verify the server is running

```bash
curl https://your-server-url/api/healthz
# Expected: { "status": "ok" }
```

---

## Step 2: TradingView Alert Setup

### 2.1 Open your ALGOX V6 chart

Open TradingView and load a chart with the **ALGOX V6** indicator applied.

### 2.2 Create a new alert

1. Click the **Alerts** clock icon (or press `Alt+A`)
2. Click **Create Alert**
3. Under **Condition**, select the **ALGOX V6** indicator and your desired signal condition (e.g., "Buy Signal" or "Sell Signal")

### 2.3 Configure the webhook

1. In the alert dialog, scroll down to **Notifications**
2. Enable **Webhook URL**
3. Paste your webhook URL:
   ```
   https://your-server-url/api/webhook
   ```

### 2.4 Set the alert message (JSON payload)

In the **Message** field, replace the default message with the following JSON. TradingView will fill in the `{{...}}` placeholders automatically:

```json
{
  "symbol": "{{ticker}}",
  "action": "BUY",
  "price": {{close}}
}
```

> **Note:** For a SELL alert, change `"action": "BUY"` to `"action": "SELL"`. Create separate alerts for BUY and SELL signals.

**Payload field reference:**

| Field    | Type             | Required | Description                              |
|----------|------------------|----------|------------------------------------------|
| `symbol` | string           | Yes      | Trading symbol (e.g. `BTCUSD`, `ETHUSD`) |
| `action` | `"BUY"` or `"SELL"` | Yes  | Trade direction                          |
| `price`  | number           | No       | Signal price at the time of the alert    |

### 2.5 Add authentication header

TradingView supports adding a custom header for authentication. In the **Headers** field (if available), add:

```
Authorization: Bearer your_secret_token_here
```

Replace `your_secret_token_here` with the same value you set as `WEBHOOK_SECRET`.

> **Alternative:** Some TradingView plans support adding the token in the URL as a query parameter. If your plan does not support custom headers, contact TradingView support or check the latest TradingView alert documentation.

### 2.6 Save the alert

Click **Create** to save the alert. TradingView will now send a webhook to your server every time the condition triggers.

---

## Step 3: Dashboard Usage

### 3.1 Open the dashboard

Navigate to your dashboard URL (the trading-dashboard artifact URL, e.g. `https://your-server-url/`).

### 3.2 Signals page

The **Signals** page auto-refreshes every 5 seconds and shows all received signals:

- **Symbol** — The trading symbol
- **Direction** — BUY (green) or SELL (red)
- **Price** — Price at signal time
- **Time** — When the signal was received
- **Status** — Processed or pending

### 3.3 Symbols management

Go to the **Symbols** page to manage which trading pairs the extension handles:

1. **Add a symbol:** Enter the symbol name (e.g. `BTCUSD`) and its XM URL, then click **Add**
2. **Remove a symbol:** Click the delete button next to any symbol

The following symbols are pre-loaded by default:

| Symbol  | XM URL                                         |
|---------|------------------------------------------------|
| BTCUSD  | https://my.xm.com/symbol-info/BTCUSD%23        |
| ETHUSD  | https://my.xm.com/symbol-info/ETHUSD%23        |
| ENJUSD  | https://my.xm.com/symbol-info/ENJUSD%23        |
| XRPUSD  | https://my.xm.com/symbol-info/XRPUSD%23        |
| LTCUSD  | https://my.xm.com/symbol-info/LTCUSD%23        |

### 3.4 Settings page

On the **Settings** page you can configure:

- **TP Amount** — Take Profit in USD (default: $2)
- **SL Amount** — Stop Loss in USD (default: $2)
- **Automation Enabled** — Toggle to enable or disable the extension's auto-trading
- **Webhook URL** — Copy button to copy your webhook URL for use in TradingView

---

## Step 4: Chrome Extension Install

### 4.1 Download the extension

The extension files are located in the `artifacts/chrome-extension/` folder of this project.

If you cloned the repository, you already have the files locally.

### 4.2 Enable Developer Mode in Chrome

1. Open Chrome and navigate to `chrome://extensions`
2. In the top-right corner, toggle **Developer mode** ON

### 4.3 Load the extension

1. Click **Load unpacked**
2. Browse to and select the `artifacts/chrome-extension/` folder
3. The **AlgoX Trader** extension will appear in your extensions list

### 4.4 Configure the server URL

1. Click the **AlgoX Trader** icon in the Chrome toolbar (pin it if needed)
2. In the popup, enter your API server URL in the **Server URL** field:
   ```
   https://your-server-url
   ```
3. The automation toggle should show **ON** (this reflects the setting from the dashboard)

### 4.5 Verify the extension is active

The extension icon should show a **green indicator** when automation is active and the server is reachable.

---

## Step 5: XM Broker Setup

### 5.1 Log in to XM

Open Chrome and go to [my.xm.com](https://my.xm.com). Log in with your XM account credentials.

> **Important:** You must be logged in to XM in the same Chrome browser where the extension is installed. The extension will open XM symbol pages directly.

### 5.2 Enable One Click Order

1. On any XM trading page, locate the **One Click Order** toggle
2. Enable it so orders can be placed without additional confirmation dialogs
3. The extension's content script will also attempt to enable this automatically, but enabling it manually first is recommended

### 5.3 Test the automation

1. Make sure the server is running and the Chrome extension is installed and configured
2. Send a test webhook manually:

```bash
curl -X POST https://your-server-url/api/webhook \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_secret_token_here" \
  -d '{"symbol": "BTCUSD", "action": "BUY", "price": 65000}'
```

3. Within a few seconds, Chrome should open a new tab with the XM BTCUSD page and attempt to place a BUY order
4. Check the **Signals** page on the dashboard — the signal should show as **Processed**

---

## Troubleshooting

### Signal not arriving at the server

- Confirm the server is publicly accessible (TradingView requires a public URL, not `localhost`)
- Verify the webhook URL in TradingView is correct: `https://your-server-url/api/webhook`
- Check that the `Authorization: Bearer your_secret_token_here` header matches the `WEBHOOK_SECRET` environment variable exactly
- Test the webhook endpoint directly with `curl` (see Step 5.3)

### Extension is not placing orders

- Make sure you are logged in to XM in the same Chrome browser
- Check that the **Server URL** in the extension popup points to your running server
- Verify the **Automation Enabled** setting is ON in the dashboard Settings page
- Open `chrome://extensions`, find AlgoX Trader, and click **Service Worker** to view background script logs for errors
- Make sure the symbol exists in the Symbols list on the dashboard with a valid XM URL

### XM page selector has changed

XM occasionally updates their web interface, which can break the content script's DOM selectors. If the extension opens the XM page but does not click the order button:

1. Open an XM symbol page (e.g. `https://my.xm.com/symbol-info/BTCUSD%23`)
2. Right-click the BUY/SELL button and click **Inspect**
3. Identify the updated CSS selector or button text
4. Update the selector in `artifacts/chrome-extension/content.js` and reload the extension

### Dashboard shows no signals

- Confirm the server is running and the database is connected (`GET /api/health`)
- Check the server logs for any database connection errors
- Verify that `DATABASE_URL` is set correctly

### Automation toggle not working

- The automation state is stored in the server settings (`/api/settings`)
- If the toggle does not persist, check that the server has database write access

---

## Symbol URL Format

To add a new symbol for XM, use this URL format:

```
https://my.xm.com/symbol-info/{SYMBOL}%23
```

**Examples:**

| Symbol   | URL                                              |
|----------|--------------------------------------------------|
| BTCUSD   | `https://my.xm.com/symbol-info/BTCUSD%23`       |
| ETHUSD   | `https://my.xm.com/symbol-info/ETHUSD%23`       |
| EURUSD   | `https://my.xm.com/symbol-info/EURUSD%23`       |
| XAUUSD   | `https://my.xm.com/symbol-info/XAUUSD%23`       |
| GBPUSD   | `https://my.xm.com/symbol-info/GBPUSD%23`       |

The `%23` at the end is the URL-encoded `#` character, which XM uses to identify the trading instrument page. Replace `{SYMBOL}` with the exact symbol name as it appears on XM's platform.

---

## API Reference

| Method  | Endpoint                       | Description                              |
|---------|--------------------------------|------------------------------------------|
| `POST`  | `/api/webhook`                 | Receive signal from TradingView          |
| `GET`   | `/api/signals`                 | List all signals (paginated)             |
| `GET`   | `/api/signals/latest`          | Get latest unprocessed signal            |
| `PATCH` | `/api/signals/:id/processed`   | Mark a signal as processed               |
| `GET`   | `/api/symbols`                 | List all configured symbols              |
| `POST`  | `/api/symbols`                 | Add a new symbol                         |
| `DELETE`| `/api/symbols/:id`             | Remove a symbol                          |
| `GET`   | `/api/settings`                | Get automation settings                  |
| `PATCH` | `/api/settings`                | Update automation settings               |
| `GET`   | `/api/healthz`                 | Server health check                      |
