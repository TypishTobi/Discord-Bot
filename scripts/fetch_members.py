"""Holt alle Mitglieder mit bestimmten Rollen von der Discord-API und schreibt sie als JSON.

Aufruf:  python3 scripts/fetch_members.py <ausgabe.json> [--previous <alte.json>]

Umgebungsvariablen: DISCORD_TOKEN, GUILD_ID, ROLE_IDS (kommagetrennt),
optional MC_CHANNEL_ID (Kanal mit den Minecraft-Namen, siehe worker/worker.js).
Mit --previous wird verglichen, ob sich etwas geändert hat; das Ergebnis landet
als changed=true/false in $GITHUB_OUTPUT (falls gesetzt).
"""
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

API = "https://discord.com/api/v10"
CDN = "https://cdn.discordapp.com"


def api_get(path, token):
    req = urllib.request.Request(
        API + path,
        headers={
            "Authorization": f"Bot {token}",
            "User-Agent": "DiscordBot (https://github.com, 1.0) discord-role-site",
        },
    )
    for _ in range(5):
        try:
            with urllib.request.urlopen(req, timeout=30) as res:
                return json.load(res)
        except urllib.error.HTTPError as err:
            if err.code == 429:  # Rate-Limit: kurz warten und erneut versuchen
                wait = float(json.load(err).get("retry_after", 1))
                time.sleep(wait + 0.5)
                continue
            body = err.read().decode(errors="replace")
            hints = {
                401: "Token ungültig.",
                403: "Kein Zugriff: Ist der Bot auf dem Server und der Server Members Intent aktiv?",
                404: "Server nicht gefunden: GUILD_ID prüfen.",
            }
            sys.exit(f"Discord-API {err.code} bei {path}: {hints.get(err.code, body)}")
    sys.exit(f"Discord-API: zu viele Rate-Limits bei {path}")


def fetch_all_members(guild_id, token):
    members, after = [], "0"
    while True:
        batch = api_get(f"/guilds/{guild_id}/members?limit=1000&after={after}", token)
        members.extend(batch)
        if len(batch) < 1000:
            return members
        after = batch[-1]["user"]["id"]


# Steht allein ("mc:…") oder als kleine Zeile "-# mc:…" unter dem Ping;
# "mcdel:<id>" bedeutet, dass das Team den Eintrag entfernt hat
MC_RE = re.compile(r"^(?:-# )?(?:mc:(\d+):(\w{3,16}):([0-9a-f]{32})|mcdel:(\d+))$", re.M)


def fetch_minecraft_names(channel_id, token):
    """Liest die vom Worker geschriebenen Nachrichten; die neueste pro Nutzer gilt."""
    bot_id = api_get("/users/@me", token)["id"]
    names, before = {}, None
    while True:
        query = f"?limit=100&before={before}" if before else "?limit=100"
        batch = api_get(f"/channels/{channel_id}/messages{query}", token)  # neueste zuerst
        for msg in batch:
            # Nur Nachrichten des eigenen Bots zählen, damit niemand Namen fälschen kann
            if msg["author"]["id"] != bot_id:
                continue
            match = MC_RE.search(msg.get("content", ""))
            if not match:
                continue
            user_id = match.group(1) or match.group(4)
            if user_id not in names:
                names[user_id] = {"name": match.group(2), "uuid": match.group(3)} if match.group(1) else None
        if len(batch) < 100:
            return {uid: entry for uid, entry in names.items() if entry}
        before = batch[-1]["id"]


def avatar_url(guild_id, member):
    user = member["user"]
    if member.get("avatar"):  # Server-spezifischer Avatar
        return f"{CDN}/guilds/{guild_id}/users/{user['id']}/avatars/{member['avatar']}.png?size=128"
    if user.get("avatar"):
        return f"{CDN}/avatars/{user['id']}/{user['avatar']}.png?size=128"
    return f"{CDN}/embed/avatars/{(int(user['id']) >> 22) % 6}.png"


def role_key(name):
    """Vergleichsschlüssel für Rollennamen: nur Buchstaben/Ziffern, klein ("🛡 ┃ Sr. Admin" -> "sradmin")."""
    return "".join(c for c in name.casefold() if c.isalnum())


def split_rank(display_name, roles_by_key):
    """'Admin | Mrtx' -> Rang 'Admin' + Name 'Mrtx'; Rang wird einer Discord-Rolle zugeordnet."""
    if "|" not in display_name:
        return None, display_name.strip(), -1, None
    rank, name = (part.strip() for part in display_name.split("|", 1))
    role = roles_by_key.get(role_key(rank))
    if not role:
        return rank, name, -1, None
    color = f"#{role['color']:06x}" if role["color"] else None
    return rank, name, role["position"], color


def build_payload(guild, roles, members, role_ids, mc_names=None):
    mc_names = mc_names or {}
    roles_by_id = {r["id"]: r for r in roles}
    roles_by_key = {}
    for r in sorted(roles, key=lambda r: r["position"]):  # bei gleichen Namen gewinnt die höhere Rolle
        roles_by_key[role_key(r["name"])] = r
    result = []
    for role_id in role_ids:
        role = roles_by_id.get(role_id)
        if not role:
            print(f"WARNUNG: Rolle {role_id} nicht gefunden", file=sys.stderr)
            continue
        holders = [m for m in members if role_id in m["roles"] and not m["user"].get("bot")]
        entries = []
        for m in holders:
            display_name = m.get("nick") or m["user"].get("global_name") or m["user"]["username"]
            rank, name, rank_position, rank_color = split_rank(display_name, roles_by_key)
            entries.append({
                "id": m["user"]["id"],
                "username": m["user"]["username"],
                "displayName": display_name,
                "rank": rank,
                "name": name,
                "rankPosition": rank_position,
                "rankColor": rank_color,
                "minecraft": mc_names.get(m["user"]["id"], {}).get("name"),
                "minecraftUuid": mc_names.get(m["user"]["id"], {}).get("uuid"),
                "avatar": avatar_url(guild["id"], m),
                "roles": [r for r in role_ids if r in m["roles"]],
                "joinedAt": m.get("joined_at"),
            })
        # Höchster Rang zuerst, Leute ohne Rang ganz unten, innerhalb eines Rangs alphabetisch
        entries.sort(key=lambda e: (-e["rankPosition"], e["rank"] is None,
                                    (e["rank"] or "").casefold(), e["name"].casefold()))
        result.append({
            "id": role_id,
            "name": role["name"],
            "color": f"#{role['color']:06x}" if role["color"] else None,
            "position": role["position"],
            "members": entries,
        })
    # Höchste Rolle zuerst (wie in der Discord-Mitgliederliste)
    result.sort(key=lambda r: r["position"], reverse=True)
    for r in result:
        del r["position"]
    return {"guild": guild["name"], "updatedAt": None, "roles": result}


def main():
    args = sys.argv[1:]
    if not args:
        sys.exit(__doc__)
    out_path = args[0]
    previous_path = args[args.index("--previous") + 1] if "--previous" in args else None

    token = os.environ.get("DISCORD_TOKEN", "").strip()
    guild_id = os.environ.get("GUILD_ID", "").strip()
    role_ids = [r.strip() for r in os.environ.get("ROLE_IDS", "").split(",") if r.strip()]
    if not token or not guild_id or not role_ids:
        sys.exit("DISCORD_TOKEN (Secret), GUILD_ID und ROLE_IDS (Variables) müssen gesetzt sein.")

    guild = api_get(f"/guilds/{guild_id}", token)
    roles = api_get(f"/guilds/{guild_id}/roles", token)
    members = fetch_all_members(guild_id, token)
    mc_channel = os.environ.get("MC_CHANNEL_ID", "").strip()
    mc_names = fetch_minecraft_names(mc_channel, token) if mc_channel else {}
    payload = build_payload(guild, roles, members, role_ids, mc_names)

    previous = None
    if previous_path and os.path.exists(previous_path):
        try:
            with open(previous_path, encoding="utf-8") as f:
                previous = json.load(f)
        except (OSError, ValueError):
            previous = None

    changed = previous is None or {**previous, "updatedAt": None} != payload
    # Zeitstempel nur bei echten Änderungen erneuern
    payload["updatedAt"] = (
        datetime.now(timezone.utc).isoformat(timespec="seconds") if changed else previous["updatedAt"]
    )

    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    for r in payload["roles"]:
        print(f"Rolle \"{r['name']}\": {len(r['members'])} Mitglieder")
    print("Geändert" if changed else "Keine Änderung")

    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as f:
            f.write(f"changed={'true' if changed else 'false'}\n")


if __name__ == "__main__":
    main()
