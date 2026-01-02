// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, update, onValue } from "firebase/database";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
    apiKey: "AIzaSyA2xlgFKAXVk5PaEvIRVnHjo2f3gg1dtJA",
    authDomain: "quizalia-dfe62.firebaseapp.com",
    projectId: "quizalia-dfe62",
    storageBucket: "quizalia-dfe62.firebasestorage.app",
    messagingSenderId: "53487317404",
    appId: "1:53487317404:web:c79d8cbae248c1100fd859"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
// Export the functions so you don't have to import them from the SDK again in script.js
export { ref, set, update, onValue };