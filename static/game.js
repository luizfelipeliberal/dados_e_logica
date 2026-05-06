const socket = io();

let mySid = null;
let gameState = null;
let timerInterval = null;

const ROW_NUMBERS = {
  azul:     [2,3,4,5,6,7,8,9,10,11,12],
  marrom:   [2,3,4,5,6,7,8,9,10,11,12],
  roxo:     [12,11,10,9,8,7,6,5,4,3,2],
  vermelho: [12,11,10,9,8,7,6,5,4,3,2],
};
const COLORS = ["azul","marrom","roxo","vermelho"];
const COLOR_LABELS = { azul:"Azul", marrom:"Marrom", roxo:"Roxo", vermelho:"Vermelho" };
const MAX_PENALTIES = 4;

// --- elementos da tela ---
const lobby       = document.getElementById("lobby");
const waitingRoom = document.getElementById("waitingRoom");
const gameArea    = document.getElementById("gameArea");
const endScreen   = document.getElementById("endScreen");
const lobbyError  = document.getElementById("lobbyError");
const roomCodeDisplay = document.getElementById("roomCodeDisplay");
const playerList  = document.getElementById("playerList");
const btnStart    = document.getElementById("btnStart");
const waitingMsg  = document.getElementById("waitingMsg");
const headerRoom  = document.getElementById("headerRoom");
const headerPhase = document.getElementById("headerPhase");
const headerTurn  = document.getElementById("headerTurn");
const myCard      = document.getElementById("myCard");
const myPenalties = document.getElementById("myPenalties");
const diceDisplay = document.getElementById("diceDisplay");
const phasePanel  = document.getElementById("phasePanel");
const messageLog  = document.getElementById("messageLog");
const scoreboard  = document.getElementById("scoreboard");
const finalScores = document.getElementById("finalScores");

// --- lobby ---
document.getElementById("btnCreate").addEventListener("click", () => {
  const name = document.getElementById("playerName").value.trim();
  if (!name) { lobbyError.textContent = "Digite seu nome."; return; }
  socket.emit("create_room", { name });
});

document.getElementById("btnJoin").addEventListener("click", () => {
  const name = document.getElementById("playerName").value.trim();
  const code = document.getElementById("roomCodeInput").value.trim().toUpperCase();
  if (!name) { lobbyError.textContent = "Digite seu nome."; return; }
  if (!code)  { lobbyError.textContent = "Digite o código da sala."; return; }
  socket.emit("join_room_event", { name, room_id: code });
});

document.getElementById("btnStart").addEventListener("click", () => socket.emit("start_game"));
document.getElementById("btnRestart").addEventListener("click", () => location.reload());

// --- conexão ---
socket.on("connect", () => { mySid = socket.id; });

socket.on("room_created", (data) => {
  roomCodeDisplay.textContent = data.room_id;
  show(waitingRoom);
  lobbyError.textContent = "";
});

socket.on("error", (data) => { lobbyError.textContent = data.msg; });

socket.on("message", (msg) => addLog(msg));

socket.on("game_state", (state) => {
  gameState = state;
  if (state.phase === "ended") { renderEndScreen(state); return; }
  if (!state.started)          { renderWaiting(state); return; }
  renderGame(state);
});

// --- sala de espera ---
function renderWaiting(state) {
  roomCodeDisplay.textContent = state.room_id;
  show(waitingRoom);
  playerList.innerHTML = "";
  const sids = state.turn_order.length ? state.turn_order : Object.keys(state.players);
  sids.forEach(sid => {
    const p = state.players[sid];
    const div = document.createElement("div");
    div.className = "player-item";
    div.innerHTML = `${sid === state.host ? '<span class="crown">👑</span>' : ''} ${esc(p.name)}`;
    playerList.appendChild(div);
  });
  btnStart.classList.toggle("hidden", mySid !== state.host);
  waitingMsg.style.display = mySid === state.host ? "none" : "";
}

// --- jogo ---
function renderGame(state) {
  show(gameArea);
  const phase = state.phase;
  const amActive = mySid === state.current_turn;
  const activeName = state.players[state.current_turn]?.name ?? "?";
  const myPlayer = state.players[mySid];

  headerRoom.innerHTML  = `<strong>Sala:</strong> ${state.room_id}`;
  headerPhase.innerHTML = `<strong>Fase:</strong> ${phaseLabel(phase)}`;
  headerTurn.innerHTML  = `<strong>Vez de:</strong> ${esc(activeName)}`;

  if (phase === "choice") {
    startTimer(state.turn_start_time, state.turn_duration, amActive);
  } else {
    stopTimer();
  }

  renderCard(myPlayer, state);
  renderPhasePanel(state, amActive);
  renderScoreboard(state);
}

// --- temporizador ---
function startTimer(startTime, duration, amActive) {
  stopTimer();
  const timerEl = document.getElementById("bodyTimer");
  timerEl.classList.remove("hidden");

  function tick() {
    const remaining = Math.max(0, duration - (Date.now() / 1000 - startTime));
    const mins = Math.floor(remaining / 60);
    const secs = Math.floor(remaining % 60);
    timerEl.textContent = `⏱ ${mins}:${secs.toString().padStart(2, "0")}`;
    timerEl.className = "body-timer" + (remaining <= 15 ? " urgent" : remaining <= 30 ? " warn-timer" : "");

    if (remaining <= 0) {
      clearInterval(timerInterval);
      timerInterval = null;
      timerEl.textContent = "⏱ Tempo esgotado!";
      timerEl.className = "body-timer urgent";
      if (amActive && gameState?.phase === "choice") socket.emit("end_turn");
    }
  }

  tick();
  timerInterval = setInterval(tick, 500);
}

function stopTimer() {
  clearInterval(timerInterval);
  timerInterval = null;
  const timerEl = document.getElementById("bodyTimer");
  if (timerEl) timerEl.classList.add("hidden");
}

// --- cartela do jogador ---
function renderCard(player, state) {
  if (!player) return;
  myCard.innerHTML = "";

  COLORS.forEach(color => {
    const isGlobalLocked = state.locked_rows.includes(color);
    const container = document.createElement("div");
    container.className = `row-container ${color}${isGlobalLocked ? " locked" : ""}`;

    const label = document.createElement("div");
    label.className = "row-label";
    label.textContent = COLOR_LABELS[color] + (isGlobalLocked ? " 🔒" : "");
    container.appendChild(label);

    const nums = document.createElement("div");
    nums.className = "row-numbers";

    const row = ROW_NUMBERS[color];
    const isAscending = row[0] === 2;

    row.forEach(n => {
      const cell = document.createElement("div");
      cell.className = "num-cell";
      cell.textContent = n;

      const marked = player.marks[color]?.includes(n);
      if (marked) {
        cell.classList.add("marked");
      } else if (isGlobalLocked) {
        cell.classList.add("locked-row");
      }
      nums.appendChild(cell);
    });

    // bônus no final da linha, depende da direção (crescente ou decrescente)
    const rightBonusType = isAscending ? "bonus_12" : "bonus_2";
    const rightBonusNum  = isAscending ? 12 : 2;
    nums.appendChild(makeBonusCell(player, color, rightBonusType, rightBonusNum, state, isGlobalLocked));

    container.appendChild(nums);
    myCard.appendChild(container);
  });

  // penalidades
  myPenalties.innerHTML = "";
  for (let i = 0; i < MAX_PENALTIES; i++) {
    const box = document.createElement("div");
    box.className = "penalty-box" + (i < player.penalties ? " filled" : "");
    const sub = document.createElement("sub");
    sub.textContent = "-5";
    box.appendChild(sub);
    myPenalties.appendChild(box);
  }
}

function makeBonusCell(player, color, bonusType, number, state, isGlobalLocked) {
  const cell = document.createElement("div");
  cell.className = "num-cell bonus-cell";
  cell.textContent = "★";

  const alreadyMarked = player.bonus_marks?.[color]?.includes(bonusType);
  const markedCount = player.marks[color]?.length ?? 0;

  if (alreadyMarked) {
    cell.classList.add("marked");
    cell.title = `Bônus ${number} marcado!`;
  } else if (isGlobalLocked) {
    cell.classList.add("locked-row");
  } else if (markedCount >= 5) {
    const canAct = canMarkBonusNow(state);
    if (canAct) {
      cell.classList.add("clickable", "bonus-available");
      cell.title = `Bônus ${number}: clique para marcar (+1)`;
      cell.addEventListener("click", () => socket.emit("mark_bonus", { color, bonus_type: bonusType }));
    } else {
      cell.classList.add("bonus-available");
      cell.title = `Bônus ${number} disponível (não é sua vez)`;
    }
  } else {
    cell.classList.add("bonus-locked");
    cell.title = `Marque 5 números nesta linha para desbloquear o bônus ${number}`;
  }
  return cell;
}

function canMarkBonusNow(state) {
  return state.phase === "choice";
}

function canMarkNumber(player, color, number) {
  const row = ROW_NUMBERS[color];
  const marked = player.marks[color] ?? [];
  if (!row.includes(number)) return false;
  if (marked.includes(number)) return false;
  const idx = row.indexOf(number);
  if (marked.some(n => row.indexOf(n) > idx)) return false;
  if (number === row[row.length - 1] && marked.length < 5) return false;
  return true;
}

// --- painel de fase ---
function renderPhasePanel(state, amActive) {
  phasePanel.innerHTML = "";

  if (state.phase === "rolling") {
    if (amActive) {
      const btn = makeBtn("🎲 Rolar Dados", "btn-roll", () => socket.emit("roll_dice"));
      phasePanel.appendChild(btn);
    } else {
      phasePanel.appendChild(makeInfo(`Aguardando <strong>${esc(state.players[state.current_turn]?.name)}</strong> rolar os dados...`));
    }
    return;
  }

  if (state.phase === "choice") {
    renderChoicePhase(state, amActive);
    return;
  }
}

function renderChoicePhase(state, amActive) {
  const dice = state.dice;
  const myPlayer = state.players[mySid];
  const alreadyWhiteMarked = state.white_marked?.includes(mySid);

  // dados na tela
  const diceRow = document.createElement("div");
  diceRow.className = "dice-row";
  diceRow.appendChild(makeDie("white", dice.white1, "B1"));
  diceRow.appendChild(makeDie("white", dice.white2, "B2"));
  COLORS.forEach(c => diceRow.appendChild(makeDie(c, dice.colored[c])));
  phasePanel.appendChild(diceRow);

  // soma dos brancos (todos podem marcar)
  const whiteSection = document.createElement("div");
  whiteSection.className = "choice-section";

  const whiteTitle = document.createElement("div");
  whiteTitle.className = "choice-section-title";
  whiteTitle.innerHTML = `⬜ Soma dos brancos: <strong class="white-sum">${dice.white_sum}</strong>`;
  whiteSection.appendChild(whiteTitle);

  const colorBlockedWhite = amActive && state.color_phase_marked;

  if (alreadyWhiteMarked) {
    const done = document.createElement("p");
    done.className = "phase-hint success";
    done.textContent = "✅ Soma branca marcada!";
    whiteSection.appendChild(done);
    const btnUndo = makeBtn("↩ Desfazer", "btn-undo", () => socket.emit("undo_white"));
    whiteSection.appendChild(btnUndo);
  } else if (colorBlockedWhite) {
    const blocked = document.createElement("p");
    blocked.className = "phase-hint warn";
    blocked.textContent = "⛔ Combinação colorida já marcada — branco bloqueado.";
    whiteSection.appendChild(blocked);
  } else {
    const whiteHint = document.createElement("p");
    whiteHint.className = "pick-hint";
    whiteHint.innerHTML = "👇 Escolha aqui o número que você quer marcar";
    whiteSection.appendChild(whiteHint);

    const whiteGrid = document.createElement("div");
    whiteGrid.className = "combo-grid";
    COLORS.forEach(color => {
      if (state.locked_rows.includes(color)) return;
      const canMark = canMarkNumber(myPlayer, color, dice.white_sum);
      const row = document.createElement("div");
      row.className = `combo-row ${color}`;
      const lbl = document.createElement("span");
      lbl.className = "combo-label";
      lbl.textContent = COLOR_LABELS[color];
      row.appendChild(lbl);
      const btn = document.createElement("button");
      btn.className = `combo-btn ${color}`;
      btn.textContent = dice.white_sum;
      if (canMark) {
        btn.addEventListener("click", () => socket.emit("mark_white", { color }));
      } else {
        btn.disabled = true;
        btn.classList.add("disabled");
      }
      row.appendChild(btn);
      whiteGrid.appendChild(row);
    });
    whiteSection.appendChild(whiteGrid);
  }
  phasePanel.appendChild(whiteSection);

  // combinações coloridas (só quem é da vez)
  const colorSection = document.createElement("div");
  colorSection.className = "choice-section";

  const colorTitle = document.createElement("div");
  colorTitle.className = "choice-section-title";
  if (amActive) {
    colorTitle.innerHTML = `🎨 Combinações — escolha <strong>uma</strong>`;
  } else {
    colorTitle.innerHTML = `🎨 Combinações de <strong>${esc(state.players[state.current_turn]?.name)}</strong>`;
  }
  colorSection.appendChild(colorTitle);

  if (amActive) {
    const alreadyColorMarked = state.color_phase_marked;

    const colorHint = document.createElement("p");
    colorHint.className = "pick-hint";
    colorHint.innerHTML = "👇 Escolha aqui o número que você quer marcar";
    colorSection.appendChild(colorHint);

    const comboGrid = document.createElement("div");
    comboGrid.className = "combo-grid";

    COLORS.forEach(color => {
      if (state.locked_rows.includes(color)) return;
      const w1val = dice.combos[color].white1;
      const w2val = dice.combos[color].white2;
      const row = document.createElement("div");
      row.className = `combo-row ${color}`;
      const lbl = document.createElement("span");
      lbl.className = "combo-label";
      lbl.textContent = COLOR_LABELS[color];
      row.appendChild(lbl);
      const pairs = w1val <= w2val
        ? [["white1", w1val], ["white2", w2val]]
        : [["white2", w2val], ["white1", w1val]];
      pairs.forEach(([die, val]) => {
        const btn = document.createElement("button");
        btn.className = `combo-btn ${color}`;
        btn.textContent = val;
        const canMark = !alreadyColorMarked && canMarkNumber(myPlayer, color, val);
        if (canMark) {
          btn.addEventListener("click", () => socket.emit("mark_color", { color, white_die: die }));
        } else {
          btn.disabled = true;
          btn.classList.add("disabled");
        }
        row.appendChild(btn);
      });
      comboGrid.appendChild(row);
    });
    colorSection.appendChild(comboGrid);

    if (alreadyColorMarked) {
      const btnUndoColor = makeBtn("↩ Desfazer combinação", "btn-undo", () => socket.emit("undo_color"));
      colorSection.appendChild(btnUndoColor);
    }

    const info = document.createElement("p");
    info.className = "phase-hint";
    if (alreadyColorMarked) {
      info.className += " success";
      info.textContent = "✅ Combinação marcada!";
    } else if (state.active_turn_marked) {
      info.className += " success";
      info.textContent = "✅ Marcou o branco. Pode marcar uma combinação ou encerrar.";
    } else {
      info.className += " warn";
      info.textContent = "⚠️ Encerrar sem marcar nada dará penalidade.";
    }
    colorSection.appendChild(info);

    const btnEnd = makeBtn("✅ Encerrar Turno", "btn-end-turn", () => socket.emit("end_turn"));
    colorSection.appendChild(btnEnd);
  } else {
    const info = document.createElement("div");
    info.className = "combo-info";
    COLORS.forEach(color => {
      if (state.locked_rows.includes(color)) return;
      const w1 = dice.combos[color].white1;
      const w2 = dice.combos[color].white2;
      const line = document.createElement("div");
      line.className = "combo-info-line";
      line.innerHTML = `<span class="color-dot" style="background:var(--${color})"></span> ${COLOR_LABELS[color]}: <strong>${w1}</strong> ou <strong>${w2}</strong>`;
      info.appendChild(line);
    });
    colorSection.appendChild(info);

    // botão de pronto pra quem não é da vez
    const alreadyReady = state.ready_players?.includes(mySid);
    if (alreadyReady) {
      const readyDone = document.createElement("p");
      readyDone.className = "phase-hint success";
      readyDone.textContent = "✅ Você está pronto!";
      colorSection.appendChild(readyDone);
    } else {
      const btnReady = makeBtn("✔ Estou Pronto", "btn-ready", () => socket.emit("player_ready"));
      colorSection.appendChild(btnReady);
    }
  }
  phasePanel.appendChild(colorSection);
}

// --- placar ---
function renderScoreboard(state) {
  scoreboard.innerHTML = "";
  const order = state.turn_order.length ? state.turn_order : Object.keys(state.players);
  order.forEach(sid => {
    const p = state.players[sid];
    if (!p) return;
    const isActive = sid === state.current_turn;
    const div = document.createElement("div");
    div.className = `score-player${isActive ? " active-player" : ""}`;
    const isReady = state.ready_players?.includes(sid) || (isActive && state.phase !== "choice");
    div.innerHTML = `<div class="pname">${isActive ? '<span class="turn-arrow">▶ </span>' : ''}${esc(p.name)}${isReady && state.phase === "choice" ? ' <span class="ready-badge">✓</span>' : ''}</div>`;
    const badges = document.createElement("div");
    badges.className = "score-colors";
    COLORS.forEach(c => {
      const b = document.createElement("span");
      b.className = `score-badge ${c}`;
      const total = (p.marks?.[c]?.length ?? 0) + (p.bonus_marks?.[c]?.length ?? 0);
      b.textContent = `${COLOR_LABELS[c][0]}: ${total}✓`;
      badges.appendChild(b);
    });
    const pen = document.createElement("span");
    pen.className = "score-badge penalty";
    pen.textContent = `P: ${p.penalties ?? 0}`;
    badges.appendChild(pen);
    div.appendChild(badges);
    scoreboard.appendChild(div);
  });
}

// --- tela de resultado final ---
function renderEndScreen(state) {
  show(endScreen);
  finalScores.innerHTML = "";
  const sorted = Object.entries(state.players).sort((a, b) =>
    (b[1].score?.total ?? 0) - (a[1].score?.total ?? 0)
  );
  const maxScore = sorted[0]?.[1].score?.total ?? 0;
  sorted.forEach(([, p]) => {
    const isWinner = p.score?.total === maxScore;
    const div = document.createElement("div");
    div.className = `final-player${isWinner ? " winner" : ""}`;

    const nameRow = document.createElement("div");
    nameRow.className = "fname";
    nameRow.textContent = (isWinner ? "🏆 " : "") + (p.name ?? "?");
    div.appendChild(nameRow);

    const breakdown = document.createElement("div");
    breakdown.className = "final-breakdown";
    COLORS.forEach(c => {
      const marks = (p.marks?.[c]?.length ?? 0) + (p.bonus_marks?.[c]?.length ?? 0);
      const pts = p.score?.[c] ?? 0;
      const b = document.createElement("span");
      b.className = `score-badge ${c}`;
      b.textContent = `${COLOR_LABELS[c][0]}: ${marks}✓ = ${pts}pts`;
      breakdown.appendChild(b);
    });
    const pen = document.createElement("span");
    pen.className = "score-badge penalty";
    pen.textContent = `Pen: ${p.score?.penalties ?? 0}pts`;
    breakdown.appendChild(pen);
    div.appendChild(breakdown);

    const totalEl = document.createElement("div");
    totalEl.className = "fpts";
    totalEl.textContent = `${p.score?.total ?? 0} pts`;
    div.appendChild(totalEl);

    finalScores.appendChild(div);
  });
}

// --- probabilidades ---
(function initProbPanel() {
  const COMBOS = {
     2: [[1,1]],
     3: [[1,2],[2,1]],
     4: [[1,3],[2,2],[3,1]],
     5: [[1,4],[2,3],[3,2],[4,1]],
     6: [[1,5],[2,4],[3,3],[4,2],[5,1]],
     7: [[1,6],[2,5],[3,4],[4,3],[5,2],[6,1]],
     8: [[2,6],[3,5],[4,4],[5,3],[6,2]],
     9: [[3,6],[4,5],[5,4],[6,3]],
    10: [[4,6],[5,5],[6,4]],
    11: [[5,6],[6,5]],
    12: [[6,6]],
  };
  const MAX_WAYS = 6;

  const tbody = document.getElementById("probTableBody");
  for (let n = 2; n <= 12; n++) {
    const combos = COMBOS[n];
    const ways = combos.length;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="prob-num">${n}</td>
      <td class="prob-ways">${ways}/36</td>
      <td class="prob-bar-cell">
        <div class="prob-bar">
          <div class="prob-fill" style="width:${(ways/MAX_WAYS)*100}%"></div>
        </div>
      </td>
      <td class="prob-combos">${combos.map(([a,b]) => `${a}+${b}`).join(', ')}</td>
    `;
    tbody.appendChild(tr);
  }

  const panel  = document.getElementById("probPanel");
  const btnOpen  = document.getElementById("btnProb");
  const btnClose = document.getElementById("btnCloseProb");

  btnOpen.addEventListener("click",  () => panel.classList.toggle("hidden-panel"));
  btnClose.addEventListener("click", () => panel.classList.add("hidden-panel"));
})();

// --- funções auxiliares ---
function show(el) {
  [lobby, waitingRoom, gameArea, endScreen].forEach(e => e?.classList.add("hidden"));
  el?.classList.remove("hidden");
}

function addLog(msg) {
  const div = document.createElement("div");
  div.className = "log-entry";
  div.textContent = msg;
  messageLog.prepend(div);
  while (messageLog.children.length > 20) messageLog.lastChild.remove();
}

function phaseLabel(phase) {
  return {
    lobby: "Lobby",
    rolling: "Rolando dados",
    choice: "Escolha",
    ended: "Encerrado",
  }[phase] ?? phase;
}

function makeBtn(label, cls, onClick) {
  const btn = document.createElement("button");
  btn.className = cls;
  btn.innerHTML = label;
  btn.addEventListener("click", onClick);
  return btn;
}

function makeInfo(html) {
  const p = document.createElement("p");
  p.className = "phase-hint";
  p.innerHTML = html;
  return p;
}

function makeDie(color, value, label) {
  const d = document.createElement("div");
  d.className = `die ${color}`;
  d.innerHTML = label ? `<span class="die-label">${label}</span>${value}` : value;
  return d;
}

function esc(str) {
  const d = document.createElement("div");
  d.textContent = str ?? "";
  return d.innerHTML;
}
