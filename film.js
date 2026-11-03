(() => {
const canvas = document.getElementById("dust");
const ctx = canvas.getContext("2d");
const specks = [];
const motion = window.matchMedia("(prefers-reduced-motion: reduce)");

const resize = () => {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(window.innerWidth * dpr);
  canvas.height = Math.floor(window.innerHeight * dpr);
  canvas.style.width = window.innerWidth + "px";
  canvas.style.height = window.innerHeight + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
};

const spawn = () => {
  const large = Math.random() < 0.08;
  specks.push({
    x: Math.random() * window.innerWidth,
    y: Math.random() * window.innerHeight,
    r: large ? 0.9 + Math.random() * 0.6 : 0.3 + Math.random() * 0.45,
    squash: 0.7 + Math.random() * 0.3,
    turn: Math.random() * Math.PI,
    life: 6 + Math.floor(Math.random() * 10),
    a: large ? 0.28 + Math.random() * 0.18 : 0.14 + Math.random() * 0.16
  });
};

let tick = 0;

const frame = () => {
  if (motion.matches) return;

  tick += 1;
  if (tick % 3 === 0) {
    const x = (Math.random() - 0.5) * 0.6;
    const y = (Math.random() - 0.5) * 0.8;
    document.documentElement.style.setProperty("--wx", x.toFixed(2) + "px");
    document.documentElement.style.setProperty("--wy", y.toFixed(2) + "px");
    document.documentElement.style.setProperty("--flick", (0.988 + Math.random() * 0.012).toFixed(3));
  }

  if (specks.length < 4 && Math.random() < 0.35) spawn();

  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  for (let i = specks.length - 1; i >= 0; i--) {
    const speck = specks[i];
    speck.life -= 1;
    if (speck.life <= 0) {
      specks.splice(i, 1);
      continue;
    }
    ctx.fillStyle = `rgba(12, 12, 12, ${speck.a})`;
    ctx.beginPath();
    ctx.ellipse(speck.x, speck.y, speck.r, speck.r * speck.squash, speck.turn, 0, Math.PI * 2);
    ctx.fill();
  }
};

resize();
if (window.__filmResize) window.removeEventListener("resize", window.__filmResize);
window.__filmResize = resize;
window.addEventListener("resize", resize);
if (window.__filmTick) window.clearInterval(window.__filmTick);
window.__filmTick = motion.matches ? 0 : window.setInterval(frame, 1000 / 24);
})();
