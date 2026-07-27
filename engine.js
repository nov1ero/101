/* ============================================================
 *  «101» — игровой движок (чистая логика, без UI)
 *  Работает и в браузере, и в Node.js (для тестов).
 *  Архитектура action-based — готова к онлайн-мультиплееру.
 * ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Engine101 = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SUITS = ['♠', '♣', '♥', '♦'];
  const RANKS = ['6', '7', '8', '9', '10', 'В', 'Д', 'К', 'Т'];
  const POINTS = { '6': 6, '7': 7, '8': 8, '9': 0, '10': 10, 'В': 2, 'Д': 3, 'К': 4, 'Т': 11 };
  const ELIMINATION_LIMIT = 101;

  /* ---------- вспомогательные ---------- */

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeDeck() {
    const deck = [];
    let id = 0;
    for (const s of SUITS) for (const r of RANKS) deck.push({ id: id++, suit: s, rank: r });
    return deck;
  }

  function shuffle(arr, rnd) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function cardPoints(card) { return POINTS[card.rank]; }
  function handPoints(hand) { return hand.reduce((s, c) => s + cardPoints(c), 0); }
  function cardName(card) { return card.rank + card.suit; }

  /* ---------- создание игры ---------- */

  /**
   * players: [{name, isBot}]
   */
  function createGame(players, seed) {
    if (players.length < 2 || players.length > 5) throw new Error('Игроков должно быть от 2 до 5');
    const state = {
      seed: (seed === undefined ? Math.floor(Math.random() * 2 ** 31) : seed),
      players: players.map((p, i) => ({
        idx: i, name: p.name, isBot: !!p.isBot,
        hand: [], score: 0, eliminated: false,
        roundPoints: 0, // очки, набранные в последнем раунде (для таблицы)
      })),
      deck: [], pile: [],
      turn: -1,
      activeSuit: null,   // масть, действующая сейчас (дама может её сменить)
      activeRank: null,   // ранг верхней карты
      pendingSevens: 0,   // сколько семёрок в стопке (штраф = 2 * n)
      mustCover: false,   // текущий игрок обязан закрыть верхнюю карту
      coverMode: null,    // 'once' (после 6 — одна попытка добора) | 'until' (после 8/9 — добор до упора)
      lastWinCard: null,  // последняя карта победителя раунда — открывает следующий раунд
      pendingWinner: null,   // игрок вышел девяткой — ждём, пока её закроют
      pendingWinCard: null,  // сама победная карта (для следующего раунда)
      drawnThisTurn: false, // игрок уже взял карту на обычном ходу
      phase: 'lobby',     // lobby | playing | chooseSuit | roundEnd | gameEnd
      round: 0,
      roundWinner: null,  // idx победителя последнего раунда
      gameWinner: null,
      dealerStart: null,  // кто ходит первым в раунде
      log: [],            // события для UI/анимаций
    };
    state._rnd = mulberry32(state.seed);
    return state;
  }

  function emit(state, ev) { state.log.push(ev); }

  function alivePlayers(state) { return state.players.filter(p => !p.eliminated); }

  function nextAlive(state, from, step) {
    // step = +1 по часовой, -1 назад
    const n = state.players.length;
    let i = from;
    for (let k = 0; k < n; k++) {
      i = (i + step + n) % n;
      if (!state.players[i].eliminated) return i;
    }
    return from;
  }

  /* ---------- раунд ---------- */

  function startRound(state) {
    state.round++;
    state.deck = shuffle(makeDeck(), state._rnd);
    state.pile = [];
    state.pendingSevens = 0;
    state.mustCover = false;
    state.coverMode = null;
    state.drawnThisTurn = false;
    state.pendingWinner = null;
    state.pendingWinCard = null;
    for (const p of state.players) { p.hand = []; p.roundPoints = 0; }

    // «Владелец» стартовой карты: победитель прошлого раунда,
    // в 1-м раунде — случайный игрок (с него начинается раздача)
    let origin;
    if (state.roundWinner === null) {
      const alive = alivePlayers(state);
      origin = alive[Math.floor(state._rnd() * alive.length)].idx;
    } else {
      origin = state.roundWinner;
    }
    const first = nextAlive(state, origin, +1);
    state.dealerStart = first;

    // Карта победителя прошлого раунда открывает новый — вынимаем её из колоды заранее
    let startCard = null;
    if (state.roundWinner !== null && state.lastWinCard) {
      const i = state.deck.findIndex(c => c.id === state.lastWinCard.id);
      if (i >= 0) startCard = state.deck.splice(i, 1)[0];
    }

    // Раздача по 5, начиная с первого игрока.
    // Владельцу — 4: его пятая карта идёт на стол
    // (в 1-м раунде — последняя разданная, дальше — победная карта прошлого раунда).
    for (let k = 0; k < 5; k++) {
      let i = first;
      do {
        if (!state.players[i].eliminated && !(k === 4 && i === origin)) {
          state.players[i].hand.push(state.deck.pop());
        }
        i = (i + 1) % state.players.length;
      } while (i !== first);
    }

    // последняя разданная карта — на стол
    if (!startCard) startCard = state.deck.pop();
    state.pile.push(startCard);
    state.activeSuit = startCard.suit;
    state.activeRank = startCard.rank;
    state.turn = first;
    state.phase = 'playing';
    emit(state, { type: 'roundStart', round: state.round, first, top: { ...startCard }, fromWinner: origin });

    // модификаторы стартовой карты действуют так, будто владелец только что ей сходил
    switch (startCard.rank) {
      case '7':
        state.pendingSevens = 1;
        emit(state, { type: 'sevens', count: 1 });
        break;
      case '6':
        state.mustCover = true; state.coverMode = 'once'; // закрывает первый игрок
        break;
      case '8':
      case '9':
        state.mustCover = true; state.coverMode = 'until';
        break;
      case 'Т':
        if (alivePlayers(state).length === 2) {
          state.turn = origin; // дополнительный ход владельцу
          emit(state, { type: 'extraTurn', player: origin });
        } else {
          state.turn = nextAlive(state, origin, -1); // шаг назад от владельца
        }
        break;
      // Д — задаёт свою масть; 10/В/К — ничего
    }
    return state;
  }

  /* ---------- проверки ходов ---------- */

  function canPlayCard(state, card) {
    if (state.pendingSevens > 0) return card.rank === '7'; // на стопку семёрок — только семёрка
    // дама кладётся по обычным правилам совпадения, но затем меняет масть
    return card.suit === state.activeSuit || card.rank === state.activeRank;
  }

  function playableIndexes(state, player) {
    const res = [];
    player.hand.forEach((c, i) => { if (canPlayCard(state, c)) res.push(i); });
    return res;
  }

  function totalDrawableCards(state) {
    return state.deck.length + Math.max(0, state.pile.length - 1);
  }

  /**
   * Легальные действия текущего игрока.
   * [{type:'play', cardIndex}, {type:'draw'}, {type:'pass'}, {type:'chooseSuit', suit}]
   */
  function getLegalActions(state) {
    if (state.phase === 'chooseSuit') {
      return SUITS.map(s => ({ type: 'chooseSuit', suit: s }));
    }
    if (state.phase !== 'playing') return [];
    const player = state.players[state.turn];
    const plays = playableIndexes(state, player).map(i => ({ type: 'play', cardIndex: i }));

    const actions = [...plays];
    if (state.pendingSevens > 0) {
      actions.push({ type: 'draw' }); // взять штраф (можно и добровольно, имея семёрку)
    } else if (state.mustCover) {
      if (plays.length === 0) {
        actions.push(totalDrawableCards(state) > 0 ? { type: 'draw' } : { type: 'pass' });
      }
    } else {
      // брать карту можно всегда (даже если есть чем ходить), но один раз за ход
      if (!state.drawnThisTurn && totalDrawableCards(state) > 0) {
        actions.push({ type: 'draw' });
      }
      if (state.drawnThisTurn || (plays.length === 0 && totalDrawableCards(state) === 0)) {
        actions.push({ type: 'pass' });
      }
    }
    return actions;
  }

  /* ---------- взятие карт ---------- */

  function reshuffleIfNeeded(state) {
    if (state.deck.length === 0 && state.pile.length > 1) {
      const top = state.pile.pop();
      state.deck = shuffle(state.pile, state._rnd);
      state.pile = [top];
      emit(state, { type: 'reshuffle', count: state.deck.length });
    }
  }

  function drawOne(state, playerIdx) {
    reshuffleIfNeeded(state);
    if (state.deck.length === 0) return null;
    const card = state.deck.pop();
    state.players[playerIdx].hand.push(card);
    emit(state, { type: 'draw', player: playerIdx, card: { ...card } });
    return card;
  }

  /* ---------- применение действий ---------- */

  function advanceTurn(state, step) {
    state.turn = nextAlive(state, state.turn, step === undefined ? +1 : step);
    state.drawnThisTurn = false;
  }

  function applyAction(state, action) {
    if (state.phase === 'chooseSuit') {
      if (action.type !== 'chooseSuit') throw new Error('Нужно выбрать масть');
      state.activeSuit = action.suit;
      emit(state, { type: 'suitChosen', player: state.turn, suit: action.suit });
      state.phase = 'playing';
      advanceTurn(state);
      return state;
    }
    if (state.phase !== 'playing') throw new Error('Раунд не идёт');

    const player = state.players[state.turn];

    if (action.type === 'play') {
      const card = player.hand[action.cardIndex];
      if (!card || !canPlayCard(state, card)) throw new Error('Этой картой ходить нельзя');
      player.hand.splice(action.cardIndex, 1);
      state.pile.push(card);
      state.activeSuit = card.suit;
      state.activeRank = card.rank;
      state.mustCover = false;
      state.coverMode = null;
      state.drawnThisTurn = false;
      emit(state, { type: 'play', player: player.idx, card: { ...card } });

      // победная девятка закрыта — раунд завершается (эффекты закрывшей карты не действуют)
      if (state.pendingWinner !== null) return endRound(state, state.pendingWinner);

      // --- эффекты карт ---
      switch (card.rank) {
        case '6':
          // Игрок обязан сам закрыть её; нечем — берёт из колоды ОДНУ карту
          state.mustCover = true;
          state.coverMode = 'once';
          return state; // ход НЕ передаётся

        case '8':
          // Игрок обязан сам закрыть её, добирая из колоды до упора
          state.mustCover = true;
          state.coverMode = 'until';
          return state;

        case '7':
          state.pendingSevens++;
          emit(state, { type: 'sevens', count: state.pendingSevens });
          break;

        case '9':
          // следующий игрок обязан закрыть девятку, добирая до упора.
          // Если это была последняя карта — раунд НЕ кончается, пока девятку не закроют
          if (player.hand.length === 0) {
            state.pendingWinner = player.idx;
            state.pendingWinCard = { ...card };
          }
          advanceTurn(state);
          state.mustCover = true;
          state.coverMode = 'until';
          return state;

        case 'Д':
          // раунд закрыт дамой — всем проигравшим +40
          if (player.hand.length === 0) return endRound(state, player.idx, true);
          state.phase = 'chooseSuit';
          return state; // ждём выбора масти тем же игроком

        case 'Т':
          if (player.hand.length === 0) return endRound(state, player.idx);
          if (alivePlayers(state).length === 2) {
            // при двух игроках туз — дополнительный ход того же игрока
            state.drawnThisTurn = false;
            emit(state, { type: 'extraTurn', player: player.idx });
            return state; // ход остаётся у игрока (обычный ход: нечем — берёт 1 карту)
          }
          // шаг назад: ход переходит игроку ПЕРЕД текущим, дальше — по часовой
          advanceTurn(state, -1);
          return state;
      }

      // 7 / 10 / В / К — победа проверяется здесь
      if (player.hand.length === 0) return endRound(state, player.idx);
      advanceTurn(state);
      return state;
    }

    if (action.type === 'draw') {
      if (state.pendingSevens > 0) {
        // штраф за семёрки: 2 * n карт, ход пропускается
        const n = state.pendingSevens * 2;
        for (let i = 0; i < n; i++) drawOne(state, player.idx);
        emit(state, { type: 'sevensPenalty', player: player.idx, count: n });
        state.pendingSevens = 0;
        advanceTurn(state);
        return state;
      }
      if (state.mustCover) {
        // добор по ОДНОЙ карте за нажатие
        const c = drawOne(state, player.idx);
        if (!c) {
          // карт больше нет нигде — вынужденно пропускаем (пустая рука = победа)
          state.mustCover = false;
          state.coverMode = null;
          emit(state, { type: 'coverFail', player: player.idx });
          if (state.pendingWinner !== null) return endRound(state, state.pendingWinner);
          if (player.hand.length === 0) return endRound(state, player.idx);
          advanceTurn(state);
          return state;
        }
        if (state.coverMode === 'once' && playableIndexes(state, player).length === 0) {
          // после шестёрки — только одна попытка добора: не закрыл — ход переходит
          state.mustCover = false;
          state.coverMode = null;
          emit(state, { type: 'coverFail', player: player.idx });
          advanceTurn(state);
        }
        // coverMode 'until': остаёмся, игрок добирает дальше, пока не сможет закрыть
        return state;
      }
      // обычный ход: берём одну карту (можно и добровольно, имея чем ходить)
      if (state.drawnThisTurn) throw new Error('Карта уже взята в этот ход');
      const c = drawOne(state, player.idx);
      state.drawnThisTurn = true;
      if (!c || !canPlayCard(state, c)) {
        // взятая карта не подошла — ход переходит
        advanceTurn(state);
      }
      // если подошла — игрок может сыграть её (или спасовать)
      return state;
    }

    if (action.type === 'pass') {
      const wasCover = state.mustCover;
      state.mustCover = false;
      state.coverMode = null;
      if (state.pendingWinner !== null) return endRound(state, state.pendingWinner);
      // сыграл последнюю 6/8, а закрыть нечем и взять неоткуда — победа
      if (wasCover && player.hand.length === 0) return endRound(state, player.idx);
      advanceTurn(state);
      return state;
    }

    throw new Error('Неизвестное действие: ' + action.type);
  }

  /* ---------- конец раунда ---------- */

  function endRound(state, winnerIdx, queenFinish) {
    // Если последняя карта была семёркой — следующий игрок берёт штраф до подсчёта
    if (state.pendingSevens > 0) {
      const victim = nextAlive(state, winnerIdx, +1);
      const n = state.pendingSevens * 2;
      for (let i = 0; i < n; i++) drawOne(state, victim);
      emit(state, { type: 'sevensPenalty', player: victim, count: n });
      state.pendingSevens = 0;
    }

    state.roundWinner = winnerIdx;
    // последняя карта победителя откроет следующий раунд (со своими модификаторами);
    // если победную девятку закрывали — берём именно её, а не закрывшую карту
    state.lastWinCard = state.pendingWinCard || { ...state.pile[state.pile.length - 1] };
    state.pendingWinner = null;
    state.pendingWinCard = null;
    state.mustCover = false;
    state.coverMode = null;
    const results = [];
    for (const p of state.players) {
      if (p.eliminated) continue;
      // раунд закрыт дамой — всем проигравшим +40
      p.roundPoints = handPoints(p.hand) + (queenFinish && p.idx !== winnerIdx ? 40 : 0);
      p.score += p.roundPoints;
      if (p.score === ELIMINATION_LIMIT) {
        p.score = 0; // ровно 101 — очки сгорают
        emit(state, { type: 'scoreReset', player: p.idx });
      } else if (p.score > ELIMINATION_LIMIT) {
        p.eliminated = true;
        emit(state, { type: 'eliminated', player: p.idx, score: p.score });
      }
      results.push({ player: p.idx, roundPoints: p.roundPoints, score: p.score, eliminated: p.eliminated });
    }
    emit(state, { type: 'roundEnd', winner: winnerIdx, results, queenFinish: !!queenFinish });

    const alive = alivePlayers(state);
    if (alive.length <= 1) {
      state.phase = 'gameEnd';
      state.gameWinner = alive.length === 1 ? alive[0].idx : winnerIdx;
      emit(state, { type: 'gameEnd', winner: state.gameWinner });
    } else {
      state.phase = 'roundEnd';
    }
    return state;
  }

  /* ---------- бот ---------- */

  function botChooseAction(state) {
    const actions = getLegalActions(state);
    if (state.phase === 'chooseSuit') {
      // выбираем масть, которой в руке больше всего
      const player = state.players[state.turn];
      const count = {};
      for (const s of SUITS) count[s] = 0;
      for (const c of player.hand) count[c.suit]++;
      let best = SUITS[0];
      for (const s of SUITS) if (count[s] > count[best]) best = s;
      return { type: 'chooseSuit', suit: best };
    }
    const player = state.players[state.turn];
    const plays = actions.filter(a => a.type === 'play');
    if (plays.length > 0) {
      // приоритет: сбросить самые «дорогие» карты, дам придержать
      let best = plays[0], bestScore = -1;
      for (const a of plays) {
        const c = player.hand[a.cardIndex];
        let v = cardPoints(c);
        if (c.rank === 'Д') v -= 5;           // даму бережём напоследок
        if (c.rank === '7' && state.pendingSevens > 0) v += 20; // отбиваем штраф семёркой
        if (c.rank === '6' || c.rank === '8') {
          // класть 6/8 только если есть чем закрыть
          const rest = player.hand.filter((_, i) => i !== a.cardIndex);
          const canCover = rest.some(x => x.suit === c.suit || x.rank === c.rank);
          if (!canCover) v -= 100;
        }
        if (v > bestScore) { bestScore = v; best = a; }
      }
      return best;
    }
    const draw = actions.find(a => a.type === 'draw');
    if (draw) return draw;
    return actions.find(a => a.type === 'pass') || actions[0];
  }

  return {
    SUITS, RANKS, POINTS, ELIMINATION_LIMIT,
    createGame, startRound, getLegalActions, applyAction,
    canPlayCard, playableIndexes, botChooseAction,
    cardPoints, handPoints, cardName, alivePlayers, totalDrawableCards,
  };
});
