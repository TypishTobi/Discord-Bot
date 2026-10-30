"""Postet das Regelwerk mit dem "Minecraft-Name eintragen"-Button in einen Kanal.

Aufruf:  python3 scripts/post_button.py <kanal-id> [<nachricht-id>]
Mit Nachricht-ID wird die bestehende Nachricht des Bots bearbeitet statt neu gepostet.
Umgebungsvariablen: DISCORD_TOKEN, CODEWORD (ersetzt {CODEWORD} in rules/regelwerk.md)
"""
import json
import os
import sys
import urllib.error
import urllib.request

API = "https://discord.com/api/v10"
RULES_FILE = os.path.join(os.path.dirname(__file__), "..", "rules", "regelwerk.md")

MESSAGE = {
    "embeds": [{
        "title": "🎮 Minecraft-Name eintragen",
        "description": (
            "Hast du die Regeln gelesen und akzeptiert? Dann trag hier deinen "
            "**Minecraft-Namen (Java Edition)** ein. Er wird auf der Teilnehmerliste "
            "auf unserer Website angezeigt.\n\n"
            "Du kannst ihn jederzeit ändern, indem du erneut auf den Button klickst."
        ),
        "color": 0x3498DB,  # blau
    }],
    "components": [{
        "type": 1,
        "components": [{
            "type": 2,
            "style": 3,  # grün
            "label": "Regeln akzeptieren & Namen eintragen",
            "emoji": {"name": "✅"},
            "custom_id": "mc_register",
        }],
    }],
}


def build_message(codeword):
    with open(RULES_FILE, encoding="utf-8") as f:
        rules = f.read().strip()
    if "{CODEWORD}" in rules:
        if not codeword:
            sys.exit("CODEWORD fehlt (Repo-Variable), wird im Regelwerk gebraucht.")
        rules = rules.replace("{CODEWORD}", codeword)
    if len(rules.encode("utf-16-le")) // 2 > 4096:
        sys.exit("Regelwerk ist länger als 4096 Zeichen (Discord-Limit für ein Embed).")
    rules_embed = {"description": rules, "color": MESSAGE["embeds"][0]["color"]}
    return {**MESSAGE, "embeds": [rules_embed, *MESSAGE["embeds"]]}


def main():
    args = [a.strip() for a in sys.argv[1:] if a.strip()]
    if not 1 <= len(args) <= 2 or not all(a.isdigit() for a in args):
        sys.exit(__doc__)
    channel_id, message_id = args[0], (args[1] if len(args) == 2 else None)
    token = os.environ.get("DISCORD_TOKEN", "").strip()
    if not token:
        sys.exit("DISCORD_TOKEN fehlt.")
    message = build_message(os.environ.get("CODEWORD", "").strip())

    url = f"{API}/channels/{channel_id}/messages" + (f"/{message_id}" if message_id else "")
    req = urllib.request.Request(
        url,
        data=json.dumps(message).encode(),
        method="PATCH" if message_id else "POST",
        headers={
            "Authorization": f"Bot {token}",
            "Content-Type": "application/json",
            "User-Agent": "DiscordBot (https://github.com, 1.0) discord-role-site",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            print("Bearbeitet" if message_id else "Gepostet", "- Nachricht-ID:", json.load(res)["id"])
    except urllib.error.HTTPError as err:
        hint = {403: "Der Bot braucht in diesem Kanal 'Kanal ansehen' und 'Nachrichten senden'.",
                404: "Kanal nicht gefunden: ID prüfen."}.get(err.code, err.read().decode(errors="replace"))
        sys.exit(f"Discord-API {err.code}: {hint}")


if __name__ == "__main__":
    main()
