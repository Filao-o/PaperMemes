// Firebase Web app config — all values are PUBLIC by design (safe in client
// code). Data protection comes from Firestore Security Rules + enabled auth
// providers, not from these values. NEVER put a service-account JSON here.
export const firebaseConfig = {
  apiKey: 'AIzaSyCzxF6Ht4c-cGFT-QYY0m0dk6KYsf87B18',
  authDomain: 'papermemes-fd969.firebaseapp.com',
  projectId: 'papermemes-fd969',
  storageBucket: 'papermemes-fd969.firebasestorage.app',
  messagingSenderId: '1093050907458',
  appId: '1:1093050907458:web:d135de6fbb3c4a501ca6db',
  measurementId: 'G-7QQ41GV4FD',
}

// OAuth 2.0 Web client ID used for "Sign in with Google" in the extension.
// Get it in Firebase Console → Authentication → Sign-in method → Google →
// "Web SDK configuration" → Web client ID.
// IMPORTANT: in Google Cloud Console → APIs & Services → Credentials, open that
// same Web client and add the extension's redirect URL to "Authorized redirect
// URIs":  chrome.identity.getRedirectURL()  →  https://<EXTENSION_ID>.chromiumapp.org/
// (the extension ID is shown on chrome://extensions). Leave empty to disable
// Google sign-in (email/password still works).
export const googleClientId = ''
