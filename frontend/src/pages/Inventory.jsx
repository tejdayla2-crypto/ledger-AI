import { useCallback, useEffect, useMemo, useState } from 'react';
import api, { formatError } from '../lib/api';
import ChatPanel from '../components/chat/ChatPanel';
import './Inventory.css';

const emptyInventory = { products: [], categories: [], suppliers: [], movements: [], summary: {} };
const money = value => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);
const VIEW_MODULES = {
  dashboard: 'inventory',
  products: 'inventory-products',
  stock: 'inventory-stock',
  suppliers: 'inventory-suppliers',
  reports: 'inventory-reports',
  assistant: 'inventory-assistant'
};

function fetchInventoryData() {
  return Promise.all([
    api.get('/inventory'),
    api.get('/inventory/movements?limit=250')
  ]);
}

export default function Inventory({ view, onNavigate, refreshKey = 0 }) {
  const [data, setData] = useState(null);
  const [movementHistory, setMovementHistory] = useState([]);
  const [reportData, setReportData] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [internalView, setInternalView] = useState('dashboard');
  const [reportType, setReportType] = useState('valuation');
  const [reportRange, setReportRange] = useState({ from: `${today().slice(0, 7)}-01`, to: today() });
  const [modal, setModal] = useState(null);
  const [busy, setBusy] = useState(false);
  const inventory = data || emptyInventory;
  const activeView = view || internalView;
  const loading = data === null && !error;

  const loadInventory = useCallback(async () => {
    try {
      const [inventoryResponse, movementResponse] = await fetchInventoryData();
      setData(inventoryResponse.data);
      setMovementHistory(movementResponse.data.movements);
    } catch (err) {
      setError(formatError(err, 'Inventory could not be loaded.'));
    }
  }, []);

  useEffect(() => {
    let active = true;
    fetchInventoryData().then(([inventoryResponse, movementResponse]) => {
      if (active) {
        setData(inventoryResponse.data);
        setMovementHistory(movementResponse.data.movements);
      }
    }).catch(err => {
      if (active) setError(formatError(err, 'Inventory could not be loaded.'));
    });
    return () => { active = false; };
  }, [refreshKey]);

  useEffect(() => {
    if (activeView !== 'reports') return;
    const params = new URLSearchParams(reportRange);
    api.get(`/inventory/reports?${params}`).then(response => {
      setReportData(response.data);
      setError('');
    }).catch(err => {
      setError(formatError(err, 'Inventory reports could not be loaded.'));
    });
  }, [activeView, reportRange]);

  function navigateToView(nextView) {
    if (onNavigate) onNavigate(VIEW_MODULES[nextView]);
    else setInternalView(nextView);
  }

  const visibleProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return inventory.products.filter(product => {
      const matchesQuery = !query || [product.name, product.sku, product.category_name, product.supplier_name]
        .some(value => value?.toLowerCase().includes(query));
      const low = product.quantity <= product.reorder_level;
      return matchesQuery && (filter === 'all' || (filter === 'low' ? low : product.quantity > 0));
    });
  }, [inventory.products, filter, search]);

  async function submitProduct(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    const payload = {
      ...fields,
      quantity: Number(fields.quantity || 0),
      cost_price: Number(fields.cost_price || 0),
      selling_price: Number(fields.selling_price || 0),
      reorder_level: Number(fields.reorder_level || 0)
    };
    try {
      if (modal.product) await api.put(`/inventory/products/${modal.product.id}`, payload);
      else await api.post('/inventory/products', payload);
      setModal(null);
      setNotice(modal.product ? 'Product details updated.' : 'Product added to inventory.');
      await loadInventory();
    } catch (err) {
      setError(formatError(err, 'Product could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  async function submitMovement(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError('');
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api.post('/inventory/movements', { ...fields, quantity: Number(fields.quantity) });
      setModal(null);
      setNotice(fields.type === 'stock_in' ? 'Stock received and recorded.' : 'Stock-out recorded.');
      await loadInventory();
      form.reset();
    } catch (err) {
      setError(formatError(err, 'Stock movement could not be recorded.'));
    } finally {
      setBusy(false);
    }
  }

  async function submitAdjustment(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError('');
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api.post('/inventory/adjustments', {
        ...fields,
        actual_quantity: Number(fields.actual_quantity)
      });
      setNotice('Stock count reconciled and adjustment recorded.');
      await loadInventory();
      form.reset();
    } catch (err) {
      setError(formatError(err, 'Stock adjustment could not be recorded.'));
    } finally {
      setBusy(false);
    }
  }

  async function addNamedRecord(event, type) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError('');
    try {
      const payload = Object.fromEntries(new FormData(form));
      await api.post(`/inventory/${type}`, payload);
      form.reset();
      setNotice(type === 'categories' ? 'Category added.' : 'Supplier added.');
      await loadInventory();
    } catch (err) {
      setError(formatError(err, 'Record could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  async function submitSupplier(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api.put(`/inventory/suppliers/${modal.supplier.id}`, fields);
      setNotice('Supplier details updated.');
      setModal(null);
      await loadInventory();
    } catch (err) {
      setError(formatError(err, 'Supplier could not be updated.'));
    } finally {
      setBusy(false);
    }
  }

  async function removeNamedRecord(type, record) {
    setError('');
    try {
      await api.delete(`/inventory/${type}/${record.id}`);
      setNotice(type === 'categories' ? 'Category removed.' : 'Supplier removed.');
      await loadInventory();
    } catch (err) {
      setError(formatError(err, 'Record could not be removed.'));
    }
  }

  async function removeProduct(product) {
    if (!window.confirm(`Remove ${product.name} from inventory? Products with stock history cannot be removed.`)) return;
    setError('');
    try {
      await api.delete(`/inventory/products/${product.id}`);
      setNotice('Product removed.');
      await loadInventory();
    } catch (err) {
      setError(formatError(err, 'Product could not be removed.'));
    }
  }

  const lowStock = inventory.products.filter(product => product.quantity <= product.reorder_level);
  const reportEntries = reportData ? {
    stock: reportData.products,
    purchases: reportData.purchases,
    low_stock: reportData.low_stock,
    products: reportData.products,
    valuation: reportData.products.map(product => ({
      ...product,
      inventory_value: Number(product.quantity) * Number(product.cost_price)
    })),
    expenses: reportData.expenses
  }[reportType] : [];
  const purchaseTotals = (reportData?.purchases || []).reduce((totals, purchase) => {
    const supplier = purchase.supplier_name || 'Unspecified supplier';
    totals[supplier] = (totals[supplier] || 0) + Number(purchase.total);
    return totals;
  }, {});
  const reportChart = reportType === 'purchases'
    ? Object.entries(purchaseTotals).map(([label, value]) => ({ label, value }))
    : (reportData?.categories || []).map(category => ({
      label: category.category,
      value: reportType === 'stock' ? category.units : category.stock_value
    }));
  const reportColumns = {
    stock: [['name', 'Product'], ['sku', 'SKU'], ['quantity', 'Available'], ['unit', 'Unit'], ['reorder_level', 'Minimum level'], ['supplier_name', 'Supplier']],
    purchases: [['date', 'Date'], ['reference', 'Reference'], ['supplier_name', 'Supplier'], ['item_count', 'Items'], ['total', 'Purchase total']],
    low_stock: [['name', 'Product'], ['sku', 'SKU'], ['quantity', 'Available'], ['reorder_level', 'Minimum level'], ['supplier_name', 'Supplier']],
    products: [['name', 'Product'], ['sku', 'SKU'], ['category_name', 'Category'], ['supplier_name', 'Supplier'], ['quantity', 'Available'], ['purchased_quantity', 'Purchased'], ['sold_quantity', 'Sold']],
    valuation: [['name', 'Product'], ['quantity', 'Available'], ['cost_price', 'Unit cost'], ['inventory_value', 'Stock value']],
    expenses: [['date', 'Date'], ['description', 'Description'], ['supplier_name', 'Supplier'], ['amount', 'Expense'], ['expense_id', 'Expense record']]
  }[reportType];
  const reportTotal = {
    stock: `${reportEntries.reduce((sum, product) => sum + Number(product.quantity || 0), 0).toLocaleString('en-IN')} units`,
    purchases: money(reportEntries.reduce((sum, purchase) => sum + Number(purchase.total || 0), 0)),
    low_stock: `${reportEntries.length} products`,
    products: `${reportEntries.length} products`,
    valuation: money(reportEntries.reduce((sum, product) => sum + Number(product.inventory_value || 0), 0)),
    expenses: money(reportEntries.reduce((sum, expense) => sum + Number(expense.amount || 0), 0))
  }[reportType];

  function exportReport() {
    const rows = reportEntries || [];
    if (!rows.length) {
      setError('There is no report data to export for this selection.');
      return;
    }
    const columns = Object.keys(rows[0]);
    const escapeCell = value => {
      const raw = String(value ?? '');
      const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
      return `"${safe.replaceAll('"', '""')}"`;
    };
    const csv = [columns.map(escapeCell).join(','), ...rows.map(row => columns.map(column => escapeCell(row[column])).join(','))].join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `inventory-${reportType}-${reportRange.from}-to-${reportRange.to}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="inventory-page" aria-label="Inventory management">
      <div className="inventory-heading">
        <div>
          <div className="inventory-eyebrow">STOCK CONTROL</div>
          <h2>{({
            dashboard: 'Inventory Dashboard',
            products: 'Products',
            stock: 'Stock Management',
            suppliers: 'Suppliers',
            reports: 'Inventory Reports',
            assistant: 'AI Inventory Assistant'
          })[activeView] || 'Inventory Dashboard'}</h2>
          <p>{({
            dashboard: 'A real-time view of your products, stock value, and recent activity.',
            products: 'Search, organize, and maintain your product catalog.',
            stock: 'Receive, issue, or reconcile stock with a complete movement history.',
            suppliers: 'Manage supplier contacts and product categories.',
            reports: 'Explore date-filtered stock, purchase, valuation, and expense reports.',
            assistant: 'Ask Ledger AI questions grounded in your current stock and purchase history.'
          })[activeView] || 'Manage your business inventory.'}</p>
        </div>
        {activeView === 'products' && <button className="btn btn-primary" onClick={() => setModal({ kind: 'product' })}>＋ Add product</button>}
        {activeView === 'stock' && <button className="btn btn-secondary" onClick={() => onNavigate?.('purchases')}>Record a purchase</button>}
      </div>

      {error && <div className="inventory-message inventory-error" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
      {notice && <div className="inventory-message inventory-success" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss message">×</button></div>}

      {activeView === 'dashboard' && <div className="inventory-stats">
        <article className="inventory-stat">
          <span className="inventory-stat-icon stat-green">▦</span>
          <div><span className="inventory-stat-label">Total products</span><strong>{inventory.summary.product_count || 0}</strong><small>Unique items tracked</small></div>
        </article>
        <article className="inventory-stat">
          <span className="inventory-stat-icon stat-blue">↗</span>
          <div><span className="inventory-stat-label">Units in stock</span><strong>{Number(inventory.summary.units_in_stock || 0).toLocaleString('en-IN')}</strong><small>Across all products</small></div>
        </article>
        <article className="inventory-stat">
          <span className="inventory-stat-icon stat-gold">₹</span>
          <div><span className="inventory-stat-label">Stock value</span><strong>{money(inventory.summary.stock_value)}</strong><small>Based on cost price</small></div>
        </article>
        <article className={`inventory-stat ${lowStock.length ? 'inventory-stat-alert' : ''}`}>
          <span className="inventory-stat-icon stat-red">!</span>
          <div><span className="inventory-stat-label">Low stock items</span><strong>{lowStock.length}</strong><small>{lowStock.length ? 'Need attention soon' : 'All levels look good'}</small></div>
        </article>
      </div>}

      {(activeView === 'dashboard' || activeView === 'products') && lowStock.length > 0 && (
        <div className="inventory-low-alert" role="status">
          <span className="inventory-alert-mark">!</span>
          <div><strong>{lowStock.length} {lowStock.length === 1 ? 'product is' : 'products are'} running low</strong><p>{lowStock.slice(0, 3).map(product => product.name).join(', ')}{lowStock.length > 3 ? ` and ${lowStock.length - 3} more` : ''} {lowStock.length === 1 ? 'is' : 'are'} at or below the reorder level.</p></div>
          <button onClick={() => { setFilter('low'); navigateToView('products'); }}>Review items</button>
        </div>
      )}

      {activeView === 'dashboard' && <section className="inventory-dashboard-grid">
        <section className="inventory-card inventory-report-card">
          <h3>Low stock watch</h3><p>Products at or below their reorder levels.</p>
          {lowStock.length
            ? <div className="inventory-activity-list">{lowStock.slice(0, 8).map(product => <div className="inventory-activity" key={product.id}>
              <span className="activity-mark out">!</span><div><strong>{product.name}</strong><small>Reorder at {product.reorder_level} {product.unit}</small></div>
              <b className="movement-out">{product.quantity} {product.unit}</b>
            </div>)}</div>
            : <div className="inventory-empty compact">All products are above their reorder levels.</div>}
        </section>
        <section className="inventory-card inventory-report-card">
          <h3>Recent stock activities</h3><p>Latest receipts, issues, and adjustments.</p>
          {inventory.movements.length === 0 ? <div className="inventory-empty compact">No stock movements yet.</div> : <div className="inventory-activity-list">{inventory.movements.map(movement => <div className="inventory-activity" key={movement.id}>
            <span className={`activity-mark ${movement.type === 'stock_in' ? 'in' : 'out'}`}>{movement.type === 'stock_in' ? '↓' : '↑'}</span>
            <div><strong>{movement.product_name}</strong><small>{movement.note || (movement.type === 'stock_in' ? 'Stock received' : 'Stock issued')} · {new Date(`${movement.created_at.replace(' ', 'T')}Z`).toLocaleDateString()}</small></div>
            <b className={movement.type === 'stock_in' ? 'movement-in' : 'movement-out'}>{movement.type === 'stock_in' ? '+' : '−'}{movement.quantity}</b>
          </div>)}</div>}
        </section>
      </section>}

      {activeView === 'stock' && <div className="inventory-stock-grid">
        <section className="inventory-card manage-card">
          <div><h3>Stock in / stock out</h3><p>Use Purchases to record inventory costs and linked expenses; stock receipts here do not create an expense.</p></div>
          <form className="inventory-stock-form" onSubmit={submitMovement}>
            <label>Product<select name="product_id" required defaultValue=""><option value="" disabled>Select product</option>{inventory.products.map(product => <option key={product.id} value={product.id}>{product.name} · {product.quantity} {product.unit}</option>)}</select></label>
            <label>Movement<select name="type" defaultValue="stock_in"><option value="stock_in">Stock in</option><option value="stock_out">Stock out</option></select></label>
            <label>Quantity<input name="quantity" type="number" min="1" step="1" required /></label>
            <label>Note<input name="note" maxLength="240" placeholder="Delivery, damage, issue…" /></label>
            <button className="btn btn-primary" disabled={busy || !inventory.products.length}>{busy ? 'Recording…' : 'Record movement'}</button>
          </form>
        </section>
        <section className="inventory-card manage-card">
          <div><h3>Stock adjustment</h3><p>Set the verified physical count. The system records only the difference and prevents negative stock.</p></div>
          <form className="inventory-stock-form" onSubmit={submitAdjustment}>
            <label>Product<select name="product_id" required defaultValue=""><option value="" disabled>Select product</option>{inventory.products.map(product => <option key={product.id} value={product.id}>{product.name} · {product.quantity} {product.unit}</option>)}</select></label>
            <label>Actual count<input name="actual_quantity" type="number" min="0" step="1" required /></label>
            <label>Reason<input name="note" maxLength="240" placeholder="Physical count, damage, correction…" /></label>
            <button className="btn btn-primary" disabled={busy || !inventory.products.length}>{busy ? 'Adjusting…' : 'Apply adjustment'}</button>
          </form>
        </section>
        <section className="inventory-card inventory-report-card inventory-stock-history">
          <h3>Stock movement history</h3><p>All recent receipts, issues, and count adjustments.</p>
          {movementHistory.length ? <div className="inventory-table-wrap"><table className="inventory-table">
            <thead><tr><th>Date</th><th>Product</th><th>Movement</th><th>Change</th><th>Current stock</th><th>Note</th></tr></thead>
            <tbody>{movementHistory.map(movement => <tr key={movement.id}>
              <td>{new Date(`${movement.created_at.replace(' ', 'T')}Z`).toLocaleString()}</td>
              <td>{movement.product_name}</td>
              <td>{movement.note?.startsWith('Adjustment:') ? 'Adjustment' : movement.type === 'stock_in' ? 'Stock in' : 'Stock out'}</td>
              <td className={movement.type === 'stock_in' ? 'movement-in' : 'movement-out'}>{movement.type === 'stock_in' ? '+' : '−'}{movement.quantity} {movement.unit}</td>
              <td>{movement.current_quantity} {movement.unit}</td>
              <td>{movement.note || '—'}</td>
            </tr>)}</tbody>
          </table></div> : <div className="inventory-empty compact">No stock movements recorded yet.</div>}
        </section>
      </div>}

      {activeView === 'products' && <section className="inventory-card">
        <div className="inventory-toolbar">
          <div><h3>All products</h3><p>Manage items and keep stock up to date.</p></div>
          <div className="inventory-filters">
            <label className="inventory-search"><span aria-hidden="true">⌕</span><input aria-label="Search inventory" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search products…" /></label>
            <select aria-label="Filter products" value={filter} onChange={event => setFilter(event.target.value)}>
              <option value="all">All stock</option><option value="low">Low stock</option><option value="available">In stock</option>
            </select>
          </div>
        </div>
        {loading ? <div className="inventory-empty">Loading inventory…</div> : visibleProducts.length === 0 ? (
          <div className="inventory-empty"><strong>{inventory.products.length ? 'No products match your filters' : 'Your inventory starts here'}</strong><span>{inventory.products.length ? 'Try a different search or filter.' : 'Add your first product to start tracking stock.'}</span>{!inventory.products.length && <button className="btn btn-primary btn-sm" onClick={() => setModal({ kind: 'product' })}>Add your first product</button>}</div>
        ) : <div className="inventory-table-wrap"><table className="inventory-table">
          <thead><tr><th>Product</th><th>Category</th><th>Supplier</th><th>Purchase price</th><th>Selling price</th><th>Available</th><th>Stock status</th><th>Actions</th></tr></thead>
          <tbody>{visibleProducts.map(product => {
            const isLow = product.quantity <= product.reorder_level;
            return <tr key={product.id}>
              <td><div className="inventory-product-name"><span className="product-avatar">{product.name.slice(0, 1).toUpperCase()}</span><div><strong>{product.name}</strong><small>{product.sku || 'No SKU'}</small></div></div></td>
              <td>{product.category_name || <span className="inventory-muted">Uncategorized</span>}</td>
              <td>{product.supplier_name || <span className="inventory-muted">—</span>}</td>
              <td className="inventory-money">{money(product.cost_price)}</td>
              <td className="inventory-money">{money(product.selling_price)}</td>
              <td><strong>{product.quantity} <span className="inventory-unit">{product.unit}</span></strong><small className="inventory-reorder">Reorder at {product.reorder_level}</small></td>
              <td><span className={`inventory-badge ${isLow ? 'low' : 'healthy'}`}><i />{isLow ? 'Low stock' : 'In stock'}</span></td>
              <td><div className="inventory-row-actions">
                <button title="Stock in" aria-label={`Stock in ${product.name}`} onClick={() => setModal({ kind: 'movement', product, type: 'stock_in' })}>＋</button>
                <button title="Stock out" aria-label={`Stock out ${product.name}`} onClick={() => setModal({ kind: 'movement', product, type: 'stock_out' })}>−</button>
                <button title="Edit product" aria-label={`Edit ${product.name}`} onClick={() => setModal({ kind: 'product', product })}>✎</button>
                <button title="Delete product" aria-label={`Delete ${product.name}`} onClick={() => removeProduct(product)}>×</button>
              </div></td>
            </tr>;
          })}</tbody>
        </table></div>}
      </section>}

      {activeView === 'reports' && <section className="inventory-reports">
        <div className="inventory-report-controls">
          <label>Report<select value={reportType} onChange={event => setReportType(event.target.value)}>
            <option value="stock">Stock report</option><option value="purchases">Purchase report</option>
            <option value="low_stock">Low stock report</option><option value="products">Product-wise report</option>
            <option value="valuation">Inventory valuation report</option><option value="expenses">Inventory expense report</option>
          </select></label>
          <label>From<input type="date" value={reportRange.from} max={reportRange.to} onChange={event => setReportRange(range => ({ ...range, from: event.target.value }))} /></label>
          <label>To<input type="date" value={reportRange.to} min={reportRange.from} max={today()} onChange={event => setReportRange(range => ({ ...range, to: event.target.value }))} /></label>
          <button className="btn btn-secondary" onClick={exportReport}>Export CSV</button>
        </div>
        <div className="inventory-report-grid">
          <section className="inventory-card inventory-report-card">
            <h3>{reportType === 'purchases' ? 'Purchases by supplier' : reportType === 'stock' ? 'Current stock units by category' : 'Stock value by category'}</h3>
            <p>Stock and valuation show current on-hand figures; purchase and expense reports use the selected date range.</p>
            <div className="report-total">{reportTotal}</div>
            <div className="report-bar-list">{reportChart.length ? reportChart.map(entry => {
              const maxValue = Math.max(...reportChart.map(item => Number(item.value)), 1);
              const valueLabel = reportType === 'stock'
                ? `${Number(entry.value).toLocaleString('en-IN')} units`
                : money(entry.value);
              return <div className="report-bar-row" key={entry.label}>
                <div><span>{entry.label}</span><strong>{valueLabel}</strong></div>
                <div className="report-track"><i style={{ width: `${Math.max(3, Number(entry.value) / maxValue * 100)}%` }} /></div>
              </div>;
            }) : <div className="inventory-empty compact">No chart data for this selection.</div>}</div>
          </section>
          <section className="inventory-card inventory-report-card">
            <h3>{({
              stock: 'Stock movements',
              purchases: 'Purchases',
              low_stock: 'Low stock products',
              products: 'Product-wise activity',
              valuation: 'Product valuation',
              expenses: 'Inventory purchase expenses'
            })[reportType]}</h3>
            <p>{reportEntries.length} records · {reportData?.range.from} to {reportData?.range.to}</p>
            {reportEntries.length ? <div className="inventory-table-wrap"><table className="inventory-table">
              <thead><tr>{reportColumns.map(([, label]) => <th key={label}>{label}</th>)}</tr></thead>
              <tbody>{reportEntries.map((row, index) => <tr key={row.id || row.expense_id || `${reportType}-${index}`}>
                {reportColumns.map(([key]) => <td key={key}>{['total', 'amount', 'cost_price', 'inventory_value'].includes(key) ? money(row[key]) : row[key] ?? '—'}</td>)}
              </tr>)}</tbody>
            </table></div> : <div className="inventory-empty compact">No records found for this report and date range.</div>}
          </section>
        </div>
      </section>}

      {activeView === 'suppliers' && <div className="inventory-manage-grid">
        <section className="inventory-card manage-card">
          <div><h3>Product categories</h3><p>Organize your catalog for easier reporting.</p></div>
          <form className="manage-add-form" onSubmit={event => addNamedRecord(event, 'categories')}><input name="name" required maxLength="120" placeholder="e.g. Office supplies" aria-label="New category name" /><button className="btn btn-primary btn-sm" disabled={busy}>Add</button></form>
          <div className="manage-list">{inventory.categories.length ? inventory.categories.map(category => <div key={category.id}><span>{category.name}</span><button aria-label={`Delete ${category.name}`} onClick={() => removeNamedRecord('categories', category)}>×</button></div>) : <span className="inventory-muted">No categories added yet.</span>}</div>
        </section>
        <section className="inventory-card manage-card">
          <div><h3>Suppliers</h3><p>Keep supplier contacts close to your products.</p></div>
          <form className="manage-add-form supplier-add-form" onSubmit={event => addNamedRecord(event, 'suppliers')}>
            <input name="name" required maxLength="120" placeholder="Supplier name" aria-label="Supplier name" />
            <input name="email" type="email" maxLength="180" placeholder="Email (optional)" aria-label="Supplier email" />
            <input name="phone" maxLength="50" placeholder="Phone (optional)" aria-label="Supplier phone" />
            <button className="btn btn-primary btn-sm" disabled={busy}>Add supplier</button>
          </form>
          <div className="manage-list">{inventory.suppliers.length ? inventory.suppliers.map(supplier => <div key={supplier.id}><span><strong>{supplier.name}</strong><small>{[supplier.email, supplier.phone].filter(Boolean).join(' · ') || 'No contact details'}</small></span><div className="inventory-row-actions"><button title="Edit supplier" aria-label={`Edit ${supplier.name}`} onClick={() => setModal({ kind: 'supplier', supplier })}>✎</button><button title="Delete supplier" aria-label={`Delete ${supplier.name}`} onClick={() => removeNamedRecord('suppliers', supplier)}>×</button></div></div>) : <span className="inventory-muted">No suppliers added yet.</span>}</div>
        </section>
      </div>}

      {activeView === 'assistant' && <section className="inventory-ai-card inventory-card">
        <div className="inventory-ai-intro"><span className="business-assistant-sparkle">✦</span><div><h3>Inventory insights, grounded in your data</h3><p>Ask about current stock, reorder quantities, purchase history, and inventory summaries. Ledger AI uses your actual products and recorded transactions.</p></div></div>
        <div className="inventory-ai-panel"><ChatPanel onAction={() => { loadInventory(); }} /></div>
      </section>}

      {modal?.kind === 'supplier' && <div className="inventory-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setModal(null); }}>
        <section className="inventory-modal inventory-stock-modal" role="dialog" aria-modal="true" aria-labelledby="supplier-modal-title">
          <div className="inventory-modal-head"><div><h3 id="supplier-modal-title">Edit supplier</h3><p>Update supplier details used by your purchase records.</p></div><button onClick={() => setModal(null)} aria-label="Close dialog">×</button></div>
          <form onSubmit={submitSupplier}>
            <label>Supplier name<input name="name" required maxLength="120" defaultValue={modal.supplier.name} /></label>
            <label>Email<input name="email" type="email" maxLength="180" defaultValue={modal.supplier.email || ''} /></label>
            <label>Phone<input name="phone" maxLength="50" defaultValue={modal.supplier.phone || ''} /></label>
            <div className="inventory-modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save supplier'}</button></div>
          </form>
        </section>
      </div>}

      {modal?.kind === 'product' && <div className="inventory-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setModal(null); }}>
        <section className="inventory-modal" role="dialog" aria-modal="true" aria-labelledby="product-modal-title">
          <div className="inventory-modal-head"><div><h3 id="product-modal-title">{modal.product ? 'Edit product' : 'Add a product'}</h3><p>{modal.product ? 'Update product details and reorder settings.' : 'Add an item to your inventory.'}</p></div><button onClick={() => setModal(null)} aria-label="Close dialog">×</button></div>
          <form onSubmit={submitProduct}>
            <div className="inventory-form-grid">
              <label className="form-wide">Product name<input name="name" required maxLength="120" defaultValue={modal.product?.name || ''} placeholder="e.g. Notebook" /></label>
              <label>SKU<input name="sku" maxLength="80" defaultValue={modal.product?.sku || ''} placeholder="Optional" /></label>
              <label>Unit<input name="unit" maxLength="30" defaultValue={modal.product?.unit || 'pcs'} placeholder="pcs" /></label>
              {!modal.product && <label>Opening stock<input name="quantity" type="number" min="0" step="1" defaultValue="0" required /></label>}
              <label>Reorder level<input name="reorder_level" type="number" min="0" step="1" defaultValue={modal.product?.reorder_level ?? 5} required /></label>
              <label>Unit cost (₹)<input name="cost_price" type="number" min="0" step="0.01" defaultValue={modal.product?.cost_price ?? 0} required /></label>
              <label>Selling price (₹)<input name="selling_price" type="number" min="0" step="0.01" defaultValue={modal.product?.selling_price ?? 0} required /></label>
              <label>Category<select name="category_id" defaultValue={modal.product?.category_id || ''}><option value="">Uncategorized</option>{inventory.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label>
              <label>Supplier<select name="supplier_id" defaultValue={modal.product?.supplier_id || ''}><option value="">No supplier</option>{inventory.suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
            </div>
            <div className="inventory-modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : modal.product ? 'Save changes' : 'Add product'}</button></div>
          </form>
        </section>
      </div>}

      {modal?.kind === 'movement' && <div className="inventory-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setModal(null); }}>
        <section className="inventory-modal inventory-stock-modal" role="dialog" aria-modal="true" aria-labelledby="movement-modal-title">
          <div className="inventory-modal-head"><div><h3 id="movement-modal-title">{modal.type === 'stock_in' ? 'Receive stock' : 'Record stock-out'}</h3><p>{modal.product.name} · {modal.product.quantity} {modal.product.unit} currently available</p></div><button onClick={() => setModal(null)} aria-label="Close dialog">×</button></div>
          <form onSubmit={submitMovement}>
            <input type="hidden" name="product_id" value={modal.product.id} />
            <input type="hidden" name="type" value={modal.type} />
            <label>Quantity<input name="quantity" type="number" min="1" max={modal.type === 'stock_out' ? modal.product.quantity : undefined} step="1" required autoFocus /></label>
            <label>Note <span className="inventory-muted">(optional)</span><input name="note" maxLength="240" placeholder={modal.type === 'stock_in' ? 'Purchase order, delivery…' : 'Reason for stock-out…'} /></label>
            <div className="inventory-modal-actions"><button type="button" className="btn btn-secondary" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Recording…' : 'Confirm movement'}</button></div>
          </form>
        </section>
      </div>}
    </section>
  );
}
