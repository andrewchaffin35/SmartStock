# SmartStock AI

SmartStock AI is a local demo for small-business inventory. It tracks products, sales, incoming shipments, and stock adjustments, then calculates revenue and gross profit from those records.

This version runs in the browser with HTML, CSS, and vanilla JavaScript. It does not use a front-end framework or a build step.

## Files

- `index.html` — page structure, navigation, dashboard, tables, forms, and dialogs
- `style.css` — layout, color, and responsive styles
- `script.js` — records, calculations, rendering, and form behavior
- `sample-inventory.csv` — example inventory file
- `README.md` — this guide

## Run the website

Open `index.html` in a current browser. That is enough for the demo, including saving records in this browser.

Chart.js is loaded from a CDN, so charts need an internet connection. If the library does not load, the totals still appear as text.

You can also serve the folder locally:

```bash
cd smartstock-ai
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Demo sign-in

Create an account with your name, business name, email, and a password of at least 8 characters. Creating the account does not open the dashboard. Sign in afterward with that email and password.

You can also choose Continue with Google on the create account or log in screen. Google sign-in opens only after you add your own Google OAuth client ID to `GOOGLE_CLIENT_ID` at the top of `script.js`. In Google Cloud, allow this site under Authorized JavaScript origins. The page loads Google's sign-in script from the internet. A production app should verify Google's token on a server.

The password itself is not stored. The browser saves a salted hash and checks it locally. Someone with access to this browser's saved data could still try to guess the password, so this is not a substitute for server-side authentication. Signing out hides the dashboard and keeps the records.

In Settings, choose a color to make an initials picture, or upload a photo. The photo is cropped to a square and saved with the profile in this browser.

Sample products, sales, and shipments load the first time the site is opened. They stay in place when you refresh. Settings can restore the original sample. That replaces products, sales, shipments, and adjustments, and it keeps the current profile signed in.

The sample figures are demo data. The dashboard calculates them from the stored records.

## Import a CSV

Use Import CSV on the dashboard, or download `sample-inventory.csv`.

Required columns:

`Product,SKU,Category,Supplier,Price,UnitCost,Stock,ReorderThreshold`

The importer accepts quoted fields, including commas inside a product name. It shows a preview before anything changes. If any row is invalid, or a SKU is repeated in the file or already in inventory, nothing is imported and the preview lists the row errors.

The sample file uses the same SKUs as the built-in demo products. Importing it unchanged reports duplicate SKUs. To try a successful import, change the SKUs or remove the matching products first.

Export CSV downloads the products that match the current search and filters, including rows hidden by Show more.

## Sales and profit

Revenue for a sale is the quantity multiplied by the actual selling price per unit. That price is what the customer paid. An optional discount note is stored with the sale and is not subtracted again.

Cost of goods sold is the quantity multiplied by the unit cost saved when the sale was recorded. Later edits to a product's unit cost do not change older sales.

Gross profit is revenue minus cost of goods sold. Gross profit margin is gross profit divided by revenue. When revenue is zero, the margin is omitted.

Estimated gross profit per unit on a product is the current selling price minus the current unit cost. It does not include rent, wages, shipping, taxes, or other operating costs.

The next-month forecast averages up to three completed calendar months when at least two of those months have sales. With less history, the card shows a limited estimate or says there is not enough data. Forecasts are estimates, not promised results.

Percentage change is `((current period - previous period) / previous period) × 100`. If the previous period is zero and the current period is above zero, the card says "New sales activity." If there is no earlier period to compare, it says "Not enough data."

Inventory value is the current quantity of each product multiplied by its current unit cost.

Approximate turnover, when shown, is the last 30 days of cost of goods sold divided by the current inventory value. It is not a historical average of inventory.

## Gross profit and net profit

Gross profit only subtracts the cost of the goods that were sold. Net profit would also subtract operating expenses, taxes, and other costs. This demo does not record those expenses, so it never labels a number as net profit.

## Stock changes

Sales, delivered shipments, and manual adjustments all change quantity through the same stock update and write a history entry.

A shipment has its own inventory flag, separate from the status label. The ordered quantity is added once, the first time the status becomes Delivered. Later edits do not add it again. Changing a delivered shipment back to another status does not remove the stock. Record an adjustment if a delivery was a mistake.

A sale cannot reduce stock below zero. Damage or loss cannot either. A correction stores the quantity you counted, as long as that count is zero or greater, and logs the difference.

## Limits before a real multi-user version

localStorage is only appropriate for this single-browser prototype. A production app needs:

- a backend API
- a database
- secure authentication, with passwords hashed on the server and Google tokens checked on the server
- server-side authorization
- data isolation between businesses

Do not deploy this demo as a place to store real customer or financial records.
