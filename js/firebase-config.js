import { initializeApp } from "https://www.gstatic.com/firebasejs/12.14.0/firebase-app.js";
import { getAuth }       from "https://www.gstatic.com/firebasejs/12.14.0/firebase-auth.js";
import { getDatabase }   from "https://www.gstatic.com/firebasejs/12.14.0/firebase-database.js";
import { getStorage }    from "https://www.gstatic.com/firebasejs/12.14.0/firebase-storage.js";

const firebaseConfig = {
  apiKey:            "AIzaSyBRcY8jb7Yk4X_cxirqv7PsM5skgsPZXt0",
  authDomain:        "mlbb-tournament-ee7d3.firebaseapp.com",
  databaseURL:       "https://mlbb-tournament-ee7d3-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId:         "mlbb-tournament-ee7d3",
  storageBucket:     "mlbb-tournament-ee7d3.firebasestorage.app",
  messagingSenderId: "647971653478",
  appId:             "1:647971653478:web:b6dae372e859ba809deaa7"
};

const app = initializeApp(firebaseConfig);

export const auth    = getAuth(app);
export const db      = getDatabase(app);
export const storage = getStorage(app);