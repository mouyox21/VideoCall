import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyAJPf3zhYg3klnMspQMMOiJDorUTIW8-JQ",
  authDomain: "codechat-d9761.firebaseapp.com",
  databaseURL: "https://codechat-d9761-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "codechat-d9761",
  storageBucket: "codechat-d9761.firebasestorage.app",
  messagingSenderId: "602319518337",
  appId: "1:602319518337:web:92dcebb186299ecb046b80",
  measurementId: "G-G98HT7C5ZV"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const storage = getStorage(app);