/* ============================================================
 *  Профили игроков (Firebase): Google-вход, имя, фото-аватарка,
 *  код друга, presence. Работает только если задан FIREBASE_CONFIG
 *  и собран window.FBSDK — иначе игра живёт без профилей.
 * ============================================================ */
window.Profiles = (function () {
  'use strict';
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let S = null, app = null, auth = null, db = null;
  let profile = null;      // {uid, name, photo, code}
  let hooks = {};
  let hb = null;           // heartbeat-таймер
  let currentRoom = null;

  function available() {
    return !!(window.FBSDK && window.FIREBASE_CONFIG && window.FIREBASE_CONFIG.apiKey);
  }

  async function init(h) {
    hooks = h || {};
    if (!available()) return false;
    S = window.FBSDK;
    try {
      app = S.initializeApp(window.FIREBASE_CONFIG);
      auth = S.getAuth(app);
      db = S.getFirestore(app);
    } catch (e) {
      status('Firebase не инициализирован: ' + (e.message || e));
      return false;
    }
    // завершение redirect-входа (мобильные)
    try { await S.getRedirectResult(auth); } catch (e) {}
    S.onAuthStateChanged(auth, async (u) => {
      if (!u) { profile = null; stopHeartbeat(); emitUser(); return; }
      try {
        profile = await ensureUserDoc(u);
      } catch (e) {
        // профиль в БД недоступен (правила/сеть) — работаем с данными Google
        profile = { uid: u.uid, name: u.displayName || 'Игрок', photo: u.photoURL || null, code: null };
        status('Профиль не загружен: ' + (e.code || e.message || e));
      }
      startHeartbeat();
      emitUser();
    });
    return true;
  }

  function status(msg) { if (hooks.onStatus) hooks.onStatus(msg); }
  function emitUser() { if (hooks.onUser) hooks.onUser(profile); }

  /* документ пользователя + уникальный код друга */
  async function ensureUserDoc(u) {
    const refU = S.doc(db, 'users', u.uid);
    const snap = await S.getDoc(refU);
    if (snap.exists()) {
      const d = snap.data();
      return { uid: u.uid, name: d.name || 'Игрок', photo: d.photo || null, code: d.code || null };
    }
    for (let attempt = 0; attempt < 6; attempt++) {
      let code = '';
      for (let i = 0; i < 6; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      try {
        await S.runTransaction(db, async (tx) => {
          const cRef = S.doc(db, 'friendCodes', code);
          const c = await tx.get(cRef);
          if (c.exists()) throw new Error('code-taken');
          tx.set(cRef, { uid: u.uid });
          tx.set(refU, {
            name: (u.displayName || 'Игрок').slice(0, 12),
            photo: u.photoURL || null,
            code,
            lastSeen: S.serverTimestamp(),
            room: null,
          });
        });
        return { uid: u.uid, name: (u.displayName || 'Игрок').slice(0, 12), photo: u.photoURL || null, code };
      } catch (e) {
        if (String(e.message).indexOf('code-taken') < 0) throw e;
      }
    }
    throw new Error('не удалось выдать код друга');
  }

  async function signIn() {
    if (!auth) return;
    const p = new S.GoogleAuthProvider();
    try {
      await S.signInWithPopup(auth, p);
    } catch (e) {
      // popup заблокирован (мобильные браузеры, PWA) — пробуем redirect
      const code = e && e.code || '';
      if (code === 'auth/popup-blocked' || code === 'auth/popup-closed-by-user' ||
          code === 'auth/operation-not-supported-in-this-environment' || code === 'auth/cancelled-popup-request') {
        try { await S.signInWithRedirect(auth, p); return; } catch (e2) { e = e2; }
      }
      status('Не удалось войти: ' + (e.code || e.message || e));
    }
  }

  async function signOutUser() {
    try { setRoom(null); await S.signOut(auth); } catch (e) {}
  }

  async function setName(name) {
    if (!profile) return;
    name = String(name).trim().slice(0, 12) || 'Игрок';
    await S.updateDoc(S.doc(db, 'users', profile.uid), { name });
    profile.name = name;
    emitUser();
  }

  /* фото: квадратная обрезка по центру + сжатие на устройстве, потом в Storage */
  function resizeSquare(file, size) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = size; cv.height = size;
        const ctx = cv.getContext('2d');
        const side = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
        URL.revokeObjectURL(img.src);
        cv.toBlob(b => b ? res(b) : rej(new Error('не удалось сжать фото')), 'image/jpeg', 0.85);
      };
      img.onerror = () => rej(new Error('не удалось открыть фото'));
      img.src = URL.createObjectURL(file);
    });
  }

  /* загрузка фото в Cloudinary (unsigned preset — без секретов и без сервера) */
  async function setAvatarFile(file) {
    if (!profile) throw new Error('нет профиля');
    const cfg = window.CLOUDINARY_CONFIG;
    if (!cfg || !cfg.cloudName || !cfg.uploadPreset) throw new Error('загрузка фото не настроена (Cloudinary)');
    const blob = await resizeSquare(file, 128);
    const fd = new FormData();
    fd.append('file', blob, 'avatar.jpg');
    fd.append('upload_preset', cfg.uploadPreset);
    fd.append('public_id', 'ava_' + profile.uid); // повторная загрузка заменяет старое фото
    const resp = await fetch('https://api.cloudinary.com/v1_1/' + encodeURIComponent(cfg.cloudName) + '/image/upload', {
      method: 'POST', body: fd,
    });
    if (!resp.ok) throw new Error('Cloudinary: ошибка ' + resp.status);
    const data = await resp.json();
    const url = data.secure_url;
    if (!url) throw new Error('Cloudinary не вернул ссылку');
    await S.updateDoc(S.doc(db, 'users', profile.uid), { photo: url });
    profile.photo = url;
    emitUser();
  }

  /* presence: «пульс» раз в 60 сек + текущая комната */
  function startHeartbeat() {
    stopHeartbeat();
    const beat = () => {
      if (profile) {
        S.updateDoc(S.doc(db, 'users', profile.uid), { lastSeen: S.serverTimestamp(), room: currentRoom }).catch(() => {});
      }
    };
    beat();
    hb = setInterval(beat, 60000);
  }
  function stopHeartbeat() { if (hb) { clearInterval(hb); hb = null; } }

  function setRoom(code) {
    currentRoom = code || null;
    if (profile && db) {
      S.updateDoc(S.doc(db, 'users', profile.uid), { room: currentRoom }).catch(() => {});
    }
  }

  function get() { return profile; }

  return { available, init, signIn, signOutUser, setName, setAvatarFile, setRoom, get };
})();
