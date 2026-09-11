import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBIMRLj2fEaF931f2f-DuczjNidHWXDCv8",
  authDomain: "musashi-festival-1a.firebaseapp.com",
  projectId: "musashi-festival-1a",
  storageBucket: "musashi-festival-1a.firebasestorage.app",
  messagingSenderId: "814077633684",
  appId: "1:814077633684:web:f51dc9ff5a7b2032420081",
  measurementId: "G-DHMRHG5QVQ",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const STAFF_EMAIL_DOMAIN = "musashi.local";
