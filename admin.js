(() => {
  const form = document.querySelector("#editor");
  const fields = document.querySelector("#fields");
  const status = document.querySelector("#status");
  let state = null;
  let dirty = false;
  let saving = false;

  const append = (node, children) => {
    for (const child of children) {
      if (child) node.append(child);
    }
    return node;
  };

  const el = (tag, className) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  };

  const text = (tag, value, className) => {
    const node = el(tag, className);
    node.textContent = value;
    return node;
  };

  const mark = () => {
    dirty = true;
    status.textContent = "";
  };

  const field = (label, value, onInput, placeholder) => {
    const input = document.createElement("input");
    input.type = "text";
    input.value = value || "";
    if (placeholder) input.placeholder = placeholder;
    input.addEventListener("input", () => {
      mark();
      onInput(input.value);
    });
    const span = text("span", label);
    return append(el("label"), [span, input]);
  };

  let dragList = null;
  let dragFrom = -1;
  let focusGrip = "";

  const paint = () => {
    const y = window.scrollY;
    fields.replaceChildren(renderCv(), renderFilms());
    window.scrollTo(0, y);
    if (!focusGrip) return;
    const gripNode = fields.querySelector(`[data-grip="${CSS.escape(focusGrip)}"]`);
    focusGrip = "";
    if (gripNode) gripNode.focus();
  };

  const change = () => {
    mark();
    paint();
  };

  const move = (list, index, direction) => {
    const next = index + direction;
    if (next < 0 || next >= list.length) return;
    const [item] = list.splice(index, 1);
    list.splice(next, 0, item);
    change();
  };

  const reorder = (list, from, to) => {
    if (from === to || from < 0 || to < 0 || to >= list.length) return;
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    change();
  };

  const grip = (list, index, name, keyAt) => {
    const button = el("button", "grip");
    button.type = "button";
    button.draggable = true;
    button.dataset.grip = keyAt(index);
    button.title = "Drag to reorder";
    button.setAttribute("aria-label", `Drag ${name}`);
    button.addEventListener("dragstart", (event) => {
      dragList = list;
      dragFrom = index;
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", name);
      button.closest(".line, .entry").classList.add("dragging");
    });
    button.addEventListener("dragend", () => {
      dragList = null;
      dragFrom = -1;
      fields.querySelectorAll(".dragging, .drop-target").forEach((node) => {
        node.classList.remove("dragging", "drop-target");
      });
    });
    button.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      const to = index + (event.key === "ArrowUp" ? -1 : 1);
      if (to < 0 || to >= list.length) return;
      event.preventDefault();
      focusGrip = keyAt(to);
      reorder(list, index, to);
    });
    return button;
  };

  const removeButton = (list, index, name) => {
    const remove = text("button", "Remove", "remove");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${name}`);
    remove.addEventListener("click", () => {
      list.splice(index, 1);
      change();
    });
    return remove;
  };

  const lineBlock = (className, list, index, name, keyAt, children) => {
    const block = el("div", className);
    const parts = [];
    if (list.length > 1) parts.push(grip(list, index, name, keyAt));
    parts.push(...children, removeButton(list, index, name));
    append(block, parts);
    block.addEventListener("dragover", (event) => {
      if (dragList !== list || dragFrom === index) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      fields.querySelectorAll(".drop-target").forEach((node) => {
        if (node !== block) node.classList.remove("drop-target");
      });
      block.classList.add("drop-target");
    });
    block.addEventListener("drop", (event) => {
      if (dragList !== list) return;
      event.preventDefault();
      const from = dragFrom;
      dragList = null;
      reorder(list, from, index);
    });
    return block;
  };

  const shift = (glyph, label, onClick) => {
    const button = text("button", glyph, "shift");
    button.type = "button";
    button.title = label;
    button.setAttribute("aria-label", label);
    button.addEventListener("click", onClick);
    return button;
  };

  const moves = (list, index, name, removeLabel = "Remove") => {
    const buttons = [];
    if (index > 0) buttons.push(shift("↑", `Move ${name} up`, () => move(list, index, -1)));
    if (index < list.length - 1) buttons.push(shift("↓", `Move ${name} down`, () => move(list, index, 1)));

    const remove = text("button", removeLabel, "remove");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${name}`);
    remove.addEventListener("click", () => {
      list.splice(index, 1);
      change();
    });
    buttons.push(remove);

    return append(el("div", "moves"), buttons);
  };

  const adder = (label, onClick) => {
    const button = text("button", label);
    button.type = "button";
    button.className = "add";
    button.addEventListener("click", () => {
      onClick();
      change();
    });
    return button;
  };

  const uniqueId = (title) => {
    const base = String(title || "section")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "section";
    const used = new Set(state.cv.map((section) => section.id));
    let id = base;
    let number = 2;
    while (used.has(id)) {
      id = `${base}-${number}`;
      number += 1;
    }
    return id;
  };

  const renderCv = () => {
    const bio = state.bio.map((line, index) =>
      lineBlock("block line", state.bio, index, "biography line", (place) => `bio-${place}`, [
        field("Line", line, (value) => {
          state.bio[index] = value;
        }),
      ])
    );

    const sections = state.cv.map((section, sectionIndex) => {
      const heading = text("h3", section.title || "Untitled section");
      const groups = section.groups.map((group, groupIndex) => {
        const items = group.items.map((item, itemIndex) =>
          lineBlock(
            "block line",
            group.items,
            itemIndex,
            item.text || "line",
            (place) => `cv-${sectionIndex}-${groupIndex}-${place}`,
            [
              append(el("div", "row"), [
                field("Year", item.year, (value) => {
                  item.year = value;
                }),
                field("Line", item.text, (value) => {
                  item.text = value;
                }),
              ]),
            ]
          )
        );
        return append(el("div", "group"), [
          append(el("div", "head"), [
            field(
              "Heading",
              group.label,
              (value) => {
                group.label = value;
              },
              "Only if this list needs a heading"
            ),
            moves(section.groups, groupIndex, group.label || "list", "Remove list"),
          ]),
          ...items,
          adder("Add a line", () => group.items.push({ year: "", text: "" })),
        ]);
      });

      return append(el("div", "section"), [
        append(el("div", "head"), [
          heading,
          moves(state.cv, sectionIndex, section.title || "section", "Remove section"),
        ]),
        field("Section", section.title, (value) => {
          section.title = value;
          heading.textContent = value.trim() || "Untitled section";
        }),
        field("Note", section.note, (value) => {
          section.note = value;
        }, "Optional"),
        ...groups,
        adder("Add a list", () => section.groups.push({ label: "", items: [{ year: "", text: "" }] })),
      ]);
    });

    return append(el("section"), [
      text("h2", "CV"),
      text("p", "Wrap a title in asterisks for italics, as in *Killdeer*.", "hint"),
      text("h3", "Biography"),
      ...bio,
      adder("Add a line", () => state.bio.push("")),
      ...sections,
      adder("Add a section", () =>
        state.cv.push({
          id: uniqueId("section"),
          title: "",
          note: "",
          groups: [{ label: "", items: [{ year: "", text: "" }] }],
        })
      ),
    ]);
  };

  const renderFilms = () => {
    const groups = state.films.map((group, groupIndex) => {
      const heading = text("h3", group.label || "Untitled group");
      const films = group.films.map((film, filmIndex) =>
        lineBlock(
          "block entry",
          group.films,
          filmIndex,
          film.title || "film",
          (place) => `film-${groupIndex}-${place}`,
          [
            field("Title", film.title, (value) => {
              film.title = value;
            }),
            field("Year", film.year, (value) => {
              film.year = value;
            }),
            field("Detail", film.detail, (value) => {
              film.detail = value;
            }),
            field("Vimeo link", film.vimeo, (value) => {
              film.vimeo = value;
            }, "https://vimeo.com/…"),
          ]
        )
      );
      return append(el("div", "group"), [
        append(el("div", "head"), [
          heading,
          moves(state.films, groupIndex, group.label || "group", "Remove group"),
        ]),
        field("Group", group.label, (value) => {
          group.label = value;
          heading.textContent = value.trim() || "Untitled group";
        }),
        ...films,
        adder("Add a film", () => group.films.push({ title: "", year: "", detail: "", vimeo: "" })),
      ]);
    });

    return append(el("section"), [
      text("h2", "Films page"),
      text("p", "A Vimeo link plays when that film is chosen.", "hint"),
      ...groups,
      adder("Add a group", () =>
        state.films.push({ label: "", films: [{ title: "", year: "", detail: "", vimeo: "" }] })
      ),
    ]);
  };

  window.addEventListener("beforeunload", (event) => {
    if (!dirty) return;
    event.preventDefault();
    event.returnValue = "";
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!state || saving) return;
    saving = true;
    status.textContent = "Saving";
    const payload = JSON.parse(JSON.stringify(state));
    delete payload.index;
    fetch("/api/content", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(async (response) => {
        const message = await response.text();
        if (!response.ok) {
          throw new Error(
            message.includes("<")
              ? "Could not save. Open this page from the local site."
              : message || "Could not save."
          );
        }
        dirty = false;
        status.textContent = "Saved";
      })
      .catch((error) => {
        status.textContent =
          error.message === "Failed to fetch"
            ? "Could not save. Open this page from the local site."
            : error.message;
      })
      .finally(() => {
        saving = false;
      });
  });

  fetch("content.json", { cache: "no-store", credentials: "same-origin" })
    .then((response) => {
      if (response.status === 401) throw new Error("Sign in required.");
      if (!response.ok) throw new Error("load");
      return response.json();
    })
    .then((data) => {
      state = data;
      paint();
    })
    .catch((error) => {
      status.textContent = error.message === "load" ? "Could not load the site." : error.message;
    });
})();
