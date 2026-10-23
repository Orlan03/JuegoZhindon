"""Servidor del juego: sirve los archivos estáticos y la tabla de puntuación compartida.

Uso:  python server.py            (puerto 8080, accesible en la red local)
      python server.py 9000       (otro puerto)

Los registros (con WhatsApp) se guardan en data/leaderboard.json y nunca se
sirven al público: la API solo devuelve nombre y puntaje.

Exportar participantes (solo desde este mismo PC):
      http://localhost:8080/admin-exportar               todos (para premios)
      http://localhost:8080/admin-exportar?solo=campana  solo quienes aceptaron info de campaña
"""

import csv
import io
import ipaddress
import json
import re
import secrets
import sys
import threading
import time
from datetime import datetime
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DATA_FILE = DATA_DIR / "leaderboard.json"
BOARD_SIZE = 10
MAX_SCORE = 100_000
PRIVATE_PREFIXES = ("/data/", "/server.py")
LETTER_RE = re.compile(r"[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]")
EXPORT_PATH = "/admin-exportar"
# Un túnel (cloudflared, localtunnel, ngrok…) se conecta desde 127.0.0.1, así que la IP no basta:
# cualquier petición que llegue reenviada por un proxy se trata como externa.
PROXY_HEADERS = ("Cf-Connecting-Ip", "Cf-Ray", "X-Forwarded-For", "X-Forwarded-Host", "X-Real-Ip", "Forwarded", "Via")

lock = threading.Lock()


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
        if self.path.split("?", 1)[0] != "/api/scores":
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
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
