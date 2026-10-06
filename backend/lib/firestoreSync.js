// backend/lib/firestoreSync.js
// Cloud Firestore integration helper for syncing expenses and budgets to the cloud.

const { getFirestoreDb, isFirebaseAdminConfigured } = require('./firebaseAdmin');

function isFirestoreAvailable() {
  return isFirebaseAdminConfigured() && getFirestoreDb() !== null;
}

/**
 * Saves or updates an expense document in Cloud Firestore
 * Path: users/{userId}/expenses/{expenseId}
 */
async function syncExpenseToFirestore(userId, expense) {
  if (!isFirestoreAvailable()) return false;
  try {
    const db = getFirestoreDb();
    await db
      .collection('users')
      .doc(userId)
      .collection('expenses')
      .doc(String(expense.id))
      .set(
        {
          ...expense,
          syncedAt: new Date().toISOString()
        },
        { merge: true }
      );
    return true;
  } catch (err) {
    console.warn(`[FirestoreSync] Failed to sync expense ${expense.id}:`, err.message);
    return false;
  }
}

/**
 * Removes an expense document from Cloud Firestore
 */
async function deleteExpenseFromFirestore(userId, expenseId) {
  if (!isFirestoreAvailable()) return false;
  try {
    const db = getFirestoreDb();
    await db
      .collection('users')
      .doc(userId)
      .collection('expenses')
      .doc(String(expenseId))
      .delete();
    return true;
  } catch (err) {
    console.warn(`[FirestoreSync] Failed to delete expense ${expenseId}:`, err.message);
    return false;
  }
}

/**
 * Saves or updates a budget document in Cloud Firestore
 * Path: users/{userId}/budgets/{budgetId}
 */
async function syncBudgetToFirestore(userId, budget) {
  if (!isFirestoreAvailable()) return false;
  try {
    const db = getFirestoreDb();
    await db
      .collection('users')
      .doc(userId)
      .collection('budgets')
      .doc(String(budget.id || budget.category))
      .set(
        {
          ...budget,
          syncedAt: new Date().toISOString()
        },
        { merge: true }
      );
    return true;
  } catch (err) {
    console.warn(`[FirestoreSync] Failed to sync budget:`, err.message);
    return false;
  }
}

/**
 * Fetch all expenses for a user from Cloud Firestore
 */
async function fetchExpensesFromFirestore(userId) {
  if (!isFirestoreAvailable()) return [];
  try {
    const db = getFirestoreDb();
    const snapshot = await db
      .collection('users')
      .doc(userId)
      .collection('expenses')
      .orderBy('date', 'desc')
      .get();

    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (err) {
    console.warn(`[FirestoreSync] Failed to fetch expenses:`, err.message);
    return [];
  }
}

module.exports = {
  isFirestoreAvailable,
  syncExpenseToFirestore,
  deleteExpenseFromFirestore,
  syncBudgetToFirestore,
  fetchExpensesFromFirestore
};
