(() => {
  if (window.__snakeDismiss) window.__snakeDismiss();

  const letters = ["t", "h", "e", "o"];
  const directions = {
    ArrowUp: { x: 0, y: -1 },
    ArrowDown: { x: 0, y: 1 },
    ArrowLeft: { x: -1, y: 0 },
    ArrowRight: { x: 1, y: 0 },
    w: { x: 0, y: -1 },
    W: { x: 0, y: -1 },
    a: { x: -1, y: 0 },
    A: { x: -1, y: 0 },
    s: { x: 0, y: 1 },
    S: { x: 0, y: 1 },
    d: { x: 1, y: 0 },
    D: { x: 1, y: 0 }
  };
  const cols = 28;
  const rows = 18;
  const held = new Set();
  let armed = true;
  let holdTimer = 0;
  let root = null;
  let canvas = null;
  let ctx = null;
  let scoreNode = null;
  let noteNode = null;
  let cell = 16;
  let snake = [];
  let food = null;
  let dir = { x: 1, y: 0 };
  let queue = [];
  let score = 0;
  let dead = false;
  let waiting = true;
  let step = 150;
  let tick = 0;

  const letter = (event) => {
    const key = String(event.key || "");
    return letters.includes(key) ? key : "";
  };

  const allHeld = () => letters.every((key) => held.has(key));

  const clearHold = () => {
    if (!holdTimer) return;
    window.clearTimeout(holdTimer);
    holdTimer = 0;
  };

  const watch = () => {
    if (!document.body.classList.contains("intro") || root) {
      clearHold();
      return;
    }
    if (!allHeld()) {
      armed = true;
      clearHold();
      return;
    }
    if (!armed || holdTimer) return;
    holdTimer = window.setTimeout(open, 10000);
  };

  const fit = () => {
    const maxW = Math.min(window.innerWidth - 48, 704);
    const maxH = Math.max(120, window.innerHeight - 170);
    cell = Math.max(6, Math.floor(Math.min(maxW / cols, maxH / rows)));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(cols * cell * dpr);
    canvas.height = Math.floor(rows * cell * dpr);
    const width = cols * cell + "px";
    canvas.style.width = width;
    canvas.style.height = rows * cell + "px";
    scoreNode.parentElement.style.width = width;
    noteNode.style.width = width;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  };

  const draw = () => {
    if (!ctx) return;
    const gap = cell > 8 ? 1 : 0;
    ctx.fillStyle = "#f4f3ef";
    ctx.fillRect(0, 0, cols * cell, rows * cell);
    ctx.fillStyle = "#141414";
    for (const part of snake) {
      ctx.fillRect(part.x * cell + gap, part.y * cell + gap, cell - gap * 2, cell - gap * 2);
    }
    if (!food) return;
    const inset = Math.max(gap + 1, Math.floor(cell * 0.32));
    ctx.fillRect(food.x * cell + inset, food.y * cell + inset, cell - inset * 2, cell - inset * 2);
  };

  const placeFood = () => {
    const openCells = [];
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        if (!snake.some((part) => part.x === x && part.y === y)) openCells.push({ x, y });
      }
    }
    if (!openCells.length) {
      food = null;
      return false;
    }
    food = openCells[Math.floor(Math.random() * openCells.length)];
    return true;
  };

  const schedule = () => {
    window.clearTimeout(tick);
    tick = window.setTimeout(stepMove, step);
  };

  const die = () => {
    dead = true;
    window.clearTimeout(tick);
    tick = 0;
    noteNode.textContent = "Again";
    draw();
  };

  const reset = () => {
    dead = false;
    score = 0;
    step = 150;
    dir = { x: 1, y: 0 };
    queue = [];
    scoreNode.textContent = "0";
    noteNode.textContent = "Arrows";
    waiting = true;
    const y = Math.floor(rows / 2);
    const x = Math.floor(cols / 2) - 1;
    snake = [
      { x, y },
      { x: x - 1, y },
      { x: x - 2, y }
    ];
    placeFood();
    draw();
    window.clearTimeout(tick);
    tick = 0;
  };

  const stepMove = () => {
    tick = 0;
    if (!root || !root.isConnected || !document.body.classList.contains("intro")) {
      close();
      return;
    }
    if (dead) return;
    if (queue.length) dir = queue.shift();
    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
    const hitWall = head.x < 0 || head.y < 0 || head.x >= cols || head.y >= rows;
    const hitSelf = snake.some((part) => part.x === head.x && part.y === head.y);
    if (hitWall || hitSelf) {
      die();
      return;
    }
    snake.unshift(head);
    if (food && head.x === food.x && head.y === food.y) {
      score += 1;
      scoreNode.textContent = String(score);
      if (score % 5 === 0) step = Math.max(80, step - 10);
      if (!placeFood()) {
        die();
        return;
      }
    } else {
      snake.pop();
    }
    draw();
    schedule();
  };

  const turn = (x, y) => {
    if (dead) reset();
    if (waiting) {
      dir = { x, y };
      queue = [];
      waiting = false;
      schedule();
      return;
    }
    const last = queue[queue.length - 1] || dir;
    if (x === -last.x && y === -last.y) return;
    if (x === last.x && y === last.y) return;
    if (queue.length >= 2) return;
    queue.push({ x, y });
  };

  const close = () => {
    window.clearTimeout(tick);
    tick = 0;
    if (root) root.remove();
    root = null;
    canvas = null;
    ctx = null;
    armed = false;
    watch();
  };

  const open = () => {
    clearHold();
    if (root || !document.body.classList.contains("intro")) return;
    armed = false;
    root = document.createElement("div");
    root.className = "snake";
    root.tabIndex = -1;
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Snake");

    const bar = document.createElement("div");
    bar.className = "snake-bar";
    scoreNode = document.createElement("p");
    scoreNode.className = "snake-score";
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "snake-close";
    closeButton.textContent = "Close";
    closeButton.addEventListener("click", close);
    bar.append(scoreNode, closeButton);

    canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    ctx = canvas.getContext("2d");
    noteNode = document.createElement("p");
    noteNode.className = "snake-note";
    root.append(bar, canvas, noteNode);
    document.body.append(root);
    fit();
    reset();
    root.focus();
  };

  const onKeyDown = (event) => {
    const key = letter(event);
    if (key) {
      held.add(key);
      watch();
    }
    if (!root) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key === " " && dead) {
      event.preventDefault();
      reset();
      return;
    }
    const move = directions[event.key];
    if (!move) return;
    event.preventDefault();
    turn(move.x, move.y);
  };

  const onKeyUp = (event) => {
    const key = letter(event);
    if (!key) return;
    held.delete(key);
    watch();
  };

  const onBlur = () => {
    held.clear();
    clearHold();
    armed = true;
  };

  const onResize = () => {
    if (root) fit();
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  window.addEventListener("resize", onResize);

  window.__snakeDismiss = () => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("resize", onResize);
    clearHold();
    window.clearTimeout(tick);
    tick = 0;
    if (root) root.remove();
    root = null;
  };
})();
