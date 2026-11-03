#!/usr/bin/env python3
"""Local site server. Saving from admin.html writes the CV and films."""

import hmac
import json
import os
import re
import secrets
import socket
import sys
import threading
import time
from http.cookies import SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent
MAX_BODY = 200_000


def load_env(path):
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


load_env(ROOT / ".env")
PORT = int(os.environ.get("PORT", "8765"))
ADMIN_USER = os.environ.get("ADMIN_USER", "")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "")
COOKIE_NAME = "theo_admin"
SESSION_TTL = 12 * 60 * 60
PROTECTED = {"admin.html", "admin.js", "content.json"}
SESSIONS = {}
SESSIONS_LOCK = threading.Lock()

LOGIN_HTML = """<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Admin — Theo Thompson</title>
    <meta name="robots" content="noindex" />
    <meta name="theme-color" content="#f4f3ef" />
    <link rel="stylesheet" href="styles.css" />
    <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Ctext x='6' y='24' font-family='Times New Roman,Times,serif' font-size='22' fill='%23111'%3ET%3C/text%3E%3C/svg%3E" />
  </head>
  <body class="admin">
    <header>
      <nav class="pages" aria-label="Pages">
        <a href="index.html">Index</a>
        <a href="cv.html">CV</a>
        <a href="films.html">Films</a>
      </nav>
      <h1><span>Theo Thompson</span></h1>
      <p>Sign in to update the CV and the films.</p>
    </header>
    <main>
      <form class="gate" id="login" method="post" action="/api/login">
        <label>
          <span>Username</span>
          <input name="username" autocomplete="username" required />
        </label>
        <label>
          <span>Password</span>
          <input name="password" type="password" autocomplete="current-password" required />
        </label>
        <button type="submit">Enter</button>
        <p id="status" role="status"></p>
      </form>
    </main>
    <script>
      const form = document.querySelector("#login");
      const status = document.querySelector("#status");
      form.querySelector("input[name=username]").focus();
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        status.textContent = "";
        const data = new FormData(form);
        fetch("/api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            username: data.get("username"),
            password: data.get("password"),
          }),
        })
          .then((response) => {
            if (!response.ok) {
              status.textContent = "That username or password is not right.";
              return;
            }
            location.reload();
          })
          .catch(() => {
            status.textContent = "Could not sign in.";
          });
      });
    </script>
  </body>
</html>
"""

VIMEO_ID = re.compile(r"\d{5,12}")
VIMEO_LINK = re.compile(
    r"vimeo\.com/(?:(?:video|manage/videos)/)?(\d{5,12})(?:/([A-Za-z0-9]+))?",
    re.I,
)


class ContentError(ValueError):
    pass


def clean_text(value, limit):
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise ContentError("A field was not text.")
    text = " ".join(value.split())
    if "<!--" in text:
        raise ContentError("That text can’t be saved.")
    if len(text) > limit:
        raise ContentError("A field is too long.")
    return text


def clean_vimeo(value, label):
    text = clean_text(value, 300).rstrip("/")
    if not text:
        return ""
    if VIMEO_ID.fullmatch(text):
        return text
    match = VIMEO_LINK.search(text)
    if not match:
        raise ContentError(f"{label} needs a Vimeo link.")
    link = f"https://vimeo.com/{match.group(1)}"
    if match.group(2):
        return f"{link}/{match.group(2)}"
    privacy = re.search(r"[?&]h=([A-Za-z0-9]+)", text)
    if privacy:
        return f"{link}?h={privacy.group(1)}"
    return link


def safe_id(value):
    return re.sub(r"[^a-z0-9-]", "", str(value or "").lower()).strip("-")


def clean_bio(value):
    if not isinstance(value, list):
        raise ContentError("The biography was not valid.")
    if len(value) > 8:
        raise ContentError("The biography can hold 8 lines.")
    return [line for line in (clean_text(item, 240) for item in value) if line]


def clean_items(value):
    if not isinstance(value, list):
        raise ContentError("A CV list was not valid.")
    if len(value) > 80:
        raise ContentError("A CV list is too long.")
    items = []
    for item in value:
        if not isinstance(item, dict):
            raise ContentError("A CV line was not valid.")
        items.append(
            {
                "year": clean_text(item.get("year", ""), 32),
                "text": clean_text(item.get("text", ""), 500),
            }
        )
    return items


def clean_cv(value):
    if not isinstance(value, list):
        raise ContentError("The CV was not valid.")
    if len(value) > 24:
        raise ContentError("The CV has too many sections.")
    used = set()
    sections = []
    for section in value:
        if not isinstance(section, dict):
            raise ContentError("A CV section was not valid.")
        title = clean_text(section.get("title", ""), 120)
        base = safe_id(section.get("id")) or safe_id(title) or "section"
        candidate = base
        number = 2
        while candidate in used:
            candidate = f"{base}-{number}"
            number += 1
        used.add(candidate)
        groups = section.get("groups")
        if not isinstance(groups, list) or len(groups) > 12:
            raise ContentError("A CV section was not valid.")
        cleaned_groups = []
        for group in groups:
            if not isinstance(group, dict):
                raise ContentError("A CV list was not valid.")
            cleaned_groups.append(
                {
                    "label": clean_text(group.get("label", ""), 120),
                    "items": clean_items(group.get("items")),
                }
            )
        sections.append(
            {
                "id": candidate,
                "title": title,
                "note": clean_text(section.get("note", ""), 300),
                "groups": cleaned_groups,
            }
        )
    return sections


def clean_films(value):
    if not isinstance(value, list):
        raise ContentError("The films were not valid.")
    if len(value) > 12:
        raise ContentError("There are too many film groups.")
    groups = []
    for group in value:
        if not isinstance(group, dict):
            raise ContentError("A film group was not valid.")
        films = group.get("films")
        if not isinstance(films, list) or len(films) > 40:
            raise ContentError("A film group was not valid.")
        cleaned = []
        for film in films:
            if not isinstance(film, dict):
                raise ContentError("A film was not valid.")
            title = clean_text(film.get("title", ""), 200)
            cleaned.append(
                {
                    "title": title,
                    "year": clean_text(film.get("year", ""), 32),
                    "detail": clean_text(film.get("detail", ""), 500),
                    "vimeo": clean_vimeo(film.get("vimeo", ""), title or "A film"),
                }
            )
        groups.append({"label": clean_text(group.get("label", ""), 120), "films": cleaned})
    return groups


def normalize(data):
    if not isinstance(data, dict):
        raise ContentError("That was not valid content.")
    return {
        "bio": clean_bio(data.get("bio")),
        "cv": clean_cv(data.get("cv")),
        "films": clean_films(data.get("films")),
    }


def esc(text):
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def rich(text):
    safe = re.sub(r"\*([^*]+)\*", r"<cite>\1</cite>", esc(text))
    return safe.replace(", UK", ",&nbsp;UK").replace(", NZ", ",&nbsp;NZ")


def bio_html(lines):
    if not lines:
        return ""
    body = "<br />\n        ".join(rich(line) for line in lines)
    return f"      <p>\n        {body}\n      </p>"


def published_sections(sections):
    result = []
    for section in sections:
        groups = []
        for group in section["groups"]:
            items = [item for item in group["items"] if item["year"] or item["text"]]
            if items:
                groups.append({"label": group["label"], "items": items})
        if groups:
            result.append({**section, "groups": groups})
    return result


def section_html(section):
    lines = [f'      <section id="{section["id"]}">', f"        <h2>{esc(section['title'])}</h2>"]
    if section["note"]:
        lines.append(f'        <p class="note">{rich(section["note"])}</p>')
    for group in section["groups"]:
        if group["label"]:
            lines.append(f"        <h3>{esc(group['label'])}</h3>")
        lines.append("        <ul>")
        for item in group["items"]:
            year = esc(item["year"])
            stamp = f' datetime="{year}"' if re.fullmatch(r"\d{4}", item["year"]) else ""
            lines.append("          <li>")
            lines.append(f"            <time{stamp}>{year}</time>")
            lines.append(f"            <p>{rich(item['text'])}</p>")
            lines.append("          </li>")
        lines.append("        </ul>")
    lines.append("      </section>")
    return "\n".join(lines)


def cv_main(sections):
    parts = ["    <main>"]
    parts.extend(section_html(section) for section in published_sections(sections))
    parts.append("    </main>")
    return "\n".join(parts)


def published_films(groups):
    result = []
    for group in groups:
        films = [
            film
            for film in group["films"]
            if film["title"] or film["year"] or film["detail"] or film["vimeo"]
        ]
        if films:
            result.append({"label": group["label"], "films": films})
    return result


def script_block(element_id, value):
    body = json.dumps(value, ensure_ascii=False, indent=2).replace("<", "\\u003c")
    indented = "\n".join(f"      {line}" if line else line for line in body.split("\n"))
    return (
        f'    <script type="application/json" id="{element_id}">\n'
        f"{indented}\n"
        f"    </script>"
    )


def splice(text, name, inner):
    pattern = re.compile(
        rf"(<!-- content:{name} -->\n)(.*?)(\n[ \t]*<!-- /content:{name} -->)",
        re.S,
    )
    match = pattern.search(text)
    if not match:
        raise ContentError(f"The {name} section is missing from the site.")
    return text[: match.start()] + match.group(1) + inner.strip("\n") + match.group(3) + text[match.end() :]


def write_text(path, text):
    path.write_text(text, encoding="utf-8")


def publish(data):
    clean = data
    content_path = ROOT / "content.json"
    cv_path = ROOT / "cv.html"
    films_path = ROOT / "films.html"
    cv = cv_path.read_text(encoding="utf-8")
    films = films_path.read_text(encoding="utf-8")
    cv = splice(cv, "bio", bio_html(clean["bio"]))
    cv = splice(cv, "cv", cv_main(clean["cv"]))
    films = splice(films, "films", script_block("film-data", published_films(clean["films"])))
    write_text(content_path, json.dumps(clean, ensure_ascii=False, indent=2) + "\n")
    write_text(cv_path, cv)
    write_text(films_path, films)


def is_local(host):
    host = host.split("%", 1)[0]
    return host in {"127.0.0.1", "::1"} or host.startswith("::ffff:127.0.0.1")


def same(expected, given):
    if not isinstance(expected, str) or not isinstance(given, str) or expected == "":
        return False
    return hmac.compare_digest(expected.encode(), given.encode())


def new_session():
    now = time.time()
    token = secrets.token_urlsafe(32)
    with SESSIONS_LOCK:
        expired = [key for key, exp in SESSIONS.items() if exp <= now]
        for key in expired:
            del SESSIONS[key]
        SESSIONS[token] = now + SESSION_TTL
    return token


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def reply(self, code, message, headers=None):
        body = message.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def session_token(self):
        raw = self.headers.get("Cookie", "")
        jar = SimpleCookie()
        try:
            jar.load(raw)
        except Exception:
            return ""
        morsel = jar.get(COOKIE_NAME)
        return morsel.value if morsel else ""

    def authenticated(self):
        token = self.session_token()
        if not token:
            return False
        now = time.time()
        with SESSIONS_LOCK:
            expires = SESSIONS.get(token)
            if not expires or expires <= now:
                SESSIONS.pop(token, None)
                return False
        return True

    def guarded(self):
        local = Path(self.translate_path(self.path)).resolve()
        try:
            local.relative_to(ROOT)
        except ValueError:
            return False
        return local.name.lower() in PROTECTED and local.parent == ROOT

    def send_login(self):
        body = LOGIN_HTML.encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def block_admin(self):
        if not self.guarded() or self.authenticated():
            return False
        name = PurePosixPath(unquote(urlparse(self.path).path)).name.lower()
        if name == "admin.html":
            self.send_login()
        else:
            self.reply(401, "Sign in required.")
        return True

    def read_json(self, limit, too_large):
        try:
            length = int(self.headers.get("Content-Length", "0") or "0")
        except ValueError as error:
            raise ContentError(too_large) from error
        if length <= 0 or length > limit:
            raise ContentError(too_large)
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def handle_login(self):
        try:
            data = self.read_json(4_000, "That sign-in was not valid.")
        except (ContentError, UnicodeError, json.JSONDecodeError, ValueError):
            self.reply(400, "That sign-in was not valid.")
            return
        if not isinstance(data, dict) or not (
            same(ADMIN_USER, data.get("username", "")) and same(ADMIN_PASSWORD, data.get("password", ""))
        ):
            time.sleep(0.4)
            self.reply(401, "That username or password is not right.")
            return
        cookie = f"{COOKIE_NAME}={new_session()}; HttpOnly; SameSite=Strict; Path=/; Max-Age={SESSION_TTL}"
        self.reply(200, "Signed in", {"Set-Cookie": cookie})

    def do_HEAD(self):
        if self.block_admin():
            return
        super().do_HEAD()

    def do_GET(self):
        if self.block_admin():
            return
        super().do_GET()

    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/login":
            self.handle_login()
            return
        if path != "/api/content":
            self.reply(404, "Not found.")
            return
        if not self.authenticated():
            self.reply(401, "Sign in required.")
            return
        if not is_local(self.client_address[0]):
            self.reply(403, "Saving is only available on this computer.")
            return
        try:
            data = self.read_json(MAX_BODY, "That update is too large.")
            publish(normalize(data))
        except ContentError as error:
            self.reply(400, str(error))
            return
        except (UnicodeError, json.JSONDecodeError, ValueError):
            self.reply(400, "That was not valid content.")
            return
        except OSError:
            self.reply(500, "The site files could not be written.")
            return
        self.reply(200, "Saved")


class Server(ThreadingHTTPServer):
    address_family = socket.AF_INET6
    allow_reuse_address = True
    daemon_threads = True

    def server_bind(self):
        self.socket.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 0)
        super().server_bind()


class PublicServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def serve():
    if os.environ.get("PORT"):
        server = PublicServer(("0.0.0.0", PORT), Handler)
    else:
        server = Server(("::", PORT), Handler)
    print(f"Site:  http://127.0.0.1:{PORT}/", flush=True)
    print(f"Admin: http://127.0.0.1:{PORT}/admin.html", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print()
    finally:
        server.server_close()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "publish":
        publish(normalize(json.loads((ROOT / "content.json").read_text(encoding="utf-8"))))
    else:
        serve()
