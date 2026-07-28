# Пошаговый гайд: настройка Firebase для игры «101»

Это твоя часть работы (~10–15 минут, всё бесплатно). После неё пришлёшь мне конфиг — и я подключу его в игру. Ничего страшного, если сделаешь заранее: пока код не готов, проект просто будет ждать.

## Шаг 1. Создать проект

1. Открой **console.firebase.google.com** и войди в свой Google-аккаунт.
2. Нажми **Create a project** (Создать проект).
3. Имя проекта: `durak101` (или любое) → **Continue**.
4. Google Analytics — **выключи** (переключатель Enable Google Analytics → off) → **Create project**.
5. Дождись «Your new project is ready» → **Continue**.

## Шаг 2. Добавить веб-приложение и получить конфиг

1. На главной странице проекта нажми значок **`</>`** (Web).
2. App nickname: `101` → галочку **Firebase Hosting НЕ ставить** → **Register app**.
3. На экране появится код с объектом `firebaseConfig` — вот такой:

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "durak101.firebaseapp.com",
  projectId: "durak101",
  storageBucket: "durak101.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abc..."
};
```

4. **Скопируй его целиком и сохрани** (пришли мне в чат — это не секретные данные, они всё равно видны в коде любой веб-игры; безопасность обеспечивают правила из шагов 4–5).
5. Нажми **Continue to console**.

## Шаг 3. Включить вход через Google

1. Слева в меню: **Build → Authentication** → **Get started**.
2. Вкладка **Sign-in method** → в списке провайдеров выбери **Google** → переключатель **Enable**.
3. В поле *Support email* выбери свою почту → **Save**.
4. Вкладка **Settings** → раздел **Authorized domains** → **Add domain** → введи `nov1ero.github.io` → **Add**. (`localhost` уже есть в списке — он нужен для проверок.)

## Шаг 4. Создать базу Firestore и вставить правила

1. **Build → Firestore Database** → **Create database**.
2. Location: выбери `eur3 (europe-west)` или ближайший к твоим игрокам регион → **Next**.
3. Режим: **Start in production mode** → **Create** (или **Enable**).
4. Открой вкладку **Rules**, удали всё и вставь это, затем **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    function signedIn() { return request.auth != null; }

    // профили: читают все вошедшие, пишет только владелец
    match /users/{uid} {
      allow read: if signedIn();
      allow write: if signedIn() && request.auth.uid == uid;
    }

    // коды друзей: обратный указатель код -> uid
    match /friendCodes/{code} {
      allow read: if signedIn();
      allow create: if signedIn() && request.resource.data.uid == request.auth.uid;
    }

    // дружбы: документ могут создать/удалить только участники пары
    match /friendships/{id} {
      allow read: if signedIn();
      allow create: if signedIn()
        && (request.resource.data.a == request.auth.uid || request.resource.data.b == request.auth.uid);
      allow delete: if signedIn()
        && (resource.data.a == request.auth.uid || resource.data.b == request.auth.uid);
    }

    // приглашения в игру
    match /invites/{id} {
      allow read: if signedIn()
        && (resource.data.to == request.auth.uid || resource.data.from == request.auth.uid);
      allow create: if signedIn() && request.resource.data.from == request.auth.uid;
      allow delete: if signedIn()
        && (resource.data.to == request.auth.uid || resource.data.from == request.auth.uid);
    }

    // реестр открытых лобби (для списка всех лобби)
    match /rooms/{code} {
      allow read: if signedIn();
      allow create: if signedIn() && request.resource.data.host == request.auth.uid;
      allow update, delete: if signedIn() && resource.data.host == request.auth.uid;
    }
  }
}
```

## Шаг 5. Cloudinary — хранилище фото-аватарок (вместо Firebase Storage)

Firebase Storage на новых проектах требует платный тариф, поэтому фото храним в Cloudinary — он бесплатный и карту не просит. Аватарка из Google-аккаунта работает и без этого шага; Cloudinary нужен только для загрузки своих фото.

1. Зарегистрируйся на **cloudinary.com** (Sign up for free, можно тем же Google-аккаунтом).
2. После входа открой **Dashboard** (или Settings → Account) и найди **Cloud name** — короткое имя вроде `dab1c2d3e`. Запиши его.
3. Открой **Settings (шестерёнка) → Upload → Upload presets** → **Add upload preset**:
   - **Signing Mode**: выбери **Unsigned** (это главное);
   - **Folder**: `avatars`;
   - в разделе Incoming Transformation (если есть) можно задать ограничение `w_128,h_128,c_fill` — необязательно, игра и так сжимает фото до 128×128;
   - **Save**. Запиши **имя пресета** (вроде `ml_default` или своё, например `durak101`).
4. Пришли мне **Cloud name** и **имя пресета** — я вставлю их в игру (это не секреты, как и firebaseConfig).

## Шаг 6. Готово — что дальше

Пришли мне в чат: `firebaseConfig` из шага 2 (уже прислал ✓) и Cloud name + имя пресета из шага 5. Дальше всё делаю я.

## Частые проблемы

- **«Этот домен не авторизован» при входе** — забыл шаг 3.4 (Authorized domains → nov1ero.github.io).
- **Вход не открывается на телефоне в установленном приложении (PWA)** — мы используем redirect-вход, но если вдруг не сработает, открой игру в обычном Safari/Chrome, войди, потом возвращайся в приложение.
- **Missing or insufficient permissions** — правила из шага 4 не опубликованы (кнопка Publish) или вставлены не полностью.
