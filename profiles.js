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
  // друзья и приглашения
  let subs = [];           // отписки от основных слушателей
  let friendSubs = {};     // uid друга -> отписка от его users-документа
  let friendsData = {};    // uid -> {uid, name, photo, online, room}
  let friendSet = new Set();

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
      if (!u) { profile = null; stopHeartbeat(); stopWatchers(); emitUser(); return; }
      try {
        profile = await ensureUserDoc(u);
      } catch (e) {
        // профиль в БД недоступен (правила/сеть) — работаем с данными Google
        profile = { uid: u.uid, name: u.displayName || 'Игрок', photo: u.photoURL || null, code: null };
        status('Профиль не загружен: ' + (e.code || e.message || e));
      }
      startHeartbeat();
      startWatchers();
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

  /* ---------- друзья и приглашения ---------- */
  function stopWatchers() {
    subs.forEach(u => { try { u(); } catch (e) {} });
    subs = [];
    Object.values(friendSubs).forEach(u => { try { u(); } catch (e) {} });
    friendSubs = {}; friendsData = {}; friendSet = new Set();
    if (hooks.onFriends) hooks.onFriends([]);
    if (hooks.onInvites) hooks.onInvites([]);
  }

  function emitFriends() { if (hooks.onFriends) hooks.onFriends(Object.values(friendsData)); }

  function startWatchers() {
    stopWatchers();
    if (!profile) return;
    const uid = profile.uid;

    const handleShips = (snap) => {
      snap.docChanges().forEach(ch => {
        const d = ch.doc.data();
        const fuid = d.a === uid ? d.b : d.a;
        if (ch.type === 'removed') {
          friendSet.delete(fuid);
          if (friendSubs[fuid]) { try { friendSubs[fuid](); } catch (e) {} delete friendSubs[fuid]; }
          delete friendsData[fuid];
        } else if (!friendSet.has(fuid)) {
          friendSet.add(fuid);
          // живой профиль каждого друга: имя, фото, онлайн, комната
          friendSubs[fuid] = S.onSnapshot(S.doc(db, 'users', fuid), (us) => {
            const u = us.data() || {};
            const last = u.lastSeen && u.lastSeen.toMillis ? u.lastSeen.toMillis() : 0;
            friendsData[fuid] = {
              uid: fuid,
              name: u.name || 'Игрок',
              photo: u.photo || null,
              room: u.room || null,
              online: (Date.now() - last) < 150000, // «пульс» был меньше 2.5 мин назад
            };
            emitFriends();
          }, () => {});
        }
      });
      emitFriends();
    };
    subs.push(S.onSnapshot(S.query(S.collection(db, 'friendships'), S.where('a', '==', uid)), handleShips, () => {}));
    subs.push(S.onSnapshot(S.query(S.collection(db, 'friendships'), S.where('b', '==', uid)), handleShips, () => {}));

    // входящие приглашения (протухшие тихо удаляем)
    subs.push(S.onSnapshot(S.query(S.collection(db, 'invites'), S.where('to', '==', uid)), (snap) => {
      const now = Date.now();
      const list = [];
      snap.forEach(d => {
        const v = d.data();
        const ts = v.ts && v.ts.toMillis ? v.ts.toMillis() : now;
        if (now - ts < 120000) {
          list.push({ id: d.id, from: v.from, fromName: String(v.fromName || 'Друг').slice(0, 14), room: String(v.room || '').slice(0, 8) });
        } else {
          S.deleteDoc(S.doc(db, 'invites', d.id)).catch(() => {});
        }
      });
      if (hooks.onInvites) hooks.onInvites(list);
    }, () => {}));
  }

  async function addFriendByCode(code) {
    if (!profile) throw new Error('нет профиля');
    code = String(code).trim().toUpperCase();
    if (code.length !== 6) throw new Error('код состоит из 6 символов');
    if (code === profile.code) throw new Error('это твой собственный код');
    const snap = await S.getDoc(S.doc(db, 'friendCodes', code));
    if (!snap.exists()) throw new Error('игрок с таким кодом не найден');
    const fuid = snap.data().uid;
    if (fuid === profile.uid) throw new Error('это твой собственный код');
    const [a, b] = [profile.uid, fuid].sort();
    await S.setDoc(S.doc(db, 'friendships', a + '_' + b), { a, b });
  }

  async function removeFriend(fuid) {
    if (!profile) return;
    const [a, b] = [profile.uid, fuid].sort();
    await S.deleteDoc(S.doc(db, 'friendships', a + '_' + b));
  }

  async function sendInvite(toUid, room) {
    if (!profile) throw new Error('нет профиля');
    await S.addDoc(S.collection(db, 'invites'), {
      to: toUid, from: profile.uid, fromName: profile.name, room, ts: S.serverTimestamp(),
    });
  }

  async function deleteInvite(id) {
    try { await S.deleteDoc(S.doc(db, 'invites', id)); } catch (e) {}
  }

  return {
    available, init, signIn, signOutUser, setName, setAvatarFile, setRoom, get,
    addFriendByCode, removeFriend, sendInvite, deleteInvite,
  };
})();
