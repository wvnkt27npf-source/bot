# AlgoX Trader — Full Setup Guide

Complete guide to connecting TradingView ALGOX V6 → API Server → Chrome Extension → XM Broker.

---

## Prerequisites

- TradingView account with ALGOX V6 indicator
- XM broker account (Demo or Real) — logged in on Chrome
- Replit account (this project deployed)
- Google Chrome browser

---

## Step 1: Set Your Webhook Secret

The API server requires a secret token to authenticate incoming TradingView webhooks.

1. In this Replit project, go to **Secrets** (lock icon in the sidebar)
2. Add a new secret:
   - **Key**: `WEBHOOK_SECRET`
   - **Value**: any long random string (e.g. `algox-secret-abc123xyz789`)
3. Restart the API Server workflow after adding the secret

> If `WEBHOOK_SECRET` is not set, the webhook endpoint will reject ALL requests with 401.

---

## Step 2: Deploy the App

1. Click **Deploy** in Replit to publish the app
2. Note your production URL (e.g. `https://algox-trader.replit.app`)
3. This URL is your **Server URL** — you'll use it in TradingView and the Chrome extension

---

## Step 3: Configure TradingView Webhook

1. Open TradingView and add the ALGOX V6 indicator to your chart
2. Create a new alert on the indicator:
   - **Condition**: set to your desired signal
   - **Alert Name**: anything (e.g. "AlgoX Signal")
3. Go to the **Notifications** tab of the alert:
   - Check **Webhook URL**
   - Paste: `https://YOUR-APP.replit.app/api/webhook`
4. In the **Message** box, paste exactly:
   ```json
   {"symbol":"{{ticker}}","action":"{{strategy.order.action}}","price":{{close}}}
   ```
5. Add the Authorization header in TradingView:
   - In the Webhook URL field, some versions support headers — alternatively set the Authorization header as: `Bearer YOUR_WEBHOOK_SECRET`
   
   **Alternative** (if TradingView doesn't support headers): Append secret to the URL path and handle it server-side, or use TradingView's alert message to include the token.

   > **Note**: TradingView's standard webhook sends to the URL with POST. The server validates the `Authorization: Bearer <WEBHOOK_SECRET>` header.

---

## Step 4: Install the Chrome Extension

1. Go to the **Settings** page in the dashboard
2. Click **Download ZIP** to download the extension
3. Extract the ZIP to a folder on your computer
4. Open Chrome and navigate to: `chrome://extensions`
5. Enable **Developer mode** (top right toggle)
6. Click **Load unpacked** and select the extracted folder
7. The **AlgoX Trader** extension icon will appear in your toolbar

---

## Step 5: Configure the Chrome Extension

1. Click the AlgoX Trader icon in Chrome toolbar
2. In the popup, enter your **Server URL**: `https://YOUR-APP.replit.app`
3. Click **Save**
4. The status will change to **Connected** (green dot)
5. Make sure **Auto Trading** toggle is ON

> The extension polls your server every 3 seconds for new signals.

---

## Step 6: Ensure You're Logged into XM

1. Open Chrome and go to `https://my.xm.com`
2. Log in to your Demo or Real account
3. The extension needs an active XM session to place orders

---

## Step 7: Verify the Full Flow

1. Open the dashboard's **Signals** page — you should see it polling (live indicator blinking)
2. In TradingView, trigger a test alert manually
3. Watch the **Signals** page — a new BUY or SELL signal should appear
4. The extension will:
   - Open the XM symbol page for that symbol
   - Attempt to click the BUY/SELL button automatically
   - Show an overlay with the signal details
   - Mark the signal as processed
5. If auto-click doesn't work (XM page structure may vary), the overlay will show manual instructions

---

## Managing Symbols

The **Symbols** page lets you manage which pairs the extension can trade:

- 5 default symbols are pre-configured: BTCUSD, ETHUSD, ENJUSD, XRPUSD, LTCUSD
- Add new symbols by providing the symbol name and its XM URL
- XM URL format: `https://my.xm.com/symbol-info/SYMBOLNAME%23`
  - Example: `https://my.xm.com/symbol-info/SOLUSD%23`
- Delete symbols you don't want to trade

> If a signal arrives for a symbol not in the registry, it will be marked processed immediately (no trade placed).

---

## Settings

The **Settings** page controls:

| Setting | Default | Description |
|---------|---------|-------------|
| Take Profit | $2 | Dollar amount for TP on each order |
| Stop Loss | $2 | Dollar amount for SL on each order |
| Automation | Enabled | Master switch for the Chrome extension |

Changes save immediately and the extension picks them up on the next poll.

---

## Troubleshooting

### Signals not appearing
- Check the API server is running (Replit workflows panel)
- Verify `WEBHOOK_SECRET` is set and matches what TradingView sends
- Test manually with curl:
  ```bash
  curl -X POST https://YOUR-APP.replit.app/api/webhook \
    -H "Authorization: Bearer YOUR_SECRET" \
    -H "Content-Type: application/json" \
    -d '{"symbol":"BTCUSD","action":"BUY","price":65000}'
  ```

### Extension shows "Error" or "No URL"
- Make sure you've saved the Server URL in the extension popup
- Check the URL has no trailing slash
- Ensure the app is deployed (not just running in development)

### Auto-click not working on XM
- XM may update their interface — the overlay will show the action you need to take manually
- Ensure you're logged into XM in Chrome
- The extension needs the `my.xm.com` tab to be fully loaded

### Extension service worker sleeping
- Chrome may put the service worker to sleep after inactivity
- The extension uses a 30-second alarm to keep it alive
- Click the extension icon to wake it up if needed

---

## Architecture Overview

```
TradingView Alert
      │  POST /api/webhook (Bearer token)
      ▼
API Server (Express)
      │  Stores signal in PostgreSQL
      │
      ├──▶ Dashboard (React)
      │     Polls GET /api/signals every 5s
      │     Shows real-time signal feed
      │
      └──▶ Chrome Extension
            Polls GET /api/signals/latest every 3s
            Opens XM tab → clicks BUY/SELL
            PATCH /api/signals/:id/processed
```
