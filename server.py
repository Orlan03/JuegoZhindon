"""Servidor del juego: sirve los archivos estáticos y la tabla de puntuación compartida.

Uso:  python server.py            (puerto 8080, accesible en la red local)
      python server.py 9000       (otro puerto)

Los registros (con WhatsApp) se guardan en data/leaderboard.json y nunca se
sirven al público: la API solo devuelve nombre y puntaje.

Exportar participantes (solo desde este mismo PC):
      http://localhost:8080/admin-exportar

Panel de campaña: http://localhost:8080/admin.html
  Formulario con título, textos, colores y enlaces de YouTube/TikTok. Pide la clave
  de administrador, que se genera sola en data/admin_key.txt y se muestra al arrancar
  (o se fija con la variable de entorno ADMIN_KEY). Se guarda en config.json y
  landing.html lo muestra al público. Los videos MP4/WebM subidos desde el panel
  se guardan en uploads/videos/.
"""

import csv
import io
import ipaddress
import json
import os
import re
import secrets
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DATA_FILE = DATA_DIR / "leaderboard.json"
ADMIN_KEY_FILE = DATA_DIR / "admin_key.txt"
CONFIG_FILE = ROOT / "config.json"
MAX_DISCARD_BYTES = 1024 * 1024
BOARD_SIZE = 10
MAX_SCORE = 100_000
PRIVATE_DIRS = ("data", "__pycache__")
PRIVATE_SUFFIXES = (".py", ".pyc", ".tmp", ".part")
LETTER_RE = re.compile(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]")
# Deben coincidir con PARISHES en game.js.
PARISHES = ("Centro Urbano", "Nazón", "San Francisco de Sageo", "Turupamba", "Jerusalén")
EXPORT_PATH = "/admin-exportar"
# Un túnel (cloudflared, localtunnel, ngrok…) se conecta desde 127.0.0.1, así que la IP no basta:
# cualquier petición que llegue reenviada por un proxy se trata como externa.
PROXY_HEADERS = ("Cf-Connecting-Ip", "Cf-Ray", "X-Forwarded-For", "X-Forwarded-Host", "X-Real-Ip", "Forwarded", "Via")

lock = threading.Lock()
config_lock = threading.Lock()

DEFAULT_CONFIG = {
    "texts": {
        "heroTitle": "¡Gracias por llenar de energía a Biblián!",
        "heroText": "Tu puntaje ya está registrado. Así como recargaste la ciudad en el juego, juntos podemos iluminar el futuro de Biblián.",
        "ctaText": "¡Volver a jugar!",
    },
    "colors": {
        "primaryColor": "#2563eb",
        "backgroundColor": "#f8fafc",
    },
    # El panel envía youtubeUrl y tiktokUrls; los id y enlaces canónicos los calcula el servidor al guardar.
    "media": {
        "youtubeUrl": "",
        "youtubeId": "",
        "youtubeVertical": False,
        "tiktoks": [],
        # Videos subidos desde el panel: solo se agregan o quitan con /api/videos.
        "videos": [],
    },
}
TEXT_LIMITS = {"heroTitle": 200, "heroText": 1000, "ctaText": 60}
MAX_TIKTOKS = 12
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
YOUTUBE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
TIKTOK_VIDEO_ID_RE = re.compile(r"^\d{8,25}$")

VIDEO_DIR = ROOT / "uploads" / "videos"
VIDEO_URL_PREFIX = "/uploads/videos/"
VIDEO_TYPES = {".mp4": "video/mp4", ".webm": "video/webm"}
VIDEO_NAME_RE = re.compile(r"^[0-9a-f]{16}\.(?:mp4|webm)$")
# El túnel gratuito de Cloudflare rechaza subidas de más de 100 MB.
MAX_VIDEO_MB = 95
MAX_VIDEO_BYTES = MAX_VIDEO_MB * 1024 * 1024
MAX_VIDEOS = 12
VIDEO_TITLE_MAX = 120
STREAM_CHUNK = 256 * 1024
RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")


def load_admin_key():
    env_key = os.environ.get("ADMIN_KEY", "").strip()
    if env_key:
        return env_key
    try:
        key = ADMIN_KEY_FILE.read_text(encoding="utf-8").strip()
        if key:
            return key
    except FileNotFoundError:
        pass
    DATA_DIR.mkdir(exist_ok=True)
    key = secrets.token_urlsafe(12)
    ADMIN_KEY_FILE.write_text(key, encoding="utf-8")
    return key


ADMIN_KEY = load_admin_key()


def load_config():
    try:
        stored = json.loads(CONFIG_FILE.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        stored = {}
    merged = {}
    for section, defaults in DEFAULT_CONFIG.items():
        values = stored.get(section) if isinstance(stored.get(section), dict) else {}
        merged[section] = {k: values.get(k, v) for k, v in defaults.items()}

    media = stored.get("media") if isinstance(stored.get("media"), dict) else {}
    tiktoks = media.get("tiktoks")
    if not isinstance(tiktoks, list):
        # Formato anterior: un solo TikTok en tiktokUrl / tiktokId / tiktokCite.
        tiktoks = [{"url": media.get("tiktokUrl", ""), "id": media.get("tiktokId", ""), "cite": media.get("tiktokCite", "")}]
    merged["media"]["tiktoks"] = [
        {"url": str(t.get("url", "")), "id": t["id"], "cite": str(t.get("cite", ""))}
        for t in tiktoks
        if isinstance(t, dict) and TIKTOK_VIDEO_ID_RE.match(str(t.get("id", "")))
    ]
    videos = media.get("videos") if isinstance(media.get("videos"), list) else []
    merged["media"]["videos"] = [
        {"file": v["file"], "title": str(v.get("title", ""))[:VIDEO_TITLE_MAX]}
        for v in videos
        if isinstance(v, dict) and VIDEO_NAME_RE.match(str(v.get("file", ""))) and (VIDEO_DIR / v["file"]).is_file()
    ]
    return merged


def video_extension(head):
    """Reconoce el formato por los primeros bytes, sin fiarse del nombre del archivo."""
    if head[4:8] == b"ftyp":
        # "qt  " es el .mov de iPhone: Chrome y Android no siempre lo reproducen.
        return None if head[8:12] == b"qt  " else ".mp4"
    if head[:4] == b"\x1a\x45\xdf\xa3":
        return ".webm"
    return None


def parse_youtube(url):
    """Devuelve (id, es_vertical) de un enlace de YouTube; acepta watch, youtu.be, shorts, embed y live."""
    parts = urllib.parse.urlsplit(url.strip())
    host = (parts.hostname or "").lower()
    for prefix in ("www.", "m.", "music."):
        if host.startswith(prefix):
            host = host[len(prefix):]
    segments = [s for s in parts.path.split("/") if s]
    video_id, vertical = "", False
    if parts.scheme in ("http", "https"):
        if host == "youtu.be" and segments:
            video_id = segments[0]
        elif host in ("youtube.com", "youtube-nocookie.com"):
            if parts.path == "/watch":
                video_id = (urllib.parse.parse_qs(parts.query).get("v") or [""])[0]
            elif len(segments) >= 2 and segments[0] in ("shorts", "embed", "live"):
                video_id, vertical = segments[1], segments[0] == "shorts"
    if not YOUTUBE_ID_RE.match(video_id):
        raise ValueError("No reconozco el enlace de YouTube. Copia el enlace del video (por ejemplo, https://youtu.be/…).")
    return video_id, vertical


def clean_config(data):
    """Solo acepta los campos del panel con valores seguros; lo que no viene se conserva."""
    if not isinstance(data, dict):
        raise ValueError("Formato de configuración inválido.")
    current = load_config()
    for key, value in (data.get("texts") or {}).items():
        if key in DEFAULT_CONFIG["texts"]:
            if not isinstance(value, str):
                raise ValueError(f"Texto inválido en {key}.")
            current["texts"][key] = value.strip()[: TEXT_LIMITS[key]]
    for key, value in (data.get("colors") or {}).items():
        if key in DEFAULT_CONFIG["colors"]:
            if not isinstance(value, str) or not COLOR_RE.match(value):
                raise ValueError("Los colores deben tener el formato #RRGGBB.")
            current["colors"][key] = value.lower()

    media = data.get("media") or {}
    if "youtubeUrl" in media:
        url = str(media["youtubeUrl"] or "").strip()[:500]
        video_id, vertical = parse_youtube(url) if url else ("", False)
        current["media"].update(youtubeUrl=url, youtubeId=video_id, youtubeVertical=vertical)
    if "tiktokUrls" in media:
        urls = media["tiktokUrls"]
        if not isinstance(urls, list):
            raise ValueError("Formato de TikTok inválido.")
        urls = [u.strip()[:500] for u in urls if isinstance(u, str) and u.strip()]
        if len(urls) > MAX_TIKTOKS:
            raise ValueError(f"Puedes poner hasta {MAX_TIKTOKS} videos de TikTok.")
        known = {t["url"]: t for t in current["media"]["tiktoks"]}
        tiktoks, seen = [], set()
        for number, url in enumerate(urls, 1):
            entry = known.get(url)
            if not entry:
                video_id, cite = resolve_tiktok(url)
                if not video_id:
                    raise ValueError(f"No reconozco el enlace de TikTok n.º {number}. Copia el enlace del video desde TikTok y pégalo de nuevo.")
                entry = {"url": url, "id": video_id, "cite": cite}
            if entry["id"] not in seen:
                seen.add(entry["id"])
                tiktoks.append(entry)
        current["media"]["tiktoks"] = tiktoks
    return current


def save_config(config):
    tmp = CONFIG_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(config, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(CONFIG_FILE)


TIKTOK_ID_RE = re.compile(r"/(?:video|embed/v2|player/v1|v)/(\d{8,25})")
TIKTOK_USER_RE = re.compile(r"/(@[A-Za-z0-9._]{1,40})/video/")


def is_tiktok_host(host):
    host = (host or "").lower()
    return host == "tiktok.com" or host.endswith(".tiktok.com")


class TikTokOnlyRedirects(urllib.request.HTTPRedirectHandler):
    # Los enlaces cortos redirigen varias veces: nunca se sigue una redirección fuera de TikTok.
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not is_tiktok_host(urllib.parse.urlsplit(newurl).hostname):
            raise urllib.error.HTTPError(newurl, code, "Redirección fuera de TikTok", headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def tiktok_from_path(path):
    match = TIKTOK_ID_RE.search(path)
    if not match:
        return "", ""
    video_id = match.group(1)
    user = TIKTOK_USER_RE.search(path)
    cite = f"https://www.tiktok.com/{user.group(1)}/video/{video_id}" if user else f"https://www.tiktok.com/embed/v2/{video_id}"
    return video_id, cite


def resolve_tiktok(url):
    """Devuelve (id, enlace canónico) de un video de TikTok; los enlaces cortos de la app se resuelven."""
    parts = urllib.parse.urlsplit(url.strip())
    if parts.scheme not in ("http", "https") or not is_tiktok_host(parts.hostname):
        return "", ""
    video_id, cite = tiktok_from_path(parts.path)
    if video_id:
        return video_id, cite
    opener = urllib.request.build_opener(TikTokOnlyRedirects)
    request = urllib.request.Request(urllib.parse.urlunsplit(parts), headers={"User-Agent": "Mozilla/5.0"})
    try:
        with opener.open(request, timeout=8) as resp:
            final = resp.geturl()
    except (urllib.error.URLError, ValueError, TimeoutError):
        return "", ""
    return tiktok_from_path(urllib.parse.urlsplit(final).path)


def load_rows():
    try:
        rows = json.loads(DATA_FILE.read_text(encoding="utf-8"))
        return rows if isinstance(rows, list) else []
    except (FileNotFoundError, json.JSONDecodeError):
        return []


def save_rows(rows):
    DATA_DIR.mkdir(exist_ok=True)
    tmp = DATA_FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(DATA_FILE)


def best_by_phone(rows):
    """Cada partida registrada es una fila; aquí queda solo la mejor de cada WhatsApp."""
    best = {}
    for r in rows:
        current = best.get(r["whatsapp"])
        if current is None or (r["score"], -r["at"]) > (current["score"], -current["at"]):
            best[r["whatsapp"]] = r
    return best


def public_top(rows):
    ordered = sorted(best_by_phone(rows).values(), key=lambda r: (-r["score"], r["at"]))[:BOARD_SIZE]
    return [{"name": r["name"], "score": r["score"], "token": r["token"]} for r in ordered]


def csv_safe(value):
    # Evita que Excel interprete como fórmula un nombre escrito por un jugador (=, +, -, @).
    text = str(value)
    return f"'{text}" if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


def international(phone):
    return f"593{phone[1:]}" if phone.startswith("0") else phone


def participants_csv(rows):
    """Todas las partidas registradas, de mayor a menor puntaje, con el mejor de cada WhatsApp al lado."""
    ranked = sorted(rows, key=lambda r: (-r["score"], r["at"]))
    best = {phone: r["score"] for phone, r in best_by_phone(rows).items()}
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";", lineterminator="\r\n")
    writer.writerow([
        "N.º", "Nombre", "WhatsApp", "Enlace WhatsApp", "¿Vive en Biblián?", "Parroquia",
        "Puntaje (kW)", "Mejor puntaje de este WhatsApp (kW)",
        "Fecha de registro", "Fecha del consentimiento", "Versión del aviso",
    ])
    for i, r in enumerate(ranked, 1):
        intl = international(r["whatsapp"])
        consent_at = r.get("consent_at")
        es_biblian = r.get("es_biblian")
        writer.writerow([
            i,
            csv_safe(r["name"]),
            f"+{intl[:3]} {intl[3:5]} {intl[5:8]} {intl[8:]}" if intl.startswith("593") else r["whatsapp"],
            f"https://wa.me/{intl}",
            {True: "Sí", False: "No"}.get(es_biblian, ""),
            # Solo quien respondió "Sí" tiene parroquia; con "No" o sin respuesta la celda queda vacía.
            (r.get("parroquia") or "") if es_biblian is True else "",
            r["score"],
            best[r["whatsapp"]],
            datetime.fromtimestamp(r["at"]).strftime("%Y-%m-%d %H:%M"),
            datetime.fromtimestamp(consent_at).strftime("%Y-%m-%d %H:%M") if consent_at else "",
            csv_safe(r.get("privacy_version", "")),
        ])
    # BOM UTF-8: Excel muestra bien las tildes y la ñ.
    return ("\ufeff" + buf.getvalue()).encode("utf-8")


class GameHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def list_directory(self, path):
        self.send_error(HTTPStatus.NOT_FOUND)
        return None

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def is_private(self):
        # Se decide sobre la ruta real en disco, no sobre la URL: "/%64ata/…" o "/DATA/…" llegan al
        # mismo archivo que "/data/…" una vez decodificados por translate_path y por Windows.
        try:
            rel = Path(self.translate_path(self.path)).resolve().relative_to(ROOT)
        except (ValueError, OSError):
            return True
        parts = [p.lower() for p in rel.parts]
        if not parts:
            return False
        return (
            parts[0] in PRIVATE_DIRS
            or any(p.startswith(".") for p in parts)
            or parts[-1].endswith(PRIVATE_SUFFIXES)
        )

    def is_admin(self):
        key = self.headers.get("X-Admin-Key", "")
        return bool(key) and secrets.compare_digest(key.encode("utf-8"), ADMIN_KEY.encode("utf-8"))

    def read_body(self, limit):
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length > limit:
            self.discard_body(length)
            raise OverflowError
        return self.rfile.read(length)

    def discard_body(self, length=None):
        # Si se responde sin leer el cuerpo, el navegador ve un corte de conexión en vez del error.
        remaining = int(self.headers.get("Content-Length", 0) or 0) if length is None else length
        if remaining > MAX_DISCARD_BYTES:
            self.close_connection = True
            return
        while remaining > 0:
            chunk = self.rfile.read(min(remaining, 64 * 1024))
            if not chunk:
                break
            remaining -= len(chunk)

    def reject_unauthorized(self):
        self.discard_body()
        return self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "Clave de administrador incorrecta."})

    def handle_config_post(self):
        if not self.is_admin():
            return self.reject_unauthorized()
        try:
            data = json.loads(self.read_body(64 * 1024) or b"{}")
            with config_lock:
                config = clean_config(data)
                save_config(config)
        except OverflowError:
            return self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {"error": "Configuración demasiado grande."})
        except (ValueError, json.JSONDecodeError) as err:
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": str(err) or "Datos inválidos."})
        return self.send_json(HTTPStatus.OK, {"config": config})

    def iter_body(self, limit):
        """Entrega el cuerpo por trozos. Admite "chunked" porque algunos túneles lo reenvían así."""
        if "chunked" in self.headers.get("Transfer-Encoding", "").lower():
            total = 0
            while True:
                size = int(self.rfile.readline(1024).split(b";")[0].strip() or b"0", 16)
                if size == 0:
                    while self.rfile.readline(1024) not in (b"\r\n", b"\n", b""):
                        pass
                    return
                total += size
                if total > limit:
                    raise OverflowError
                while size:
                    chunk = self.rfile.read(min(size, STREAM_CHUNK))
                    if not chunk:
                        raise ConnectionError
                    size -= len(chunk)
                    yield chunk
                self.rfile.readline(1024)
        remaining = int(self.headers.get("Content-Length", 0) or 0)
        if remaining > limit:
            self.discard_body(remaining)
            raise OverflowError
        while remaining:
            chunk = self.rfile.read(min(remaining, STREAM_CHUNK))
            if not chunk:
                raise ConnectionError
            remaining -= len(chunk)
            yield chunk

    def handle_video_upload(self):
        if not self.is_admin():
            return self.reject_unauthorized()
        with config_lock:
            full = len(load_config()["media"]["videos"]) >= MAX_VIDEOS
        if full:
            self.discard_body()
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": f"Ya hay {MAX_VIDEOS} videos. Borra uno para subir otro."})

        title = " ".join(urllib.parse.unquote(self.headers.get("X-Video-Title", "")).split())[:VIDEO_TITLE_MAX]
        VIDEO_DIR.mkdir(parents=True, exist_ok=True)
        token = secrets.token_hex(8)
        part = VIDEO_DIR / f"{token}.part"
        try:
            with part.open("wb") as out:
                for chunk in self.iter_body(MAX_VIDEO_BYTES):
                    out.write(chunk)
            with part.open("rb") as f:
                ext = video_extension(f.read(12))
        except OverflowError:
            part.unlink(missing_ok=True)
            self.close_connection = True
            return self.send_json(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, {
                "error": f"El video pesa más de {MAX_VIDEO_MB} MB. Expórtalo más liviano (720p suele bastar).",
            })
        except (OSError, ValueError):
            part.unlink(missing_ok=True)
            self.close_connection = True
            try:
                return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "La subida se interrumpió. Inténtalo de nuevo."})
            except OSError:
                return None

        if not ext:
            part.unlink(missing_ok=True)
            return self.send_json(HTTPStatus.BAD_REQUEST, {
                "error": "Solo se aceptan videos MP4 o WebM. Si es un video de iPhone (.mov), expórtalo como MP4.",
            })
        name = f"{token}{ext}"
        part.replace(VIDEO_DIR / name)
        with config_lock:
            config = load_config()
            videos = config["media"]["videos"]
            if len(videos) >= MAX_VIDEOS:
                (VIDEO_DIR / name).unlink(missing_ok=True)
                return self.send_json(HTTPStatus.BAD_REQUEST, {"error": f"Ya hay {MAX_VIDEOS} videos. Borra uno para subir otro."})
            videos.append({"file": name, "title": title})
            save_config(config)
        return self.send_json(HTTPStatus.OK, {"videos": videos})

    def handle_video_delete(self):
        if not self.is_admin():
            return self.reject_unauthorized()
        try:
            name = str(json.loads(self.read_body(4096) or b"{}").get("file", ""))
        except (OverflowError, ValueError, AttributeError):
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Datos inválidos."})
        with config_lock:
            config = load_config()
            videos = config["media"]["videos"]
            kept = [v for v in videos if v["file"] != name]
            if len(kept) == len(videos):
                return self.send_json(HTTPStatus.NOT_FOUND, {"error": "Ese video ya no existe."})
            config["media"]["videos"] = kept
            save_config(config)
        (VIDEO_DIR / name).unlink(missing_ok=True)
        return self.send_json(HTTPStatus.OK, {"videos": kept})

    def send_video(self, name, head_only=False):
        """Sirve un video con soporte de Range: Safari en iPhone no reproduce videos sin él."""
        path = VIDEO_DIR / name
        if not VIDEO_NAME_RE.match(name) or not path.is_file():
            return self.send_error(HTTPStatus.NOT_FOUND)
        size = path.stat().st_size
        start, end = 0, size - 1
        partial = False
        match = RANGE_RE.match(self.headers.get("Range", "").strip())
        if match and (match.group(1) or match.group(2)):
            if match.group(1):
                start = int(match.group(1))
                end = min(int(match.group(2)), size - 1) if match.group(2) else size - 1
            else:
                start = max(0, size - int(match.group(2)))
            if start >= size or start > end:
                self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return None
            partial = True

        length = end - start + 1
        self.send_response(HTTPStatus.PARTIAL_CONTENT if partial else HTTPStatus.OK)
        self.send_header("Content-Type", VIDEO_TYPES[path.suffix])
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Content-Length", str(length))
        # El nombre es aleatorio y nunca se reutiliza: navegadores y Cloudflare pueden guardarlo en caché.
        self.send_header("Cache-Control", "public, max-age=604800, immutable")
        if partial:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if head_only:
            return None
        try:
            with path.open("rb") as f:
                f.seek(start)
                while length > 0:
                    chunk = f.read(min(length, STREAM_CHUNK))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    length -= len(chunk)
        except OSError:
            self.close_connection = True
        return None

    def is_local_admin(self):
        try:
            loopback = ipaddress.ip_address(self.client_address[0]).is_loopback
        except ValueError:
            loopback = False
        return loopback and not any(self.headers.get(h) for h in PROXY_HEADERS)

    def send_export(self):
        with lock:
            body = participants_csv(load_rows())
        filename = f"participantes_biblian_{datetime.now():%Y%m%d_%H%M}.csv"
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "text/csv; charset=utf-8")
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/leaderboard":
            with lock:
                top = public_top(load_rows())
            return self.send_json(HTTPStatus.OK, {"top": top})
        if path == "/api/config":
            with config_lock:
                config = load_config()
            return self.send_json(HTTPStatus.OK, {"config": config})
        if path == "/api/admin/check":
            if not self.is_admin():
                return self.send_json(HTTPStatus.UNAUTHORIZED, {"error": "Clave de administrador incorrecta."})
            return self.send_json(HTTPStatus.OK, {"ok": True})
        if path.rstrip("/") == EXPORT_PATH:
            if not self.is_local_admin():
                return self.send_error(HTTPStatus.NOT_FOUND)
            return self.send_export()
        if path.startswith(VIDEO_URL_PREFIX):
            return self.send_video(path[len(VIDEO_URL_PREFIX):])
        if self.is_private():
            return self.send_error(HTTPStatus.NOT_FOUND)
        return super().do_GET()

    def do_HEAD(self):
        path = self.path.split("?", 1)[0]
        if path.startswith(VIDEO_URL_PREFIX):
            return self.send_video(path[len(VIDEO_URL_PREFIX):], head_only=True)
        if self.is_private():
            return self.send_error(HTTPStatus.NOT_FOUND)
        return super().do_HEAD()

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/config":
            return self.handle_config_post()
        if path == "/api/videos":
            return self.handle_video_upload()
        if path == "/api/videos/delete":
            return self.handle_video_delete()
        if path != "/api/scores":
            return self.send_error(HTTPStatus.NOT_FOUND)
        try:
            length = min(int(self.headers.get("Content-Length", 0)), 4096)
            data = json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError):
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Datos inválidos."})

        name = " ".join(str(data.get("name", "")).split())[:48]
        phone = re.sub(r"\D", "", str(data.get("whatsapp", "")))
        try:
            score = int(data.get("score", -1))
        except (TypeError, ValueError):
            score = -1

        if len(LETTER_RE.findall(name)) < 3:
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Escribe tu nombre y apellido (mínimo 3 letras)."})
        if not re.fullmatch(r"\d{10}", phone):
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "El WhatsApp debe tener 10 dígitos."})
        if not 0 <= score <= MAX_SCORE:
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Puntaje inválido."})
        if data.get("consentPrize") is not True:
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Debes aceptar el aviso de privacidad para participar."})
        # None = sin respuesta (una pestaña abierta con el juego anterior). Con "No" nunca se guarda parroquia.
        es_biblian = data.get("es_biblian")
        if es_biblian is not None and not isinstance(es_biblian, bool):
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Indica si vives en el cantón Biblián."})
        parroquia = data.get("parroquia") if es_biblian else None
        if es_biblian and parroquia not in PARISHES:
            return self.send_json(HTTPStatus.BAD_REQUEST, {"error": "Elige tu parroquia."})
        consent = {
            "consent_prize": True,
            "consent_at": time.time(),
            "privacy_version": str(data.get("privacyVersion", ""))[:20],
        }

        with lock:
            rows = load_rows()
            # Se guardan todas las partidas; el token se reutiliza para reconocer al jugador en el Top.
            previous = next((r for r in rows if r["whatsapp"] == phone), None)
            token = previous["token"] if previous else secrets.token_hex(8)
            rows.append({
                "name": name, "whatsapp": phone, "score": score, "at": time.time(), "token": token,
                "es_biblian": es_biblian, "parroquia": parroquia, **consent,
            })
            save_rows(rows)
            top = public_top(rows)
        return self.send_json(HTTPStatus.OK, {"token": token, "top": top})


class GameServer(ThreadingHTTPServer):
    # El juego pide unas 20 imágenes a la vez; con la cola por defecto (5) Windows rechaza
    # las conexiones sobrantes y el túnel responde "actively refused".
    request_queue_size = 128


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    server = GameServer(("0.0.0.0", port), GameHandler)
    print(f"Biblián Jetpack en http://0.0.0.0:{port}/ (Ctrl+C para detener)", flush=True)
    print(f"Exportar participantes (solo en este PC): http://localhost:{port}{EXPORT_PATH}", flush=True)
    print(f"Panel de campaña: http://localhost:{port}/admin.html  ·  Clave: {ADMIN_KEY}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
