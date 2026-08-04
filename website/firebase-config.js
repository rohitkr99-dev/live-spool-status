// Firebase Configuration
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.1.0/firebase-app.js";
import {
    getAuth
} from "https://www.gstatic.com/firebasejs/12.1.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyBrZXL5-rlzkV7txTn7tls64I1s36sJPkc",
    authDomain: "dee-live-dashboard.firebaseapp.com",
    projectId: "dee-live-dashboard",
    storageBucket: "dee-live-dashboard.firebasestorage.app",
    messagingSenderId: "166961591019",
    appId: "1:166961591019:web:fb7345a1f28f1dd9d684ae"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
