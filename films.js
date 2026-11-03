(() => {
const filmData = document.getElementById("film-data");
const groups = filmData ? JSON.parse(filmData.textContent) : [];

const films = groups.flatMap((group) => group.films);
const player = document.getElementById("player");
const slate = document.getElementById("slate");
const now = document.getElementById("now");
const detail = document.getElementById("detail");
const program = document.getElementById("program");
const buttons = [];

const slug = (title) => title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const vimeoClip = (value) => {
  const text = String(value || "").trim();
  if (!text) return null;
  if (/^\d+$/.test(text)) return { id: text, hash: "" };
  const match = text.match(/vimeo\.com\/(?:(?:video|manage\/videos)\/)?(\d+)(?:\/([A-Za-z0-9]+))?/);
  if (!match) return null;
  const query = text.match(/[?&]h=([A-Za-z0-9]+)/);
  return { id: match[1], hash: match[2] || (query ? query[1] : "") };
};

const stage = document.querySelector(".stage");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
let current = -1;
let fadeTimer = 0;

const paint = (index, autoplay) => {
  const film = films[index];
  const clip = vimeoClip(film.vimeo);

  for (const button of buttons) button.removeAttribute("aria-current");
  buttons[index].setAttribute("aria-current", "true");

  now.replaceChildren();
  const nowCite = document.createElement("cite");
  nowCite.textContent = film.title;
  now.append(nowCite);
  detail.textContent = `${film.year}. ${film.detail}`;
  slate.replaceChildren();
  const slateTitle = document.createElement("p");
  const slateCite = document.createElement("cite");
  slateCite.textContent = film.title;
  slateTitle.append(slateCite);
  const slateYear = document.createElement("p");
  slateYear.textContent = film.year;
  slate.append(slateTitle, slateYear);

  if (clip) {
    slate.hidden = true;
    player.hidden = false;
    player.title = film.title;
    const params = new URLSearchParams({ dnt: "1" });
    if (autoplay) params.set("autoplay", "1");
    if (clip.hash) params.set("h", clip.hash);
    player.src = `https://player.vimeo.com/video/${clip.id}?${params}`;
  } else {
    player.hidden = true;
    player.removeAttribute("src");
    player.title = "";
    slate.hidden = false;
  }

  const hash = `#${slug(film.title)}`;
  if (location.hash !== hash) history.replaceState(null, "", hash);
};

const show = (index, autoplay) => {
  if (index === current) return;

  const swap = () => {
    current = index;
    paint(index, autoplay);
    stage.classList.remove("is-fading");
  };

  if (reduceMotion.matches || current < 0) {
    swap();
    return;
  }

  stage.classList.add("is-fading");
  window.clearTimeout(fadeTimer);
  fadeTimer = window.setTimeout(swap, 240);
};

for (const group of groups) {
  if (group.label) {
    const heading = document.createElement("h2");
    heading.textContent = group.label;
    program.appendChild(heading);
  }

  const list = document.createElement("ul");
  for (const film of group.films) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    const time = document.createElement("time");
    if (/^\d{4}$/.test(film.year)) time.dateTime = film.year;
    time.textContent = film.year;
    const span = document.createElement("span");
    const cite = document.createElement("cite");
    cite.textContent = film.title;
    span.append(cite);
    button.append(time, span);
    const index = films.indexOf(film);
    button.addEventListener("click", () => show(index, true));
    item.appendChild(button);
    list.appendChild(item);
    buttons.push(button);
  }
  program.appendChild(list);
}

program.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  const current = buttons.findIndex((button) => button.getAttribute("aria-current") === "true");
  const next = current + (event.key === "ArrowDown" ? 1 : -1);
  if (next < 0 || next >= buttons.length) return;
  event.preventDefault();
  show(next, true);
  buttons[next].focus();
});

const fromHash = films.findIndex((film) => `#${slug(film.title)}` === location.hash);
if (films.length) show(fromHash >= 0 ? fromHash : 0, false);
})();
