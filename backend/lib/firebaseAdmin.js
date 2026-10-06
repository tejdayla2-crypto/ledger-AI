// backend/lib/firebaseAdmin.js
// Firebase Admin SDK initialization for server-side token verification and cloud services.

const fs = require('fs');
const path = require('path');
const { initializeApp, getApps, getApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');

let isConfigured = false;
let firebaseApp = null;
let firebaseAuth = null;
let firestoreDb = null;

function initFirebaseAdmin() {
  if (getApps().length > 0) {
    firebaseApp = getApp();
    firebaseAuth = getAuth(firebaseApp);
    firestoreDb = getFirestore(firebaseApp);
    isConfigured = true;
    return firebaseApp;
  }

  // Option 1: Inline service account JSON string or file path
  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (serviceAccountKey) {
    try {
      let credentialObj;
      if (serviceAccountKey.trim().startsWith('{')) {
        credentialObj = JSON.parse(serviceAccountKey);
      } else {
        const resolvedPath = path.isAbsolute(serviceAccountKey)
          ? serviceAccountKey
          : path.join(__dirname, '..', serviceAccountKey);
        if (fs.existsSync(resolvedPath)) {
          credentialObj = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
        }
      }

      if (credentialObj) {
        firebaseApp = initializeApp({
          credential: cert(credentialObj),
          projectId: credentialObj.project_id || process.env.FIREBASE_PROJECT_ID
        });
        firebaseAuth = getAuth(firebaseApp);
        firestoreDb = getFirestore(firebaseApp);
        isConfigured = true;
        console.log('✅ Firebase Admin SDK initialized with service account key');
        return firebaseApp;
      }
    } catch (err) {
      console.warn('⚠️  Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY:', err.message);
    }
  }

  // Option 2: Discrete environment variables
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  let privateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (projectId && clientEmail && privateKey) {
    try {
      privateKey = privateKey.replace(/\\n/g, '\n');
      firebaseApp = initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey
        })
      });
      firebaseAuth = getAuth(firebaseApp);
      firestoreDb = getFirestore(firebaseApp);
      isConfigured = true;
      console.log('✅ Firebase Admin SDK initialized with environment credentials');
      return firebaseApp;
    } catch (err) {
      console.warn('⚠️  Failed to initialize Firebase Admin with environment credentials:', err.message);
    }
  }

  // Option 3: Default application credentials (e.g. running in Cloud Run / GCP)
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      firebaseApp = initializeApp();
      firebaseAuth = getAuth(firebaseApp);
      firestoreDb = getFirestore(firebaseApp);
      isConfigured = true;
      console.log('✅ Firebase Admin SDK initialized with Google Application Credentials');
      return firebaseApp;
    } catch (err) {
      console.warn('⚠️  Failed to initialize Firebase Admin with default credentials:', err.message);
    }
  }

  console.warn('⚠️  Firebase Admin SDK is not configured yet. Set FIREBASE_SERVICE_ACCOUNT_KEY or FIREBASE_PROJECT_ID in backend/.env');
  return null;
}

// Attempt initial setup
initFirebaseAdmin();

function isFirebaseAdminConfigured() {
  return isConfigured && Boolean(firebaseApp && firebaseAuth);
}

async function verifyFirebaseIdToken(idToken) {
  if (!isFirebaseAdminConfigured()) {
    throw new Error('Firebase Admin is not configured. Please add your Firebase credentials to backend/.env');
  }
  return await firebaseAuth.verifyIdToken(idToken);
}

function getFirestoreDb() {
  if (!isFirebaseAdminConfigured()) {
    return null;
  }
  return firestoreDb;
}

function getAdminAuth() {
  if (!isFirebaseAdminConfigured()) {
    return null;
  }
  return firebaseAuth;
}

module.exports = {
  initFirebaseAdmin,
  isFirebaseAdminConfigured,
  verifyFirebaseIdToken,
  getFirestoreDb,
  getAdminAuth
};
