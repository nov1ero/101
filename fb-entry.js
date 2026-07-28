/* Точка входа для бандла Firebase SDK: нужные функции складываются в window.FBSDK.
 * Сборка: node build-fb.js → fb.min.js (коммитится в репозиторий, чтобы
 * пересборка игры не требовала esbuild). */
import { initializeApp } from 'firebase/app';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, onAuthStateChanged, signOut,
} from 'firebase/auth';
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
  collection, query, where, getDocs, addDoc, serverTimestamp, runTransaction,
} from 'firebase/firestore';
// Firebase Storage не используется: для фото — Cloudinary (бесплатно, без карты)

window.FBSDK = {
  initializeApp,
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, onAuthStateChanged, signOut,
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, onSnapshot,
  collection, query, where, getDocs, addDoc, serverTimestamp, runTransaction,
};
