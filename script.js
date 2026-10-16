"use strict";

const STORAGE_KEY = "replenish";
const BUSINESS_ID = "biz_demo";
const PAGE_SIZE = 8;
// Web client for Sign in with Google. Authorized JavaScript origins must include
// the exact address in the browser, such as http://127.0.0.1:8765.
const GOOGLE_CLIENT_ID = "";
const AVATAR_COLORS = ["#123C32", "#16A36A", "#1F2937", "#2563EB", "#7C3AED", "#DC2626", "#F59E0B", "#0F766E"];

const SHIPMENT_LABELS = {
  preparing: "Preparing",
  shipped: "Shipped",
  out_for_delivery: "Out for Delivery",
  delivered: "Delivered"
};

const STOCK_LABELS = {
  in: "In Stock",
  low: "Low Stock",
  out: "Out of Stock"
};

const ADJUSTMENT_LABELS = {
  restock: "Restock",
  damage: "Damage/Loss",
  return: "Return",
  correction: "Correction",
  sale: "Sale",
  shipment: "Shipment delivery"
};

const moneyFormat = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const dateFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const monthFormat = new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric" });
const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const shortMonthFormat = new Intl.DateTimeFormat("en-US", { month: "short" });

let state = null;
let lastFocus = null;

const ui = {
  panel: "dashboard",
  inventory: {
    search: "",
    category: "all",
    status: "all",
    sort: "name",
    direction: "asc",
    visibleCount: PAGE_SIZE
  },
  salesTrendRange: "monthly",
  salesPage: { range: "month", search: "" },
  shipmentFilter: "all",
  analyticsRange: "90",
  charts: {},
  csvPreview: null,
  editingProductId: null,
  editingShipmentId: null,
  detailProductId: null,
  confirmAction: null,
  toastTimer: null
};

function emptyState() {
  return {
    version: 1,
    businessId: BUSINESS_ID,
    profile: null,
    sessionActive: false,
    products: [],
    sales: [],
    shipments: [],
    adjustments: [],
    counters: { product: 1, sale: 1, shipment: 1, adjustment: 1 }
  };
}

function maxId(records, prefix) {
  return records.reduce((max, record) => {
    const match = new RegExp(`^${prefix}_(\\d+)$`).exec(String(record.id || ""));
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
}

function normalize(data) {
  const next = emptyState();
  if (!data || typeof data !== "object") return next;
  if (data.profile && data.profile.email) {
    next.profile = {
      name: String(data.profile.name || "").trim(),
      businessName: String(data.profile.businessName || "").trim(),
      email: String(data.profile.email || "").trim(),
      authProvider: data.profile.authProvider === "google" ? "google" : "password",
      passwordHash: String(data.profile.passwordHash || ""),
      passwordSalt: String(data.profile.passwordSalt || ""),
      googleSub: String(data.profile.googleSub || ""),
      avatar: readAvatar(data.profile.avatar)
    };
  }
  const canSignIn = Boolean(next.profile && (next.profile.passwordHash || next.profile.googleSub));
  next.sessionActive = Boolean(data.sessionActive && canSignIn);
  next.products = Array.isArray(data.products) ? data.products : [];
  next.sales = Array.isArray(data.sales) ? data.sales : [];
  next.shipments = Array.isArray(data.shipments) ? data.shipments : [];
  next.adjustments = Array.isArray(data.adjustments) ? data.adjustments : [];
  const stored = data.counters || {};
  next.counters = {
    product: Math.max(Number(stored.product) || 1, maxId(next.products, "prd") + 1),
    sale: Math.max(Number(stored.sale) || 1, maxId(next.sales, "sal") + 1),
    shipment: Math.max(Number(stored.shipment) || 1, maxId(next.shipments, "shp") + 1),
    adjustment: Math.max(Number(stored.adjustment) || 1, maxId(next.adjustments, "adj") + 1)
  };
  return next;
}

function clearBooks() {
  state.products = [];
  state.sales = [];
  state.shipments = [];
  state.adjustments = [];
  state.counters = { product: 1, sale: 1, shipment: 1, adjustment: 1 };
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      state = normalize(JSON.parse(raw));
      return;
    }
  } catch (error) {
    console.error("Replenish could not read saved records.", error);
  }
  state = emptyState();
  saveData();
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function nextId(kind) {
  const prefixes = { product: "prd", sale: "sal", shipment: "shp", adjustment: "adj" };
  const number = state.counters[kind];
  state.counters[kind] += 1;
  return `${prefixes[kind]}_${number}`;
}

function toISODate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseISODate(iso) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function shiftDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function todayISO() {
  return toISODate(new Date());
}

function dateMonthsAgo(monthOffset, day) {
  const now = new Date();
  const monthIndex = now.getMonth() + monthOffset;
  const lastDay = new Date(now.getFullYear(), monthIndex + 1, 0).getDate();
  let chosen = Math.min(day, lastDay);
  if (monthOffset === 0) chosen = Math.min(chosen, now.getDate());
  return new Date(now.getFullYear(), monthIndex, chosen);
}

function roundMoney(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function formatMoney(value) {
  return moneyFormat.format(roundMoney(Number(value) || 0));
}

function formatDate(iso) {
  if (!iso) return "None";
  return dateFormat.format(parseISODate(iso));
}

function formatPercent(value) {
  const rounded = Math.round(value * 10) / 10;
  const sign = rounded > 0 ? "+" : "";
  return `${sign}${rounded.toFixed(1)}%`;
}

function parseWhole(value, minimum = 0) {
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  const number = Number(text);
  return number < minimum ? null : number;
}

function parseMoney(value) {
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  return Number(text);
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function sha256(message) {
  const bytes = new TextEncoder().encode(message);
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 4, bitLength, false);
  const k = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);
  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);
  for (let offset = 0; offset < padded.length; offset += 64) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0; let b = h1; let c = h2; let d = h3;
    let e = h4; let f = h5; let g = h6; let h = h7;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + k[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }
  return [h0, h1, h2, h3, h4, h5, h6, h7].map((word) => word.toString(16).padStart(8, "0")).join("");
}

function rotr(value, bits) {
  return (value >>> bits) | (value << (32 - bits));
}

function randomSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hashPassword(password, salt) {
  let hash = sha256(`${salt}:${password}`);
  for (let round = 0; round < 4000; round += 1) hash = sha256(`${hash}:${password}`);
  return hash;
}

function passwordsMatch(password, profile) {
  if (!profile || !profile.passwordHash || !profile.passwordSalt) return false;
  return hashPassword(password, profile.passwordSalt) === profile.passwordHash;
}

function findProduct(id) {
  return state.products.find((product) => product.id === id) || null;
}

function skuTaken(sku, exceptId = "") {
  const key = sku.trim().toLowerCase();
  return state.products.some((product) => product.id !== exceptId && product.sku.trim().toLowerCase() === key);
}

function calculateStockStatus(quantity, reorderThreshold) {
  if (quantity === 0) return "out";
  if (quantity <= reorderThreshold) return "low";
  return "in";
}

function suggestedReorder(product) {
  const target = product.targetStockLevel == null ? product.reorderThreshold * 2 : product.targetStockLevel;
  return Math.max(0, target - product.quantity);
}

function calculateGrossProfit(sale) {
  const revenue = roundMoney(sale.quantity * sale.sellingPricePerUnit);
  const cogs = roundMoney(sale.quantity * sale.unitCostAtSale);
  const grossProfit = roundMoney(revenue - cogs);
  return {
    revenue,
    cogs,
    grossProfit,
    margin: revenue === 0 ? null : (grossProfit / revenue) * 100
  };
}

function summarizeSales(sales) {
  return sales.reduce((totals, sale) => {
    const result = calculateGrossProfit(sale);
    totals.revenue = roundMoney(totals.revenue + result.revenue);
    totals.cogs = roundMoney(totals.cogs + result.cogs);
    totals.grossProfit = roundMoney(totals.grossProfit + result.grossProfit);
    totals.transactions += 1;
    totals.units += sale.quantity;
    return totals;
  }, { revenue: 0, cogs: 0, grossProfit: 0, transactions: 0, units: 0, margin: null });
}

function calculateSalesMetrics(startDate, endDate, sales = state.sales) {
  const totals = summarizeSales(sales.filter((sale) => sale.date >= startDate && sale.date <= endDate));
  totals.margin = totals.revenue === 0 ? null : (totals.grossProfit / totals.revenue) * 100;
  totals.average = totals.transactions === 0 ? 0 : roundMoney(totals.revenue / totals.transactions);
  return totals;
}

function calculateInventoryValue(products = state.products) {
  return roundMoney(products.reduce((sum, product) => sum + product.quantity * product.unitCost, 0));
}

function earliestSaleDate() {
  if (!state.sales.length) return "";
  return state.sales.reduce((earliest, sale) => (sale.date < earliest ? sale.date : earliest), state.sales[0].date);
}

function periodExists(endDate) {
  const earliest = earliestSaleDate();
  return Boolean(earliest) && earliest <= endDate;
}

function percentChange(current, previous, exists) {
  if (!exists) return { kind: "insufficient" };
  if (previous === 0 && current > 0) return { kind: "new" };
  if (previous === 0) return { kind: "insufficient" };
  return { kind: "value", value: ((current - previous) / previous) * 100 };
}

function eachDate(startDate, endDate) {
  const dates = [];
  let cursor = parseISODate(startDate);
  const end = parseISODate(endDate);
  while (cursor <= end) {
    dates.push(toISODate(cursor));
    cursor = shiftDays(cursor, 1);
  }
  return dates;
}

function salesTrendModel() {
  const today = new Date();
  const end = todayISO();
  const range = ui.salesTrendRange;
  let currentStart = end;
  let previousStart = end;
  let previousEnd = end;
  let yearStart = "";
  let yearEnd = "";
  let labels = [];
  let values = [];

  if (range === "weekly") {
    currentStart = toISODate(shiftDays(today, -6));
    previousStart = toISODate(shiftDays(today, -13));
    previousEnd = toISODate(shiftDays(today, -7));
    labels = eachDate(currentStart, end).map((iso) => dayFormat.format(parseISODate(iso)));
    values = eachDate(currentStart, end).map((iso) => calculateSalesMetrics(iso, iso).revenue);
  } else if (range === "yearly") {
    currentStart = toISODate(new Date(today.getFullYear(), 0, 1));
    previousStart = toISODate(new Date(today.getFullYear() - 1, 0, 1));
    previousEnd = toISODate(new Date(today.getFullYear() - 1, 11, 31));
    for (let month = 0; month <= today.getMonth(); month += 1) {
      const start = new Date(today.getFullYear(), month, 1);
      const monthEnd = new Date(today.getFullYear(), month + 1, 0);
      const clipped = monthEnd > today ? today : monthEnd;
      labels.push(shortMonthFormat.format(start));
      values.push(calculateSalesMetrics(toISODate(start), toISODate(clipped)).revenue);
    }
  } else {
    currentStart = toISODate(new Date(today.getFullYear(), today.getMonth(), 1));
    previousStart = toISODate(new Date(today.getFullYear(), today.getMonth() - 1, 1));
    previousEnd = toISODate(new Date(today.getFullYear(), today.getMonth(), 0));
    yearStart = toISODate(new Date(today.getFullYear() - 1, today.getMonth(), 1));
    yearEnd = toISODate(new Date(today.getFullYear() - 1, today.getMonth() + 1, 0));
    labels = eachDate(currentStart, end).map((iso) => dayFormat.format(parseISODate(iso)));
    values = eachDate(currentStart, end).map((iso) => calculateSalesMetrics(iso, iso).revenue);
  }

  return {
    range,
    current: calculateSalesMetrics(currentStart, end),
    previous: calculateSalesMetrics(previousStart, previousEnd),
    previousExists: periodExists(previousEnd),
    year: yearStart ? calculateSalesMetrics(yearStart, yearEnd) : null,
    yearExists: yearEnd ? periodExists(yearEnd) : false,
    labels,
    values
  };
}

function averageMetrics(months) {
  const count = months.length || 1;
  const revenue = roundMoney(months.reduce((sum, month) => sum + month.revenue, 0) / count);
  const cogs = roundMoney(months.reduce((sum, month) => sum + month.cogs, 0) / count);
  const grossProfit = roundMoney(revenue - cogs);
  return {
    revenue,
    cogs,
    grossProfit,
    margin: revenue === 0 ? null : (grossProfit / revenue) * 100
  };
}

function calculateProfitForecast() {
  if (!state.sales.length) return { kind: "insufficient", months: [] };
  const today = new Date();
  const earliest = parseISODate(earliestSaleDate());
  const firstMonth = new Date(earliest.getFullYear(), earliest.getMonth(), 1);
  const lastCompleted = new Date(today.getFullYear(), today.getMonth() - 1, 1);
  const months = [];

  if (firstMonth <= lastCompleted) {
    let cursor = new Date(firstMonth);
    while (cursor <= lastCompleted) {
      const start = toISODate(cursor);
      const end = toISODate(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0));
      months.push({
        label: monthFormat.format(cursor),
        ...calculateSalesMetrics(start, end)
      });
      cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    }
  }

  if (months.length >= 2) {
    const recent = months.slice(-3);
    return {
      kind: "average",
      months: recent,
      forecast: averageMetrics(recent),
      previous: months[months.length - 1],
      monthCount: recent.length
    };
  }

  if (months.length === 1) {
    return {
      kind: "limited",
      months,
      forecast: averageMetrics(months),
      previous: null,
      monthCount: 1
    };
  }

  const currentStart = toISODate(new Date(today.getFullYear(), today.getMonth(), 1));
  const current = calculateSalesMetrics(currentStart, todayISO());
  if (current.transactions === 0) return { kind: "insufficient", months: [] };
  return {
    kind: "limited",
    months: [{ label: monthFormat.format(today), ...current }],
    forecast: current,
    previous: null,
    monthCount: 1
  };
}

function calculateTurnover() {
  const end = todayISO();
  const start = toISODate(shiftDays(new Date(), -29));
  const metrics = calculateSalesMetrics(start, end);
  const value = calculateInventoryValue();
  if (metrics.transactions === 0 || value <= 0) return null;
  return metrics.cogs / value;
}

function applyStockChange(product, delta, entry) {
  const nextQuantity = product.quantity + delta;
  if (nextQuantity < 0) {
    if (entry.type === "sale") return { ok: false, error: "Not enough inventory for this sale." };
    if (entry.type === "damage") return { ok: false, error: "Damage or loss cannot reduce stock below zero." };
    return { ok: false, error: "Stock cannot go below zero." };
  }
  product.quantity = nextQuantity;
  product.updatedAt = new Date().toISOString();
  state.adjustments.push({
    id: nextId("adjustment"),
    businessId: BUSINESS_ID,
    productId: product.id,
    productName: product.name,
    sku: product.sku,
    type: entry.type,
    quantityDelta: delta,
    quantityAfter: nextQuantity,
    date: entry.date,
    note: entry.note || "",
    sourceId: entry.sourceId || ""
  });
  return { ok: true };
}

function addProduct(input) {
  if (skuTaken(input.sku)) return { ok: false, error: "That SKU is already used." };
  const timestamp = new Date().toISOString();
  const product = {
    id: nextId("product"),
    businessId: BUSINESS_ID,
    name: input.name.trim(),
    sku: input.sku.trim(),
    category: input.category.trim(),
    supplier: input.supplier.trim(),
    supplierContact: (input.supplierContact || "").trim(),
    description: (input.description || "").trim(),
    barcode: (input.barcode || "").trim(),
    sellingPrice: input.sellingPrice,
    unitCost: input.unitCost,
    quantity: 0,
    reorderThreshold: input.reorderThreshold,
    targetStockLevel: input.targetStockLevel == null ? null : input.targetStockLevel,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  state.products.push(product);
  if (input.quantity > 0) {
    const stock = applyStockChange(product, input.quantity, {
      type: "restock",
      date: todayISO(),
      note: input.stockNote || "Opening balance",
      sourceId: product.id
    });
    if (!stock.ok) {
      state.products.pop();
      return stock;
    }
  }
  return { ok: true, product };
}

function editProduct(id, input) {
  const product = findProduct(id);
  if (!product) return { ok: false, error: "That product is no longer in inventory." };
  if (skuTaken(input.sku, id)) return { ok: false, error: "That SKU is already used." };
  product.name = input.name.trim();
  product.sku = input.sku.trim();
  product.category = input.category.trim();
  product.supplier = input.supplier.trim();
  product.supplierContact = (input.supplierContact || "").trim();
  product.description = (input.description || "").trim();
  product.barcode = (input.barcode || "").trim();
  product.sellingPrice = input.sellingPrice;
  product.unitCost = input.unitCost;
  product.reorderThreshold = input.reorderThreshold;
  product.targetStockLevel = input.targetStockLevel == null ? null : input.targetStockLevel;
  product.updatedAt = new Date().toISOString();
  return { ok: true, product };
}

function deleteProduct(id) {
  const product = findProduct(id);
  if (!product) return { ok: false, error: "That product is no longer in inventory." };
  const blocking = state.shipments.find((shipment) => (
    shipment.productId === id && !shipment.inventoryReconciled && shipment.status !== "delivered"
  ));
  if (blocking) {
    return {
      ok: false,
      error: "This product has an incoming shipment. Deliver or delete that shipment before deleting the product."
    };
  }
  state.products = state.products.filter((item) => item.id !== id);
  return { ok: true };
}

function recordSale(input) {
  const product = findProduct(input.productId);
  if (!product) return { ok: false, error: "Choose a product." };
  if (input.quantity > product.quantity) return { ok: false, error: "Not enough inventory for this sale." };
  const sale = {
    id: nextId("sale"),
    businessId: BUSINESS_ID,
    productId: product.id,
    productName: product.name,
    sku: product.sku,
    category: product.category,
    quantity: input.quantity,
    date: input.date,
    sellingPricePerUnit: input.price,
    unitCostAtSale: product.unitCost,
    discountNote: input.discountNote || "",
    orderId: input.orderId || ""
  };
  const stock = applyStockChange(product, -input.quantity, {
    type: "sale",
    date: input.date,
    note: input.orderId ? `Sale ${input.orderId}` : `Sale ${sale.id}`,
    sourceId: sale.id
  });
  if (!stock.ok) return stock;
  state.sales.push(sale);
  return { ok: true, sale };
}

function deliverShipment(shipment, appliedDate) {
  if (shipment.inventoryReconciled) return { ok: true, already: true };
  const product = findProduct(shipment.productId);
  if (!product) return { ok: false, error: "The product for this shipment is no longer in inventory." };
  const stock = applyStockChange(product, shipment.quantity, {
    type: "shipment",
    date: appliedDate || todayISO(),
    note: `Delivered shipment ${shipment.id}`,
    sourceId: shipment.id
  });
  if (!stock.ok) return stock;
  shipment.status = "delivered";
  shipment.inventoryReconciled = true;
  shipment.updatedAt = new Date().toISOString();
  return { ok: true };
}

function createShipment(input, appliedDate) {
  const product = findProduct(input.productId);
  if (!product) return { ok: false, error: "Choose a product." };
  const timestamp = new Date().toISOString();
  const shipment = {
    id: nextId("shipment"),
    businessId: BUSINESS_ID,
    productId: product.id,
    productName: product.name,
    sku: product.sku,
    supplier: input.supplier.trim(),
    quantity: input.quantity,
    expectedDate: input.expectedDate,
    trackingNumber: (input.trackingNumber || "").trim(),
    status: input.status,
    inventoryReconciled: false,
    createdAt: timestamp,
    updatedAt: timestamp
  };
  state.shipments.push(shipment);
  if (input.status === "delivered") {
    const delivered = deliverShipment(shipment, appliedDate);
    if (!delivered.ok) {
      state.shipments.pop();
      return delivered;
    }
  }
  return { ok: true, shipment };
}

function updateShipment(id, input) {
  const shipment = state.shipments.find((item) => item.id === id);
  if (!shipment) return { ok: false, error: "That shipment could not be found." };
  if (!shipment.inventoryReconciled) {
    const product = findProduct(input.productId);
    if (!product) return { ok: false, error: "Choose a product." };
    shipment.productId = product.id;
    shipment.productName = product.name;
    shipment.sku = product.sku;
    shipment.quantity = input.quantity;
  }
  shipment.supplier = input.supplier.trim();
  shipment.expectedDate = input.expectedDate;
  shipment.trackingNumber = (input.trackingNumber || "").trim();
  shipment.updatedAt = new Date().toISOString();
  if (input.status === "delivered") {
    const delivered = deliverShipment(shipment);
    if (!delivered.ok) return delivered;
    shipment.status = "delivered";
  } else {
    shipment.status = input.status;
  }
  return { ok: true, shipment };
}

function deleteShipment(id) {
  const shipment = state.shipments.find((item) => item.id === id);
  if (!shipment) return { ok: false, error: "That shipment could not be found." };
  if (shipment.inventoryReconciled) {
    return { ok: false, error: "This shipment was already added to inventory. Record an adjustment if the stock needs to change." };
  }
  state.shipments = state.shipments.filter((item) => item.id !== id);
  return { ok: true };
}

function adjustInventory(input) {
  const product = findProduct(input.productId);
  if (!product) return { ok: false, error: "Choose a product." };
  let delta = input.quantity;
  if (input.type === "damage") delta = -input.quantity;
  if (input.type === "correction") delta = input.quantity - product.quantity;
  return applyStockChange(product, delta, {
    type: input.type,
    date: input.date,
    note: input.note,
    sourceId: ""
  });
}

function catalog() {
  return [
    ["NB-100", "Notebooks", "Stationery", "Northline Paper", "orders@northline.example", 6.5, 2.1, 20, 100, "100000000001", "Ruled notebooks, pack of three.", 84],
    ["PN-200", "Pens", "Stationery", "Northline Paper", "orders@northline.example", 1.75, 0.4, 24, 60, "100000000002", "Black ballpoint pens.", 18],
    ["WB-300", "Water bottles", "Drinkware", "Harbor Goods", "hello@harbor.example", 18, 7.25, 12, 40, "100000000003", "Insulated 20 oz bottles.", 42],
    ["BP-400", "Backpacks", "Bags", "Trailform Supply", "supply@trailform.example", 42, 19.5, 8, 20, "100000000004", "Everyday laptop backpacks.", 0],
    ["DO-500", "Desk organizers", "Office", "Northline Paper", "orders@northline.example", 14, 5.8, 10, 30, "100000000005", "Desktop trays and pen cups.", 27],
    ["PC-600", "Phone chargers", "Electronics", "Volt & Co", "sales@volt.example", 15, 6.4, 15, 40, "100000000006", "USB-C wall chargers.", 9],
    ["SB-700", "Reusable shopping bags", "Bags", "Harbor Goods", "hello@harbor.example", 3.5, 1.1, 20, 80, "100000000007", "Fold-flat tote bags.", 64],
    ["MG-800", "Coffee mugs", "Drinkware", "Kiln Street Ceramics", "studio@kilnstreet.example", 12, 4.25, 10, 24, "100000000008", "12 oz stoneware mugs.", 6]
  ].map(([sku, name, category, supplier, supplierContact, sellingPrice, unitCost, reorderThreshold, targetStockLevel, barcode, description, finalQuantity]) => ({
    sku, name, category, supplier, supplierContact, sellingPrice, unitCost, reorderThreshold, targetStockLevel, barcode, description, finalQuantity
  }));
}

function plannedSales() {
  const monthSales = [
    ["NB-100", 6, 0, 2], ["PN-200", 8, 0, 5], ["WB-300", 2, 0, 8], ["DO-500", 3, 0, 11],
    ["SB-700", 4, 0, 3], ["MG-800", 2, 0, 6], ["PC-600", 2, 0, 9], ["NB-100", 10, -1, 4],
    ["PN-200", 14, -1, 8], ["WB-300", 5, -1, 12], ["DO-500", 4, -1, 15], ["PC-600", 6, -1, 18],
    ["SB-700", 9, -1, 20], ["MG-800", 5, -1, 22], ["BP-400", 2, -1, 25], ["NB-100", 8, -2, 8],
    ["PN-200", 11, -2, 14], ["WB-300", 4, -2, 18], ["SB-700", 7, -2, 21], ["MG-800", 4, -2, 24],
    ["DO-500", 3, -2, 10], ["PC-600", 3, -2, 16], ["NB-100", 7, -3, 6], ["PN-200", 9, -3, 11],
    ["WB-300", 5, -3, 16], ["PC-600", 4, -3, 19], ["SB-700", 6, -3, 23], ["BP-400", 2, -3, 27],
    ["MG-800", 3, -3, 9], ["NB-100", 6, -12, 5], ["PN-200", 8, -12, 9], ["WB-300", 3, -12, 14],
    ["DO-500", 2, -12, 18], ["SB-700", 5, -12, 22], ["MG-800", 4, -12, 26], ["PC-600", 2, -12, 8],
    ["NB-100", 8, -13, 10], ["PN-200", 10, -13, 12], ["SB-700", 6, -13, 18], ["WB-300", 4, -14, 8],
    ["MG-800", 5, -14, 15], ["DO-500", 3, -14, 20], ["PC-600", 4, -15, 14], ["BP-400", 1, -15, 11],
    ["SB-700", 4, -15, 22]
  ];
  const recentSales = [
    ["NB-100", 3, -1], ["PN-200", 4, -2], ["WB-300", 2, -3], ["MG-800", 2, -4],
    ["PC-600", 1, -5], ["SB-700", 3, -6], ["NB-100", 2, -8], ["DO-500", 2, -9],
    ["PN-200", 3, -10], ["BP-400", 1, -11], ["MG-800", 1, -12], ["WB-300", 1, -13]
  ];
  const planned = monthSales.map(([sku, qty, offset, day]) => ({
    sku,
    qty,
    date: toISODate(dateMonthsAgo(offset, day)),
    price: null,
    note: ""
  }));
  recentSales.forEach(([sku, qty, ago]) => {
    planned.push({ sku, qty, date: toISODate(shiftDays(new Date(), ago)), price: null, note: "" });
  });
  const special = planned.find((sale) => sale.sku === "NB-100");
  if (special) {
    special.price = 6;
    special.note = "Negotiated price recorded at checkout.";
  }
  return planned;
}

function populateSeed() {
  const items = catalog();
  const planned = plannedSales();
  const sold = {};
  planned.forEach((sale) => {
    sold[sale.sku] = (sold[sale.sku] || 0) + sale.qty;
  });
  const received = { "PC-600": 20 };
  items.forEach((item) => {
    const opening = item.finalQuantity + (sold[item.sku] || 0) - (received[item.sku] || 0);
    if (opening < 0) throw new Error(`Demo opening stock for ${item.sku} is negative.`);
    const created = addProduct({
      name: item.name,
      sku: item.sku,
      category: item.category,
      supplier: item.supplier,
      supplierContact: item.supplierContact,
      description: item.description,
      barcode: item.barcode,
      sellingPrice: item.sellingPrice,
      unitCost: item.unitCost,
      quantity: 0,
      reorderThreshold: item.reorderThreshold,
      targetStockLevel: item.targetStockLevel,
      stockNote: "Opening balance for demo data"
    });
    if (!created.ok) throw new Error(created.error);
    if (opening > 0) {
      const stock = applyStockChange(created.product, opening, {
        type: "restock",
        date: "1970-01-01",
        note: "Opening balance for demo data"
      });
      if (!stock.ok) throw new Error(stock.error);
    }
    item.productId = created.product.id;
  });

  const openingDate = toISODate(shiftDays(parseISODate(planned.map((sale) => sale.date).sort()[0]), -1));
  items.forEach((item) => {
    const product = findProduct(item.productId);
    const openingEntry = state.adjustments.find((entry) => entry.productId === product.id && entry.note === "Opening balance for demo data");
    if (openingEntry) openingEntry.date = openingDate;
  });

  const charger = state.products.find((product) => product.sku === "PC-600");
  const delivered = createShipment({
    productId: charger.id,
    supplier: charger.supplier,
    quantity: 20,
    expectedDate: openingDate,
    trackingNumber: "VL-1008",
    status: "delivered"
  }, openingDate);
  if (!delivered.ok) throw new Error(delivered.error);

  planned.sort((a, b) => a.date.localeCompare(b.date) || a.sku.localeCompare(b.sku));
  planned.forEach((sale) => {
    const product = state.products.find((item) => item.sku === sale.sku);
    const result = recordSale({
      productId: product.id,
      quantity: sale.qty,
      date: sale.date,
      price: sale.price == null ? product.sellingPrice : sale.price,
      discountNote: sale.note,
      orderId: ""
    });
    if (!result.ok) throw new Error(`${sale.sku} on ${sale.date}: ${result.error}`);
  });
  state.sales.forEach((sale, index) => {
    sale.orderId = `ORD-${1500 + index}`;
  });

  [
    ["PN-200", 40, 4, "preparing", ""],
    ["WB-300", 24, 2, "shipped", "HS-20411"],
    ["MG-800", 18, 1, "out_for_delivery", "KS-7781"]
  ].forEach(([sku, quantity, days, status, trackingNumber]) => {
    const product = state.products.find((item) => item.sku === sku);
    const result = createShipment({
      productId: product.id,
      supplier: product.supplier,
      quantity,
      expectedDate: toISODate(shiftDays(new Date(), days)),
      trackingNumber,
      status
    });
    if (!result.ok) throw new Error(result.error);
  });

  items.forEach((item) => {
    const product = state.products.find((entry) => entry.sku === item.sku);
    if (product.quantity !== item.finalQuantity) {
      throw new Error(`Expected ${item.sku} to end at ${item.finalQuantity}, found ${product.quantity}.`);
    }
  });
}

function restoreDemoData() {
  const profile = state.profile;
  const sessionActive = state.sessionActive;
  state = emptyState();
  state.profile = profile;
  state.sessionActive = sessionActive;
  populateSeed();
  saveData();
  ui.inventory.visibleCount = PAGE_SIZE;
  ui.inventory.search = "";
  ui.inventory.category = "all";
  ui.inventory.status = "all";
  document.getElementById("inventory-search").value = "";
  document.getElementById("inventory-status").value = "all";
  renderAll();
  toast("Demo data restored.");
}

function filteredProducts() {
  const query = ui.inventory.search.trim().toLowerCase();
  const rows = state.products.filter((product) => {
    const status = calculateStockStatus(product.quantity, product.reorderThreshold);
    const haystack = `${product.name} ${product.sku}`.toLowerCase();
    if (query && !haystack.includes(query)) return false;
    if (ui.inventory.category !== "all" && product.category !== ui.inventory.category) return false;
    if (ui.inventory.status === "needs-restock") return status === "low" || status === "out";
    if (ui.inventory.status !== "all" && status !== ui.inventory.status) return false;
    return true;
  });
  const direction = ui.inventory.direction === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    let result = 0;
    if (ui.inventory.sort === "name") result = a.name.localeCompare(b.name);
    if (ui.inventory.sort === "quantity") result = a.quantity - b.quantity;
    if (ui.inventory.sort === "price") result = a.sellingPrice - b.sellingPrice;
    if (ui.inventory.sort === "cost") result = a.unitCost - b.unitCost;
    if (result === 0) result = a.name.localeCompare(b.name);
    return result * direction;
  });
  return rows;
}

function stockAlerts() {
  return state.products
    .filter((product) => {
      const status = calculateStockStatus(product.quantity, product.reorderThreshold);
      return status === "low" || status === "out";
    })
    .sort((a, b) => {
      const rank = (product) => (calculateStockStatus(product.quantity, product.reorderThreshold) === "out" ? 0 : 1);
      const ratio = (product) => (product.reorderThreshold === 0 ? product.quantity : product.quantity / product.reorderThreshold);
      return rank(a) - rank(b) || ratio(a) - ratio(b) || a.name.localeCompare(b.name);
    });
}

function incomingShipments() {
  return state.shipments
    .filter((shipment) => shipment.status !== "delivered")
    .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate) || a.id.localeCompare(b.id));
}

function salesPageBounds() {
  const today = new Date();
  const end = todayISO();
  if (ui.salesPage.range === "lastMonth") {
    return {
      start: toISODate(new Date(today.getFullYear(), today.getMonth() - 1, 1)),
      end: toISODate(new Date(today.getFullYear(), today.getMonth(), 0))
    };
  }
  if (ui.salesPage.range === "30") return { start: toISODate(shiftDays(today, -29)), end };
  if (ui.salesPage.range === "year") return { start: toISODate(new Date(today.getFullYear(), 0, 1)), end };
  if (ui.salesPage.range === "all") return { start: "0000-01-01", end: "9999-12-31" };
  return { start: toISODate(new Date(today.getFullYear(), today.getMonth(), 1)), end };
}

function analyticsBounds() {
  const today = new Date();
  const end = todayISO();
  if (ui.analyticsRange === "year") return { start: toISODate(new Date(today.getFullYear(), 0, 1)), end };
  if (ui.analyticsRange === "all") return { start: earliestSaleDate() || end, end };
  return { start: toISODate(new Date(today.getFullYear(), today.getMonth() - 2, 1)), end };
}

function monthBuckets(startDate, endDate) {
  const buckets = [];
  let cursor = new Date(parseISODate(startDate).getFullYear(), parseISODate(startDate).getMonth(), 1);
  const last = new Date(parseISODate(endDate).getFullYear(), parseISODate(endDate).getMonth(), 1);
  while (cursor <= last) {
    const start = toISODate(cursor);
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    const clipped = toISODate(monthEnd < parseISODate(endDate) ? monthEnd : parseISODate(endDate));
    buckets.push({ label: monthFormat.format(cursor), ...calculateSalesMetrics(start, clipped) });
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }
  return buckets;
}

function escapeCSV(value) {
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, "\"\"")}"`;
  return text;
}

function exportCSV() {
  const rows = filteredProducts();
  if (!rows.length) {
    toast("There are no products to export for the current search.");
    return;
  }
  const lines = ["Product,SKU,Category,Supplier,Price,UnitCost,Stock,ReorderThreshold"];
  rows.forEach((product) => {
    lines.push([
      product.name,
      product.sku,
      product.category,
      product.supplier,
      product.sellingPrice.toFixed(2),
      product.unitCost.toFixed(2),
      product.quantity,
      product.reorderThreshold
    ].map(escapeCSV).join(","));
  });
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "replenish-inventory.csv";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast(`Exported ${rows.length} products.`);
}

function parseCSV(text) {
  const source = text.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inQuotes) {
      if (char === "\"") {
        if (source[index + 1] === "\"") {
          cell += "\"";
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
    } else if (char === "\"") {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((columns) => columns.some((column) => column.trim() !== ""));
}

function validateCSV(text) {
  const table = parseCSV(text);
  const errors = [];
  const rows = [];
  if (!table.length) return { rows, errors: ["The file is empty."], sourceText: text };
  const header = table[0].map((column) => column.trim().toLowerCase());
  const required = ["product", "sku", "category", "supplier", "price", "unitcost", "stock", "reorderthreshold"];
  const missing = required.filter((name) => !header.includes(name));
  if (missing.length) {
    return { rows, errors: [`Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`], sourceText: text };
  }
  const index = Object.fromEntries(required.map((name) => [name, header.indexOf(name)]));
  const seen = new Set();
  if (table.length === 1) errors.push("The file has no product rows.");
  for (let lineIndex = 1; lineIndex < table.length; lineIndex += 1) {
    const columns = table[lineIndex];
    const line = lineIndex + 1;
    const rowErrors = [];
    const value = (name) => (columns[index[name]] || "").trim();
    const product = value("product");
    const sku = value("sku");
    const category = value("category");
    const supplier = value("supplier");
    const priceText = value("price");
    const costText = value("unitcost");
    const stockText = value("stock");
    const reorderText = value("reorderthreshold");
    const price = parseMoney(priceText);
    const unitCost = parseMoney(costText);
    const stock = parseWhole(stockText);
    const reorder = parseWhole(reorderText);
    if (!product) rowErrors.push("product name is required");
    if (!sku) rowErrors.push("SKU is required");
    if (!category) rowErrors.push("category is required");
    if (!supplier) rowErrors.push("supplier is required");
    if (price == null) rowErrors.push("price must be zero or greater, with up to 2 decimals");
    if (unitCost == null) rowErrors.push("unit cost must be zero or greater, with up to 2 decimals");
    if (stock == null) rowErrors.push("stock must be a nonnegative whole number");
    if (reorder == null) rowErrors.push("reorder threshold must be a nonnegative whole number");
    const skuKey = sku.toLowerCase();
    if (sku && seen.has(skuKey)) rowErrors.push("duplicate SKU in this file");
    if (sku) seen.add(skuKey);
    if (sku && skuTaken(sku)) rowErrors.push("SKU already exists in inventory");
    if (rowErrors.length) errors.push(`Row ${line}: ${rowErrors.join("; ")}.`);
    rows.push({ line, product, sku, category, supplier, priceText, costText, stockText, reorderText, price, unitCost, stock, reorder });
  }
  return { rows, errors, sourceText: text };
}

function importCSV(rows) {
  rows.forEach((row) => {
    const result = addProduct({
      name: row.product,
      sku: row.sku,
      category: row.category,
      supplier: row.supplier,
      sellingPrice: row.price,
      unitCost: row.unitCost,
      quantity: row.stock,
      reorderThreshold: row.reorder,
      targetStockLevel: null,
      stockNote: "Opening balance from CSV import"
    });
    if (!result.ok) throw new Error(result.error);
  });
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value == null || value === false) return;
    if (key === "className") node.className = value;
    else if (key === "text") node.textContent = String(value);
    else node.setAttribute(key, String(value));
  });
  children.flat().forEach((child) => {
    if (child == null) return;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return node;
}

function clear(node) {
  node.replaceChildren();
}

function appendCells(row, pairs) {
  pairs.forEach(([label, content]) => {
    const cell = document.createElement("td");
    cell.dataset.label = label;
    if (content instanceof Node) cell.append(content);
    else cell.textContent = content == null || content === "" ? "None" : String(content);
    row.append(cell);
  });
}

function pill(status) {
  return el("span", { className: `pill pill-${status === "in" || status === "low" || status === "out" ? status : "neutral"}`, text: STOCK_LABELS[status] || status });
}

function shipmentPill(status) {
  return el("span", { className: "pill pill-neutral", text: SHIPMENT_LABELS[status] || status });
}

function actionButton(label, action, id, className) {
  return el("button", { type: "button", className, text: label, "data-action": action, "data-id": id });
}

function toast(message) {
  const node = document.getElementById("toast");
  node.textContent = message;
  window.clearTimeout(ui.toastTimer);
  ui.toastTimer = window.setTimeout(() => {
    node.textContent = "";
  }, 4200);
}

function openDialog(id) {
  lastFocus = document.activeElement;
  const dialog = document.getElementById(id);
  if (!dialog.open) dialog.showModal();
}

function closeDialog(id) {
  const dialog = document.getElementById(id);
  if (dialog.open) dialog.close();
}

function clearErrors(ids) {
  ids.forEach((id) => {
    const field = document.getElementById(id);
    const error = document.getElementById(`${id}-error`);
    if (field) field.removeAttribute("aria-invalid");
    if (error) error.textContent = "";
  });
}

function setError(id, message) {
  const field = document.getElementById(id);
  const error = document.getElementById(`${id}-error`);
  if (field) field.setAttribute("aria-invalid", "true");
  if (error) error.textContent = message;
  return false;
}

function setFormMessage(id, message) {
  const node = document.getElementById(id);
  if (node) node.textContent = message;
}

function setCompare(id, text, className) {
  const node = document.getElementById(id);
  node.textContent = text;
  node.className = `compare ${className || ""}`.trim();
  node.hidden = !text;
}

function describeChange(result, label) {
  if (result.kind === "new") return { text: `${label}: New sales activity`, className: "warn" };
  if (result.kind === "insufficient") return { text: `${label}: Not enough data`, className: "" };
  const direction = result.value > 0 ? "up" : result.value < 0 ? "down" : "";
  return { text: `${label}: ${formatPercent(result.value)}`, className: direction };
}

function describeDirection(result) {
  if (result.kind === "new") return { text: "New sales activity", className: "warn" };
  if (result.kind === "insufficient") return { text: "Not enough data", className: "" };
  if (result.value > 0) return { text: "Increasing", className: "up" };
  if (result.value < 0) return { text: "Decreasing", className: "down" };
  return { text: "No change", className: "" };
}

function formatMargin(margin) {
  return margin == null ? "Not available" : formatPercent(margin).replace("+", "");
}

function requireSession() {
  if (state.sessionActive && state.profile) return true;
  openLogin();
  setFormMessage("login-errors", "Sign in with your password or Google before opening the dashboard.");
  return false;
}

function closeAccountMenu() {
  document.getElementById("account-menu").hidden = true;
  document.getElementById("account-button").setAttribute("aria-expanded", "false");
}

function closeNav() {
  document.getElementById("nav-links").classList.remove("is-open");
  document.getElementById("nav-toggle").setAttribute("aria-expanded", "false");
}

function updateNav() {
  document.querySelectorAll(".nav-link[data-panel]").forEach((button) => {
    if (button.dataset.panel === ui.panel) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

function showPanel(name, options = {}) {
  if (!requireSession()) return;
  ui.panel = name;
  ["dashboard", "sales", "shipments", "analytics", "settings"].forEach((panel) => {
    document.getElementById(`panel-${panel}`).hidden = panel !== name;
  });
  if (name === "settings") fillSettings();
  updateNav();
  closeNav();
  closeAccountMenu();
  refreshVisibleCharts();
  if (!options.keepScroll) window.scrollTo({ top: 0 });
}

function showInventory(status) {
  if (!requireSession()) return;
  showPanel("dashboard", { keepScroll: true });
  if (status) {
    ui.inventory.status = status;
    ui.inventory.visibleCount = PAGE_SIZE;
    document.getElementById("inventory-status").value = status;
    renderInventoryTable();
  }
  document.getElementById("all-products").scrollIntoView({ behavior: "smooth", block: "start" });
}

function readAvatar(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.type === "photo" && typeof raw.image === "string" && raw.image.startsWith("data:image/jpeg;base64,") && raw.image.length < 200000) {
    return { type: "photo", image: raw.image };
  }
  if (raw.type === "initials" && AVATAR_COLORS.includes(raw.color)) return { type: "initials", color: raw.color };
  return null;
}

function initialsFor(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function paintAvatar(node, profile) {
  if (!node || !profile) return;
  node.replaceChildren();
  const avatar = profile.avatar;
  if (avatar && avatar.type === "photo") {
    const image = document.createElement("img");
    image.alt = "";
    image.src = avatar.image;
    node.append(image);
    node.style.background = "";
    return;
  }
  node.textContent = initialsFor(profile.name);
  node.style.background = avatar && avatar.color ? avatar.color : "#123C32";
}

function markAvatarColor() {
  const selected = state.profile && state.profile.avatar && state.profile.avatar.type === "initials" ? state.profile.avatar.color : "";
  document.querySelectorAll(".avatar-swatch").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.color === selected));
  });
}

function saveAvatar(avatar) {
  if (!state.profile) return;
  state.profile.avatar = avatar;
  saveData();
  paintAvatar(document.getElementById("account-avatar"), state.profile);
  paintAvatar(document.getElementById("settings-avatar"), state.profile);
  markAvatarColor();
}

function resizeAvatar(file) {
  return new Promise((resolve, reject) => {
    if (!file || !String(file.type || "").startsWith("image/")) {
      reject(new Error("Choose a PNG, JPEG, WebP, or GIF image."));
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      reject(new Error("Choose an image smaller than 8 MB."));
      return;
    }
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const size = 256;
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext("2d");
      const scale = Math.max(size / image.width, size / image.height);
      const width = image.width * scale;
      const height = image.height * scale;
      context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That image could not be read."));
    };
    image.src = url;
  });
}

function renderChrome() {
  const signedIn = Boolean(state.sessionActive && state.profile);
  document.getElementById("view-welcome").hidden = signedIn;
  document.getElementById("view-app").hidden = !signedIn;
  document.getElementById("logged-out-actions").hidden = signedIn;
  document.getElementById("logged-in-actions").hidden = !signedIn;
  if (!signedIn) return;
  document.getElementById("nav-business").textContent = state.profile.businessName;
  document.getElementById("account-name").textContent = state.profile.name;
  paintAvatar(document.getElementById("account-avatar"), state.profile);
  document.getElementById("dash-title").textContent = state.profile.businessName;
  document.getElementById("dash-subtitle").textContent = `Signed in as ${state.profile.name}. Figures on this page are calculated from the records in this browser.`;
  updateNav();
}

function renderSalesCard() {
  const model = salesTrendModel();
  document.getElementById("sales-total").textContent = formatMoney(model.current.revenue);
  const previousLabel = model.range === "weekly" ? "Compared with the previous 7 days" : model.range === "yearly" ? "Compared with last year" : "Compared with last month";
  const previous = describeChange(percentChange(model.current.revenue, model.previous.revenue, model.previousExists), previousLabel);
  setCompare("sales-compare", previous.text, previous.className);
  const yearNode = document.getElementById("sales-year");
  if (model.range === "monthly" && model.year) {
    const year = describeChange(percentChange(model.current.revenue, model.year.revenue, model.yearExists), "Compared with the same month last year");
    setCompare("sales-year", year.text, year.className);
    yearNode.hidden = false;
  } else {
    yearNode.textContent = "";
    yearNode.hidden = true;
  }
  const direction = describeDirection(percentChange(model.current.revenue, model.previous.revenue, model.previousExists));
  const directionNode = document.getElementById("sales-direction");
  directionNode.textContent = direction.text;
  directionNode.className = `direction ${direction.className}`.trim();
  ["weekly", "monthly", "yearly"].forEach((range) => {
    document.getElementById(`trend-${range}`).setAttribute("aria-checked", String(ui.salesTrendRange === range));
  });
  document.getElementById("sales-summary").textContent = `${formatMoney(model.current.revenue)} revenue. ${previous.text}. ${yearNode.hidden ? "" : yearNode.textContent}`.trim();
}

function renderLowStock() {
  const list = document.getElementById("low-stock-list");
  const empty = document.getElementById("low-stock-empty");
  clear(list);
  const alerts = stockAlerts().slice(0, 3);
  empty.hidden = alerts.length > 0;
  alerts.forEach((product) => {
    const status = calculateStockStatus(product.quantity, product.reorderThreshold);
    list.append(el("li", { className: "compact-item" }, [
      el("div", {}, [
        el("p", { className: "item-title", text: product.name }),
        el("p", { className: "item-meta", text: `${product.sku} · ${product.quantity} on hand · reorder at ${product.reorderThreshold} · suggest ${suggestedReorder(product)}` })
      ]),
      el("div", { className: "row-actions" }, [
        pill(status),
        actionButton("Restock", "restock", product.id, "button button-secondary")
      ])
    ]));
  });
}

function renderIncomingCard() {
  const list = document.getElementById("incoming-list");
  const empty = document.getElementById("incoming-empty");
  clear(list);
  const shipments = incomingShipments().slice(0, 3);
  empty.hidden = shipments.length > 0;
  list.hidden = shipments.length === 0;
  shipments.forEach((shipment) => {
    list.append(el("li", { className: "compact-item" }, [
      el("div", {}, [
        el("p", { className: "item-title", text: shipment.productName }),
        el("p", { className: "item-meta", text: `${shipment.sku} · ${shipment.supplier} · ${shipment.quantity} ordered · ${formatDate(shipment.expectedDate)}` })
      ]),
      shipmentPill(shipment.status)
    ]));
  });
}

function renderForecast() {
  const forecast = calculateProfitForecast();
  const note = document.getElementById("forecast-note");
  const summary = document.getElementById("forecast-summary");
  const chartBox = document.getElementById("forecastChart").parentElement;
  if (forecast.kind === "insufficient") {
    ["forecast-revenue", "forecast-cogs", "forecast-profit", "forecast-margin"].forEach((id) => {
      document.getElementById(id).textContent = "Not enough data to forecast.";
    });
    setCompare("forecast-compare", "Not enough data", "");
    note.textContent = "A forecast needs sales history. Gross profit is an estimate, not a guaranteed result, and it excludes operating expenses.";
    summary.textContent = "Not enough data to forecast.";
    chartBox.hidden = true;
    return;
  }
  chartBox.hidden = false;
  document.getElementById("forecast-revenue").textContent = formatMoney(forecast.forecast.revenue);
  document.getElementById("forecast-cogs").textContent = formatMoney(forecast.forecast.cogs);
  document.getElementById("forecast-profit").textContent = formatMoney(forecast.forecast.grossProfit);
  document.getElementById("forecast-margin").textContent = formatMargin(forecast.forecast.margin);
  if (forecast.kind === "average" && forecast.previous) {
    const change = describeChange(
      percentChange(forecast.forecast.grossProfit, forecast.previous.grossProfit, true),
      "Estimated gross profit compared with last month"
    );
    setCompare("forecast-compare", change.text, change.className);
    note.textContent = `Estimate based on the average of the last ${forecast.monthCount} completed months. This is not a guaranteed result. Gross profit excludes operating expenses.`;
  } else {
    setCompare("forecast-compare", "Compared with last month: Not enough data", "");
    note.textContent = "Limited estimate. Fewer than two full months of sales are available. This is not a guaranteed result. Gross profit excludes operating expenses.";
  }
  summary.textContent = `${note.textContent} Estimated revenue ${formatMoney(forecast.forecast.revenue)}. Estimated gross profit ${formatMoney(forecast.forecast.grossProfit)}.`;
}

function syncCategoryOptions() {
  const select = document.getElementById("inventory-category");
  const categories = [...new Set(state.products.map((product) => product.category))].sort((a, b) => a.localeCompare(b));
  const signature = categories.join("|");
  if (select.dataset.signature === signature) return;
  select.dataset.signature = signature;
  select.replaceChildren(el("option", { value: "all", text: "All categories" }));
  categories.forEach((category) => select.append(el("option", { value: category, text: category })));
  const next = categories.includes(ui.inventory.category) || ui.inventory.category === "all" ? ui.inventory.category : "all";
  select.value = next;
  ui.inventory.category = next;
}

function renderInventoryTable() {
  syncCategoryOptions();
  const rows = filteredProducts();
  const visible = rows.slice(0, ui.inventory.visibleCount);
  const body = document.getElementById("inventory-body");
  clear(body);
  visible.forEach((product) => {
    const status = calculateStockStatus(product.quantity, product.reorderThreshold);
    const row = document.createElement("tr");
    row.dataset.productId = product.id;
    const nameButton = actionButton(product.name, "view", product.id, "name-button");
    appendCells(row, [
      ["Product Name", nameButton],
      ["SKU", product.sku],
      ["Product Type", product.category],
      ["Supplier", product.supplier],
      ["Selling Price", formatMoney(product.sellingPrice)],
      ["Unit Cost", formatMoney(product.unitCost)],
      ["Quantity", product.quantity],
      ["Stock Status", pill(status)],
      ["Actions", el("div", { className: "row-actions" }, [
        actionButton("View", "view", product.id, "button button-secondary"),
        actionButton("Edit", "edit", product.id, "button button-secondary"),
        actionButton("Delete", "delete", product.id, "button button-danger")
      ])]
    ]);
    body.append(row);
  });
  const countLabel = state.products.length === 1 ? "product" : "products";
  document.getElementById("product-count").textContent = `${state.products.length} ${countLabel}`;
  const empty = document.getElementById("inventory-empty");
  empty.hidden = rows.length > 0;
  empty.textContent = state.products.length === 0 ? "No products yet. Add a product to start the inventory." : "No products match this search.";
  document.getElementById("inventory-page-info").textContent = rows.length ? `Showing ${visible.length} of ${rows.length}` : "";
  document.getElementById("inventory-more").hidden = visible.length >= rows.length;
  const directionButton = document.getElementById("inventory-direction");
  directionButton.textContent = ui.inventory.direction === "asc" ? "Ascending" : "Descending";
  directionButton.setAttribute("aria-label", ui.inventory.direction === "asc" ? "Sort ascending" : "Sort descending");
}

function renderRecentSales() {
  const body = document.getElementById("recent-sales-body");
  const empty = document.getElementById("recent-sales-empty");
  clear(body);
  const sales = [...state.sales].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)).slice(0, 5);
  empty.hidden = sales.length > 0;
  sales.forEach((sale) => {
    const result = calculateGrossProfit(sale);
    const row = document.createElement("tr");
    appendCells(row, [
      ["Date", formatDate(sale.date)],
      ["Product", sale.productName],
      ["Quantity", sale.quantity],
      ["Revenue", formatMoney(result.revenue)],
      ["Gross profit", formatMoney(result.grossProfit)]
    ]);
    body.append(row);
  });
}

function renderSummary() {
  const today = new Date();
  const metrics = calculateSalesMetrics(toISODate(new Date(today.getFullYear(), today.getMonth(), 1)), todayISO());
  document.getElementById("summary-inventory-value").textContent = formatMoney(calculateInventoryValue());
  document.getElementById("summary-gross-profit").textContent = formatMoney(metrics.grossProfit);
}

function renderDashboard() {
  renderSalesCard();
  renderLowStock();
  renderIncomingCard();
  renderForecast();
  renderInventoryTable();
  renderRecentSales();
  renderSummary();
}

function matchingSales() {
  const bounds = salesPageBounds();
  const query = ui.salesPage.search.trim().toLowerCase();
  return state.sales
    .filter((sale) => sale.date >= bounds.start && sale.date <= bounds.end)
    .filter((sale) => {
      if (!query) return true;
      return `${sale.productName} ${sale.sku} ${sale.orderId}`.toLowerCase().includes(query);
    })
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
}

function renderSalesTable() {
  const sales = matchingSales();
  const totals = summarizeSales(sales);
  totals.average = totals.transactions === 0 ? 0 : roundMoney(totals.revenue / totals.transactions);
  document.getElementById("sales-revenue").textContent = formatMoney(totals.revenue);
  document.getElementById("sales-profit").textContent = formatMoney(totals.grossProfit);
  document.getElementById("sales-count").textContent = String(totals.transactions);
  document.getElementById("sales-average").textContent = formatMoney(totals.average);
  const body = document.getElementById("sales-body");
  clear(body);
  sales.forEach((sale) => {
    const result = calculateGrossProfit(sale);
    const row = document.createElement("tr");
    appendCells(row, [
      ["Date", formatDate(sale.date)],
      ["Product", sale.productName],
      ["SKU", sale.sku],
      ["Quantity", sale.quantity],
      ["Price per unit", formatMoney(sale.sellingPricePerUnit)],
      ["Discount note", sale.discountNote],
      ["Revenue", formatMoney(result.revenue)],
      ["Cost of goods", formatMoney(result.cogs)],
      ["Gross profit", formatMoney(result.grossProfit)],
      ["Order ID", sale.orderId]
    ]);
    body.append(row);
  });
  document.getElementById("sales-empty").hidden = sales.length > 0;
}

function shipmentMatches(shipment, delivered) {
  if (delivered && shipment.status !== "delivered") return false;
  if (!delivered && shipment.status === "delivered") return false;
  if (ui.shipmentFilter === "all") return true;
  return shipment.status === ui.shipmentFilter;
}

function shipmentRow(shipment) {
  const row = document.createElement("tr");
  const actions = el("div", { className: "row-actions" }, [
    actionButton("Edit", "edit-shipment", shipment.id, "button button-secondary")
  ]);
  if (!shipment.inventoryReconciled) {
    actions.append(actionButton("Delete", "delete-shipment", shipment.id, "button button-danger"));
  }
  appendCells(row, [
    ["Product", shipment.productName],
    ["SKU", shipment.sku],
    ["Supplier", shipment.supplier],
    ["Quantity", shipment.quantity],
    ["Expected date", formatDate(shipment.expectedDate)],
    ["Tracking", shipment.trackingNumber],
    ["Status", shipmentPill(shipment.status)],
    ["Inventory", shipment.inventoryReconciled ? "Added to inventory" : "Not added yet"],
    ["Actions", actions]
  ]);
  return row;
}

function renderShipments() {
  const incomingBody = document.getElementById("incoming-body");
  const historyBody = document.getElementById("history-body");
  clear(incomingBody);
  clear(historyBody);
  const incoming = state.shipments
    .filter((shipment) => shipmentMatches(shipment, false))
    .sort((a, b) => a.expectedDate.localeCompare(b.expectedDate));
  const history = state.shipments
    .filter((shipment) => shipmentMatches(shipment, true))
    .sort((a, b) => b.expectedDate.localeCompare(a.expectedDate));
  incoming.forEach((shipment) => incomingBody.append(shipmentRow(shipment)));
  history.forEach((shipment) => historyBody.append(shipmentRow(shipment)));
  document.getElementById("incoming-page-empty").hidden = incoming.length > 0;
  const historyEmpty = document.getElementById("history-empty");
  historyEmpty.hidden = history.length > 0;
  historyEmpty.textContent = ui.shipmentFilter !== "all" && ui.shipmentFilter !== "delivered"
    ? "Delivered history is hidden while another status is selected."
    : "No delivered shipments yet.";

  const suppliers = new Map();
  const ensure = (name) => {
    if (!suppliers.has(name)) suppliers.set(name, { name, contacts: new Set(), products: 0, open: 0 });
    return suppliers.get(name);
  };
  state.products.forEach((product) => {
    const row = ensure(product.supplier || "Unknown supplier");
    row.products += 1;
    if (product.supplierContact) row.contacts.add(product.supplierContact);
  });
  state.shipments.forEach((shipment) => {
    const row = ensure(shipment.supplier || "Unknown supplier");
    if (shipment.status !== "delivered") row.open += 1;
  });
  const supplierBody = document.getElementById("supplier-body");
  clear(supplierBody);
  [...suppliers.values()].sort((a, b) => a.name.localeCompare(b.name)).forEach((supplier) => {
    const row = document.createElement("tr");
    appendCells(row, [
      ["Supplier", supplier.name],
      ["Contact", [...supplier.contacts].join(", ")],
      ["Products", supplier.products],
      ["Open shipments", supplier.open]
    ]);
    supplierBody.append(row);
  });
}

function renderAnalytics() {
  const bounds = analyticsBounds();
  const totals = calculateSalesMetrics(bounds.start, bounds.end);
  document.getElementById("metric-revenue").textContent = formatMoney(totals.revenue);
  document.getElementById("metric-profit").textContent = formatMoney(totals.grossProfit);
  document.getElementById("metric-inventory").textContent = formatMoney(calculateInventoryValue());
  const turnover = calculateTurnover();
  document.getElementById("metric-turnover").textContent = turnover == null ? "Not enough data" : turnover.toFixed(2);
  const buckets = monthBuckets(bounds.start, bounds.end);
  document.getElementById("revenue-summary").textContent = buckets.map((bucket) => `${bucket.label} revenue ${formatMoney(bucket.revenue)}`).join(". ");
  document.getElementById("profit-summary").textContent = buckets.map((bucket) => `${bucket.label} gross profit ${formatMoney(bucket.grossProfit)}`).join(". ");

  const ranking = new Map();
  state.sales.filter((sale) => sale.date >= bounds.start && sale.date <= bounds.end).forEach((sale) => {
    if (!ranking.has(sale.sku)) ranking.set(sale.sku, { name: sale.productName, quantity: 0, revenue: 0 });
    const row = ranking.get(sale.sku);
    row.quantity += sale.quantity;
    row.revenue = roundMoney(row.revenue + calculateGrossProfit(sale).revenue);
  });
  const best = [...ranking.values()].sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name)).slice(0, 5);
  const soldByProduct = new Map();
  state.sales.filter((sale) => sale.date >= bounds.start && sale.date <= bounds.end).forEach((sale) => {
    soldByProduct.set(sale.productId, (soldByProduct.get(sale.productId) || 0) + sale.quantity);
  });
  const slow = state.products
    .map((product) => ({ name: product.name, quantity: soldByProduct.get(product.id) || 0 }))
    .sort((a, b) => a.quantity - b.quantity || a.name.localeCompare(b.name))
    .slice(0, 5);
  document.getElementById("best-summary").textContent = best.length
    ? best.map((item) => `${item.name}: ${item.quantity} sold, ${formatMoney(item.revenue)} revenue`).join(". ")
    : "No sales in this range.";
  document.getElementById("slow-summary").textContent = slow.length
    ? slow.map((item) => `${item.name}: ${item.quantity} sold`).join(". ")
    : "No products to compare.";

  const categories = new Map();
  state.sales.filter((sale) => sale.date >= bounds.start && sale.date <= bounds.end).forEach((sale) => {
    const result = calculateGrossProfit(sale);
    categories.set(sale.category, roundMoney((categories.get(sale.category) || 0) + result.revenue));
  });
  document.getElementById("category-summary").textContent = categories.size
    ? [...categories.entries()].map(([name, revenue]) => `${name}: ${formatMoney(revenue)}`).join(". ")
    : "No category sales in this range.";

  const list = document.getElementById("analytics-low-stock");
  clear(list);
  const alerts = stockAlerts();
  document.getElementById("analytics-low-empty").hidden = alerts.length > 0;
  alerts.forEach((product) => {
    const status = calculateStockStatus(product.quantity, product.reorderThreshold);
    list.append(el("li", { className: "compact-item" }, [
      el("div", {}, [
        el("p", { className: "item-title", text: product.name }),
        el("p", { className: "item-meta", text: `${product.sku} · ${product.quantity} on hand · suggest ${suggestedReorder(product)}` })
      ]),
      pill(status)
    ]));
  });
  ui.analyticsCache = { buckets, best, slow, categories };
}

function fillSettings() {
  if (!state.profile) return;
  document.getElementById("settings-name").value = state.profile.name;
  document.getElementById("settings-business").value = state.profile.businessName;
  document.getElementById("settings-email").value = state.profile.email;
  const googleOnly = Boolean(state.profile.googleSub) && !state.profile.passwordHash;
  document.getElementById("settings-password-field").hidden = googleOnly;
  document.getElementById("settings-email").readOnly = googleOnly;
  document.getElementById("settings-password").value = "";
  paintAvatar(document.getElementById("settings-avatar"), state.profile);
  markAvatarColor();
  document.getElementById("avatar-error").textContent = "";
  clearErrors(["settings-name", "settings-business", "settings-email", "settings-password"]);
  setFormMessage("settings-errors", "");
}

function renderAll() {
  renderChrome();
  if (!state.sessionActive || !state.profile) return;
  renderDashboard();
  renderSalesTable();
  renderShipments();
  renderAnalytics();
  refreshVisibleCharts();
}

function chartOptions(horizontal = false) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: horizontal ? "y" : "x",
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label(item) {
            const value = horizontal ? item.parsed.x : item.parsed.y;
            return horizontal ? `${value} sold` : formatMoney(Number(value) || 0);
          }
        }
      }
    },
    scales: horizontal
      ? {
          x: { beginAtZero: true, ticks: { precision: 0 } },
          y: { grid: { display: false } }
        }
      : {
          x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } },
          y: { beginAtZero: true, ticks: { callback: (value) => formatMoney(value) } }
        }
  };
}

function drawChart(key, canvasId, config) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === "undefined") return;
  if (ui.charts[key]) ui.charts[key].destroy();
  ui.charts[key] = new Chart(canvas, config);
}

function showChartFallbacks() {
  const missing = typeof Chart === "undefined";
  document.querySelectorAll(".chart-fallback").forEach((node) => {
    node.hidden = !missing;
  });
}

function drawSalesChart() {
  const model = salesTrendModel();
  drawChart("sales", "salesTrendChart", {
    type: "line",
    data: {
      labels: model.labels,
      datasets: [{
        label: "Revenue",
        data: model.values,
        borderColor: "#16A36A",
        backgroundColor: "rgba(22, 163, 106, 0.15)",
        fill: true,
        tension: 0.25,
        pointRadius: 3
      }]
    },
    options: chartOptions(false)
  });
}

function drawForecastChart() {
  const forecast = calculateProfitForecast();
  if (forecast.kind === "insufficient") {
    if (ui.charts.forecast) {
      ui.charts.forecast.destroy();
      delete ui.charts.forecast;
    }
    return;
  }
  const labels = [...forecast.months.map((month) => month.label), "Next month (est.)"];
  drawChart("forecast", "forecastChart", {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: "Actual revenue", data: [...forecast.months.map((month) => month.revenue), null], backgroundColor: "#16A36A" },
        { label: "Estimated revenue", data: [...forecast.months.map(() => null), forecast.forecast.revenue], backgroundColor: "#123C32" }
      ]
    },
    options: {
      ...chartOptions(false),
      plugins: { ...chartOptions(false).plugins, legend: { display: true } }
    }
  });
}

function drawAnalyticsCharts() {
  const cache = ui.analyticsCache || { buckets: [], best: [], slow: [], categories: new Map() };
  drawChart("revenue", "revenueChart", {
    type: "line",
    data: {
      labels: cache.buckets.map((bucket) => bucket.label),
      datasets: [{ label: "Revenue", data: cache.buckets.map((bucket) => bucket.revenue), borderColor: "#16A36A", backgroundColor: "rgba(22, 163, 106, 0.12)", fill: true, tension: 0.25 }]
    },
    options: chartOptions(false)
  });
  drawChart("profit", "profitChart", {
    type: "line",
    data: {
      labels: cache.buckets.map((bucket) => bucket.label),
      datasets: [{ label: "Gross profit", data: cache.buckets.map((bucket) => bucket.grossProfit), borderColor: "#123C32", backgroundColor: "rgba(18, 60, 50, 0.12)", fill: true, tension: 0.25 }]
    },
    options: chartOptions(false)
  });
  if (cache.best.length) {
    drawChart("best", "bestSellersChart", {
      type: "bar",
      data: {
        labels: cache.best.map((item) => item.name),
        datasets: [{ label: "Units sold", data: cache.best.map((item) => item.quantity), backgroundColor: "#16A36A" }]
      },
      options: chartOptions(true)
    });
  }
  if (cache.slow.length) {
    drawChart("slow", "slowSellersChart", {
      type: "bar",
      data: {
        labels: cache.slow.map((item) => item.name),
        datasets: [{ label: "Units sold", data: cache.slow.map((item) => item.quantity), backgroundColor: "#F59E0B" }]
      },
      options: chartOptions(true)
    });
  }
  const names = [...cache.categories.keys()];
  if (!names.length) return;
  drawChart("category", "categoryChart", {
    type: "doughnut",
    data: {
      labels: names,
      datasets: [{
        data: names.map((name) => cache.categories.get(name)),
        backgroundColor: ["#16A36A", "#123C32", "#F59E0B", "#0F766E", "#65A30D", "#0369A1", "#7C3AED", "#6B7280"]
      }]
    },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }
  });
}

function refreshVisibleCharts() {
  showChartFallbacks();
  if (typeof Chart === "undefined") return;
  window.requestAnimationFrame(() => {
    if (ui.panel === "dashboard") {
      drawSalesChart();
      drawForecastChart();
    }
    if (ui.panel === "analytics") drawAnalyticsCharts();
  });
}

function readProfile(prefix) {
  clearErrors([`${prefix}-name`, `${prefix}-business`, `${prefix}-email`]);
  setFormMessage(`${prefix}-errors`, "");
  const name = document.getElementById(`${prefix}-name`).value.trim();
  const businessName = document.getElementById(`${prefix}-business`).value.trim();
  const email = document.getElementById(`${prefix}-email`).value.trim();
  let valid = true;
  if (!name) valid = setError(`${prefix}-name`, "Name is required.");
  if (!businessName) valid = setError(`${prefix}-business`, "Business name is required.");
  if (!email) valid = setError(`${prefix}-email`, "Email is required.");
  else if (!isEmail(email)) valid = setError(`${prefix}-email`, "Enter an email address like name@example.com.");
  return valid ? { name, businessName, email } : null;
}

function openCreate() {
  document.getElementById("create-form").reset();
  clearErrors(["create-name", "create-business", "create-email", "create-password", "create-password-confirm"]);
  setFormMessage("create-errors", "");
  openDialog("create-dialog");
}

function openLogin() {
  document.getElementById("login-form").reset();
  clearErrors(["login-email", "login-password"]);
  setFormMessage("login-errors", "");
  const notice = document.getElementById("login-notice");
  notice.textContent = "";
  notice.classList.remove("success");
  if (state.profile) document.getElementById("login-email").value = state.profile.email;
  openDialog("login-dialog");
}

function decodeJwt(token) {
  const segment = String(token || "").split(".")[1] || "";
  const padded = segment.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(segment.length / 4) * 4, "=");
  return JSON.parse(atob(padded));
}

function googleErrorTarget() {
  return document.getElementById("create-dialog").open ? "create-errors" : "login-errors";
}

let googleInitialized = false;

function setupGoogle() {
  if (!GOOGLE_CLIENT_ID || googleInitialized) return;
  if (!window.google || !google.accounts || !google.accounts.id) return;
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    callback: handleGoogleCredential,
    auto_select: false,
    cancel_on_tap_outside: true
  });
  googleInitialized = true;
  mountGoogleButton("create-google");
  mountGoogleButton("login-google");
}

function mountGoogleButton(id) {
  const slot = document.getElementById(id);
  if (!slot || slot.dataset.mounted === "true" || !googleInitialized) return;
  slot.replaceChildren();
  google.accounts.id.renderButton(slot, {
    type: "standard",
    theme: "outline",
    size: "large",
    text: "continue_with",
    shape: "rectangular",
    width: 320,
    logo_alignment: "left"
  });
  slot.dataset.mounted = "true";
}

function startGoogleSignIn() {
  const messageId = googleErrorTarget();
  setFormMessage(messageId, "");
  setupGoogle();
  if (!window.google || !google.accounts || !google.accounts.id) {
    setFormMessage(messageId, "Google sign-in did not load. Check your connection and try again.");
    return;
  }
  if (!GOOGLE_CLIENT_ID) {
    setFormMessage(messageId, "Google sign-in needs a client ID in script.js. Until then, create a password and sign in with it.");
    return;
  }
  google.accounts.id.prompt();
}

function handleGoogleCredential(response) {
  const messageId = googleErrorTarget();
  try {
    const payload = decodeJwt(response.credential);
    if (!payload.email || !payload.sub || payload.email_verified === false) {
      setFormMessage(messageId, "Google did not confirm that email.");
      return;
    }
    signInWithGoogle(payload);
  } catch (error) {
    setFormMessage(messageId, "Google did not return a usable account.");
  }
}

function signInWithGoogle(payload) {
  const email = String(payload.email).trim();
  const messageId = googleErrorTarget();
  if (state.profile && state.profile.email.toLowerCase() !== email.toLowerCase()) {
    setFormMessage(messageId, "This browser already has a different account. Sign in with that email and password.");
    return;
  }
  if (state.profile && state.profile.googleSub && state.profile.googleSub !== payload.sub) {
    setFormMessage(messageId, "This email is linked to a different Google account.");
    return;
  }
  if (!state.profile) {
    clearBooks();
    state.profile = {
      name: payload.name || email,
      businessName: "My business",
      email,
      authProvider: "google",
      passwordHash: "",
      passwordSalt: "",
      googleSub: payload.sub,
      avatar: null
    };
  } else {
    state.profile.googleSub = payload.sub;
    if (!state.profile.passwordHash) state.profile.authProvider = "google";
    if (!state.profile.name) state.profile.name = payload.name || email;
  }
  state.sessionActive = true;
  saveData();
  closeDialog("create-dialog");
  closeDialog("login-dialog");
  renderAll();
  showPanel("dashboard");
  toast("Signed in with Google.");
}

function fillProductSelect(select, selectedId, disableEmpty) {
  const current = selectedId || select.value;
  select.replaceChildren();
  const placeholder = new Option("Select a product", "");
  select.append(placeholder);
  [...state.products].sort((a, b) => a.name.localeCompare(b.name)).forEach((product) => {
    const option = new Option(`${product.name} (${product.sku}) — ${product.quantity} on hand`, product.id);
    if (disableEmpty && product.quantity === 0 && product.id !== current) option.disabled = true;
    select.append(option);
  });
  if (current) select.value = current;
}

function openProductForm(productId) {
  const form = document.getElementById("product-form");
  form.reset();
  ui.editingProductId = productId || null;
  clearErrors(["product-name", "product-sku", "product-category", "product-supplier", "product-price", "product-cost", "product-quantity", "product-reorder", "product-target"]);
  setFormMessage("product-errors", "");
  const quantity = document.getElementById("product-quantity");
  const note = document.getElementById("product-quantity-note");
  document.getElementById("product-dialog-title").textContent = productId ? "Edit product" : "Add product";
  if (!productId) {
    quantity.disabled = false;
    note.textContent = "The starting quantity is saved as a restock adjustment.";
    openDialog("product-dialog");
    return;
  }
  const product = findProduct(productId);
  if (!product) return;
  document.getElementById("product-name").value = product.name;
  document.getElementById("product-sku").value = product.sku;
  document.getElementById("product-category").value = product.category;
  document.getElementById("product-supplier").value = product.supplier;
  document.getElementById("product-price").value = product.sellingPrice.toFixed(2);
  document.getElementById("product-cost").value = product.unitCost.toFixed(2);
  quantity.value = product.quantity;
  quantity.disabled = true;
  document.getElementById("product-reorder").value = product.reorderThreshold;
  document.getElementById("product-target").value = product.targetStockLevel == null ? "" : product.targetStockLevel;
  document.getElementById("product-barcode").value = product.barcode || "";
  document.getElementById("product-contact").value = product.supplierContact || "";
  document.getElementById("product-description").value = product.description || "";
  note.textContent = "Quantity stays locked here. Use a sale, a delivered shipment, or an adjustment to change it.";
  openDialog("product-dialog");
}

function readProductForm() {
  const ids = ["product-name", "product-sku", "product-category", "product-supplier", "product-price", "product-cost", "product-quantity", "product-reorder", "product-target"];
  clearErrors(ids);
  setFormMessage("product-errors", "");
  const name = document.getElementById("product-name").value.trim();
  const sku = document.getElementById("product-sku").value.trim();
  const category = document.getElementById("product-category").value.trim();
  const supplier = document.getElementById("product-supplier").value.trim();
  const sellingPrice = parseMoney(document.getElementById("product-price").value);
  const unitCost = parseMoney(document.getElementById("product-cost").value);
  const quantity = parseWhole(document.getElementById("product-quantity").value);
  const reorderThreshold = parseWhole(document.getElementById("product-reorder").value);
  const targetRaw = document.getElementById("product-target").value.trim();
  const targetStockLevel = targetRaw === "" ? null : parseWhole(targetRaw);
  let valid = true;
  if (!name) valid = setError("product-name", "Product name is required.");
  if (!sku) valid = setError("product-sku", "SKU is required.");
  else if (skuTaken(sku, ui.editingProductId || "")) valid = setError("product-sku", "That SKU is already used.");
  if (!category) valid = setError("product-category", "Product type is required.");
  if (!supplier) valid = setError("product-supplier", "Supplier is required.");
  if (sellingPrice == null) valid = setError("product-price", "Enter a price of zero or more, with up to 2 decimals.");
  if (unitCost == null) valid = setError("product-cost", "Enter a unit cost of zero or more, with up to 2 decimals.");
  if (!ui.editingProductId && quantity == null) valid = setError("product-quantity", "Enter a nonnegative whole number.");
  if (reorderThreshold == null) valid = setError("product-reorder", "Enter a nonnegative whole number.");
  if (targetRaw !== "" && targetStockLevel == null) valid = setError("product-target", "Enter a nonnegative whole number, or leave the target blank.");
  if (!valid) return null;
  return {
    name,
    sku,
    category,
    supplier,
    sellingPrice,
    unitCost,
    quantity: quantity == null ? 0 : quantity,
    reorderThreshold,
    targetStockLevel,
    supplierContact: document.getElementById("product-contact").value,
    description: document.getElementById("product-description").value,
    barcode: document.getElementById("product-barcode").value
  };
}

function openDetail(productId) {
  const product = findProduct(productId);
  if (!product) return;
  ui.detailProductId = productId;
  document.getElementById("detail-title").textContent = product.name;
  const body = document.getElementById("detail-body");
  clear(body);
  const unitProfit = roundMoney(product.sellingPrice - product.unitCost);
  const status = calculateStockStatus(product.quantity, product.reorderThreshold);
  const facts = [
    ["SKU", product.sku],
    ["Category", product.category],
    ["Supplier", product.supplier],
    ["Supplier contact", product.supplierContact],
    ["Selling price", formatMoney(product.sellingPrice)],
    ["Unit cost", formatMoney(product.unitCost)],
    ["Current quantity", String(product.quantity)],
    ["Reorder threshold", String(product.reorderThreshold)],
    ["Target stock", product.targetStockLevel == null ? "Not set" : String(product.targetStockLevel)],
    ["Suggested reorder", String(suggestedReorder(product))],
    ["Barcode", product.barcode],
    ["Stock status", STOCK_LABELS[status]]
  ];
  const grid = el("div", { className: "detail-grid" });
  facts.forEach(([label, value]) => {
    grid.append(el("div", { className: "detail-block" }, [
      el("p", { className: "item-meta", text: label }),
      el("p", { className: "item-title", text: value || "None" })
    ]));
  });
  body.append(grid);
  body.append(el("p", { text: `Estimated gross profit per unit is ${formatMoney(unitProfit)}. This is the selling price minus the unit cost. It does not include operating expenses.` }));
  if (product.description) body.append(el("p", { text: product.description }));
  body.append(el("h3", { text: "Sales history" }));
  body.append(historyTable(
    state.sales.filter((sale) => sale.productId === product.id).sort((a, b) => b.date.localeCompare(a.date)),
    ["Date", "Quantity", "Price", "Revenue", "Gross profit"],
    (sale) => {
      const result = calculateGrossProfit(sale);
      return [formatDate(sale.date), sale.quantity, formatMoney(sale.sellingPricePerUnit), formatMoney(result.revenue), formatMoney(result.grossProfit)];
    },
    "No sales for this product yet."
  ));
  body.append(el("h3", { text: "Stock adjustment history" }));
  body.append(historyTable(
    state.adjustments.filter((entry) => entry.productId === product.id).sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id)),
    ["Date", "Type", "Change", "Quantity after", "Notes"],
    (entry) => [formatDate(entry.date), ADJUSTMENT_LABELS[entry.type] || entry.type, entry.quantityDelta > 0 ? `+${entry.quantityDelta}` : String(entry.quantityDelta), entry.quantityAfter, entry.note],
    "No stock adjustments yet."
  ));
  body.append(el("h3", { text: "Related shipments" }));
  body.append(historyTable(
    state.shipments.filter((shipment) => shipment.productId === product.id).sort((a, b) => b.expectedDate.localeCompare(a.expectedDate)),
    ["Expected", "Supplier", "Quantity", "Status", "Inventory"],
    (shipment) => [formatDate(shipment.expectedDate), shipment.supplier, shipment.quantity, SHIPMENT_LABELS[shipment.status], shipment.inventoryReconciled ? "Added to inventory" : "Not added yet"],
    "No shipments for this product yet."
  ));
  openDialog("detail-dialog");
}

function historyTable(rows, headers, mapRow, emptyText) {
  if (!rows.length) return el("p", { className: "empty-inline", text: emptyText });
  const table = el("table", { className: "data-table" });
  const head = document.createElement("tr");
  headers.forEach((header) => head.append(el("th", { scope: "col", text: header })));
  table.append(el("thead", {}, [head]));
  const body = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    mapRow(row).forEach((value, index) => {
      const cell = document.createElement("td");
      cell.dataset.label = headers[index];
      cell.textContent = value == null || value === "" ? "None" : String(value);
      tr.append(cell);
    });
    body.append(tr);
  });
  table.append(body);
  return el("div", { className: "table-scroll" }, [table]);
}

function openSaleForm() {
  document.getElementById("sale-form").reset();
  clearErrors(["sale-product", "sale-quantity", "sale-date", "sale-price"]);
  setFormMessage("sale-errors", "");
  fillProductSelect(document.getElementById("sale-product"), "", true);
  const date = document.getElementById("sale-date");
  date.max = todayISO();
  date.value = todayISO();
  openDialog("sale-dialog");
}

function openShipmentForm(shipmentId) {
  document.getElementById("shipment-form").reset();
  ui.editingShipmentId = shipmentId || null;
  clearErrors(["shipment-product", "shipment-supplier", "shipment-quantity", "shipment-date"]);
  setFormMessage("shipment-errors", "");
  const shipment = shipmentId ? state.shipments.find((item) => item.id === shipmentId) : null;
  fillProductSelect(document.getElementById("shipment-product"), shipment ? shipment.productId : "", false);
  document.getElementById("shipment-title").textContent = shipment ? "Edit shipment" : "Add shipment";
  document.getElementById("shipment-product").disabled = Boolean(shipment && shipment.inventoryReconciled);
  document.getElementById("shipment-quantity").disabled = Boolean(shipment && shipment.inventoryReconciled);
  const note = document.getElementById("shipment-reconcile-note");
  if (shipment) {
    document.getElementById("shipment-supplier").value = shipment.supplier;
    document.getElementById("shipment-quantity").value = shipment.quantity;
    document.getElementById("shipment-date").value = shipment.expectedDate;
    document.getElementById("shipment-tracking").value = shipment.trackingNumber || "";
    document.getElementById("shipment-status").value = shipment.status;
    note.textContent = shipment.inventoryReconciled
      ? "This shipment was already added to inventory. Changing the quantity or status will not add or remove that stock again."
      : "Stock increases once, the first time the status is Delivered.";
  } else {
    note.textContent = "Stock increases once, the first time the status is Delivered.";
  }
  openDialog("shipment-dialog");
}

function openAdjustment(productId, type) {
  document.getElementById("adjustment-form").reset();
  clearErrors(["adjustment-product", "adjustment-quantity", "adjustment-date", "adjustment-notes"]);
  setFormMessage("adjustment-errors", "");
  fillProductSelect(document.getElementById("adjustment-product"), productId || "", false);
  document.getElementById("adjustment-type").value = type || "restock";
  const date = document.getElementById("adjustment-date");
  date.max = todayISO();
  date.value = todayISO();
  updateAdjustmentHint();
  openDialog("adjustment-dialog");
}

function updateAdjustmentHint() {
  const type = document.getElementById("adjustment-type").value;
  const label = document.getElementById("adjustment-quantity-label");
  const hint = document.getElementById("adjustment-hint");
  if (type === "correction") {
    label.textContent = "Counted quantity";
    hint.textContent = "Enter the quantity you counted. Replenish records the difference from the current stock.";
  } else if (type === "damage") {
    label.textContent = "Quantity";
    hint.textContent = "This quantity is removed and cannot take stock below zero.";
  } else if (type === "return") {
    label.textContent = "Quantity";
    hint.textContent = "This quantity is added back to stock.";
  } else {
    label.textContent = "Quantity";
    hint.textContent = "This quantity is added to stock.";
  }
}

function askConfirm(title, message, confirmLabel, onConfirm) {
  document.getElementById("confirm-title").textContent = title;
  document.getElementById("confirm-message").textContent = message;
  document.getElementById("confirm-accept").textContent = confirmLabel;
  ui.confirmAction = onConfirm;
  openDialog("confirm-dialog");
}

function requestDeleteProduct(id) {
  const product = findProduct(id);
  if (!product) return;
  const check = deleteProductPreview(product);
  if (!check.ok) {
    toast(check.error);
    return;
  }
  askConfirm(
    "Delete product",
    `Delete ${product.name}? Past sales and shipments stay in history. This removes the product from inventory.`,
    "Delete product",
    () => {
      const result = deleteProduct(id);
      if (!result.ok) {
        toast(result.error);
        return;
      }
      saveData();
      renderAll();
      toast("Product deleted. Past sales were kept.");
    }
  );
}

function deleteProductPreview(product) {
  const blocking = state.shipments.find((shipment) => (
    shipment.productId === product.id && !shipment.inventoryReconciled && shipment.status !== "delivered"
  ));
  if (!blocking) return { ok: true };
  return { ok: false, error: "This product has an incoming shipment. Deliver or delete that shipment before deleting the product." };
}

function readCSVFile(file) {
  const name = file.name.toLowerCase();
  const type = file.type || "";
  const allowedType = type === "" || type.includes("csv") || type === "text/plain" || type === "application/vnd.ms-excel";
  if (!name.endsWith(".csv") || !allowedType) {
    toast("Choose a CSV file.");
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    ui.csvPreview = validateCSV(String(reader.result || ""));
    renderCSVPreview();
    openDialog("csv-dialog");
  };
  reader.readAsText(file);
}

function renderCSVPreview() {
  const preview = ui.csvPreview;
  const errorList = document.getElementById("csv-errors");
  const body = document.getElementById("csv-preview-body");
  clear(errorList);
  clear(body);
  if (!preview) return;
  document.getElementById("csv-summary").textContent = preview.errors.length
    ? "Nothing has been imported. The file needs to be corrected before any rows can be added."
    : `${preview.rows.length} products are ready to import. Nothing is saved until you confirm.`;
  preview.errors.forEach((message) => errorList.append(el("li", { text: message })));
  preview.rows.forEach((row) => {
    const tr = document.createElement("tr");
    appendCells(tr, [
      ["Row", row.line],
      ["Product", row.product],
      ["SKU", row.sku],
      ["Category", row.category],
      ["Supplier", row.supplier],
      ["Price", row.priceText],
      ["Unit cost", row.costText],
      ["Stock", row.stockText],
      ["Reorder", row.reorderText]
    ]);
    body.append(tr);
  });
  document.getElementById("csv-confirm").disabled = preview.errors.length > 0 || preview.rows.length === 0;
}

function commitCSV() {
  if (!ui.csvPreview) return;
  const again = validateCSV(ui.csvPreview.sourceText);
  ui.csvPreview = again;
  renderCSVPreview();
  if (again.errors.length || !again.rows.length) return;
  try {
    importCSV(again.rows);
  } catch (error) {
    toast(error.message);
    return;
  }
  saveData();
  closeDialog("csv-dialog");
  renderAll();
  toast(`Imported ${again.rows.length} products.`);
}

function bindEvents() {
  document.querySelectorAll("dialog").forEach((dialog) => {
    dialog.addEventListener("close", () => {
      if (lastFocus && lastFocus.isConnected && !(lastFocus.closest("dialog") && !lastFocus.closest("dialog").open)) {
        lastFocus.focus();
      }
      lastFocus = null;
    });
  });
  document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => closeDialog(button.dataset.close));
  });

  document.getElementById("brand-link").addEventListener("click", (event) => {
    event.preventDefault();
    if (state.sessionActive) showPanel("dashboard");
    else document.getElementById("view-welcome").scrollIntoView({ behavior: "smooth" });
  });
  document.getElementById("nav-toggle").addEventListener("click", () => {
    const links = document.getElementById("nav-links");
    const open = !links.classList.contains("is-open");
    links.classList.toggle("is-open", open);
    document.getElementById("nav-toggle").setAttribute("aria-expanded", String(open));
  });
  document.getElementById("nav-dashboard").addEventListener("click", () => showPanel("dashboard"));
  document.getElementById("nav-inventory").addEventListener("click", () => showInventory());
  document.getElementById("nav-sales").addEventListener("click", () => showPanel("sales"));
  document.getElementById("nav-shipments").addEventListener("click", () => showPanel("shipments"));
  document.getElementById("nav-analytics").addEventListener("click", () => showPanel("analytics"));
  document.getElementById("nav-login").addEventListener("click", openLogin);
  document.getElementById("nav-create").addEventListener("click", openCreate);
  document.getElementById("welcome-login").addEventListener("click", openLogin);
  document.getElementById("welcome-start").addEventListener("click", openCreate);
  document.getElementById("account-button").addEventListener("click", () => {
    const menu = document.getElementById("account-menu");
    const open = menu.hidden;
    menu.hidden = !open;
    document.getElementById("account-button").setAttribute("aria-expanded", String(open));
  });
  document.getElementById("menu-settings").addEventListener("click", () => showPanel("settings"));
  document.getElementById("menu-logout").addEventListener("click", () => {
    state.sessionActive = false;
    saveData();
    closeAccountMenu();
    ui.panel = "dashboard";
    renderChrome();
    toast("Signed out. Your records stay in this browser.");
  });
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".account")) closeAccountMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAccountMenu();
  });

  document.getElementById("create-google-fallback").addEventListener("click", startGoogleSignIn);
  document.getElementById("login-google-fallback").addEventListener("click", startGoogleSignIn);
  document.getElementById("create-form").addEventListener("submit", (event) => {
    event.preventDefault();
    clearErrors(["create-name", "create-business", "create-email", "create-password", "create-password-confirm"]);
    setFormMessage("create-errors", "");
    const name = document.getElementById("create-name").value.trim();
    const businessName = document.getElementById("create-business").value.trim();
    const email = document.getElementById("create-email").value.trim();
    const password = document.getElementById("create-password").value;
    const confirmation = document.getElementById("create-password-confirm").value;
    let valid = true;
    if (!name) valid = setError("create-name", "Name is required.");
    if (!businessName) valid = setError("create-business", "Business name is required.");
    if (!email) valid = setError("create-email", "Email is required.");
    else if (!isEmail(email)) valid = setError("create-email", "Enter an email address like name@example.com.");
    if (password.length < 8) valid = setError("create-password", "Use at least 8 characters.");
    if (password !== confirmation) valid = setError("create-password-confirm", "Those passwords do not match.");
    if (!valid) return;
    if (state.profile && state.profile.passwordHash) {
      setFormMessage("create-errors", "This browser already has an account. Sign in with your password.");
      return;
    }
    if (state.profile && state.profile.googleSub && state.profile.email.toLowerCase() !== email.toLowerCase()) {
      setFormMessage("create-errors", "This browser already has a Google account. Continue with Google.");
      return;
    }
    if (!state.profile) clearBooks();
    const salt = randomSalt();
    state.profile = {
      name,
      businessName,
      email,
      authProvider: "password",
      passwordHash: hashPassword(password, salt),
      passwordSalt: salt,
      googleSub: state.profile && state.profile.email.toLowerCase() === email.toLowerCase() ? state.profile.googleSub : ""
    };
    state.sessionActive = false;
    saveData();
    document.getElementById("create-password").value = "";
    document.getElementById("create-password-confirm").value = "";
    closeDialog("create-dialog");
    renderChrome();
    openLogin();
    document.getElementById("login-email").value = email;
    const notice = document.getElementById("login-notice");
    notice.textContent = "Account created. Sign in with your email and password.";
    notice.classList.add("success");
    toast("Account created. Sign in to continue.");
  });
  document.getElementById("login-form").addEventListener("submit", (event) => {
    event.preventDefault();
    clearErrors(["login-email", "login-password"]);
    setFormMessage("login-errors", "");
    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;
    let valid = true;
    if (!email || !isEmail(email)) valid = setError("login-email", "Enter the email on the account.");
    if (!password) valid = setError("login-password", "Password is required.");
    if (!valid) return;
    if (!state.profile || !state.profile.passwordHash) {
      setFormMessage("login-errors", state.profile && state.profile.googleSub
        ? "This account uses Google. Continue with Google."
        : "Create an account first, then sign in with the password you chose.");
      return;
    }
    if (email.toLowerCase() !== state.profile.email.toLowerCase()) {
      setFormMessage("login-errors", "No account on this browser uses that email.");
      return;
    }
    if (!passwordsMatch(password, state.profile)) {
      setFormMessage("login-errors", "That password does not match.");
      return;
    }
    document.getElementById("login-password").value = "";
    state.sessionActive = true;
    saveData();
    closeDialog("login-dialog");
    renderAll();
    showPanel("dashboard");
    toast("Signed in.");
  });
  document.getElementById("settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const profile = readProfile("settings");
    if (!profile) return;
    const googleOnly = Boolean(state.profile.googleSub) && !state.profile.passwordHash;
    if (!googleOnly && !passwordsMatch(document.getElementById("settings-password").value, state.profile)) {
      setError("settings-password", "Enter your current password to save changes.");
      return;
    }
    state.profile.name = profile.name;
    state.profile.businessName = profile.businessName;
    if (!googleOnly) state.profile.email = profile.email;
    paintAvatar(document.getElementById("settings-avatar"), state.profile);
    document.getElementById("settings-password").value = "";
    saveData();
    renderChrome();
    toast("Profile saved in this browser.");
  });
  const colorGroup = document.getElementById("avatar-colors");
  AVATAR_COLORS.forEach((color) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "avatar-swatch";
    button.dataset.color = color;
    button.style.background = color;
    button.setAttribute("aria-label", `Initials on ${color}`);
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      document.getElementById("avatar-error").textContent = "";
      saveAvatar({ type: "initials", color });
      toast("Profile picture saved.");
    });
    colorGroup.append(button);
  });
  document.getElementById("avatar-file").addEventListener("change", async (event) => {
    const [file] = event.target.files;
    event.target.value = "";
    const error = document.getElementById("avatar-error");
    error.textContent = "";
    if (!file) return;
    try {
      const image = await resizeAvatar(file);
      saveAvatar({ type: "photo", image });
      toast("Profile picture saved.");
    } catch (failure) {
      error.textContent = failure.message;
    }
  });
  document.getElementById("avatar-remove").addEventListener("click", () => {
    document.getElementById("avatar-error").textContent = "";
    saveAvatar(null);
    toast("Profile picture removed.");
  });
  document.getElementById("restore-demo").addEventListener("click", () => {
    askConfirm(
      "Restore demo data",
      "Replace products, sales, shipments, and adjustments with the original sample? Your name, business, and email stay signed in.",
      "Restore demo data",
      restoreDemoData
    );
  });

  document.querySelectorAll("[data-range]").forEach((button) => {
    button.addEventListener("click", () => {
      ui.salesTrendRange = button.dataset.range;
      renderSalesCard();
      if (ui.panel === "dashboard") drawSalesChart();
    });
  });
  document.getElementById("view-all-low").addEventListener("click", () => showInventory("needs-restock"));
  document.getElementById("view-all-shipments").addEventListener("click", () => showPanel("shipments"));
  document.getElementById("add-shipment-card").addEventListener("click", () => openShipmentForm());
  document.getElementById("add-shipment").addEventListener("click", () => openShipmentForm());
  document.getElementById("view-all-sales").addEventListener("click", () => showPanel("sales"));
  document.getElementById("open-analytics").addEventListener("click", () => showPanel("analytics"));
  document.getElementById("add-sale-dash").addEventListener("click", openSaleForm);
  document.getElementById("add-sale").addEventListener("click", openSaleForm);
  document.getElementById("add-product").addEventListener("click", () => openProductForm());

  document.getElementById("inventory-search").addEventListener("input", (event) => {
    ui.inventory.search = event.target.value;
    ui.inventory.visibleCount = PAGE_SIZE;
    renderInventoryTable();
  });
  document.getElementById("inventory-category").addEventListener("change", (event) => {
    ui.inventory.category = event.target.value;
    ui.inventory.visibleCount = PAGE_SIZE;
    renderInventoryTable();
  });
  document.getElementById("inventory-status").addEventListener("change", (event) => {
    ui.inventory.status = event.target.value;
    ui.inventory.visibleCount = PAGE_SIZE;
    renderInventoryTable();
  });
  document.getElementById("inventory-sort").addEventListener("change", (event) => {
    ui.inventory.sort = event.target.value;
    renderInventoryTable();
  });
  document.getElementById("inventory-direction").addEventListener("click", () => {
    ui.inventory.direction = ui.inventory.direction === "asc" ? "desc" : "asc";
    renderInventoryTable();
  });
  document.getElementById("inventory-more").addEventListener("click", () => {
    ui.inventory.visibleCount += PAGE_SIZE;
    renderInventoryTable();
  });
  document.getElementById("sales-range").addEventListener("change", (event) => {
    ui.salesPage.range = event.target.value;
    renderSalesTable();
  });
  document.getElementById("sales-search").addEventListener("input", (event) => {
    ui.salesPage.search = event.target.value;
    renderSalesTable();
  });
  document.getElementById("shipment-filter").addEventListener("change", (event) => {
    ui.shipmentFilter = event.target.value;
    renderShipments();
  });
  document.getElementById("analytics-range").addEventListener("change", (event) => {
    ui.analyticsRange = event.target.value;
    renderAnalytics();
    if (ui.panel === "analytics") drawAnalyticsCharts();
  });

  document.getElementById("inventory-body").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");
    if (!button) return;
    if (button.dataset.action === "view") openDetail(button.dataset.id);
    if (button.dataset.action === "edit") openProductForm(button.dataset.id);
    if (button.dataset.action === "delete") requestDeleteProduct(button.dataset.id);
  });
  document.getElementById("low-stock-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action='restock']");
    if (button) openAdjustment(button.dataset.id, "restock");
  });
  document.getElementById("incoming-body").addEventListener("click", handleShipmentAction);
  document.getElementById("history-body").addEventListener("click", handleShipmentAction);

  document.getElementById("product-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const input = readProductForm();
    if (!input) return;
    const result = ui.editingProductId ? editProduct(ui.editingProductId, input) : addProduct(input);
    if (!result.ok) {
      setFormMessage("product-errors", result.error);
      return;
    }
    saveData();
    closeDialog("product-dialog");
    renderAll();
    toast(ui.editingProductId ? "Product updated." : "Product saved.");
  });
  document.getElementById("detail-edit").addEventListener("click", () => {
    const id = ui.detailProductId;
    closeDialog("detail-dialog");
    openProductForm(id);
  });
  document.getElementById("detail-adjust").addEventListener("click", () => {
    const id = ui.detailProductId;
    closeDialog("detail-dialog");
    openAdjustment(id, "restock");
  });
  document.getElementById("sale-product").addEventListener("change", () => {
    const product = findProduct(document.getElementById("sale-product").value);
    if (product) document.getElementById("sale-price").value = product.sellingPrice.toFixed(2);
  });
  document.getElementById("sale-form").addEventListener("submit", (event) => {
    event.preventDefault();
    clearErrors(["sale-product", "sale-quantity", "sale-date", "sale-price"]);
    setFormMessage("sale-errors", "");
    const productId = document.getElementById("sale-product").value;
    const quantity = parseWhole(document.getElementById("sale-quantity").value, 1);
    const date = document.getElementById("sale-date").value;
    const price = parseMoney(document.getElementById("sale-price").value);
    let valid = true;
    if (!productId) valid = setError("sale-product", "Choose a product.");
    if (quantity == null) valid = setError("sale-quantity", "Enter a whole number of at least 1.");
    if (!date) valid = setError("sale-date", "Choose a sale date.");
    else if (date > todayISO()) valid = setError("sale-date", "Sale date cannot be in the future.");
    if (price == null) valid = setError("sale-price", "Enter the price the customer paid, zero or greater.");
    if (!valid) return;
    const result = recordSale({
      productId,
      quantity,
      date,
      price,
      discountNote: document.getElementById("sale-discount").value.trim(),
      orderId: document.getElementById("sale-order").value.trim()
    });
    if (!result.ok) {
      setFormMessage("sale-errors", result.error);
      return;
    }
    saveData();
    closeDialog("sale-dialog");
    renderAll();
    toast("Sale recorded. Inventory decreased.");
  });
  document.getElementById("shipment-product").addEventListener("change", () => {
    const product = findProduct(document.getElementById("shipment-product").value);
    if (product && !document.getElementById("shipment-product").disabled) {
      document.getElementById("shipment-supplier").value = product.supplier;
    }
  });
  document.getElementById("shipment-form").addEventListener("submit", (event) => {
    event.preventDefault();
    clearErrors(["shipment-product", "shipment-supplier", "shipment-quantity", "shipment-date"]);
    setFormMessage("shipment-errors", "");
    const productId = document.getElementById("shipment-product").value;
    const supplier = document.getElementById("shipment-supplier").value.trim();
    const quantity = parseWhole(document.getElementById("shipment-quantity").value, 1);
    const expectedDate = document.getElementById("shipment-date").value;
    const status = document.getElementById("shipment-status").value;
    let valid = true;
    if (!productId) valid = setError("shipment-product", "Choose a product.");
    if (!supplier) valid = setError("shipment-supplier", "Supplier is required.");
    if (quantity == null) valid = setError("shipment-quantity", "Enter a whole number of at least 1.");
    if (!expectedDate) valid = setError("shipment-date", "Choose an expected delivery date.");
    if (!Object.prototype.hasOwnProperty.call(SHIPMENT_LABELS, status)) valid = false;
    if (!valid) return;
    const input = {
      productId,
      supplier,
      quantity,
      expectedDate,
      trackingNumber: document.getElementById("shipment-tracking").value,
      status
    };
    const editing = ui.editingShipmentId;
    const before = editing ? state.shipments.find((item) => item.id === editing) : null;
    const wasReconciled = Boolean(before && before.inventoryReconciled);
    const result = editing ? updateShipment(editing, input) : createShipment(input);
    if (!result.ok) {
      setFormMessage("shipment-errors", result.error);
      return;
    }
    saveData();
    closeDialog("shipment-dialog");
    renderAll();
    const addedNow = result.shipment && result.shipment.inventoryReconciled && !wasReconciled;
    toast(addedNow ? `Shipment delivered. Inventory increased by ${result.shipment.quantity}.` : "Shipment saved.");
  });
  document.getElementById("adjustment-type").addEventListener("change", updateAdjustmentHint);
  document.getElementById("adjustment-form").addEventListener("submit", (event) => {
    event.preventDefault();
    clearErrors(["adjustment-product", "adjustment-quantity", "adjustment-date", "adjustment-notes"]);
    setFormMessage("adjustment-errors", "");
    const type = document.getElementById("adjustment-type").value;
    const productId = document.getElementById("adjustment-product").value;
    const minimum = type === "correction" ? 0 : 1;
    const quantity = parseWhole(document.getElementById("adjustment-quantity").value, minimum);
    const date = document.getElementById("adjustment-date").value;
    const note = document.getElementById("adjustment-notes").value.trim();
    let valid = true;
    if (!productId) valid = setError("adjustment-product", "Choose a product.");
    if (quantity == null) {
      valid = setError("adjustment-quantity", type === "correction" ? "Enter the counted quantity as a nonnegative whole number." : "Enter a whole number of at least 1.");
    }
    if (!date) valid = setError("adjustment-date", "Choose a date.");
    else if (date > todayISO()) valid = setError("adjustment-date", "Adjustment date cannot be in the future.");
    if (!note) valid = setError("adjustment-notes", "Enter a reason or note.");
    if (!valid) return;
    const result = adjustInventory({ productId, type, quantity, date, note });
    if (!result.ok) {
      setFormMessage("adjustment-errors", result.error);
      return;
    }
    saveData();
    closeDialog("adjustment-dialog");
    renderAll();
    toast("Stock updated and recorded.");
  });

  document.getElementById("import-csv").addEventListener("click", () => document.getElementById("csv-file").click());
  document.getElementById("csv-file").addEventListener("change", (event) => {
    const [file] = event.target.files;
    event.target.value = "";
    if (file) readCSVFile(file);
  });
  document.getElementById("export-csv").addEventListener("click", exportCSV);
  document.getElementById("csv-confirm").addEventListener("click", commitCSV);
  document.getElementById("confirm-accept").addEventListener("click", () => {
    const action = ui.confirmAction;
    ui.confirmAction = null;
    closeDialog("confirm-dialog");
    if (action) action();
  });
}

function handleShipmentAction(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  if (button.dataset.action === "edit-shipment") openShipmentForm(button.dataset.id);
  if (button.dataset.action === "delete-shipment") {
    const shipment = state.shipments.find((item) => item.id === button.dataset.id);
    if (!shipment) return;
    askConfirm("Delete shipment", `Delete the incoming shipment for ${shipment.productName}? Stock will not change.`, "Delete shipment", () => {
      const result = deleteShipment(shipment.id);
      if (!result.ok) {
        toast(result.error);
        return;
      }
      saveData();
      renderAll();
      toast("Shipment deleted.");
    });
  }
}

function init() {
  loadData();
  if (typeof Chart !== "undefined") {
    Chart.defaults.font.family = "\"Avenir Next\", \"Segoe UI\", sans-serif";
    Chart.defaults.color = "#6B7280";
  }
  bindEvents();
  setupGoogle();
  renderAll();
}

if (typeof document !== "undefined") {
  document.addEventListener("DOMContentLoaded", init);
}

if (typeof window === "undefined" && typeof process !== "undefined" && process.argv.includes("--check-seed")) {
  const memory = new Map();
  global.localStorage = {
    getItem(key) { return memory.has(key) ? memory.get(key) : null; },
    setItem(key, value) { memory.set(key, String(value)); }
  };
  loadData();
  populateSeed();
  state.products.forEach((product) => console.log(`${product.sku} ${product.quantity}`));
  console.log("sales", state.sales.length, "shipments", state.shipments.length, "adjustments", state.adjustments.length);
  const negative = state.adjustments.filter((entry) => entry.quantityAfter < 0);
  console.log("negative", negative.length, "reconciled", state.shipments.filter((item) => item.inventoryReconciled).length);
}
