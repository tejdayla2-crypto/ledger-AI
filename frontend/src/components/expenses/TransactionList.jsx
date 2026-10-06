// src/components/expenses/TransactionList.jsx
import TransactionRow from './TransactionRow';

export default function TransactionList({ expenses, onAction }) {
  return (
    <div className="ledger-panel">
      <div className="ledger-header">
        <h3 style={{margin:0, fontSize:'1.1rem'}}>Recent Transactions</h3>
      </div>
      
      {expenses.length === 0 ? (
        <div className="ledger-empty">
          <p>No transactions yet.</p>
        </div>
      ) : (
        <div className="ledger-list">
          {expenses.map((exp, i) => (
            <TransactionRow 
              key={exp.id} 
              expense={exp} 
              onAction={onAction} 
            />
          ))}
        </div>
      )}
    </div>
  );
}
