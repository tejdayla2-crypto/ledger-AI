import { useCallback, useEffect, useState } from 'react';
import api, { formatError } from '../lib/api';
import Inventory from './Inventory';
import './Business.css';

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => `${today().slice(0, 7)}-01`;
const money = value => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const initialData = { inventory: { products: [], categories: [], suppliers: [], summary: {} }, overview: { finance: {}, stock: {}, low_stock: [], receivables: {} }, sales: [], purchases: [], customers: [], suppliers: [], expenses: [], reports: null, assistant: [] };
const tabs = [
  ['dashboard', 'Business overview'], ['inventory', 'Inventory'], ['sales', 'Sales'],
  ['purchases', 'Purchases'], ['customers', 'Customers'], ['suppliers', 'Suppliers'],
  ['finance', 'Finance'], ['reports', 'Reports'], ['assistant', 'AI assistant']
];

async function fetchBusinessData(range) {
  const params = new URLSearchParams(range);
  const [inventory, overview, sales, purchases, customers, suppliers, expenses, reports, assistant] = await Promise.all([
    api.get('/inventory'),
    api.get(`/business/overview?${params}`),
    api.get('/business/sales'),
    api.get('/business/purchases'),
    api.get('/business/customers'),
    api.get('/business/suppliers'),
    api.get(`/expenses?from=${range.from}&to=${range.to}&limit=100`),
    api.get(`/business/reports?${params}`),
    api.get('/business/assistant')
  ]);
  return {
    inventory: inventory.data,
    overview: overview.data,
    sales: sales.data.sales,
    purchases: purchases.data.purchases,
    customers: customers.data.customers,
    suppliers: suppliers.data.suppliers,
    expenses: expenses.data.expenses,
    reports: reports.data,
    assistant: assistant.data.insights
  };
}

export default function Business({ activeTab = 'dashboard', inventoryView = 'dashboard', onTabChange, refreshKey = 0 }) {
  const [internalTab, setInternalTab] = useState('dashboard');
  const tab = onTabChange ? activeTab : internalTab;
  const setTab = onTabChange || setInternalTab;
  const [data, setData] = useState(initialData);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [range, setRange] = useState({ from: monthStart(), to: today() });
  const [cart, setCart] = useState([]);
  const [purchaseCart, setPurchaseCart] = useState([]);
  const [purchaseIdempotencyRequest, setPurchaseIdempotencyRequest] = useState(null);
  const [aiReply, setAiReply] = useState('');
  const [directoryHistory, setDirectoryHistory] = useState({});
  const [historyLoading, setHistoryLoading] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await fetchBusinessData(range));
    } catch (err) {
      setError(formatError(err, 'Business data could not be loaded.'));
    }
  }, [range]);

  useEffect(() => {
    let active = true;
    fetchBusinessData(range).then(result => {
      if (active) setData(result);
    }).catch(err => {
      if (active) setError(formatError(err, 'Business data could not be loaded.'));
    });
    return () => { active = false; };
  }, [range, refreshKey]);

  async function saveCustomer(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setError('');
    try {
      await api.post('/business/customers', Object.fromEntries(new FormData(form)));
      form.reset();
      setNotice('Customer saved.');
      await load();
    } catch (err) {
      setError(formatError(err, 'Customer could not be saved.'));
    } finally {
      setBusy(false);
    }
  }

  function addLine(event, kind) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = Object.fromEntries(new FormData(form));
    const product = data.inventory.products.find(item => item.id === fields.product_id);
    const quantity = Number(fields.quantity);
    const priceKey = kind === 'sale' ? 'unit_price' : 'unit_cost';
    const price = Number(fields[priceKey]);
    if (!product || !Number.isInteger(quantity) || quantity <= 0 || !Number.isFinite(price) || price < 0) {
      setError('Choose a product and enter a valid whole-number quantity and price.');
      return;
    }
    const currentCart = kind === 'sale' ? cart : purchaseCart;
    if (kind === 'sale') {
      const committed = currentCart.filter(item => item.product_id === product.id).reduce((sum, item) => sum + item.quantity, 0);
      if (committed + quantity > product.quantity) {
        setError(`Only ${Math.max(0, product.quantity - committed)} more ${product.unit} of ${product.name} can be added to this sale.`);
        return;
      }
    }
    const line = { product_id: product.id, name: product.name, quantity, [priceKey]: price, total: quantity * price };
    if (kind === 'sale') setCart(items => [...items, line]);
    else setPurchaseCart(items => [...items, line]);
    setError('');
    form.reset();
  }

  async function submitSale(event) {
    event.preventDefault();
    if (!cart.length) return setError('Add at least one product to the sale.');
    setBusy(true);
    setError('');
    const form = event.currentTarget;
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await api.post('/business/sales', {
        customer_id: fields.customer_id || null,
        date: fields.date,
        notes: fields.notes,
        amount_paid: Number(fields.amount_paid || 0),
        items: cart.map(({ product_id, quantity, unit_price }) => ({ product_id, quantity, unit_price }))
      });
      setCart([]);
      form.reset();
      setNotice(`Sale recorded. Invoice ${response.data.sale.id.slice(0, 8)} is ready to print.`);
      await load();
    } catch (err) {
      setError(formatError(err, 'Sale could not be recorded.'));
    } finally {
      setBusy(false);
    }
  }

  async function submitPurchase(event) {
    event.preventDefault();
    if (!purchaseCart.length) return setError('Add at least one product to the purchase.');
    setBusy(true);
    setError('');
    const form = event.currentTarget;
    const fields = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const purchasePayload = {
        supplier_id: fields.supplier_id || null,
        reference: fields.reference,
        date: fields.date,
        notes: fields.notes,
        items: purchaseCart.map(({ product_id, quantity, unit_cost }) => ({ product_id, quantity, unit_cost }))
      };
      const fingerprint = JSON.stringify(purchasePayload);
      const idempotencyKey = purchaseIdempotencyRequest?.fingerprint === fingerprint
        ? purchaseIdempotencyRequest.key
        : window.crypto.randomUUID();
      setPurchaseIdempotencyRequest({ key: idempotencyKey, fingerprint });
      const response = await api.post('/business/purchases', purchasePayload, {
        headers: { 'Idempotency-Key': idempotencyKey }
      });
      setPurchaseCart([]);
      setPurchaseIdempotencyRequest(null);
      form.reset();
      setNotice(`Purchase recorded (${money(response.data.purchase.total)}). Stock increased and one expense was added.`);
      await load();
    } catch (err) {
      setError(formatError(err, 'Purchase could not be recorded.'));
    } finally {
      setBusy(false);
    }
  }

  async function deleteCustomer(customer) {
    if (customer.purchase_count) {
      setError('Customers with sales history cannot be deleted. Edit the customer details to keep invoices linked.');
      return;
    }
    if (!window.confirm(`Remove customer ${customer.name}?`)) return;
    try {
      await api.delete(`/business/customers/${customer.id}`);
      setNotice('Customer removed.');
      await load();
    } catch (err) {
      setError(formatError(err, 'Customer could not be removed.'));
    }
  }

  async function editCustomer(customer) {
    const name = window.prompt('Customer name', customer.name);
    if (name === null || !name.trim()) return;
    const email = window.prompt('Customer email', customer.email || '');
    if (email === null) return;
    const phone = window.prompt('Customer phone', customer.phone || '');
    if (phone === null) return;
    const address = window.prompt('Customer address', customer.address || '');
    if (address === null) return;
    try {
      await api.put(`/business/customers/${customer.id}`, { name: name.trim(), email, phone, address });
      setNotice('Customer details updated.');
      await load();
    } catch (err) {
      setError(formatError(err, 'Customer could not be updated.'));
    }
  }

  async function editSupplier(supplier) {
    const name = window.prompt('Supplier name', supplier.name);
    if (name === null || !name.trim()) return;
    const email = window.prompt('Supplier email', supplier.email || '');
    if (email === null) return;
    const phone = window.prompt('Supplier phone', supplier.phone || '');
    if (phone === null) return;
    try {
      await api.put(`/inventory/suppliers/${supplier.id}`, { name: name.trim(), email, phone });
      setNotice('Supplier details updated.');
      await load();
    } catch (err) {
      setError(formatError(err, 'Supplier could not be updated.'));
    }
  }

  async function toggleHistory(kind, record) {
    const key = `${kind}:${record.id}`;
    if (Object.hasOwn(directoryHistory, key)) {
      setDirectoryHistory(current => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      return;
    }
    setHistoryLoading(key);
    setError('');
    try {
      const { data: result } = await api.get(`/business/${kind}/${record.id}/history`);
      setDirectoryHistory(current => ({ ...current, [key]: result.history }));
    } catch (err) {
      setError(formatError(err, `${kind === 'customers' ? 'Customer' : 'Supplier'} history could not be loaded.`));
    } finally {
      setHistoryLoading('');
    }
  }

  async function deleteSupplier(supplier) {
    if (supplier.purchase_count) {
      setError('Suppliers with purchase history cannot be deleted. Edit supplier details to keep purchase records linked.');
      return;
    }
    if (!window.confirm(`Remove supplier ${supplier.name}?`)) return;
    try {
      await api.delete(`/inventory/suppliers/${supplier.id}`);
      setNotice('Supplier removed.');
      await load();
    } catch (err) {
      setError(formatError(err, 'Supplier could not be removed.'));
    }
  }

  async function recordPayment(sale) {
    const remaining = Number(sale.balance_due || 0);
    if (remaining <= 0) return;
    const input = window.prompt(`Remaining balance: ${money(remaining)}\nEnter the payment received:`, remaining.toFixed(2));
    if (input === null) return;
    const amount = Number(input);
    if (!Number.isFinite(amount) || amount <= 0 || amount > remaining) {
      setError(`Enter a payment greater than zero and no more than ${money(remaining)}.`);
      return;
    }
    try {
      await api.post(`/business/sales/${sale.id}/payment`, { amount });
      setNotice(`${money(amount)} payment recorded.`);
      await load();
    } catch (err) {
      setError(formatError(err, 'Payment could not be recorded.'));
    }
  }

  async function analyzeWithAI() {
    setBusy(true);
    setError('');
    setAiReply('');
    try {
      const response = await api.post('/business/assistant');
      setAiReply(response.data.reply);
    } catch (err) {
      setError(formatError(err, 'AI analysis could not be completed.'));
    } finally {
      setBusy(false);
    }
  }

  async function printInvoice(saleId) {
    const printWindow = window.open('', '_blank', 'width=850,height=700');
    if (!printWindow) {
      setError('Allow pop-ups for this site to print invoices.');
      return;
    }
    const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
    try {
      const { data: result } = await api.get(`/business/sales/${saleId}`);
      const sale = result.sale;
      const rows = sale.items.map(item => `<tr><td>${escapeHtml(item.name)}</td><td>${item.quantity}</td><td>₹${Number(item.unit_price).toFixed(2)}</td><td>₹${Number(item.line_total).toFixed(2)}</td></tr>`).join('');
      printWindow.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${escapeHtml(sale.id.slice(0, 8))}</title><style>body{font:15px Arial,sans-serif;max-width:760px;margin:48px auto;color:#222}header{display:flex;justify-content:space-between;border-bottom:2px solid #2d4a3e;padding-bottom:18px}h1{color:#2d4a3e}table{width:100%;border-collapse:collapse;margin:28px 0}th,td{text-align:left;padding:12px;border-bottom:1px solid #ddd}th:last-child,td:last-child{text-align:right}.total{text-align:right;font-size:20px;font-weight:bold}.settlement{text-align:right;line-height:1.8}.muted{color:#666}@media print{body{margin:20px}}</style></head><body><header><div><h1>Ledger</h1><p>Sales invoice</p></div><div><strong>Invoice #${escapeHtml(sale.id.slice(0, 8))}</strong><p>${escapeHtml(sale.date)}</p></div></header><section><strong>Bill to: ${escapeHtml(sale.customer_name || 'Walk-in customer')}</strong><p class="muted">${escapeHtml(sale.customer_email || '')}<br>${escapeHtml(sale.customer_phone || '')}<br>${escapeHtml(sale.customer_address || '')}</p></section><table><thead><tr><th>Product</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table><div class="settlement"><p>Total: ${money(sale.total)}</p><p>Paid: ${money(sale.amount_paid)}</p><p><strong>Balance due: ${money(sale.balance_due)}</strong></p></div>${sale.notes ? `<p>Notes: ${escapeHtml(sale.notes)}</p>` : ''}<script>window.onload=()=>window.print()</script></body></html>`);
      printWindow.document.close();
      setError('');
    } catch (err) {
      printWindow.close();
      setError(formatError(err, 'Invoice could not be loaded.'));
    }
  }

  const { finance, stock, low_stock: lowStock = [] } = data.overview;
  const recentTransactions = [
    ...data.sales.map(record => ({ ...record, kind: 'Sale', label: record.customer_name || 'Walk-in customer' })),
    ...data.purchases.map(record => ({ ...record, kind: 'Purchase', label: record.supplier_name || 'Supplier' }))
  ].sort((a, b) => `${b.date}${b.created_at || ''}`.localeCompare(`${a.date}${a.created_at || ''}`)).slice(0, 7);
  const rangeChange = (key, value) => {
    setError('');
    setRange(current => ({ ...current, [key]: value }));
  };

  return <main className="business-page">
    <header className="business-heading">
      <div><span className="business-kicker">SMART BUSINESS MANAGEMENT</span><h2>{tabs.find(item => item[0] === tab)?.[1]}</h2><p>One connected view of your sales, stock, customers, and finances.</p></div>
      <button className="business-refresh" onClick={() => { setError(''); load(); }} aria-label="Refresh business data">↻ Refresh</button>
    </header>
    {error && <div className="business-alert error" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss">×</button></div>}
    {notice && <div className="business-alert success" role="status"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss">×</button></div>}

    {tab === 'dashboard' && <section className="business-module">
      <div className="business-period-note">Financial snapshot · {range.from} to {range.to}</div>
      <div className="business-kpi-grid">
        <KPI label="Total sales" value={money(finance.sales)} hint={`${finance.sales_count || 0} recorded sales`} color="green" />
        <KPI label="Total purchases" value={money(finance.purchases)} hint={`${finance.purchase_count || 0} recorded purchases`} color="orange" />
        <KPI label="Estimated net profit" value={money(finance.estimated_net_profit)} hint="Sales minus recorded expenses" color={finance.estimated_net_profit >= 0 ? 'blue' : 'red'} />
        <KPI label="Total products" value={stock.total_products || 0} hint="Products in your catalog" color="purple" />
        <KPI label="Available stock" value={Number(stock.available_stock || 0).toLocaleString('en-IN')} hint={`Inventory value ${money(stock.stock_value)}`} color="teal" />
        <KPI label="Low stock alerts" value={stock.low_stock_count || 0} hint={stock.low_stock_count ? 'Review products below' : 'Stock levels look healthy'} color="red" />
        <KPI label="Total expenses" value={money(finance.expenses)} hint={`${finance.expense_count || 0} recorded entries`} color="orange" />
        <KPI label="Pending customer payments" value={money(data.overview.receivables?.pending_amount)} hint={`${data.overview.receivables?.pending_invoice_count || 0} unpaid invoices`} color="purple" />
      </div>
      <div className="business-columns">
        <section className="business-card">
          <SectionTitle title="Low stock watch" subtitle="Products at or below their reorder level" />
          {lowStock.length ? <div className="business-list">{lowStock.map(item => <div className="business-list-row" key={item.id}><span className="business-list-icon warning">!</span><div><strong>{item.name}</strong><small>Reorder at {item.reorder_level} {item.unit}</small></div><b>{item.quantity} {item.unit}</b></div>)}</div> : <Empty>No products need restocking right now.</Empty>}
        </section>
        <section className="business-card">
          <SectionTitle title="Recent activity" subtitle="Latest sales and purchases" />
          {recentTransactions.length
            ? recentTransactions.map(record => <div className="business-list-row" key={`${record.kind}-${record.id}`}><span className={`business-list-icon ${record.kind === 'Sale' ? 'positive' : 'neutral'}`}>{record.kind === 'Sale' ? '↗' : '↓'}</span><div><strong>{record.kind} · {record.label}</strong><small>{record.date}</small></div><b className={record.kind === 'Sale' ? 'positive-text' : ''}>{money(record.total)}</b></div>)
            : <Empty>Record a sale or purchase to see activity.</Empty>}
        </section>
        <section className="business-card">
          <SectionTitle title="Money movement" subtitle="Recorded totals for the selected period; purchases are included in expenses." />
          <Bars entries={[
            { label: 'Sales', value: finance.sales || 0 },
            { label: 'Purchases', value: finance.purchases || 0 },
            { label: 'All recorded expenses', value: finance.expenses || 0 }
          ]} />
        </section>
      </div>
    </section>}

    {tab === 'inventory' && <Inventory view={inventoryView} onNavigate={onTabChange || setTab} refreshKey={refreshKey} />}

    {tab === 'sales' && <section className="business-module business-columns">
      <section className="business-card">
        <SectionTitle title="Record a sale" subtitle="Items are deducted from stock when the sale is saved." />
        {data.inventory.products.length ? <>
          <form className="business-line-form" onSubmit={event => addLine(event, 'sale')}>
            <label>Product<select name="product_id" required defaultValue=""><option value="" disabled>Select product</option>{data.inventory.products.filter(item => item.quantity > 0).map(item => <option key={item.id} value={item.id}>{item.name} · {item.quantity} available</option>)}</select></label>
            <label>Qty<input name="quantity" type="number" min="1" step="1" required /></label>
            <label>Price/unit<input name="unit_price" type="number" min="0" step="0.01" required /></label>
            <button className="btn btn-secondary btn-sm">Add item</button>
          </form>
          <Cart lines={cart} priceKey="unit_price" onRemove={index => setCart(items => items.filter((_, i) => i !== index))} />
          <form className="business-record-form" onSubmit={submitSale}>
            <label>Customer<select name="customer_id"><option value="">Walk-in customer</option>{data.customers.map(customer => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
            <label>Sale date<input name="date" type="date" required defaultValue={today()} /></label>
            <label>Paid now (₹)<input name="amount_paid" type="number" min="0" max={cart.reduce((sum, line) => sum + line.total, 0)} step="0.01" defaultValue="0" /></label>
            <label>Notes<input name="notes" maxLength="240" placeholder="Optional note" /></label>
            <div className="business-form-footer"><strong>Sale total <span>{money(cart.reduce((sum, line) => sum + line.total, 0))}</span></strong><button className="btn btn-primary" disabled={busy || !cart.length}>{busy ? 'Saving…' : 'Record sale'}</button></div>
          </form>
        </> : <Empty>Add products in Inventory before recording sales.</Empty>}
      </section>
      <section className="business-card">
        <SectionTitle title="Sales history" subtitle="Print an invoice for any recorded sale." />
        {data.sales.length ? <div className="business-list">{data.sales.map(sale => <div className="business-list-row" key={sale.id}><span className="business-list-icon positive">↗</span><div><strong>{sale.customer_name || 'Walk-in customer'}</strong><small>{sale.date} · {sale.item_count} item{sale.item_count === 1 ? '' : 's'} · Due {money(sale.balance_due)} · #{sale.id.slice(0, 8)}</small></div><b>{money(sale.total)}</b>{sale.balance_due > 0 && <button className="business-small-button" onClick={() => recordPayment(sale)}>Record payment</button>}<button className="business-small-button" onClick={() => printInvoice(sale.id)}>Invoice</button></div>)}</div> : <Empty>No sales recorded yet.</Empty>}
      </section>
    </section>}

    {tab === 'purchases' && <section className="business-module business-columns">
      <section className="business-card">
        <SectionTitle title="Record a purchase" subtitle="Stock increases automatically; purchase cost is recorded as one expense." />
        {data.inventory.products.length ? <>
          <form className="business-line-form purchase-line-form" onSubmit={event => addLine(event, 'purchase')}>
            <label>Product<select name="product_id" required defaultValue=""><option value="" disabled>Select product</option>{data.inventory.products.map(item => <option key={item.id} value={item.id}>{item.name} · {item.quantity} in stock</option>)}</select></label>
            <label>Qty<input name="quantity" type="number" min="1" step="1" required /></label>
            <label>Cost/unit<input name="unit_cost" type="number" min="0" step="0.01" required /></label>
            <button className="btn btn-secondary btn-sm">Add item</button>
          </form>
          <Cart lines={purchaseCart} priceKey="unit_cost" onRemove={index => setPurchaseCart(items => items.filter((_, i) => i !== index))} />
          <form className="business-record-form" onSubmit={submitPurchase}>
            <label>Supplier<select name="supplier_id"><option value="">Unspecified supplier</option>{data.inventory.suppliers.map(supplier => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
            <label>Purchase date<input name="date" type="date" required defaultValue={today()} /></label>
            <label>Invoice/reference<input name="reference" maxLength="100" placeholder="Unique invoice number (optional)" /></label>
            <label>Notes<input name="notes" maxLength="240" placeholder="Optional note" /></label>
            <div className="business-form-footer"><strong>Purchase total <span>{money(purchaseCart.reduce((sum, line) => sum + line.total, 0))}</span></strong><button className="btn btn-primary" disabled={busy || !purchaseCart.length}>{busy ? 'Saving…' : 'Record purchase'}</button></div>
          </form>
        </> : <Empty>Add products in Inventory before recording purchases.</Empty>}
      </section>
      <section className="business-card">
        <SectionTitle title="Purchase history" subtitle="Purchases are already included in finance expenses." />
        {data.purchases.length ? <div className="business-list">{data.purchases.map(purchase => <div className="business-list-row" key={purchase.id}><span className="business-list-icon neutral">↓</span><div><strong>{purchase.supplier_name || 'Supplier'}</strong><small>{purchase.date} · {purchase.item_count} item{purchase.item_count === 1 ? '' : 's'}{purchase.reference ? ` · ${purchase.reference}` : ''}</small></div><b>{money(purchase.total)}</b></div>)}</div> : <Empty>No purchases recorded yet.</Empty>}
      </section>
    </section>}

    {tab === 'finance' && <section className="business-module">
      <DateRange range={range} onChange={rangeChange} />
      <div className="business-kpi-grid three">
        <KPI label="Sales income" value={money(data.reports?.finance?.sales)} hint={`${data.reports?.finance?.sales_count || 0} sales in period`} color="green" />
        <KPI label="Recorded expenses" value={money(data.reports?.finance?.expenses)} hint="Includes purchases once" color="orange" />
        <KPI label="Estimated net profit" value={money(data.reports?.finance?.estimated_net_profit)} hint="Sales income − expenses" color={data.reports?.finance?.estimated_net_profit >= 0 ? 'blue' : 'red'} />
      </div>
      <section className="business-card"><SectionTitle title="Expense breakdown" subtitle="Existing Ledger expenses and recorded purchases" />
        {data.reports?.expenses?.length ? <Bars entries={data.reports.expenses.map(item => ({ label: item.category === 'Purchases' ? 'Purchases' : item.category, value: item.total }))} /> : <Empty>No expenses in the selected period.</Empty>}
      </section>
    </section>}

    {tab === 'customers' && <section className="business-module business-columns">
      <section className="business-card">
        <SectionTitle title="Add a customer" subtitle="Customer details are private to your account." />
        <form className="business-record-form" onSubmit={saveCustomer}>
          <label>Customer name<input name="name" required maxLength="120" /></label>
          <label>Email<input name="email" type="email" maxLength="180" /></label>
          <label>Phone<input name="phone" maxLength="50" /></label>
          <label>Address<input name="address" maxLength="300" /></label>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save customer'}</button>
        </form>
      </section>
      <section className="business-card">
        <SectionTitle title="Customers" subtitle="Purchase history and outstanding balances update from sales." />
        {data.customers.length ? <div className="business-list">{data.customers.map(customer => {
          const key = `customers:${customer.id}`;
          return <div className="business-directory-record" key={customer.id}>
            <div className="business-list-row customer-row"><span className="business-customer-avatar">{customer.name.slice(0, 1).toUpperCase()}</span><div><strong>{customer.name}</strong><small>{[customer.email, customer.phone].filter(Boolean).join(' · ') || 'No contact details'} · {customer.purchase_count} purchases · Due {money(customer.pending_amount)}</small></div><b>{money(customer.total_spent)}</b><button className="business-small-button" onClick={() => toggleHistory('customers', customer)}>{historyLoading === key ? 'Loading…' : Object.hasOwn(directoryHistory, key) ? 'Hide history' : 'View history'}</button><button className="business-small-button" onClick={() => editCustomer(customer)}>Edit</button><button className="business-icon-button" aria-label={`Remove ${customer.name}`} onClick={() => deleteCustomer(customer)}>×</button></div>
            {Object.hasOwn(directoryHistory, key) && <div className="business-directory-history">{directoryHistory[key].length ? directoryHistory[key].map(sale => <div className="business-history-item" key={sale.id}><div><strong>{sale.date} · Invoice #{sale.id.slice(0, 8)}</strong><small>{sale.items.map(item => `${item.name} × ${item.quantity}`).join(' · ')}</small><small>Paid {money(sale.amount_paid)} · Due {money(sale.balance_due)}</small></div><b>{money(sale.total)}</b><button className="business-small-button" onClick={() => printInvoice(sale.id)}>Invoice</button></div>) : <Empty>No sales recorded for this customer.</Empty>}</div>}
          </div>;
        })}</div> : <Empty>No customers yet. Add a customer or attach one to your next sale.</Empty>}
      </section>
    </section>}

    {tab === 'suppliers' && <section className="business-module business-columns">
      <section className="business-card">
        <SectionTitle title="Add a supplier" subtitle="Supplier records are shared with inventory and purchases." />
        <form className="business-record-form" onSubmit={async event => {
          event.preventDefault();
          const form = event.currentTarget;
          setBusy(true);
          setError('');
          try {
            await api.post('/inventory/suppliers', Object.fromEntries(new FormData(form)));
            form.reset();
            setNotice('Supplier saved.');
            await load();
          } catch (err) {
            setError(formatError(err, 'Supplier could not be saved.'));
          } finally {
            setBusy(false);
          }
        }}>
          <label>Supplier name<input name="name" required maxLength="120" /></label>
          <label>Email<input name="email" type="email" maxLength="180" /></label>
          <label>Phone<input name="phone" maxLength="50" /></label>
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save supplier'}</button>
        </form>
      </section>
      <section className="business-card">
        <SectionTitle title="Supplier directory" subtitle="Purchase totals and last order update from purchase records." />
        {data.suppliers.length ? <div className="business-list">{data.suppliers.map(supplier => {
          const key = `suppliers:${supplier.id}`;
          return <div className="business-directory-record" key={supplier.id}>
            <div className="business-list-row"><span className="business-customer-avatar">{supplier.name.slice(0, 1).toUpperCase()}</span><div><strong>{supplier.name}</strong><small>{[supplier.email, supplier.phone].filter(Boolean).join(' · ') || 'No contact details'} · {supplier.purchase_count} purchases{supplier.last_purchase_date ? ` · Last ${supplier.last_purchase_date}` : ''}</small></div><b>{money(supplier.total_purchased)}</b><button className="business-small-button" onClick={() => toggleHistory('suppliers', supplier)}>{historyLoading === key ? 'Loading…' : Object.hasOwn(directoryHistory, key) ? 'Hide history' : 'View history'}</button><button className="business-small-button" onClick={() => editSupplier(supplier)}>Edit</button><button className="business-icon-button" aria-label={`Remove ${supplier.name}`} onClick={() => deleteSupplier(supplier)}>×</button></div>
            {Object.hasOwn(directoryHistory, key) && <div className="business-directory-history">{directoryHistory[key].length ? directoryHistory[key].map(purchase => <div className="business-history-item" key={purchase.id}><div><strong>{purchase.date}{purchase.reference ? ` · ${purchase.reference}` : ''}</strong><small>{purchase.items.map(item => `${item.name} × ${item.quantity} at ${money(item.unit_cost)}`).join(' · ')}</small></div><b>{money(purchase.total)}</b></div>) : <Empty>No purchases recorded for this supplier.</Empty>}</div>}
          </div>;
        })}</div> : <Empty>No suppliers saved yet.</Empty>}
      </section>
    </section>}

    {tab === 'reports' && <section className="business-module">
      <DateRange range={range} onChange={rangeChange} />
      <div className="business-kpi-grid three">
        <KPI label="Sales" value={money(data.reports?.finance?.sales)} hint={`${data.reports?.sales?.length || 0} invoices`} color="green" />
        <KPI label="Expenses" value={money(data.reports?.finance?.expenses)} hint="Purchases included once" color="orange" />
        <KPI label="Estimated profit" value={money(data.reports?.finance?.estimated_net_profit)} hint="For selected period" color="blue" />
      </div>
      <div className="business-columns">
        <section className="business-card"><SectionTitle title="Purchase history" subtitle={`Purchases totaling ${money(data.reports?.finance?.purchases)} in this period`} />
          {data.reports?.purchases?.length ? <div className="business-list">{data.reports.purchases.map(purchase => <div className="business-list-row" key={purchase.id}><span className="business-list-icon neutral">↓</span><div><strong>{purchase.supplier_name || 'Supplier'}{purchase.reference ? ` · ${purchase.reference}` : ''}</strong><small>{purchase.date} · {purchase.item_count} item{purchase.item_count === 1 ? '' : 's'}</small></div><b>{money(purchase.total)}</b></div>)}</div> : <Empty>No purchases in the selected period.</Empty>}
        </section>
        <section className="business-card"><SectionTitle title="Product stock report" subtitle="Available quantities and units sold in the selected period" />
          {data.reports?.products?.length ? <div className="business-list">{data.reports.products.map(product => <div className="business-list-row" key={product.id}><span className={`business-list-icon ${product.quantity <= product.reorder_level ? 'warning' : 'positive'}`}>{product.quantity <= product.reorder_level ? '!' : '▦'}</span><div><strong>{product.name}</strong><small>{product.units_sold} units sold · reorder at {product.reorder_level}</small></div><b>{product.quantity} {product.unit}</b></div>)}</div> : <Empty>No products available to report.</Empty>}
        </section>
        <section className="business-card"><SectionTitle title="Expense categories" subtitle="Spending grouped by Ledger category" />
          {data.reports?.expenses?.length ? <Bars entries={data.reports.expenses.map(item => ({ label: item.category, value: item.total }))} /> : <Empty>No expenses in the selected period.</Empty>}
        </section>
      </div>
    </section>}

    {tab === 'assistant' && <section className="business-module business-assistant">
      <div className="assistant-banner"><span>✦</span><div><strong>Business insights</strong><p>Recommendations based on your current Ledger records. Add sales, purchases, and expenses for more useful guidance.</p></div><button className="btn btn-primary btn-sm" disabled={busy} onClick={analyzeWithAI}>{busy ? 'Analyzing…' : 'Analyze with AI'}</button></div>
      {data.assistant.map((insight, index) => <article className="business-card assistant-card" key={`${insight.type}-${index}`}><span className={`assistant-type ${insight.type}`}>{insight.type === 'stock' ? 'RESTOCK' : insight.type === 'saving' ? 'COST SAVING' : insight.type === 'attention' ? 'ATTENTION' : 'HEALTHY'}</span><h3>{insight.title}</h3><p>{insight.detail}</p>{insight.type === 'stock' && <button onClick={() => setTab('inventory')}>Review inventory →</button>}</article>)}
      {aiReply && <article className="business-card assistant-card"><span className="assistant-type positive">AI ANALYSIS</span><h3>Ledger’s business review</h3><p className="assistant-ai-reply">{aiReply}</p></article>}
      <div className="assistant-disclaimer">Data-based alerts remain available without an AI key. AI-generated analysis requires GEMINI_API_KEY in the backend. Insights are not a substitute for professional financial advice.</div>
    </section>}
  </main>;
}

function KPI({ label, value, hint, color }) {
  return <article className={`business-kpi ${color}`}><div className="business-kpi-top"><span>{label}</span><i /></div><strong>{value}</strong><small>{hint}</small></article>;
}

function SectionTitle({ title, subtitle }) {
  return <div className="business-section-title"><div><h3>{title}</h3><p>{subtitle}</p></div></div>;
}

function Empty({ children }) {
  return <div className="business-empty">{children}</div>;
}

function Cart({ lines, priceKey, onRemove }) {
  if (!lines.length) return <div className="business-cart-empty">Add one or more products to continue.</div>;
  return <div className="business-cart">{lines.map((line, index) => <div key={`${line.product_id}-${index}`}><span><strong>{line.name}</strong><small>{line.quantity} × {money(line[priceKey])}</small></span><b>{money(line.total)}</b><button aria-label={`Remove ${line.name}`} onClick={() => onRemove(index)}>×</button></div>)}</div>;
}

function DateRange({ range, onChange }) {
  return <div className="business-date-range"><span>Report period</span><label>From<input type="date" value={range.from} max={range.to} onChange={event => onChange('from', event.target.value)} /></label><label>To<input type="date" value={range.to} min={range.from} onChange={event => onChange('to', event.target.value)} /></label></div>;
}

function Bars({ entries }) {
  const maximum = Math.max(1, ...entries.map(item => Number(item.value)));
  return <div className="business-bars">{entries.map(entry => <div className="business-bar-row" key={entry.label}><div><span>{entry.label}</span><strong>{money(entry.value)}</strong></div><div className="business-bar-track"><i style={{ width: `${Math.max(2, Number(entry.value) / maximum * 100)}%` }} /></div></div>)}</div>;
}
