"""Servidor del juego: sirve los archivos estáticos y la tabla de puntuación compartida.

Uso:  python server.py            (puerto 8080, accesible en la red local)
      python server.py 9000       (otro puerto)

Los registros (con WhatsApp) se guardan en data/leaderboard.json y nunca se
sirven al público: la API solo devuelve nombre y puntaje.

Exportar participantes (solo desde este mismo PC):
      http://localhost:8080/admin-exportar               todos (para premios)
      http://localhost:8080/admin-exportar?solo=campana  solo quienes aceptaron info de campaña

Panel de campaña: http://localhost:8080/admin.html
  Formulario con título, textos, colores y enlaces de YouTube/TikTok. Pide la clave
  de administrador, que se genera sola en data/admin_key.txt y se muestra al arrancar
  (o se fija con la variable de entorno ADMIN_KEY). Se guarda en config.json y
  landing.html lo muestra al público.
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
PRIVATE_PREFIXES = ("/data/", "/server.py", "/.git")
LETTER_RE = re.compile(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]")
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
    },
}
TEXT_LIMITS = {"heroTitle": 200, "heroText": 1000, "ctaText": 60}
MAX_TIKTOKS = 12
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
YOUTUBE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
TIKTOK_VIDEO_ID_RE = re.compile(r"^\d{8,25}$")


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
    return merged


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


def public_top(rows):
    ordered = sorted(rows, key=lambda r: (-r["score"], r["at"]))[:BOARD_SIZE]
    return [{"name": r["name"], "score": r["score"], "token": r["token"]} for r in ordered]


def csv_safe(value):
    # Evita que Excel interprete como fórmula un nombre escrito por un jugador (=, +, -, @).
    text = str(value)
    return f"'{text}" if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


def international(phone):
    return f"593{phone[1:]}" if phone.startswith("0") else phone


def campaign_consent_label(row):
    if "consent_campaign" not in row:
        return "Sin registro (no contactar)"
    return "Sí" if row["consent_campaign"] else "No"


def participants_csv(rows, campaign_only=False):
    ranked = sorted(rows, key=lambda r: (-r["score"], r["at"]))
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";", lineterminator="\r\n")
    writer.writerow([
        "Puesto", "Nombre", "WhatsApp", "Enlace WhatsApp", "Puntaje (kW)", "Fecha de registro",
        "Acepta info de campaña", "Fecha del consentimiento", "Versión del aviso",
    ])
    for i, r in enumerate(ranked, 1):
        if campaign_only and r.get("consent_campaign") is not True:
            continue
        intl = international(r["whatsapp"])
        consent_at = r.get("consent_at")
        writer.writerow([
            i,
            csv_safe(r["name"]),
            f"+{intl[:3]} {intl[3:5]} {intl[5:8]} {intl[8:]}" if intl.startswith("593") else r["whatsapp"],
            f"https://wa.me/{intl}",
            r["score"],
            datetime.fromtimestamp(r["at"]).strftime("%Y-%m-%d %H:%M"),
            campaign_consent_label(r),
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
        path = self.path.split("?", 1)[0].lower()
        return any(path.startswith(p) for p in PRIVATE_PREFIXES)

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

    def is_local_admin(self):
        try:
            loopback = ipaddress.ip_address(self.client_address[0]).is_loopback
        except ValueError:
            loopback = False
        return loopback and not any(self.headers.get(h) for h in PROXY_HEADERS)

    def send_export(self):
        campaign_only = "solo=campana" in self.path.split("?", 1)[-1]
        with lock:
            body = participants_csv(load_rows(), campaign_only)
        kind = "campana" if campaign_only else "participantes"
        filename = f"{kind}_biblian_{datetime.now():%Y%m%d_%H%M}.csv"
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
        if self.is_private():
            return self.send_error(HTTPStatus.NOT_FOUND)
        return super().do_GET()

    def do_HEAD(self):
        if self.is_private():
            return self.send_error(HTTPStatus.NOT_FOUND)
        return super().do_HEAD()

    def do_POST(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/config":
            return self.handle_config_post()
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
        consent = {
            "consent_prize": True,
            "consent_campaign": data.get("consentCampaign") is True,
            "consent_at": time.time(),
            "privacy_version": str(data.get("privacyVersion", ""))[:20],
        }

        with lock:
            rows = load_rows()
            current = next((r for r in rows if r["whatsapp"] == phone), None)
            if current and score <= current["score"]:
                return self.send_json(HTTPStatus.CONFLICT, {
                    "error": f"Ese WhatsApp ya tiene {current['score']} kW. Supera tu récord para actualizarlo.",
                    "token": current["token"],
                    "top": public_top(rows),
                })
            if current:
                current.update(name=name, score=score, at=time.time(), **consent)
                token = current["token"]
            else:
                token = secrets.token_hex(8)
                rows.append({"name": name, "whatsapp": phone, "score": score, "at": time.time(), "token": token, **consent})
            save_rows(rows)
            top = public_top(rows)
        return self.send_json(HTTPStatus.OK, {"token": token, "top": top})


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    server = ThreadingHTTPServer(("0.0.0.0", port), GameHandler)
    print(f"Biblián Jetpack en http://0.0.0.0:{port}/ (Ctrl+C para detener)", flush=True)
    print(f"Exportar participantes (solo en este PC): http://localhost:{port}{EXPORT_PATH}", flush=True)
    print(f"Panel de campaña: http://localhost:{port}/admin.html  ·  Clave: {ADMIN_KEY}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
