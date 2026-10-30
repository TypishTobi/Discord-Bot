"""Registriert die Slash-Befehle /mcname und /login auf dem Server (einmalig bzw. nach Änderungen).

Aufruf:  python3 scripts/register_commands.py
Umgebungsvariablen: DISCORD_TOKEN, GUILD_ID
"""
import json
import os
import sys
import urllib.error
import urllib.request

API = "https://discord.com/api/v10"
MODERATE_MEMBERS = 1 << 40

COMMANDS = [{
    "name": "mcname",
    "description": "Minecraft-Namen von Mitgliedern verwalten (Team)",
    # Nur für Mitglieder mit "Mitglieder im Timeout" sichtbar; anpassbar unter
    # Servereinstellungen -> Integrationen. Der Worker prüft zusätzlich MIN_ROLE_ID.
    "default_member_permissions": str(MODERATE_MEMBERS),
    "contexts": [0],
    "options": [
        {
            "type": 1,
            "name": "setzen",
            "description": "Minecraft-Namen eines Mitglieds setzen oder ändern",
            "options": [
                {"type": 6, "name": "nutzer", "description": "Das Mitglied", "required": True},
                {"type": 3, "name": "name", "description": "Minecraft-Name (Java Edition)",
                 "required": True, "min_length": 3, "max_length": 16},
            ],
        },
        {
            "type": 1,
            "name": "entfernen",
            "description": "Minecraft-Namen eines Mitglieds entfernen",
            "options": [
                {"type": 6, "name": "nutzer", "description": "Das Mitglied", "required": True},
            ],
        },
    ],
}, {
    "name": "login",
    "description": "Einmal-Code für den Team-Login auf der Website (Tierlist)",
    "default_member_permissions": str(MODERATE_MEMBERS),
    "contexts": [0],
}]


def request(method, path, token, payload=None):
    req = urllib.request.Request(
        API + path,
        data=json.dumps(payload).encode() if payload is not None else None,
        method=method,
        headers={
            "Authorization": f"Bot {token}",
            "Content-Type": "application/json",
            "User-Agent": "DiscordBot (https://github.com, 1.0) discord-role-site",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.load(res)
    except urllib.error.HTTPError as err:
        sys.exit(f"Discord-API {err.code} bei {path}: {err.read().decode(errors='replace')}")


def main():
    token = os.environ.get("DISCORD_TOKEN", "").strip()
    guild_id = os.environ.get("GUILD_ID", "").strip()
    if not token or not guild_id:
        sys.exit("DISCORD_TOKEN und GUILD_ID müssen gesetzt sein.")
    app_id = request("GET", "/applications/@me", token)["id"]
    result = request("PUT", f"/applications/{app_id}/guilds/{guild_id}/commands", token, COMMANDS)
    print("Registriert:", ", ".join("/" + c["name"] for c in result))


if __name__ == "__main__":
    main()
