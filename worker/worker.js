// Cloudflare Worker: Discord-Interaktionen für die Minecraft-Namens-Abfrage.
//
// Ablauf: Klick auf den Button "mc_register" -> Eingabefenster -> Name wird bei
// Mojang geprüft und als Nachricht "mc:<discordId>:<name>:<uuid>" in den
// versteckten Kanal MC_CHANNEL_ID geschrieben (mit Ping des Nutzers davor).
// "mcdel:<discordId>" entfernt einen Eintrag. Das Abrufskript auf GitHub liest
// diesen Kanal; die neueste Nachricht pro Nutzer gilt. Jeder Minecraft-Account
// darf nur einem Discord-Nutzer zugeordnet sein.
//
// Team ab MIN_ROLE_ID kann per /mcname setzen|entfernen die Namen anderer ändern.
//
// Benötigte Einstellungen im Worker (Settings -> Variables and Secrets):
//   DISCORD_PUBLIC_KEY  Public Key der App (Developer Portal -> General Information)
//   DISCORD_TOKEN       Bot-Token (als Secret!)
//   MC_CHANNEL_ID       ID des versteckten Kanals für die Namen
//   CODEWORD            Codewort aus dem Regelwerk (als Secret, damit es nicht
//                       im öffentlichen Repo steht; leer = keine Abfrage)
//   MIN_ROLE_ID         Niedrigste Rolle, die /mcname benutzen darf (z. B. Mod);
//                       alle Rollen darüber dürfen es auch
//   GUILD_ID, ROLE_IDS  Optional; Standard siehe unten (Server/Rolle der Website)
//   TIER_CHANNEL_ID     Optional; Kanal für Tier-Einträge und Login-Codes (Standard: MC_CHANNEL_ID)
//   SITE_URL            Optional; Adresse der Website (Standard siehe unten)
//   SESSION_SECRET      Optional; Schlüssel für Website-Sitzungen (Standard: Bot-Token)
//
// Team-Login: /login in Discord liefert einen Einmal-Code (nur für den Nutzer sichtbar,
// 10 Minuten gültig), der als "login:<code>:<discordId>:<ablauf>" im Tier-Kanal liegt.
//
// GET  /members.json   Mitgliederliste live für die Website (gleiches Format wie
//                      scripts/fetch_members.py plus Tier, 60 s zwischengespeichert)
// POST /auth/code      { code } tauscht einen /login-Code gegen eine Sitzung
// GET  /auth/me        Prüft eine Sitzung (Authorization: Bearer ...)
// POST /tierlist       { player, tier } speichert ein Tier (nur Team ab MIN_ROLE_ID);
//                      als Nachricht "tier:<discordId>:<tier>" im Tier-Kanal, neueste gilt
// POST /player         { player, team, heartsLost, kills, description } speichert Spielerdaten;
//                      als "pdata:<discordId>:<base64url(JSON)>" im Tier-Kanal, neueste gilt

const API = "https://discord.com/api/v10";
const DEFAULT_GUILD_ID = "1502797926982746224";
const DEFAULT_ROLE_IDS = "1510380603479036054";
const DEFAULT_SITE_URL = "https://typishtobi.github.io/Discord-Bot/";
const MEMBERS_CACHE_SECONDS = 60;
const SESSION_HOURS = 12;
const TIERS = ["S+", "S", "A+", "A", "B+", "B", "C+", "C"];
const NAME_RE = /^[A-Za-z0-9_]{3,16}$/;
const ENTRY_RE = /^(?:-# )?(?:mc:(\d+):(\w{3,16}):([0-9a-f]{32})|mcdel:(\d+))$/m;
const TIER_RE = /^(?:-# )?tier:(\d+):([SABC]\+?|-)$/m;
const LOGIN_RE = /^(?:-# )?login:([A-Z2-9]{8}):(\d+):(\d+)$/m;
const PDATA_RE = /^(?:-# )?pdata:(\d+):([A-Za-z0-9_-]+)$/m;
const TEAM_COUNT = 12;
const MAX_HEARTS = 4;
const MAX_DESCRIPTION = 200;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // ohne 0/O und 1/I
const CODE_MINUTES = 10;
const ADMINISTRATOR = 1n << 3n;
const EPHEMERAL = 64;

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (request.method === "OPTIONS") return withCors(new Response(null, { status: 204 }));
    if (request.method === "GET" && path === "/members.json") return membersResponse(request, env, ctx);
    if (request.method === "POST" && path === "/auth/code") return authCode(request, env);
    if (request.method === "GET" && path === "/auth/me") return authMe(request, env);
    if (request.method === "POST" && path === "/tierlist") return tierSave(request, env, ctx);
    if (request.method === "POST" && path === "/player") return playerSave(request, env, ctx);
    if (request.method !== "POST") return new Response("Discord-Minecraft-Worker läuft.");

    const body = await request.text();
    const valid = await verifySignature(
      env.DISCORD_PUBLIC_KEY,
      request.headers.get("X-Signature-Ed25519"),
      request.headers.get("X-Signature-Timestamp"),
      body
    );
    if (!valid) return new Response("Ungültige Signatur", { status: 401 });

    const interaction = JSON.parse(body);

    // PING von Discord beim Speichern der Interactions Endpoint URL
    if (interaction.type === 1) return json({ type: 1 });

    // Button geklickt -> Eingabefenster öffnen
    if (interaction.type === 3 && interaction.data.custom_id === "mc_register") {
      const fields = [{
        type: 4,
        custom_id: "mc_name",
        label: "Dein Minecraft-Name (Java Edition)",
        style: 1,
        min_length: 3,
        max_length: 16,
        required: true,
        placeholder: "z. B. Notch",
      }];
      if (env.CODEWORD) {
        fields.push({
          type: 4,
          custom_id: "codeword",
          label: "Codewort aus dem Regelwerk",
          style: 1,
          max_length: 100,
          required: true,
          placeholder: "Steht irgendwo in den Regeln",
        });
      }
      return json({
        type: 9,
        data: {
          custom_id: "mc_modal",
          title: "Regeln akzeptieren",
          components: fields.map(field => ({ type: 1, components: [field] })),
        },
      });
    }

    // Fenster abgeschickt oder /mcname benutzt -> sofort "denkt nach" antworten,
    // Rest im Hintergrund (Discord verlangt eine Antwort innerhalb von 3 Sekunden)
    if (interaction.type === 5 && interaction.data.custom_id === "mc_modal") {
      ctx.waitUntil(respond(interaction, () => handleSubmit(interaction, env)));
      return json({ type: 5, data: { flags: EPHEMERAL } });
    }
    if (interaction.type === 2 && interaction.data.name === "mcname") {
      ctx.waitUntil(respond(interaction, () => handleCommand(interaction, env)));
      return json({ type: 5, data: { flags: EPHEMERAL } });
    }
    if (interaction.type === 2 && interaction.data.name === "login") {
      ctx.waitUntil(respond(interaction, () => handleLogin(interaction, env)));
      return json({ type: 5, data: { flags: EPHEMERAL } });
    }

    return json({ type: 4, data: { content: "Unbekannte Aktion.", flags: EPHEMERAL } });
  },
};

// Führt die Aktion aus und ersetzt die "denkt nach"-Antwort durch das Ergebnis
// (Text oder { content, components })
async function respond(interaction, action) {
  let reply;
  try {
    reply = await action();
  } catch (err) {
    console.error(err);
    reply = "⚠️ Das hat gerade nicht geklappt. Bitte versuche es in ein paar Minuten erneut.\n" +
      `-# Fehler: ${String(err.message).slice(0, 150)}`;
  }
  await fetch(`${API}/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(typeof reply === "string" ? { content: reply } : reply),
      allowed_mentions: { parse: [] },
    }),
  });
}

async function handleSubmit(interaction, env) {
  const userId = (interaction.member?.user ?? interaction.user).id;
  const values = Object.fromEntries(
    interaction.data.components.flatMap(row => row.components).map(c => [c.custom_id, c.value.trim()])
  );

  if (env.CODEWORD && normalize(values.codeword) !== normalize(env.CODEWORD)) {
    return "❌ Das Codewort ist falsch. Lies dir das Regelwerk noch einmal genau durch.";
  }
  const result = await assignName(env, interaction, userId, values.mc_name, null);
  if (result.error) return result.error;
  return `✅ Gespeichert! Dein Minecraft-Name ist **${result.name}**. ` +
    "Auf der Website erscheint er beim nächsten Update (bis zu 15 Minuten). " +
    "Zum Ändern einfach erneut auf den Button klicken.";
}

async function handleCommand(interaction, env) {
  if (!(await isTeam(interaction, env))) {
    return "❌ Diesen Befehl darf nur das Team benutzen.";
  }
  const sub = interaction.data.options[0];
  const option = name => sub.options?.find(o => o.name === name)?.value;
  const targetId = option("nutzer");
  const modId = interaction.member.user.id;

  if (sub.name === "setzen") {
    const result = await assignName(env, interaction, targetId, String(option("name")).trim(), modId);
    if (result.error) return result.error;
    return `✅ Der Minecraft-Name von <@${targetId}> ist jetzt **${result.name}**.`;
  }

  if (sub.name === "entfernen") {
    const names = await loadNames(env, interaction.application_id);
    if (!names.has(targetId)) return `ℹ️ <@${targetId}> hat keinen Minecraft-Namen eingetragen.`;
    await discord(env, `/channels/${env.MC_CHANNEL_ID}/messages`, "POST", {
      content: `<@${targetId}> → *entfernt* (von <@${modId}>)\n-# mcdel:${targetId}`,
      allowed_mentions: { users: [targetId] },
    });
    return `✅ Der Minecraft-Name von <@${targetId}> (**${names.get(targetId).name}**) wurde entfernt.`;
  }

  return "Unbekannter Unterbefehl.";
}

// Prüft den Namen, verhindert doppelte Accounts und speichert ihn.
// Gibt { name } mit korrekter Schreibweise oder { error } zurück.
async function assignName(env, interaction, userId, input, modId) {
  if (!NAME_RE.test(input ?? "")) {
    return { error: "❌ Ungültiger Name. Erlaubt sind 3–16 Zeichen: Buchstaben, Zahlen und `_`." };
  }
  const profile = await lookupProfile(input);
  if (!profile) {
    return { error: `❌ Den Minecraft-Account **${input}** gibt es nicht. Bitte prüfe die Schreibweise.` };
  }

  // Jeder Minecraft-Account nur einmal (verglichen über die UUID, nicht den Namen)
  const names = await loadNames(env, interaction.application_id);
  for (const [otherId, entry] of names) {
    if (otherId !== userId && entry.uuid === profile.id) {
      return {
        error: modId
          ? `❌ **${profile.name}** ist schon bei <@${otherId}> eingetragen. Entferne es dort zuerst mit \`/mcname entfernen\`.`
          : `❌ Der Minecraft-Name **${profile.name}** ist schon von jemand anderem eingetragen. ` +
            "Falls das deiner ist, wende dich ans Team.",
      };
    }
  }

  const byMod = modId ? ` (geändert von <@${modId}>)` : "";
  await discord(env, `/channels/${env.MC_CHANNEL_ID}/messages`, "POST", {
    content: `<@${userId}> → **${profile.name}**${byMod}\n-# mc:${userId}:${profile.name}:${profile.id}`,
    allowed_mentions: { users: [userId] },
  });
  return { name: profile.name };
}

// Liest den Namens-Kanal: Map discordId -> { name, uuid }, neueste Nachricht pro Nutzer gilt.
// Nur Nachrichten des eigenen Bots zählen (Bot-ID = Application-ID).
async function loadNames(env, botId) {
  return parseNames(await channelContents(env, env.MC_CHANNEL_ID, botId));
}

// Alle Nachrichtentexte des eigenen Bots in einem Kanal, neueste zuerst
async function channelContents(env, channelId, botId) {
  const contents = [];
  let before = null;
  while (true) {
    const query = before ? `?limit=100&before=${before}` : "?limit=100";
    const batch = await discord(env, `/channels/${channelId}/messages${query}`, "GET");
    for (const msg of batch) if (msg.author.id === botId) contents.push(msg.content);
    if (batch.length < 100) return contents;
    before = batch[batch.length - 1].id;
  }
}

function parseNames(contents) {
  const latest = new Map();
  for (const content of contents) {
    const m = ENTRY_RE.exec(content);
    if (!m) continue;
    const id = m[1] ?? m[4];
    if (!latest.has(id)) latest.set(id, m[1] ? { name: m[2], uuid: m[3] } : null);
  }
  for (const [id, entry] of latest) if (!entry) latest.delete(id);
  return latest;
}

// Map discordId -> Tier; "-" (nicht eingestuft) wird weggelassen
// Map discordId -> { team, heartsLost, kills, description }
function parsePlayers(contents) {
  const latest = new Map();
  for (const content of contents) {
    const m = PDATA_RE.exec(content);
    if (!m || latest.has(m[1])) continue;
    try {
      latest.set(m[1], JSON.parse(new TextDecoder().decode(fromB64url(m[2]))));
    } catch {}
  }
  return latest;
}

function parseTiers(contents) {
  const latest = new Map();
  for (const content of contents) {
    const m = TIER_RE.exec(content);
    if (m && !latest.has(m[1])) latest.set(m[1], TIERS.includes(m[2]) ? m[2] : null);
  }
  for (const [id, tier] of latest) if (!tier) latest.delete(id);
  return latest;
}

// --- Live-Mitgliederliste für die Website ---------------------------------

async function membersResponse(request, env, ctx) {
  const cache = caches.default;
  const cacheKey = new Request(new URL("/members.json", request.url).toString());
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let response;
  try {
    const payload = await buildMembers(env);
    response = new Response(JSON.stringify(payload), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": `public, max-age=${MEMBERS_CACHE_SECONDS}`,
      },
    });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  } catch (err) {
    console.error(err);
    response = new Response(JSON.stringify({ error: String(err.message).slice(0, 200) }), {
      status: 502,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    });
  }
  return response;
}

async function buildMembers(env) {
  const guildId = env.GUILD_ID || DEFAULT_GUILD_ID;
  const roleIds = (env.ROLE_IDS || DEFAULT_ROLE_IDS).split(",").map(s => s.trim()).filter(Boolean);

  const [guild, roles, members] = await Promise.all([
    discord(env, `/guilds/${guildId}`, "GET"),
    discord(env, `/guilds/${guildId}/roles`, "GET"),
    fetchAllMembers(env, guildId),
  ]);
  const botId = (await discord(env, "/users/@me", "GET")).id;
  const mcContents = env.MC_CHANNEL_ID ? await channelContents(env, env.MC_CHANNEL_ID, botId) : [];
  const tierChannel = env.TIER_CHANNEL_ID || env.MC_CHANNEL_ID;
  const tierContents = !tierChannel ? []
    : tierChannel === env.MC_CHANNEL_ID ? mcContents
    : await channelContents(env, tierChannel, botId);
  const names = parseNames(mcContents);
  const tiers = parseTiers(tierContents);
  const playerData = parsePlayers(tierContents);

  const rolesById = new Map(roles.map(r => [r.id, r]));
  const rolesByKey = new Map();
  for (const r of [...roles].sort((a, b) => a.position - b.position)) rolesByKey.set(roleKey(r.name), r);

  const result = [];
  for (const roleId of roleIds) {
    const role = rolesById.get(roleId);
    if (!role) continue;
    const entries = members
      .filter(m => m.roles.includes(roleId) && !m.user.bot)
      .map(m => {
        const displayName = m.nick || m.user.global_name || m.user.username;
        const rank = splitRank(displayName, rolesByKey);
        const mc = names.get(m.user.id);
        return {
          id: m.user.id,
          username: m.user.username,
          displayName,
          ...rank,
          minecraft: mc?.name ?? null,
          minecraftUuid: mc?.uuid ?? null,
          tier: tiers.get(m.user.id) ?? null,
          team: playerData.get(m.user.id)?.team ?? null,
          heartsLost: playerData.get(m.user.id)?.heartsLost ?? 0,
          kills: playerData.get(m.user.id)?.kills ?? 0,
          description: playerData.get(m.user.id)?.description ?? "",
          roles: roleIds.filter(id => m.roles.includes(id)),
          joinedAt: m.joined_at ?? null,
        };
      });
    // Höchster Rang zuerst, Leute ohne Rang ganz unten, innerhalb eines Rangs alphabetisch
    entries.sort((a, b) =>
      b.rankPosition - a.rankPosition ||
      (a.rank === null) - (b.rank === null) ||
      (a.rank ?? "").localeCompare(b.rank ?? "", "de") ||
      a.name.localeCompare(b.name, "de"));
    result.push({
      id: roleId,
      name: role.name,
      color: role.color ? hexColor(role.color) : null,
      position: role.position,
      members: entries,
    });
  }
  result.sort((a, b) => b.position - a.position);
  for (const r of result) delete r.position;
  return {
    guild: guild.name,
    updatedAt: new Date().toISOString(),
    tiers: TIERS,
    teamCount: TEAM_COUNT,
    maxHearts: MAX_HEARTS,
    roles: result,
  };
}

async function fetchAllMembers(env, guildId) {
  const all = [];
  let after = "0";
  while (true) {
    const batch = await discord(env, `/guilds/${guildId}/members?limit=1000&after=${after}`, "GET");
    all.push(...batch);
    if (batch.length < 1000) return all;
    after = batch[batch.length - 1].user.id;
  }
}

// "🛡 ┃ Sr. Admin" -> "sradmin"
function roleKey(name) {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
}

// "Admin | Mrtx" -> Rang "Admin" + Name "Mrtx"; Rang wird einer Discord-Rolle zugeordnet
function splitRank(displayName, rolesByKey) {
  const bar = displayName.indexOf("|");
  if (bar === -1) return { rank: null, name: displayName.trim(), rankPosition: -1, rankColor: null };
  const rank = displayName.slice(0, bar).trim();
  const name = displayName.slice(bar + 1).trim();
  const key = roleKey(rank);
  let role = rolesByKey.get(key);
  if (!role && key.length >= 3) {
    // Abkürzungen wie "Mod" -> "Moderator", "Dev" -> "Developer"; höchste passende Rolle
    for (const [k, r] of rolesByKey) {
      if (k.startsWith(key) && (!role || r.position > role.position)) role = r;
    }
  }
  return {
    rank,
    name,
    rankPosition: role ? role.position : -1,
    rankColor: role?.color ? hexColor(role.color) : null,
  };
}

function hexColor(color) {
  return "#" + color.toString(16).padStart(6, "0");
}

// Team = Administrator oder mindestens eine Rolle auf Höhe von MIN_ROLE_ID oder darüber
async function isTeam(interaction, env) {
  const member = interaction.member;
  if (!member) return false;
  if ((BigInt(member.permissions ?? 0) & ADMINISTRATOR) === ADMINISTRATOR) return true;
  const roles = await discord(env, `/guilds/${interaction.guild_id}/roles`, "GET");
  return rolesReachMin(env, roles, member.roles);
}

// Wie isTeam, aber für Website-Logins: Mitglied über den Bot nachschlagen
async function isTeamUser(env, userId) {
  const guildId = env.GUILD_ID || DEFAULT_GUILD_ID;
  let member;
  try {
    member = await discord(env, `/guilds/${guildId}/members/${userId}`, "GET");
  } catch {
    return false; // nicht auf dem Server
  }
  const [guild, roles] = await Promise.all([
    discord(env, `/guilds/${guildId}`, "GET"),
    discord(env, `/guilds/${guildId}/roles`, "GET"),
  ]);
  if (guild.owner_id === userId) return true;
  const adminRoles = new Set(roles.filter(r => (BigInt(r.permissions) & ADMINISTRATOR) === ADMINISTRATOR).map(r => r.id));
  if (member.roles.some(id => adminRoles.has(id))) return true;
  return rolesReachMin(env, roles, member.roles);
}

function rolesReachMin(env, roles, memberRoleIds) {
  if (!env.MIN_ROLE_ID) return false;
  const position = new Map(roles.map(r => [r.id, r.position]));
  const min = position.get(env.MIN_ROLE_ID);
  if (min === undefined) throw new Error("MIN_ROLE_ID ist keine Rolle dieses Servers");
  return memberRoleIds.some(id => (position.get(id) ?? -1) >= min);
}

// --- Discord-Login und Tierlist -------------------------------------------

function siteUrl(env) {
  return env.SITE_URL || DEFAULT_SITE_URL;
}

function tierChannel(env) {
  return env.TIER_CHANNEL_ID || env.MC_CHANNEL_ID;
}

// /login in Discord: Einmal-Code erzeugen und im Tier-Kanal hinterlegen
async function handleLogin(interaction, env) {
  if (!(await isTeam(interaction, env))) {
    return "❌ Den Team-Login dürfen nur Mod und alle Rollen darüber benutzen.";
  }
  const userId = interaction.member.user.id;
  const random = crypto.getRandomValues(new Uint8Array(8));
  const code = Array.from(random, b => CODE_CHARS[b % CODE_CHARS.length]).join("");
  const expires = Date.now() + CODE_MINUTES * 60 * 1000;
  await discord(env, `/channels/${tierChannel(env)}/messages`, "POST", {
    content: `🔑 Login-Code für <@${userId}> erstellt\n-# login:${code}:${userId}:${expires}`,
    allowed_mentions: { parse: [] },
  });
  const pretty = code.slice(0, 4) + "-" + code.slice(4);
  return {
    content: `🔑 Dein Login-Code für die Tierlist: **\`${pretty}\`**\n` +
      `Gib ihn auf der Website unter **Team-Login** ein oder klick auf den Button. ` +
      `Er gilt ${CODE_MINUTES} Minuten und nur einmal.`,
    components: [{
      type: 1,
      components: [{ type: 2, style: 5, label: "Direkt anmelden", url: `${siteUrl(env)}tierlist.html#code=${code}` }],
    }],
  };
}

// Website: Code prüfen, verbrauchen (Nachricht löschen) und Sitzung ausstellen
async function authCode(request, env) {
  try {
    const body = await request.json().catch(() => ({}));
    const code = String(body.code ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (code.length !== 8) return withCors(json({ error: "Der Code hat 8 Zeichen, z. B. ABCD-EFGH." }, 400));

    const botId = (await discord(env, "/users/@me", "GET")).id;
    const channel = tierChannel(env);
    const recent = await discord(env, `/channels/${channel}/messages?limit=100`, "GET");
    let found = null;
    for (const msg of recent) {
      const m = msg.author.id === botId && LOGIN_RE.exec(msg.content);
      if (m && m[1] === code) { found = { id: msg.id, uid: m[2], exp: Number(m[3]) }; break; }
    }
    if (!found || found.exp < Date.now()) {
      return withCors(json({ error: "Code ungültig oder abgelaufen. Hol dir mit /login einen neuen." }, 401));
    }
    await discord(env, `/channels/${channel}/messages/${found.id}`, "DELETE").catch(() => {});
    if (!(await isTeamUser(env, found.uid))) return withCors(json({ error: "Nur das Team darf die Tierlist ändern." }, 403));

    const guildId = env.GUILD_ID || DEFAULT_GUILD_ID;
    const member = await discord(env, `/guilds/${guildId}/members/${found.uid}`, "GET");
    const name = member.nick || member.user.global_name || member.user.username;
    const session = await sign(env, { uid: found.uid, name, exp: Date.now() + SESSION_HOURS * 3600 * 1000 });
    return withCors(json({ session, name }));
  } catch (err) {
    console.error(err);
    return withCors(json({ error: "Anmeldung fehlgeschlagen: " + String(err.message).slice(0, 150) }, 502));
  }
}

async function sessionFrom(request, env) {
  const header = request.headers.get("Authorization") || "";
  return header.startsWith("Bearer ") ? verifySigned(env, header.slice(7)) : null;
}

async function authMe(request, env) {
  const session = await sessionFrom(request, env);
  if (!session) return withCors(json({ error: "Nicht angemeldet" }, 401));
  return withCors(json({ id: session.uid, name: session.name, expires: session.exp }));
}

// Gemeinsamer Rahmen für Änderungen durchs Team: Sitzung und Rechte prüfen, Spieler prüfen,
// Eintrag als Nachricht im Tier-Kanal speichern. build() liefert { content, result } oder { error }.
async function teamWrite(request, env, ctx, build) {
  try {
    const session = await sessionFrom(request, env);
    if (!session) return withCors(json({ error: "Bitte neu anmelden." }, 401));
    if (!(await isTeamUser(env, session.uid))) return withCors(json({ error: "Nur das Team darf das ändern." }, 403));

    const body = await request.json().catch(() => ({}));
    const player = String(body.player ?? "");
    if (!/^\d{5,25}$/.test(player)) return withCors(json({ error: "Ungültige Angaben." }, 400));
    const entry = build(body, player, session);
    if (entry.error) return withCors(json({ error: entry.error }, 400));

    // Nur Spieler mit einer der Website-Rollen
    const guildId = env.GUILD_ID || DEFAULT_GUILD_ID;
    const roleIds = (env.ROLE_IDS || DEFAULT_ROLE_IDS).split(",").map(s => s.trim());
    const member = await discord(env, `/guilds/${guildId}/members/${player}`, "GET").catch(() => null);
    if (!member || !member.roles.some(id => roleIds.includes(id))) {
      return withCors(json({ error: "Dieser Spieler ist kein Teilnehmer." }, 400));
    }

    await discord(env, `/channels/${tierChannel(env)}/messages`, "POST", {
      content: entry.content,
      allowed_mentions: { parse: [] }, // Spieler nicht benachrichtigen
    });

    // Zwischengespeicherte Mitgliederliste verwerfen, damit die Änderung sofort sichtbar ist
    ctx.waitUntil(caches.default.delete(new Request(new URL("/members.json", request.url).toString())));
    return withCors(json({ ok: true, ...entry.result }));
  } catch (err) {
    console.error(err);
    return withCors(json({ error: "Speichern fehlgeschlagen: " + String(err.message).slice(0, 150) }, 502));
  }
}

async function tierSave(request, env, ctx) {
  return teamWrite(request, env, ctx, (body, player, session) => {
    const tier = body.tier ?? null;
    if (tier !== null && !TIERS.includes(tier)) return { error: "Ungültige Angaben." };
    return {
      content: `<@${player}> → ${tier ? `Tier **${tier}**` : "*nicht eingestuft*"} (von <@${session.uid}>)\n` +
        `-# tier:${player}:${tier ?? "-"}`,
      result: { player, tier },
    };
  });
}

// Spielerdaten: Team, verlorene Herzen, Kills, Beschreibung (als JSON in base64url)
async function playerSave(request, env, ctx) {
  return teamWrite(request, env, ctx, (body, player, session) => {
    const data = cleanPlayerData(body);
    if (data.error) return data;
    const summary = `${data.team ? "Team " + data.team : "kein Team"} · ` +
      `${data.heartsLost} ${data.heartsLost === 1 ? "Herz" : "Herzen"} verloren · ${data.kills} Kills`;
    const encoded = b64url(new TextEncoder().encode(JSON.stringify(data)));
    return {
      content: `<@${player}> → ${summary} (von <@${session.uid}>)\n-# pdata:${player}:${encoded}`,
      result: { player, ...data },
    };
  });
}

function cleanPlayerData(body) {
  const int = (value, min, max) => {
    const n = Number(value);
    return Number.isInteger(n) && n >= min && n <= max ? n : null;
  };
  const team = body.team === null || body.team === "" || body.team === undefined ? null : int(body.team, 1, TEAM_COUNT);
  if (team === null && body.team !== null && body.team !== "" && body.team !== undefined) {
    return { error: `Team muss zwischen 1 und ${TEAM_COUNT} liegen.` };
  }
  const heartsLost = int(body.heartsLost ?? 0, 0, MAX_HEARTS);
  if (heartsLost === null) return { error: `Verlorene Herzen: 0 bis ${MAX_HEARTS}.` };
  const kills = int(body.kills ?? 0, 0, 9999);
  if (kills === null) return { error: "Kills: eine Zahl von 0 bis 9999." };
  const description = String(body.description ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (description.length > MAX_DESCRIPTION) return { error: `Beschreibung: höchstens ${MAX_DESCRIPTION} Zeichen.` };
  return { team, heartsLost, kills, description };
}

// Signierte Daten: base64url(JSON) + "." + base64url(HMAC-SHA256), Schlüssel = SESSION_SECRET oder Bot-Token
async function hmacKey(env) {
  const secret = env.SESSION_SECRET || env.DISCORD_TOKEN;
  if (!secret) throw new Error("DISCORD_TOKEN fehlt im Worker");
  return crypto.subtle.importKey("raw", new TextEncoder().encode("radius2-session:" + secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function sign(env, data) {
  const payload = b64url(new TextEncoder().encode(JSON.stringify(data)));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env), new TextEncoder().encode(payload));
  return payload + "." + b64url(new Uint8Array(sig));
}

async function verifySigned(env, token) {
  if (!token || !token.includes(".")) return null;
  const [payload, sig] = token.split(".");
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(env), fromB64url(sig), new TextEncoder().encode(payload));
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    return data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

function b64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(text) {
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

function withCors(response) {
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Authorization, Content-Type");
  headers.set("Access-Control-Max-Age", "86400");
  return new Response(response.body, { status: response.status, headers });
}

// Liefert { id, name } mit korrekter Schreibweise oder null, wenn es den Account nicht gibt
async function lookupProfile(name) {
  const urls = [
    `https://api.minecraftservices.com/minecraft/profile/lookup/name/${name}`,
    `https://api.mojang.com/users/profiles/minecraft/${name}`,
  ];
  const errors = [];
  for (const url of urls) {
    const res = await fetch(url);
    if (res.status === 200) {
      const data = await res.json();
      return { id: data.id, name: data.name };
    }
    if (res.status === 404 || res.status === 204) return null;
    errors.push(`Mojang ${res.status}`); // z. B. Rate-Limit oder Cloudflare blockiert -> nächste API
  }

  // Mojang blockiert Cloudflare-Server häufig; playerdb.co fragt Mojang stellvertretend ab
  const res = await fetch(`https://playerdb.co/api/player/minecraft/${name}`, {
    headers: { "User-Agent": "discord-role-site (github.com/TypishTobi/Discord-Bot)" },
  });
  const data = await res.json().catch(() => ({}));
  if (data.success) return { id: data.data.player.raw_id, name: data.data.player.username };
  if (data.code === "minecraft.invalid_username") return null;
  errors.push(`playerdb ${res.status}`);
  throw new Error(`Namensprüfung fehlgeschlagen (${errors.join(", ")})`);
}

async function discord(env, path, method, payload) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bot ${env.DISCORD_TOKEN}`, "Content-Type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`Discord-API ${res.status} bei ${path}: ${await res.text()}`);
  return res.json();
}

async function verifySignature(publicKey, signature, timestamp, body) {
  if (!publicKey || !signature || !timestamp) return false;
  try {
    const key = await crypto.subtle.importKey("raw", hexToBytes(publicKey), { name: "Ed25519" }, false, ["verify"]);
    return await crypto.subtle.verify("Ed25519", key, hexToBytes(signature), new TextEncoder().encode(timestamp + body));
  } catch {
    return false;
  }
}

// Groß-/Kleinschreibung, Leerzeichen und Anführungszeichen beim Codewort ignorieren
function normalize(text) {
  return String(text ?? "").toLowerCase().replace(/[\s"'„“”‚‘’»«]/g, "");
}

function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
