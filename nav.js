(function () {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  let active = null;

  const settle = () => {
    const root = document.documentElement;
    root.style.setProperty("--wx", "0px");
    root.style.setProperty("--wy", "0px");
    root.style.setProperty("--flick", "1");
    if (window.__filmTick) {
      window.clearInterval(window.__filmTick);
      window.__filmTick = 0;
    }
  };

  const loadScripts = (doc) => {
    const sources = [...doc.body.querySelectorAll("script[src]")].map((node) => node.getAttribute("src"));
    return sources.reduce(
      (chain, src) =>
        chain.then(() =>
          fetch(src, { credentials: "same-origin", cache: "no-store" }).then((response) => {
            if (!response.ok) throw new Error(src);
            return response.text();
          }).then((code) => {
            const script = document.createElement("script");
            script.textContent = code;
            document.body.appendChild(script);
          })
        ),
      Promise.resolve()
    );
  };

  const go = (url, push) => {
    if (active) return active;
    active = fetch(url, { credentials: "same-origin", cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error("nav");
        return response.text();
      })
      .then((html) => {
        const doc = new DOMParser().parseFromString(html, "text/html");
        settle();
        const introToCv = document.body.classList.contains("intro") && doc.body.classList.contains("cv");
        const update = () => {
          if (push) history.pushState({ theo: true }, "", url);
          document.title = doc.title;
          document.body.className = doc.body.className;
          if (introToCv) document.body.classList.add("reveal");
          document.body.innerHTML = doc.body.innerHTML;
          document.body
            .querySelectorAll("script[src], script:not([type]), script[type='text/javascript'], script[type='module']")
            .forEach((node) => node.remove());
        };
        window.__vtWait = null;
        if (document.startViewTransition && !reduce.matches && !introToCv) {
          const transition = document.startViewTransition(update);
          window.__vtWait = transition.finished;
          return transition.ready.then(() => loadScripts(doc)).then(() => transition.finished);
        }
        update();
        return loadScripts(doc);
      })
      .finally(() => {
        active = null;
      });
    return active;
  };

  document.addEventListener("click", (event) => {
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const link = event.target.closest("a");
    if (!link || !link.closest(".pages")) return;
    const url = new URL(link.href, location.href);
    if (url.origin !== location.origin) return;
    if (url.pathname === location.pathname) return;
    event.preventDefault();
    go(url.pathname + url.search, true).catch(() => {
      location.href = link.href;
    });
  });

  window.addEventListener("popstate", () => {
    go(location.pathname + location.search, false).catch(() => location.reload());
  });
})();
