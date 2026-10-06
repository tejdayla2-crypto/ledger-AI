# Firebase Integration Guide

This project is fully configured to connect with **Firebase Authentication**, **Cloud Firestore**, and **Firebase Hosting**.

---

## 1. Create a Firebase Project

1. Go to the [Firebase Console](https://console.firebase.google.com/).
2. Click **Add project** (or select an existing one).
3. Name your project (e.g., `ledger-ai-expense`) and complete the setup.

---

## 2. Enable Authentication (Google & Email/Password)

1. In the Firebase Console sidebar, go to **Build** → **Authentication**.
2. Click **Get Started**.
3. Under the **Sign-in method** tab:
   - Enable **Google** (set your project support email).
   - Enable **Email/Password** (Email link optional, keep standard email/password enabled).
4. Under **Settings** → **Authorized domains**, make sure `localhost` is listed (it is by default).

---

## 3. Configure Frontend (Web App Keys)

1. In Firebase Console, go to **Project Settings** (gear icon) → **General**.
2. Scroll down to **Your apps** and click the **Web icon (`</>`)** to register a web app.
3. Name the app (e.g. `ledger-web`) and copy the `firebaseConfig` values.
4. Open [frontend/.env](file:///c:/Users/Aryan/Downloads/tej/tej/frontend/.env) and populate the values:

```env
VITE_FIREBASE_API_KEY=AIzaSy...
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project
VITE_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=1234567890
VITE_FIREBASE_APP_ID=1:1234567890:web:abcdef123456
```

---

## 4. Configure Backend (Firebase Admin SDK)

1. In Firebase Console, go to **Project Settings** → **Service accounts**.
2. Under **Firebase Admin SDK**, click **Generate new private key**.
3. A JSON file will download (e.g. `your-project-firebase-adminsdk-xxxxx.json`).
4. You have two options:
   - **Option A (Recommended)**: Move this file into the `backend/` directory as `firebase-service-account.json`. The backend `.env` is already pre-configured to read `FIREBASE_SERVICE_ACCOUNT_KEY=./firebase-service-account.json`.
   - **Option B**: Open [backend/.env](file:///c:/Users/Aryan/Downloads/tej/tej/backend/.env) and set the discrete environment variables:
     ```env
     FIREBASE_PROJECT_ID=your-project
     FIREBASE_CLIENT_EMAIL=firebase-adminsdk-...@your-project.iam.gserviceaccount.com
     FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC7...-----END PRIVATE KEY-----\n"
     ```

---

## 5. (Optional) Cloud Firestore

1. In the Firebase Console sidebar, go to **Build** → **Firestore Database**.
2. Click **Create database** and choose a location close to you.
3. Start in **Production mode** (or Test mode during development).
4. The backend already includes [backend/lib/firestoreSync.js](file:///c:/Users/Aryan/Downloads/tej/tej/backend/lib/firestoreSync.js) which provides automatic syncing for expenses and budgets to Firestore collections under `users/{userId}/expenses` and `users/{userId}/budgets`.

---

## 6. (Optional) Firebase Hosting Deployment

1. Update [.firebaserc](file:///c:/Users/Aryan/Downloads/tej/tej/.firebaserc) with your default project ID:
   ```json
   {
     "projects": {
       "default": "your-firebase-project-id"
     }
   }
   ```
2. Build the frontend:
   ```bash
   cd frontend
   npm run build
   ```
3. Deploy hosting using Firebase CLI:
   ```bash
   npx firebase-tools deploy --only hosting
   ```

---

## 7. Running the Project

Start the backend:
```bash
cd backend
npm start
```

Start the frontend:
```bash
cd frontend
npm run dev
```

Visit `http://localhost:5173` to see Google Sign-In and Firebase Authentication active!
