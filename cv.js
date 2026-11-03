(() => {
  if (!document.body.classList.contains("reveal") || document.body.dataset.cvReady) return;
  document.body.dataset.cvReady = "1";

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let started = false;
  const show = () => {
    if (started) return;
    started = true;
    if (!reduce) {
      const roots = [document.querySelector("header p"), document.querySelector("main")].filter(Boolean);
      const chars = [];
      roots.forEach((root) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            return node.nodeValue && node.nodeValue.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
          }
        });
        const texts = [];
        while (walker.nextNode()) texts.push(walker.currentNode);
        texts.forEach((node) => {
          const value = node.nodeValue.replace(/\s+/g, " ").trim();
          if (!value) return;
          const frag = document.createDocumentFragment();
          const readable = document.createElement("span");
          readable.className = "sr";
          readable.textContent = value;
          frag.appendChild(readable);
          for (const letter of value) {
            const span = document.createElement("span");
            span.className = "ch";
            span.setAttribute("aria-hidden", "true");
            span.textContent = letter;
            frag.appendChild(span);
            chars.push(span);
          }
          node.parentNode.replaceChild(frag, node);
        });
      });

      let line = 0;
      let col = 0;
      let lastTop = chars.length ? chars[0].getBoundingClientRect().top : 0;
      chars.forEach((span, index) => {
        const top = span.getBoundingClientRect().top;
        if (index > 0 && top > lastTop + 6) {
          line += 1;
          col = 0;
          lastTop = top;
        }
        span.style.setProperty("--d", line * 40 + Math.min(col, 12) * 7 + "ms");
        col += 1;
      });
    }
    document.body.classList.add("play");
  };

  show();
})();
