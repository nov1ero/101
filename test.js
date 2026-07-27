/* Автотесты движка «101»: юнит-проверки правил + массовая симуляция игр ботами */
const E = require('./engine.js');

let passed = 0, failed = 0;
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; console.error('FAIL:', msg); }
}

/* ---------- 1. Колода ---------- */
{
  const s = E.createGame([{ name: 'A' }, { name: 'B' }], 1);
  E.startRound(s);
  const all = [...s.deck, ...s.pile, ...s.players[0].hand, ...s.players[1].hand];
  assert(all.length === 36, 'в игре 36 карт');
  assert(new Set(all.map(c => c.id)).size === 36, 'все карты уникальны');
  assert(s.players[0].hand.length === 5 && s.players[1].hand.length === 5, 'раздано по 5 карт');
  assert(s.pile.length === 1, 'одна карта на столе');
  assert(s.deck.length === 36 - 10 - 1, 'остаток в колоде верный');
}

/* ---------- 2. Очки ---------- */
{
  const pts = { '6': 6, '7': 7, '8': 8, '9': 0, '10': 10, 'В': 2, 'Д': 3, 'К': 4, 'Т': 11 };
  for (const r of E.RANKS) assert(E.POINTS[r] === pts[r], 'очки за ' + r);
}

/* ---------- 3. Правила совпадения ---------- */
{
  const s = E.createGame([{ name: 'A' }, { name: 'B' }], 2);
  E.startRound(s);
  s.activeSuit = '♠'; s.activeRank = '10'; s.pendingSevens = 0;
  assert(E.canPlayCard(s, { suit: '♠', rank: 'К' }), 'совпадение по масти');
  assert(E.canPlayCard(s, { suit: '♥', rank: '10' }), 'совпадение по рангу');
  assert(!E.canPlayCard(s, { suit: '♥', rank: 'К' }), 'не совпало — нельзя');
  assert(!E.canPlayCard(s, { suit: '♥', rank: 'Д' }), 'дама чужой масти — нельзя');
  assert(E.canPlayCard(s, { suit: '♠', rank: 'Д' }), 'дама совпадающей масти — можно');
  s.pendingSevens = 1;
  assert(E.canPlayCard(s, { suit: '♥', rank: '7' }), 'на семёрку — семёрка');
  assert(!E.canPlayCard(s, { suit: '♠', rank: 'Т' }), 'на стопку семёрок другой картой нельзя');
}

/* helper: собрать управляемую позицию */
function rig(s, { hand0, hand1, hand2, top, turn }) {
  const used = new Set();
  const take = spec => {
    const c = [...s.deck, ...s.pile, ...s.players.flatMap(p => p.hand)]
      .find(c => c.suit === spec[1] && c.rank === spec[0] && !used.has(c.id));
    used.add(c.id);
    return c;
  };
  const h0 = hand0.map(take), h1 = hand1.map(take), h2 = hand2 ? hand2.map(take) : null;
  const t = take(top);
  const rest = [...s.deck, ...s.pile, ...s.players.flatMap(p => p.hand)].filter(c => !used.has(c.id));
  s.players[0].hand = h0; s.players[1].hand = h1;
  if (h2) s.players[2].hand = h2;
  s.pile = [t]; s.activeSuit = t.suit; s.activeRank = t.rank;
  s.deck = rest; s.turn = turn; s.pendingSevens = 0; s.mustCover = false; s.drawnThisTurn = false;
  s.phase = 'playing';
}

/* ---------- 4. Семёрки стакаются, штраф растёт до 8 ---------- */
{
  const s = E.createGame([{ name: 'A' }, { name: 'B' }, { name: 'C' }], 3);
  E.startRound(s);
  rig(s, {
    hand0: [['7', '♠'], ['К', '♠']],
    hand1: [['7', '♥'], ['К', '♥']],
    hand2: [['7', '♦'], ['7', '♣'], ['К', '♦'], ['К', '♣'], ['В', '♦']],
    top: ['10', '♠'], turn: 0,
  });
  E.applyAction(s, { type: 'play', cardIndex: 0 }); // A: 7♠
  assert(s.pendingSevens === 1 && s.turn === 1, 'после 7 ход дальше, штраф 2');
  E.applyAction(s, { type: 'play', cardIndex: 0 }); // B: 7♥
  assert(s.pendingSevens === 2 && s.turn === 2, 'семёрки стакаются');
  E.applyAction(s, { type: 'play', cardIndex: 0 }); // C: 7♦
  assert(s.pendingSevens === 3 && s.turn === 0, 'три семёрки в стопке, ход к A');
  const acts = E.getLegalActions(s);
  assert(acts.length === 1 && acts[0].type === 'draw', 'у A нет семёрки — только взять штраф (6 карт)');
  const before = s.players[0].hand.length;
  E.applyAction(s, { type: 'draw' });
  assert(s.players[0].hand.length === before + 6, 'штраф 6 карт за 3 семёрки');
}
{
  const s = E.createGame([{ name: 'A' }, { name: 'B' }], 4);
  E.startRound(s);
  rig(s, {
    hand0: [['7', '♠'], ['7', '♥'], ['К', '♠']],
    hand1: [['К', '♥'], ['В', '♥']],
    top: ['10', '♠'], turn: 0,
  });
  E.applyAction(s, { type: 'play', cardIndex: 0 }); // 7♠
  const acts = E.getLegalActions(s);
  assert(acts.every(a => a.type === 'draw') && acts.length === 1, 'без семёрки — только взять штраф');
  const before = s.players[1].hand.length;
  E.applyAction(s, { type: 'draw' });
  assert(s.players[1].hand.length === before + 2, 'штраф +2 карты');
  assert(s.pendingSevens === 0, 'штраф сброшен');
  assert(s.turn === 0, 'после взятия штрафа ход пропущен');
}
{
  // 4 семёрки подряд → 8 карт штрафа
  const s = E.createGame([{ name: 'A' }, { name: 'B' }], 5);
  E.startRound(s);
  rig(s, {
    hand0: [['7', '♠'], ['7', '♥'], ['К', '♠']],
    hand1: [['7', '♦'], ['7', '♣'], ['К', '♥']],
    top: ['10', '♠'], turn: 0,
  });
  E.applyAction(s, { type: 'play', cardIndex: 0 });
  E.applyAction(s, { type: 'play', cardIndex: 0 });
  E.applyAction(s, { type: 'play', cardIndex: 0 });
  E.applyAction(s, { type: 'play', cardIndex: 0 });
  assert(s.pendingSevens === 4, '4 семёрки в стопке');
  const before = s.players[0].hand.length;
  E.applyAction(s, { type: 'draw' });
  assert(s.players[0].hand.length === before + 8, 'штраф 8 карт');
}

/* ---------- 5. Шестёрку/восьмёрку игрок закрывает сам ---------- */
{
  const s = E.createGame([{ name: 'A' }, { name: 'B' }], 6);
  E.startRound(s);
  rig(s, {
    hand0: [['6', '♠'], ['К', '♠'], ['В', '♥']],
    hand1: [['К', '♥'], ['В', '♦']],
    top: ['10', '♠'], turn: 0,
  });
  E.applyAction(s, { type: 'play', cardIndex: 0 }); // 6♠
  assert(s.turn === 0 && s.mustCover, 'после 6 ход остаётся, надо закрыть');
  const acts = E.getLegalActions(s);
  assert(acts.length === 1 && acts[0].type === 'play', 'закрыть можно только подходящей картой');
  E.applyAction(s, acts[0]); // К♠ закрывает
  assert(s.turn === 1 && !s.mustCover, 'после закрытия ход переходит');
}
/* положить конкретную карту наверх колоды (следующая к взятию) */
function deckTop(s, spec) {
  const i = s.deck.findIndex(c => c.rank === spec[0] && c.suit === spec[1]);
  const [c] = s.deck.splice(i, 1);
  s.deck.push(c);
}
{
  // нечем закрыть шестёрку — берём ОДНУ карту; не закрыла — ход переходит
  const s = E.createGame([{ name: 'A' }, { name: 'B' }], 7);
  E.startRound(s);
  rig(s, {
    hand0: [['6', '♠'], ['В', '♥']],
    hand1: [['К', '♥'], ['В', '♦']],
    top: ['10', '♠'], turn: 0,
  });
  E.applyAction(s, { type: 'play', cardIndex: 0 }); // 6♠, в руке только В♥ — не закрывает
  assert(s.mustCover && s.coverMode === 'once' && s.turn === 0, 'должен закрыть, одна попытка');
  deckTop(s, ['К', '♥']); // не закрывает 6♠
  const before = s.players[0].hand.length;
  E.applyAction(s, { type: 'draw' });
  assert(s.players[0].hand.length === before + 1, 'взял ровно одну');
  assert(s.turn === 1 && !s.mustCover, 'не закрыл — ход перешёл');
}
{
  // шестёрка: взятая карта закрыла — играем её
  const s = E.createGame([{ name: 'A' }, { name: 'B' }], 7);
  E.startRound(s);
  rig(s, {
    hand0: [['6', '♠'], ['В', '♥']],
    hand1: [['К', '♥'], ['В', '♦']],
    top: ['10', '♠'], turn: 0,
  });
  E.applyAction(s, { type: 'play', cardIndex: 0 });
  deckTop(s, ['К', '♠']); // закрывает 6♠
  E.applyAction(s, { type: 'draw' });
  assert(s.turn === 0 && s.mustCover, 'взятая закрывает — ход остаётся, надо сыграть');
  const acts = E.getLegalActions(s);
  assert(acts.length === 1 && acts[0].type === 'play', 'только закрытие');
  E.applyAction(s, acts[0]);
  assert(s.turn === 1, 'закрыл — ход перешёл');
}
{
  // восьмёрку добираем ДО УПОРА, по одной за нажатие
  const s = E.createGame([{ name: 'A' }, { name: 'B' }], 7);
  E.startRound(s);
  rig(s, {
    hand0: [['8', '♠'], ['В', '♥']],
    hand1: [['К', '♥'], ['В', '♦']],
    top: ['10', '♠'], turn: 0,
  });
  E.applyAction(s, { type: 'play', cardIndex: 0 }); // 8♠
  assert(s.mustCover && s.coverMode === 'until' && s.turn === 0, 'восьмёрка: закрывать до упора');
  deckTop(s, ['К', '♥']); // не закрывает
  E.applyAction(s, { type: 'draw' });
  assert(s.turn === 0 && s.mustCover, 'не закрыл — но ход НЕ переходит (до упора)');
  deckTop(s, ['В', '♦']); // снова не закрывает
  E.applyAction(s, { type: 'draw' });
  assert(s.turn === 0 && s.mustCover, 'всё ещё добирает');
  deckTop(s, ['9', '♠']); // закрывает
  E.applyAction(s, { type: 'draw' });
  const acts = E.getLegalActions(s);
  assert(acts.length === 1 && acts[0].type === 'play', 'добрал до закрытия — обязан сыграть');
}

/* ---------- 6. Девятку закрывает следующий игрок ---------- */
{
  const s = E.createGame([{ name: 'A' }, { name: 'B' }], 8);
  E.startRound(s);
  rig(s, {
    hand0: [['9', '♠'], ['В', '♥']],
    hand1: [['К', '♠'], ['В', '♦']],
    top: ['10', '♠'], turn: 0,
  });
  E.applyAction(s, { type: 'play', cardIndex: 0 }); // 9♠
  assert(s.turn === 1 && s.mustCover, 'девятку закрывает следующий');
  const acts = E.getLegalActions(s);
  assert(acts.length === 1 && acts[0].type === 'play', 'только закрытие');
}
{
  // у следующего нечем — добирает по одной, до упора
  const s = E.createGame([{ name: 'A' }, { name: 'B' }], 9);
  E.startRound(s);
  rig(s, {
    hand0: [['9', '♠'], ['В', '♥']],
    hand1: [['В', '♦'], ['10', '♥']],
    top: ['10', '♠'], turn: 0,
  });
  E.applyAction(s, { type: 'play', cardIndex: 0 }); // 9♠
  assert(s.turn === 1 && s.mustCover && s.coverMode === 'until', 'следующий закрывает до упора');
  assert(s.players[1].hand.length === 2, 'автоматически ничего не добрано');
  deckTop(s, ['К', '♥']); // не закрывает 9♠
  E.applyAction(s, { type: 'draw' });
  assert(s.turn === 1 && s.players[1].hand.length === 3, 'взял одну, остался закрывать');
  deckTop(s, ['К', '♠']); // закрывает
  E.applyAction(s, { type: 'draw' });
  assert(E.playableIndexes(s, s.players[1]).length > 0 && s.turn === 1, 'добрал до подходящей');
}

/* ---------- 7. Дама меняет масть ---------- */
{
  const s = E.createGame([{ name: 'A' }, { name: 'B' }], 10);
  E.startRound(s);
  rig(s, {
    hand0: [['Д', '♠'], ['В', '♥']],
    hand1: [['К', '♥'], ['В', '♦']],
    top: ['10', '♠'], turn: 0,
  });
  E.applyAction(s, { type: 'play', cardIndex: 0 }); // Д♠ на 10♠ (по масти)
  assert(s.phase === 'chooseSuit', 'ожидание выбора масти');
  E.applyAction(s, { type: 'chooseSuit', suit: '♥' });
  assert(s.activeSuit === '♥', 'масть сменена на ♥');
  assert(s.turn === 1, 'ход перешёл');
  assert(E.canPlayCard(s, { suit: '♥', rank: '10' }), 'теперь играются червы');
}

/* ---------- 8. Туз — шаг назад ---------- */
{
  const s = E.createGame([{ name: 'A' }, { name: 'B' }, { name: 'C' }], 11);
  E.startRound(s);
  rig(s, {
    hand0: [['Т', '♠'], ['В', '♥']],
    hand1: [['К', '♥'], ['В', '♦']],
    hand2: [['К', '♦'], ['В', '♣'], ['10', '♥'], ['9', '♣'], ['8', '♥']],
    top: ['10', '♠'], turn: 1,
  });
  s.turn = 1;
  // B ходит... подстроим: у B карта совпадающая? К♥ на 10♠ нет. Проще: ход туза от A.
  s.turn = 0;
  E.applyAction(s, { type: 'play', cardIndex: 0 }); // A играет Т♠
  assert(s.turn === 2, 'туз: ход уходит назад (к игроку C)');
}

/* ---------- 9. Конец раунда, очки, ровно 101, вылет ---------- */
{
  const s = E.createGame([{ name: 'A' }, { name: 'B' }, { name: 'C' }], 12);
  E.startRound(s);
  rig(s, {
    hand0: [['К', '♠']],
    hand1: [['Т', '♥'], ['Т', '♦']],
    hand2: [['9', '♥'], ['В', '♦'], ['Д', '♦'], ['К', '♦'], ['10', '♦']],
    top: ['10', '♠'], turn: 0,
  });
  s.players[1].score = 50;
  s.players[2].score = 82; // 82 + 19 = 101 → сброс
  E.applyAction(s, { type: 'play', cardIndex: 0 }); // A выложил последнюю карту
  assert(s.phase === 'roundEnd', 'раунд завершён');
  assert(s.roundWinner === 0, 'победитель раунда — A');
  assert(s.players[1].score === 50 + 22, 'B: +22 (Т+Т)');
  assert(s.players[2].score === 0, 'C: ровно 101 — очки аннулированы');
}
{
  // вылет при >101 и конец игры
  const s = E.createGame([{ name: 'A' }, { name: 'B' }], 13);
  E.startRound(s);
  rig(s, {
    hand0: [['К', '♠']],
    hand1: [['Т', '♥'], ['Т', '♦']],
    top: ['10', '♠'], turn: 0,
  });
  s.players[1].score = 95; // 95 + 22 = 117 > 101 → вылет
  E.applyAction(s, { type: 'play', cardIndex: 0 });
  assert(s.players[1].eliminated, 'B вылетел (>101)');
  assert(s.phase === 'gameEnd' && s.gameWinner === 0, 'остался один — победа A');
}

/* ---------- 10. Победа последней семёркой: штраф применяется ---------- */
{
  const s = E.createGame([{ name: 'A' }, { name: 'B' }], 14);
  E.startRound(s);
  rig(s, {
    hand0: [['7', '♠']],
    hand1: [['В', '♥'], ['В', '♦']],
    top: ['10', '♠'], turn: 0,
  });
  E.applyAction(s, { type: 'play', cardIndex: 0 });
  assert(s.phase === 'roundEnd' || s.phase === 'gameEnd', 'раунд завершён');
  assert(s.players[1].hand.length === 4, 'соперник поднял штраф +2 перед подсчётом');
}

/* ---------- 11. Перемешивание стола при пустой колоде ---------- */
{
  const s = E.createGame([{ name: 'A' }, { name: 'B' }], 15);
  E.startRound(s);
  // сливаем колоду на стол
  while (s.deck.length) s.pile.push(s.deck.pop());
  const top = s.pile[s.pile.length - 1];
  s.activeSuit = top.suit; s.activeRank = top.rank;
  const pileBefore = s.pile.length;
  // руку игрока кладём в низ стола, чтобы карты не терялись
  s.pile.unshift(...s.players[0].hand);
  s.players[0].hand = [];
  s.mustCover = true; s.turn = 0;
  E.applyAction(s, { type: 'draw' });
  assert(s.deck.length + s.pile.length + s.players[0].hand.length + s.players[1].hand.length === 36, 'карты не теряются');
  assert(s.pile.length >= 1, 'верхняя карта осталась на столе');
  assert(s.players[0].hand.length > 0, 'игрок добрал из перетасованной колоды');
}

/* ---------- 13. Добровольное взятие карты ---------- */
{
  const s = E.createGame([{ name: 'A' }, { name: 'B' }], 20);
  E.startRound(s);
  rig(s, {
    hand0: [['К', '♠'], ['В', '♥']],
    hand1: [['К', '♥'], ['В', '♦']],
    top: ['10', '♠'], turn: 0,
  });
  const acts = E.getLegalActions(s);
  assert(acts.some(a => a.type === 'play'), 'есть чем ходить');
  assert(acts.some(a => a.type === 'draw'), 'но взять карту всё равно можно');
  E.applyAction(s, { type: 'draw' });
  assert(s.players[0].hand.length === 3, 'карта взята');
  if (s.turn === 0) {
    const acts2 = E.getLegalActions(s);
    assert(acts2.some(a => a.type === 'pass'), 'после взятия можно спасовать');
    assert(!acts2.some(a => a.type === 'draw'), 'вторую взять нельзя');
  } // если взятая не подошла — ход уже перешёл, это тоже верно
}

/* ---------- 14. Туз при двух игроках — дополнительный ход ---------- */
{
  const s = E.createGame([{ name: 'A' }, { name: 'B' }], 21);
  E.startRound(s);
  rig(s, {
    hand0: [['Т', '♠'], ['К', '♠'], ['В', '♥']],
    hand1: [['К', '♥'], ['В', '♦']],
    top: ['10', '♠'], turn: 0,
  });
  E.applyAction(s, { type: 'play', cardIndex: 0 }); // Т♠
  assert(s.turn === 0 && !s.mustCover, 'при 2 игроках туз — ходишь ещё раз');
  E.applyAction(s, { type: 'play', cardIndex: 0 }); // К♠ на Т♠
  assert(s.turn === 1, 'после второго хода очередь переходит');
}
{
  // туз при 2 игроках, ходить нечем — берёт одну карту как обычно
  const s = E.createGame([{ name: 'A' }, { name: 'B' }], 22);
  E.startRound(s);
  rig(s, {
    hand0: [['Т', '♠'], ['В', '♥']],
    hand1: [['К', '♥'], ['В', '♦']],
    top: ['10', '♠'], turn: 0,
  });
  E.applyAction(s, { type: 'play', cardIndex: 0 }); // Т♠, осталась В♥ — не подходит
  assert(s.turn === 0, 'дополнительный ход');
  const acts = E.getLegalActions(s);
  assert(acts.length >= 1 && acts.some(a => a.type === 'draw'), 'нечем ходить — берёт карту');
  const before = s.players[0].hand.length;
  E.applyAction(s, { type: 'draw' });
  assert(s.players[0].hand.length === before + 1, 'взял ровно одну');
}

/* ---------- 15. Раунд закрыт дамой — всем проигравшим +40 ---------- */
{
  const s = E.createGame([{ name: 'A' }, { name: 'B' }, { name: 'C' }], 23);
  E.startRound(s);
  rig(s, {
    hand0: [['Д', '♠']],
    hand1: [['В', '♥'], ['В', '♦']], // 4 очка + 40
    hand2: [['9', '♥'], ['10', '♦'], ['К', '♦'], ['В', '♣'], ['8', '♥']], // 24 очка + 40
    top: ['10', '♠'], turn: 0,
  });
  E.applyAction(s, { type: 'play', cardIndex: 0 }); // Д♠ — последняя карта
  assert(s.phase === 'roundEnd', 'раунд завершён сразу, без выбора масти');
  assert(s.roundWinner === 0, 'победитель — A');
  assert(s.players[1].score === 44, 'B: 4 + 40 за даму');
  assert(s.players[2].score === 64, 'C: 24 + 40 за даму');
  const ev = s.log.find(e => e.type === 'roundEnd');
  assert(ev.queenFinish === true, 'событие отмечено как закрытие дамой');
}

/* ---------- 16. Карта победителя открывает следующий раунд ---------- */
{
  // победа семёркой: новый раунд начинается с неё, первый игрок под штрафом
  const s = E.createGame([{ name: 'A' }, { name: 'B' }, { name: 'C' }], 30);
  E.startRound(s);
  rig(s, {
    hand0: [['7', '♠']],
    hand1: [['В', '♥'], ['В', '♦']],
    hand2: [['К', '♦'], ['В', '♣'], ['10', '♥'], ['9', '♣'], ['8', '♥']],
    top: ['10', '♠'], turn: 0,
  });
  E.applyAction(s, { type: 'play', cardIndex: 0 }); // A победил семёркой
  assert(s.phase === 'roundEnd' && s.roundWinner === 0, 'раунд за A');
  E.startRound(s);
  const top = s.pile[s.pile.length - 1];
  assert(top.rank === '7' && top.suit === '♠', 'новый раунд открыт картой победителя (7♠)');
  assert(s.pendingSevens === 1, 'модификатор семёрки действует');
  assert(s.turn === 1, 'первым ходит игрок после победителя');
  assert(s.players[0].hand.length === 4, 'у победителя 4 карты (пятая — на столе)');
  assert(s.players[1].hand.length === 5 && s.players[2].hand.length === 5, 'у остальных по 5');
  const total = s.deck.length + s.pile.length + s.players.reduce((x, p) => x + p.hand.length, 0);
  assert(total === 36, 'карты не задвоились');
  const ev = s.log.filter(e => e.type === 'roundStart').pop();
  assert(ev.fromWinner === 0, 'событие содержит источник карты');
}
{
  // победа девяткой: раунд НЕ кончается, пока следующий её не закроет (рука растёт до подсчёта)
  const s = E.createGame([{ name: 'A' }, { name: 'B' }, { name: 'C' }], 31);
  E.startRound(s);
  rig(s, {
    hand0: [['9', '♠']],
    hand1: [['В', '♥'], ['В', '♦']],
    hand2: [['К', '♦'], ['В', '♣'], ['10', '♥'], ['9', '♣'], ['8', '♥']],
    top: ['10', '♠'], turn: 0,
  });
  E.applyAction(s, { type: 'play', cardIndex: 0 }); // A вышел девяткой
  assert(s.phase === 'playing', 'раунд ещё идёт — девятку надо закрыть');
  assert(s.turn === 1 && s.mustCover, 'закрывает следующий игрок');
  deckTop(s, ['К', '♥']); // не закрывает
  E.applyAction(s, { type: 'draw' });
  assert(s.phase === 'playing' && s.players[1].hand.length === 3, 'добирает — рука растёт');
  deckTop(s, ['К', '♠']); // закрывает
  E.applyAction(s, { type: 'draw' });
  const acts = E.getLegalActions(s);
  assert(acts.length === 1 && acts[0].type === 'play', 'обязан закрыть');
  E.applyAction(s, acts[0]); // К♠ закрыл девятку
  assert(s.phase === 'roundEnd' && s.roundWinner === 0, 'теперь раунд завершён, победил A');
  assert(s.players[1].roundPoints === 2 + 2 + 4, 'B посчитан с добранными картами (В+В+К♥)');
  E.startRound(s);
  const top = s.pile[s.pile.length - 1];
  assert(top.rank === '9' && top.suit === '♠', 'новый раунд открыт именно девяткой победителя, не закрывшей картой');
  assert(s.turn === 1 && s.mustCover && s.coverMode === 'until', 'первый игрок закрывает её до упора');
  assert(s.players[0].hand.length === 4, 'у победителя 4 карты');
}
{
  // победную девятку закрыть нечем вообще — раунд всё равно завершается
  const s = E.createGame([{ name: 'A' }, { name: 'B' }], 34);
  E.startRound(s);
  rig(s, {
    hand0: [['9', '♠']],
    hand1: [['В', '♥']],
    top: ['10', '♠'], turn: 0,
  });
  // делаем так, чтобы карт для добора не осталось: колода и стол пусты (кроме верхней)
  s.players[1].hand.push(...s.deck); s.deck = [];
  s.players[1].hand = s.players[1].hand.filter(c => !(c.suit === '♠' || c.rank === '9')); // нечем закрыть
  const dumped = 36 - 1 /*top*/ - 1 /*9♠ у A*/ - s.players[1].hand.length;
  // лишние карты «сгружаем» в низ стола, чтобы не терять (их не добрать — верхняя остаётся)
  E.applyAction(s, { type: 'play', cardIndex: 0 }); // A вышел девяткой
  assert(s.phase === 'playing' && s.turn === 1, 'B должен закрывать');
  // B добирает всё, что есть, не может закрыть — coverFail → раунд завершается за A
  let guard = 50;
  while (s.phase === 'playing' && guard-- > 0) {
    const a = E.getLegalActions(s)[0];
    E.applyAction(s, a);
  }
  assert(s.phase === 'roundEnd' || s.phase === 'gameEnd', 'раунд завершился');
  assert(s.roundWinner === 0, 'победил A, вышедший девяткой');
}
{
  // победа тузом при 3 игроках: первый ход уходит назад от победителя
  const s = E.createGame([{ name: 'A' }, { name: 'B' }, { name: 'C' }], 32);
  E.startRound(s);
  rig(s, {
    hand0: [['Т', '♠']],
    hand1: [['В', '♥'], ['В', '♦']],
    hand2: [['К', '♦'], ['В', '♣'], ['10', '♥'], ['9', '♣'], ['8', '♥']],
    top: ['10', '♠'], turn: 0,
  });
  E.applyAction(s, { type: 'play', cardIndex: 0 });
  E.startRound(s);
  assert(s.pile[s.pile.length - 1].rank === 'Т', 'раунд открыт тузом');
  assert(s.turn === 2, 'шаг назад: ходит игрок перед победителем');
}
{
  // в первом раунде карта из колоды эффекта не даёт
  const s = E.createGame([{ name: 'A' }, { name: 'B' }], 33);
  E.startRound(s);
  assert(s.pendingSevens === 0 && !s.mustCover, 'первая карта первого раунда без эффекта');
}

/* ---------- 12. Массовая симуляция: 300 полных игр ботами ---------- */
{
  let ok = 0;
  for (let seed = 100; seed < 400; seed++) {
    const n = 2 + (seed % 4); // 2..5 игроков
    const s = E.createGame(Array.from({ length: n }, (_, i) => ({ name: 'B' + i, isBot: true })), seed);
    let guard = 200000;
    try {
      E.startRound(s);
      while (s.phase !== 'gameEnd' && guard-- > 0) {
        if (s.phase === 'roundEnd') { E.startRound(s); continue; }
        const a = E.botChooseAction(s);
        E.applyAction(s, a);
        // инвариант: 36 карт в игре
        const total = s.deck.length + s.pile.length + s.players.reduce((x, p) => x + p.hand.length, 0);
        if (total !== 36) throw new Error('потеря карт: ' + total + ' seed=' + seed);
      }
      if (guard <= 0) throw new Error('зависание, seed=' + seed);
      if (s.gameWinner === null) throw new Error('нет победителя, seed=' + seed);
      ok++;
    } catch (e) {
      failed++;
      console.error('SIM FAIL seed=' + seed + ':', e.message);
    }
  }
  assert(ok === 300, 'все 300 симуляций дошли до победителя (' + ok + '/300)');
  console.log('Симуляций успешно:', ok + '/300');
}

console.log('\n=== Итог: passed=' + passed + ', failed=' + failed + ' ===');
process.exit(failed ? 1 : 0);
