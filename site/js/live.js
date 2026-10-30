// Radius 2 – Live-Daten aus Discord: Team-Liste, Tierlist und Spieler-Seite.
// Die Daten liefert der Cloudflare Worker (worker/worker.js); das Team meldet sich
// mit einem Einmal-Code aus dem Discord-Befehl /login an, kann die Spieler per
// Drag & Drop oder Antippen einstufen und Team, Kills, Herzen und Beschreibung pflegen.
(function(){
  var WORKER="https://mc-namen.typischtobi66.workers.dev";
  var DEFAULT_TIERS=["S+","S","A+","A","B+","B","C+","C","D"];
  var SESSION_KEY="radius2-session",MAX_DESCRIPTION=200;
  var board=document.getElementById("tier-board"),grid=document.getElementById("player-grid"),teamsGrid=document.getElementById("teams-grid");
  var creatorGrid=document.getElementById("creator-grid"),creatorAdd=document.getElementById("creator-add");
  var authBox=document.getElementById("team-auth"),msg=document.getElementById("team-msg");
  var players=[],teams=[],tiers=DEFAULT_TIERS,teamCount=12,maxHearts=4,session=null,me=null,selected=null,editId=null;

  function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
  function head(p){return "https://minotar.net/helm/"+encodeURIComponent(p.minecraftUuid||"MHF_Steve")+"/64.png";}
  function headImg(p,size){var i=el("img","mc-head");i.src=head(p);i.alt="";i.width=size;i.height=size;return i;}
  function say(text,bad){if(!msg)return;msg.textContent=text||"";msg.classList.toggle("bad",!!bad);}
  function store(k,v){try{v==null?localStorage.removeItem(k):localStorage.setItem(k,v);}catch(e){}}
  function read(k){try{return localStorage.getItem(k);}catch(e){return null;}}

  // ---- Daten laden: live vom Worker, sonst die von GitHub erzeugte Kopie ----
  function getJSON(url){return fetch(url,{cache:"no-store"}).then(function(r){if(!r.ok)throw new Error(r.status);return r.json();});}
  function load(){
    return getJSON(WORKER+"/members.json").catch(function(){return getJSON("members.json");}).then(function(data){
      var seen={};players=[];
      (data.roles||[]).forEach(function(role){(role.members||[]).forEach(function(m){if(!seen[m.id]){seen[m.id]=1;players.push(m);}});});
      if(data.tiers&&data.tiers.length)tiers=data.tiers;
      if(data.teamCount)teamCount=data.teamCount;
      if(data.maxHearts)maxHearts=data.maxHearts;
      teams=data.teams||[];
      links=data.links||{};
      renderRoster();rerender();
    }).catch(function(){
      if(board)board.innerHTML='<p class="note">Die Tierlist konnte gerade nicht geladen werden.</p>';
      if(grid)grid.innerHTML='<p class="note">Die Spieler konnten gerade nicht geladen werden.</p>';
    });
  }
  function rerender(){renderBoard();renderPlayers();renderTeams();renderCreators();renderSocials();}
  function teamLost(n){var t=teams.filter(function(x){return x.team===n;})[0];return t?Math.min(t.heartsLost||0,maxHearts):0;}

  // ---- Team: alle mit Rang im Discord-Namen ("Admin | Mrtx"), gruppiert nach Rang ----
  function renderRoster(){
    var box=document.getElementById("roster");if(!box)return;
    var groups=[],byRank={};
    players.forEach(function(p){
      if(!p.rank)return;
      if(!byRank[p.rank]){byRank[p.rank]={rank:p.rank,color:p.rankColor,list:[]};groups.push(byRank[p.rank]);}
      byRank[p.rank].list.push(p);
    });
    box.textContent="";
    groups.forEach(function(g){
      var sec=el("div","roster-group"),h=el("h3","roster-rank",g.rank);
      if(g.color)h.style.setProperty("--rank",g.color);
      var grid=el("div","roster-grid");
      g.list.forEach(function(p){
        var card=el("button","roster-card"),txt=el("div");card.type="button";
        card.onclick=function(){openPlayer(p);};card.setAttribute("aria-label",(p.name||p.displayName)+": Details anzeigen");
        card.appendChild(headImg(p,56));
        txt.appendChild(el("h4",null,p.name||p.displayName));
        if(p.minecraft)txt.appendChild(el("p","mc","@"+p.minecraft));
        card.appendChild(txt);grid.appendChild(card);
      });
      sec.appendChild(h);sec.appendChild(grid);box.appendChild(sec);
    });
  }

  // ---- Tierlist ----
  function editing(){return !!me;}
  function chip(p){
    // div statt button, weil Firefox Buttons nicht ziehen lässt
    var c=el("div","tchip");
    c.dataset.id=p.id;
    if(editing()){c.tabIndex=0;c.setAttribute("role","button");c.draggable=true;c.setAttribute("aria-pressed",selected===p.id?"true":"false");c.title="Ziehen – oder antippen und dann Ziel antippen. Pfeiltasten verschieben.";}
    c.appendChild(headImg(p,32));c.appendChild(el("span",null,p.name||p.displayName));
    if(selected===p.id)c.classList.add("sel");
    return c;
  }
  function row(tier,label,list){
    var r=el("div","tier-row"+(tier?"":" pool"));r.dataset.tier=tier||"";
    var lab=el(editing()?"button":"div","tier-label",label);
    if(tier)lab.dataset.t=tier;
    if(editing()){lab.type="button";lab.setAttribute("aria-label",(tier?"Ausgewählten Spieler nach "+tier:"Ausgewählten Spieler aus der Tierlist")+" verschieben");}
    var zone=el("div","tier-zone");
    list.forEach(function(p){zone.appendChild(chip(p));});
    if(!list.length)zone.appendChild(el("span","tier-empty",tier?"":"Alle Spieler sind eingestuft."));
    r.appendChild(lab);r.appendChild(zone);return r;
  }
  function byName(a,b){return (a.name||a.displayName).localeCompare(b.name||b.displayName,"de");}
  // Innerhalb eines Tiers gilt der gespeicherte Platz (links = besser), ohne Platz alphabetisch dahinter
  function byOrder(a,b){
    var x=a.tierOrder==null?1e9:a.tierOrder,y=b.tierOrder==null?1e9:b.tierOrder;
    return x-y||byName(a,b);
  }
  function inTier(t){return players.filter(function(p){return p.tier===t;}).sort(byOrder);}
  function renderBoard(){
    if(!board)return;
    board.textContent="";
    if(!players.length){board.appendChild(el("p","note","Noch keine Spieler."));return;}
    board.classList.toggle("editing",editing());
    tiers.forEach(function(t){board.appendChild(row(t,t,inTier(t)));});
    var open=players.filter(function(p){return !p.tier||tiers.indexOf(p.tier)<0;}).sort(byName);
    if(open.length||editing())board.appendChild(row(null,"Offen",open));
  }

  // ---- Bearbeiten: Ziehen (Maus), Antippen + Ziel antippen (Touch) oder Pfeiltasten ----
  // move(id, tier, beforeId): Spieler in ein Tier setzen, vor beforeId (null = ganz rechts)
  function move(id,tier,beforeId){
    var p=players.filter(function(x){return x.id===id;})[0];if(!p)return;
    var list=tier?inTier(tier).filter(function(x){return x.id!==id;}):[];
    var at=beforeId?list.map(function(x){return x.id;}).indexOf(beforeId):-1;
    if(tier)list.splice(at<0?list.length:at,0,p);
    var ids=list.map(function(x){return x.id;});
    if(p.tier===tier&&(!tier||inTier(tier).map(function(x){return x.id;}).join()===ids.join())){selected=null;renderBoard();return;}
    // Vorher-Stand merken, um bei einem Fehler zurückzusetzen
    var snapshot=players.map(function(x){return {p:x,tier:x.tier,order:x.tierOrder};});
    p.tier=tier;list.forEach(function(x,i){x.tierOrder=i+1;});if(!tier)p.tierOrder=null;
    selected=null;renderBoard();focusChip(id);
    say("Speichere …");
    post("/tierlist",tier?{tier:tier,order:ids,moved:id}:{player:id,tier:null})
      .then(function(){say((p.name||p.displayName)+" → "+(tier?tier+", Platz "+(ids.indexOf(id)+1):"offen")+" gespeichert.");})
      .catch(function(e){snapshot.forEach(function(s){s.p.tier=s.tier;s.p.tierOrder=s.order;});renderBoard();say(e.message||"Speichern fehlgeschlagen.",true);if(e.status===401||e.status===403)logout(true);});
  }
  function focusChip(id){var c=board.querySelector('.tchip[data-id="'+id+'"]');if(c)c.focus();}
  // Einfügestelle beim Ziehen: vor dem Spieler unter dem Mauszeiger, oder dahinter (rechte Hälfte)
  function dropTarget(e,dragId){
    var c=e.target.closest(".tchip");
    if(!c)return {before:null,chip:null};
    if(c.dataset.id===dragId){var n=c.nextElementSibling;return {before:n&&n.classList.contains("tchip")?n.dataset.id:null,chip:null};}
    var rect=c.getBoundingClientRect(),right=e.clientX>rect.left+rect.width/2;
    var next=right?c.nextElementSibling:c;
    while(next&&(!next.classList.contains("tchip")||next.dataset.id===dragId))next=next.nextElementSibling;
    return {before:next?next.dataset.id:null,chip:c,side:right?"after":"before"};
  }
  if(board){
  var dragId=null;
  board.addEventListener("click",function(e){
    if(!editing()){var v=e.target.closest(".tchip");if(v)openPlayer(byId(v.dataset.id));return;} // Ansehen: Spieler-Fenster
    var c=e.target.closest(".tchip"),lab=e.target.closest(".tier-label");
    if(c&&selected&&selected!==c.dataset.id){move(selected,c.closest(".tier-row").dataset.tier||null,c.dataset.id);return;}
    if(c){
      var id=c.dataset.id;selected=selected===id?null:id;renderBoard();
      say(selected?"Jetzt einen Spieler antippen (davor einordnen) oder ein Tier links (ganz rechts einordnen).":"");
      focusChip(id);
    }
    else if(lab&&selected){move(selected,lab.parentNode.dataset.tier||null,null);}
  });
  board.addEventListener("keydown",function(e){
    var c=e.target.closest(".tchip");if(!c||!editing())return;
    if(e.key==="Enter"||e.key===" "){e.preventDefault();c.click();return;}
    var id=c.dataset.id,tier=c.closest(".tier-row").dataset.tier||null;
    if(e.key==="ArrowLeft"||e.key==="ArrowRight"){
      if(!tier)return;e.preventDefault();
      var ids=inTier(tier).map(function(x){return x.id;}),i=ids.indexOf(id);
      if(e.key==="ArrowLeft"&&i>0)move(id,tier,ids[i-1]);
      if(e.key==="ArrowRight"&&i<ids.length-1)move(id,tier,ids[i+2]||null);
    }
    if(e.key==="ArrowUp"||e.key==="ArrowDown"){
      e.preventDefault();
      var all=tiers.concat([null]),k=all.indexOf(tier),to=all[k+(e.key==="ArrowUp"?-1:1)];
      if(k+(e.key==="ArrowUp"?-1:1)>=0&&k+(e.key==="ArrowUp"?-1:1)<all.length)move(id,to,null);
    }
  });
  board.addEventListener("dragstart",function(e){var c=e.target.closest&&e.target.closest(".tchip");if(c&&editing()){dragId=c.dataset.id;e.dataTransfer.setData("text/plain",dragId);e.dataTransfer.effectAllowed="move";c.classList.add("drag");}});
  board.addEventListener("dragend",function(e){var c=e.target.closest&&e.target.closest(".tchip");if(c)c.classList.remove("drag");dragId=null;clearOver();});
  board.addEventListener("dragover",function(e){
    var r=e.target.closest(".tier-row");if(!r||!editing())return;
    e.preventDefault();e.dataTransfer.dropEffect="move";clearOver();r.classList.add("over");
    var t=dropTarget(e,dragId);if(t.chip)t.chip.classList.add("ins-"+t.side);
  });
  board.addEventListener("dragleave",function(e){var r=e.target.closest(".tier-row");if(r&&!r.contains(e.relatedTarget))clearOver();});
  board.addEventListener("drop",function(e){
    var r=e.target.closest(".tier-row");if(!r||!editing())return;e.preventDefault();
    var id=e.dataTransfer.getData("text/plain"),t=dropTarget(e,id);clearOver();
    move(id,r.dataset.tier||null,t.before);
  });
  }
  function clearOver(){[].forEach.call(board.querySelectorAll(".over,.ins-before,.ins-after"),function(x){x.classList.remove("over","ins-before","ins-after");});}

  // ---- Spieler-Seite: Karten mit Team, Tier, Kills, Herzen und Beschreibung ----
  var HEART=["01100110","11111111","11111111","11111111","01111110","00111100","00011000"];
  function heartSVG(lost){
    var r="";HEART.forEach(function(row,y){for(var x=0;x<8;x++)if(row[x]==="1")r+='<rect x="'+x+'" y="'+y+'" width="1" height="1"/>';});
    return '<svg class="heart'+(lost?' lost':'')+'" viewBox="0 0 8 7" shape-rendering="crispEdges" aria-hidden="true">'+r+'</svg>';
  }
  var filterTeam="",sortBy="team";
  function renderFilters(){
    var box=document.getElementById("player-filters");if(!box||box.childNodes.length)return;
    function select(label,options,value,onChange){
      var wrap=el("label","pfilter"),s=el("select");wrap.appendChild(el("span",null,label));
      options.forEach(function(o){var opt=el("option",null,o[1]);opt.value=o[0];s.appendChild(opt);});
      s.value=value;s.onchange=function(){onChange(s.value);renderPlayers();};wrap.appendChild(s);return wrap;
    }
    var teamOpts=[["","Alle"],["none","Ohne Team"]];for(var t=1;t<=teamCount;t++)teamOpts.push([String(t),"Team "+t]);
    box.appendChild(select("Team",teamOpts,filterTeam,function(v){filterTeam=v;}));
    box.appendChild(select("Sortieren",[["team","Nach Team"],["tier","Nach Tier"],["kills","Nach Kills"],["name","Nach Name"]],sortBy,function(v){sortBy=v;}));
  }
  function tierRank(p){var i=tiers.indexOf(p.tier);return i<0?99:i;}
  function sortPlayers(list){
    var cmp={
      team:function(a,b){return (a.team||99)-(b.team||99)||byName(a,b);},
      tier:function(a,b){return tierRank(a)-tierRank(b)||byName(a,b);},
      kills:function(a,b){return (b.kills||0)-(a.kills||0)||byName(a,b);},
      name:byName
    }[sortBy];
    return list.slice().sort(cmp);
  }
  // Kompakte Karte: nur Kopf, Name und Tier; alles andere zeigt das Spieler-Fenster beim Klick
  function playerCard(p){
    var card=el("article","pcard compact clickable");card.dataset.id=p.id;card.tabIndex=0;card.setAttribute("aria-label",(p.name||p.displayName)+": Details anzeigen");
    var top=el("div","pcard-top"),who=el("div");
    top.appendChild(headImg(p,48));
    var h3=el("h3",null,p.name||p.displayName);
    if(isGeneral(p))h3.appendChild(el("em","gen-tag","General"));
    who.appendChild(h3);
    if(p.minecraft)who.appendChild(el("p","mc","@"+p.minecraft));
    top.appendChild(who);
    var badge=el("span","tier-badge",p.tier||"–");if(p.tier)badge.dataset.t=p.tier;badge.title=p.tier?"Tier "+p.tier:"Noch nicht eingestuft";
    top.appendChild(badge);card.appendChild(top);
    if(editing()){var b=el("button","pedit","Bearbeiten");b.type="button";b.dataset.edit=p.id;card.appendChild(b);}
    return card;
  }
  function editForm(p){
    var f=el("form","pcard pform");f.dataset.id=p.id;
    var top=el("div","pcard-top"),who=el("div");top.appendChild(headImg(p,56));who.appendChild(el("h3",null,p.name||p.displayName));who.appendChild(el("p","mc","bearbeiten"));top.appendChild(who);f.appendChild(top);
    function field(label,input){var l=el("label","pfield");l.appendChild(el("span",null,label));l.appendChild(input);f.appendChild(l);return input;}
    var team=el("select");var none=el("option",null,"Kein Team");none.value="";team.appendChild(none);
    for(var t=1;t<=teamCount;t++){var o=el("option",null,"Team "+t);o.value=String(t);team.appendChild(o);}
    team.value=p.team?String(p.team):"";field("Team",team);
    var kills=el("input");kills.type="number";kills.min=0;kills.max=9999;kills.value=p.kills||0;field("Kills",kills);
    var desc=el("textarea");desc.maxLength=MAX_DESCRIPTION;desc.rows=3;desc.value=p.description||"";
    var count=el("small","pcount");function upd(){count.textContent=desc.value.length+"/"+MAX_DESCRIPTION;}desc.oninput=upd;upd();
    field("Kurze Beschreibung",desc).parentNode.appendChild(count);
    var yt=el("input");yt.type="text";yt.value=p.youtube||"";yt.placeholder="youtube.com/@name oder @name";yt.maxLength=200;
    field("YouTube-Kanal (macht den Spieler zum Creator)",yt);
    var tt=el("input");tt.type="text";tt.value=p.tiktok||"";tt.placeholder="tiktok.com/@name oder @name";tt.maxLength=200;
    field("TikTok",tt);
    var row=el("div","pactions"),save=el("button","btn dc","Speichern"),cancel=el("button","btn ghost","Abbrechen");
    save.type="submit";cancel.type="button";cancel.onclick=function(){editId=null;renderPlayers();};
    row.appendChild(save);row.appendChild(cancel);f.appendChild(row);
    f.onsubmit=function(e){
      e.preventDefault();
      savePlayer(p,{team:team.value?Number(team.value):null,kills:Number(kills.value),description:desc.value.trim(),youtube:yt.value.trim(),tiktok:tt.value.trim()});
    };
    return f;
  }
  function renderPlayers(){
    if(!grid)return;
    renderFilters();
    var list=players.filter(function(p){return !filterTeam||(filterTeam==="none"?!p.team:String(p.team)===filterTeam);});
    grid.textContent="";
    if(!list.length){grid.appendChild(el("p","note",players.length?"Keine Spieler in dieser Auswahl.":"Noch keine Spieler."));return;}
    sortPlayers(list).forEach(function(p){grid.appendChild(editing()&&editId===p.id?editForm(p):playerCard(p));});
  }
  function post(path,body){
    return fetch(WORKER+path,{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+session},body:JSON.stringify(body)})
      .then(function(r){return r.json().then(function(d){if(!r.ok)throw Object.assign(new Error(d.error||r.status),{status:r.status});return d;});});
  }
  function savePlayer(p,data){
    say("Speichere …");
    post("/player",Object.assign({player:p.id},data))
      .then(function(d){p.team=d.team;p.kills=d.kills;p.description=d.description;p.youtube=d.youtube||"";p.tiktok=d.tiktok||"";editId=null;renderPlayers();say((p.name||p.displayName)+" gespeichert.");})
      .catch(function(e){say(e.message||"Speichern fehlgeschlagen.",true);if(e.status===401||e.status===403)logout(true);});
  }
  if(grid){
    grid.addEventListener("click",function(e){
      var b=e.target.closest("[data-edit]");
      if(b&&editing()){editId=b.dataset.edit;renderPlayers();var f=grid.querySelector(".pform select");if(f)f.focus();return;}
      // Klick auf eine Karte (nicht im Bearbeiten-Formular) öffnet das Spieler-Fenster
      var card=e.target.closest(".pcard:not(.pform)");if(card)openPlayer(byId(card.dataset.id));
    });
    grid.addEventListener("keydown",function(e){
      var card=e.target.closest(".pcard:not(.pform)");
      if(card&&e.target===card&&(e.key==="Enter"||e.key===" ")){e.preventDefault();openPlayer(byId(card.dataset.id));}
    });
  }

  // ---- Teams-Seite: 12 Teams mit Mitgliedern (aus den Spielerdaten) und gemeinsamen Herzen ----
  // Bester Spieler zuerst: höchstes Tier, dann weiter links im Tier, dann mehr Kills.
  // Der erste ist automatisch General.
  function bestFirst(a,b){
    var x=a.tierOrder==null?1e9:a.tierOrder,y=b.tierOrder==null?1e9:b.tierOrder;
    return tierRank(a)-tierRank(b)||x-y||(b.kills||0)-(a.kills||0)||byName(a,b);
  }
  function teamMembers(n){return players.filter(function(p){return p.team===n;}).sort(bestFirst);}
  function isGeneral(p){return !!p.team&&teamMembers(p.team)[0]===p;}
  function renderTeams(){
    if(!teamsGrid)return;
    var fixed=window.RADIUS_TEAMS||[];
    teamsGrid.textContent="";
    for(var n=1;n<=teamCount;n++){
      var lost=teamLost(n),left=maxHearts-lost;
      var live=teamMembers(n);
      var card=el("article","team-card clickable"+(left===0?" out":""));card.dataset.team=n;
      card.tabIndex=0;card.setAttribute("role","button");card.setAttribute("aria-label","Team "+n+": Statistik anzeigen");
      card.appendChild(el("h3",null,"Team "+n));
      var hearts=el("span","hearts"+(editing()?" edit":""));hearts.setAttribute("aria-label",left+" von "+maxHearts+" Team-Herzen übrig");
      for(var i=0;i<maxHearts;i++){
        // Volle Herzen links, verlorene rechts; im Bearbeiten-Modus antippen zum Verlieren/Zurückgeben
        var isLost=i>=left,hb=el(editing()?"button":"span","heart-btn");hb.innerHTML=heartSVG(isLost);
        if(editing()){hb.type="button";hb.dataset.team=n;hb.dataset.left=isLost?i+1:i;hb.title=isLost?"Herz zurückgeben":"Herz verloren";hb.setAttribute("aria-label","Team "+n+": "+hb.title);}
        hearts.appendChild(hb);
      }
      card.appendChild(hearts);
      var ul=el("ul");
      for(var s=0;s<4;s++){
        var p=live[s],name=p?(p.name||p.displayName):fixed[n-1]&&fixed[n-1][s];
        if(name){
          var li=el("li",s===0?"gen":"");
          if(p){li.classList.add("live");li.appendChild(headImg(p,22));}
          li.appendChild(el("span",null,name));
          if(s===0)li.appendChild(el("em",null,"General"));
          if(p&&p.tier){var tb=el("span","tier-badge mini",p.tier);tb.dataset.t=p.tier;li.appendChild(tb);}
          if(p&&editing()){var rm=el("button","team-rm","×");rm.type="button";rm.dataset.remove=p.id;rm.title=(p.name||p.displayName)+" aus Team "+n+" nehmen";rm.setAttribute("aria-label",rm.title);li.appendChild(rm);}
          ul.appendChild(li);
        }else ul.appendChild(el("li","empty",s===0?"General":"Platz "+(s+1)));
      }
      card.appendChild(ul);
      // Team-Login: Spieler direkt hier zuordnen (höchstens 4 pro Team)
      if(editing()&&live.length<4){
        var add=el("select","team-add");add.dataset.team=n;add.setAttribute("aria-label","Spieler zu Team "+n+" hinzufügen");
        var first=el("option",null,"+ Spieler hinzufügen");first.value="";add.appendChild(first);
        var free=players.filter(function(p){return !p.team;}).sort(bestFirst),taken=players.filter(function(p){return p.team&&p.team!==n;}).sort(byName);
        [["Ohne Team",free],["Aus anderem Team holen",taken]].forEach(function(g){
          if(!g[1].length)return;var og=el("optgroup");og.label=g[0];
          g[1].forEach(function(p){var o=el("option",null,(p.name||p.displayName)+(p.tier?" ("+p.tier+")":"")+(p.team?" · Team "+p.team:""));o.value=p.id;og.appendChild(o);});
          add.appendChild(og);
        });
        card.appendChild(add);
      }
      card.appendChild(el("span","team-more","Statistik ansehen →"));
      teamsGrid.appendChild(card);
    }
  }

  // Team eines Spielers ändern (Kills und Beschreibung bleiben erhalten)
  function setTeam(id,team){
    var p=players.filter(function(x){return x.id===id;})[0];if(!p||p.team===team)return;
    if(team&&teamMembers(team).length>=4){say("Team "+team+" ist schon voll (4 Spieler).",true);renderTeams();return;}
    var before=p.team;p.team=team;rerender();say("Speichere …");
    post("/player",{player:p.id,team:team,kills:p.kills||0,description:p.description||"",youtube:p.youtube||"",tiktok:p.tiktok||""})
      .then(function(){say((p.name||p.displayName)+(team?" ist jetzt in Team "+team+".":" hat jetzt kein Team mehr."));})
      .catch(function(e){p.team=before;rerender();say(e.message||"Speichern fehlgeschlagen.",true);if(e.status===401||e.status===403)logout(true);});
  }

  // ---- Kanäle: Symbole, Namen, Link-Buttons ----
  var ICONS={
    youtube:'<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>',
    tiktok:'<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg>',
    discord:'<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.865-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.74 19.74 0 0 0 3.677 4.37a.07.07 0 0 0-.032.028C.533 9.046-.32 13.58.099 18.058a.082.082 0 0 0 .031.056 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.1 13.1 0 0 1-1.872-.892.077.077 0 0 1-.008-.128c.126-.094.252-.192.372-.291a.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.3 12.3 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.84 19.84 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>'
  };
  var SOCIAL_NAMES={youtube:"YouTube",tiktok:"TikTok",discord:"Discord",instagram:"Instagram",twitch:"Twitch",x:"X"};
  var SOCIAL_HINTS={youtube:"youtube.com/@name oder @name",tiktok:"tiktok.com/@name oder @name",discord:"discord.gg/einladung",instagram:"instagram.com/name",twitch:"twitch.tv/name",x:"x.com/name"};
  // "https://www.youtube.com/@abc" -> "@abc", "https://discord.gg/xyz" -> "discord.gg/xyz"
  function handleOf(platform,url){
    if(platform==="discord")return (url||"").replace(/^https:\/\//,"");
    var m=/\.(?:com|tv)\/(@?[\w.-]+)/.exec(url||"");return m?(m[1].charAt(0)==="@"?m[1]:"@"+m[1]):url;
  }
  function socialButton(platform,url){
    var a=el("a","social-btn s-"+platform);a.href=url;a.target="_blank";a.rel="noopener";
    a.innerHTML=ICONS[platform]||"";a.appendChild(el("span",null,SOCIAL_NAMES[platform]));
    a.setAttribute("aria-label",SOCIAL_NAMES[platform]+": "+handleOf(platform,url));return a;
  }
  function byId(id){return players.filter(function(x){return x.id===id;})[0];}

  // ---- Spieler-Fenster: Skin, Tier, Team, Kills, Herzen, Beschreibung, YouTube/TikTok ----
  var playerDialog=null;
  function openPlayer(p){
    if(!p)return;
    if(!playerDialog){
      playerDialog=el("dialog","team-dialog player-dialog");playerDialog.setAttribute("aria-labelledby","player-dialog-title");
      playerDialog.addEventListener("click",function(e){if(e.target===playerDialog)playerDialog.close();});
      document.body.appendChild(playerDialog);
    }
    var d=playerDialog,name=p.name||p.displayName;d.textContent="";
    var close=el("button","td-close","×");close.type="button";close.setAttribute("aria-label","Schließen");close.onclick=function(){d.close();};
    d.appendChild(close);
    var body=el("div","pd-body"),skin=el("img","pd-skin");
    skin.src="https://minotar.net/armor/body/"+encodeURIComponent(p.minecraftUuid||"MHF_Steve")+"/150.png";skin.alt="Minecraft-Skin von "+name;skin.width=75;skin.height=150;
    body.appendChild(skin);
    var info=el("div","pd-info"),title=el("h2",null,name);title.id="player-dialog-title";
    if(isGeneral(p))title.appendChild(el("em","gen-tag","General"));
    info.appendChild(title);
    if(p.rank){var rk=el("p","pd-rank",p.rank);if(p.rankColor)rk.style.color=p.rankColor;info.appendChild(rk);}
    if(p.minecraft)info.appendChild(el("p","mc","@"+p.minecraft));
    info.appendChild(el("p","pd-desc"+(p.description?"":" empty"),p.description||"Noch keine Beschreibung."));
    var links=el("div","pd-links");
    if(p.youtube)links.appendChild(socialButton("youtube",p.youtube));
    if(p.tiktok)links.appendChild(socialButton("tiktok",p.tiktok));
    if(links.childNodes.length)info.appendChild(links);
    body.appendChild(info);d.appendChild(body);

    var grid=el("dl","td-stats");
    function box(label,value,extra){var x=el("div"),dd=el("dd");if(typeof value==="string")dd.textContent=value;else dd.appendChild(value);x.appendChild(el("dt",null,label));x.appendChild(dd);if(extra)x.appendChild(el("small",null,extra));grid.appendChild(x);}
    var tierEl;if(p.tier){tierEl=el("span","tier-badge",p.tier);tierEl.dataset.t=p.tier;}else tierEl="–";
    var place=p.tier?inTier(p.tier).indexOf(p)+1:0;
    box("Tier",tierEl,p.tier?"Platz "+place+" von "+inTier(p.tier).length+" im Tier":"noch nicht eingestuft");
    box("Team",p.team?"Team "+p.team:"–",p.team?(isGeneral(p)?"General":teamMembers(p.team).length+" / 4 Spieler"):null);
    box("Kills",String(p.kills||0));
    if(p.team){var left=maxHearts-teamLost(p.team),h=el("span","hearts"),s="";for(var i=0;i<maxHearts;i++)s+=heartSVG(i>=left);h.innerHTML=s;box("Team-Herzen",h,left+" von "+maxHearts+" übrig");}
    d.appendChild(grid);

    if(d.showModal)d.showModal();else d.setAttribute("open","");
    close.focus();
  }

  // ---- Creator-Seite: alle Spieler mit YouTube- oder TikTok-Kanal; Klick öffnet das Spieler-Fenster ----
  function isCreator(p){return !!(p.youtube||p.tiktok);}
  function renderCreators(){
    if(!creatorGrid)return;
    var list=players.filter(isCreator).sort(byName);
    creatorGrid.textContent="";
    if(!list.length)creatorGrid.appendChild(el("p","note","Noch keine Creator eingetragen."));
    list.forEach(function(p){
      var name=p.name||p.displayName,item=el("div","creator-item"),a=el("button","chip");
      a.type="button";a.dataset.player=p.id;a.setAttribute("aria-label",name+": Infos und Kanäle anzeigen");
      a.appendChild(headImg(p,44));
      var txt=el("span","chip-name");txt.appendChild(el("span",null,name));
      txt.appendChild(el("small",null,[p.youtube&&handleOf("youtube",p.youtube),p.tiktok&&"TikTok "+handleOf("tiktok",p.tiktok)].filter(Boolean).join(" · ")));
      a.appendChild(txt);
      var icons=el("span","chip-icons");if(p.youtube)icons.insertAdjacentHTML("beforeend",'<span class="chip-yt">'+ICONS.youtube+'</span>');if(p.tiktok)icons.insertAdjacentHTML("beforeend",'<span class="chip-tt">'+ICONS.tiktok+'</span>');
      a.appendChild(icons);item.appendChild(a);
      if(editing()){var rm=el("button","team-rm creator-rm","×");rm.type="button";rm.dataset.uncreator=p.id;rm.title=name+" als Creator entfernen";rm.setAttribute("aria-label",rm.title);item.appendChild(rm);}
      creatorGrid.appendChild(item);
    });
    renderCreatorAdd();
  }
  // Team-Login: Spieler vom Server mit YouTube und/oder TikTok verbinden
  function renderCreatorAdd(){
    if(!creatorAdd)return;
    creatorAdd.textContent="";
    if(!editing())return;
    var form=el("form","creator-form"),who=el("select"),yt=el("input"),tt=el("input"),go=el("button","btn dc","Als Creator verbinden");
    who.setAttribute("aria-label","Spieler");yt.setAttribute("aria-label","YouTube-Kanal");tt.setAttribute("aria-label","TikTok-Kanal");
    var none=el("option",null,"Spieler wählen …");none.value="";who.appendChild(none);
    players.slice().sort(byName).forEach(function(p){var o=el("option",null,(p.name||p.displayName)+(isCreator(p)?" (Creator)":""));o.value=p.id;who.appendChild(o);});
    who.onchange=function(){var p=byId(who.value);yt.value=p&&p.youtube||"";tt.value=p&&p.tiktok||"";};
    yt.type=tt.type="text";yt.placeholder="YouTube: "+SOCIAL_HINTS.youtube;tt.placeholder="TikTok: "+SOCIAL_HINTS.tiktok;yt.maxLength=tt.maxLength=200;go.type="submit";
    form.appendChild(who);form.appendChild(yt);form.appendChild(tt);form.appendChild(go);
    form.onsubmit=function(e){
      e.preventDefault();
      if(!who.value){say("Bitte zuerst einen Spieler wählen.",true);return;}
      if(!yt.value.trim()&&!tt.value.trim()){say("Bitte YouTube oder TikTok eintragen.",true);yt.focus();return;}
      setChannels(who.value,yt.value.trim(),tt.value.trim());
    };
    creatorAdd.appendChild(form);
  }
  function setChannels(id,youtube,tiktok){
    var p=byId(id);if(!p)return;
    say("Speichere …");
    post("/player",{player:p.id,team:p.team||null,kills:p.kills||0,description:p.description||"",youtube:youtube,tiktok:tiktok})
      .then(function(d){p.youtube=d.youtube||"";p.tiktok=d.tiktok||"";rerender();say((p.name||p.displayName)+(isCreator(p)?" ist jetzt als Creator verbunden.":" ist kein Creator mehr."));})
      .catch(function(e){say(e.message||"Speichern fehlgeschlagen.",true);if(e.status===401||e.status===403)logout(true);});
  }
  if(creatorGrid){
    creatorGrid.addEventListener("click",function(e){
      var rm=e.target.closest("[data-uncreator]");
      if(rm&&editing()){e.preventDefault();setChannels(rm.dataset.uncreator,"","");return;}
      var c=e.target.closest("[data-player]");if(c)openPlayer(byId(c.dataset.player));
    });
  }

  // ---- Socials-Seite: offizielle Kanäle von Radius 2 (vom Team gepflegt) ----
  var socialsGrid=document.getElementById("socials-grid"),socialsEdit=document.getElementById("socials-edit"),links={};
  function renderSocials(){
    if(!socialsGrid)return;
    socialsGrid.textContent="";
    var order=["discord","youtube","tiktok","instagram","twitch","x"],any=false;
    order.forEach(function(k){
      if(!links[k])return;any=true;
      var a=el("a","social-card s-"+k);a.href=links[k];a.target="_blank";a.rel="noopener";
      var ic=el("span","sc-icon");ic.innerHTML=ICONS[k]||"";if(!ICONS[k])ic.textContent=SOCIAL_NAMES[k].charAt(0);
      a.appendChild(ic);
      var t=el("span","sc-text");t.appendChild(el("strong",null,SOCIAL_NAMES[k]));t.appendChild(el("small",null,handleOf(k,links[k])));a.appendChild(t);
      a.appendChild(el("span","sc-go","Öffnen →"));
      socialsGrid.appendChild(a);
    });
    if(!any)socialsGrid.appendChild(el("p","note","Noch keine Kanäle eingetragen."));
    renderSocialsEdit();
  }
  function renderSocialsEdit(){
    if(!socialsEdit)return;
    socialsEdit.textContent="";
    if(!editing())return;
    var form=el("form","creator-form socials-form"),inputs={};
    ["discord","youtube","tiktok","instagram","twitch","x"].forEach(function(k){
      var l=el("label","pfield"),i=el("input");i.type="text";i.value=links[k]||"";i.placeholder=SOCIAL_HINTS[k];i.maxLength=200;
      l.appendChild(el("span",null,SOCIAL_NAMES[k]));l.appendChild(i);form.appendChild(l);inputs[k]=i;
    });
    var go=el("button","btn dc","Kanäle speichern");go.type="submit";form.appendChild(go);
    form.onsubmit=function(e){
      e.preventDefault();var body={};Object.keys(inputs).forEach(function(k){body[k]=inputs[k].value.trim();});
      say("Speichere …");
      post("/links",body).then(function(d){links=d.links||{};renderSocials();say("Kanäle gespeichert.");})
        .catch(function(e){say(e.message||"Speichern fehlgeschlagen.",true);if(e.status===401||e.status===403)logout(true);});
    };
    socialsEdit.appendChild(form);
  }

  // ---- Team-Statistik (Fenster beim Klick auf ein Team) ----
  // Tier als Zahl: höchstes Tier = Anzahl der Tiers, niedrigstes = 1
  function tierScore(p){var i=tiers.indexOf(p.tier);return i<0?null:tiers.length-i;}
  function teamStats(n){
    var list=teamMembers(n),scores=list.map(tierScore).filter(function(x){return x!=null;});
    var kills=list.reduce(function(s,p){return s+(p.kills||0);},0);
    var avg=scores.length?scores.reduce(function(s,x){return s+x;},0)/scores.length:null;
    var topKiller=list.slice().sort(function(a,b){return (b.kills||0)-(a.kills||0);})[0];
    return {n:n,list:list,avgScore:avg,avgTier:avg==null?null:tiers[tiers.length-Math.round(avg)],ranked:scores.length,
      kills:kills,avgKills:list.length?kills/list.length:0,left:maxHearts-teamLost(n),
      general:list[0]||null,topKiller:topKiller&&topKiller.kills?topKiller:null};
  }
  function fmt(x){return x.toLocaleString("de-DE",{maximumFractionDigits:1});}
  var dialog=null;
  function openTeamStats(n){
    var st=teamStats(n);
    // Platzierung nach Durchschnitts-Tier unter allen Teams mit eingestuften Spielern
    var ranking=[];for(var t=1;t<=teamCount;t++){var o=teamStats(t);if(o.avgScore!=null)ranking.push(o);}
    ranking.sort(function(a,b){return b.avgScore-a.avgScore||b.kills-a.kills;});
    var place=ranking.indexOf(ranking.filter(function(o){return o.n===n;})[0])+1;

    if(!dialog){
      dialog=el("dialog","team-dialog");dialog.setAttribute("aria-labelledby","team-dialog-title");
      dialog.addEventListener("click",function(e){if(e.target===dialog)dialog.close();}); // Klick neben das Fenster schließt
      document.body.appendChild(dialog);
    }
    dialog.textContent="";
    var head=el("div","td-head"),title=el("h2",null,"Team "+n);title.id="team-dialog-title";
    var close=el("button","td-close","×");close.type="button";close.setAttribute("aria-label","Schließen");close.onclick=function(){dialog.close();};
    var hearts=el("span","hearts"),h="";for(var i=0;i<maxHearts;i++)h+=heartSVG(i>=st.left);hearts.innerHTML=h;
    hearts.setAttribute("aria-label",st.left+" von "+maxHearts+" Herzen übrig");
    head.appendChild(title);head.appendChild(hearts);head.appendChild(close);dialog.appendChild(head);

    var grid=el("dl","td-stats");
    function box(label,value,extra){var d=el("div"),dd=el("dd");if(typeof value==="string")dd.textContent=value;else dd.appendChild(value);d.appendChild(el("dt",null,label));d.appendChild(dd);if(extra)d.appendChild(el("small",null,extra));grid.appendChild(d);}
    var avgEl;
    if(st.avgTier){avgEl=el("span","tier-badge",st.avgTier);avgEl.dataset.t=st.avgTier;}else avgEl="–";
    box("Ø Tier",avgEl,st.avgScore!=null?"Wert "+fmt(st.avgScore)+" von "+tiers.length+(st.ranked<st.list.length?" · "+st.ranked+" eingestuft":""):null);
    box("Platz",place?place+".":"–",place?"von "+ranking.length+" Teams nach Ø Tier":"noch keine Einstufung");
    box("Kills gesamt",String(st.kills));
    box("Ø Kills",fmt(st.avgKills),"pro Spieler");
    box("Herzen übrig",st.left+" / "+maxHearts,st.left===0?"ausgeschieden":null);
    box("Spieler",st.list.length+" / 4");
    dialog.appendChild(grid);

    var facts=el("p","td-facts");
    facts.textContent=(st.general?"General: "+(st.general.name||st.general.displayName):"Noch kein General")+
      (st.topKiller?" · Meiste Kills: "+(st.topKiller.name||st.topKiller.displayName)+" ("+st.topKiller.kills+")":"");
    dialog.appendChild(facts);

    if(st.list.length){
      var table=el("table","td-table"),thead=el("thead"),tr=el("tr");
      ["Spieler","Tier","Kills"].forEach(function(t){tr.appendChild(el("th",null,t));});thead.appendChild(tr);table.appendChild(thead);
      var tbody=el("tbody");
      st.list.forEach(function(p,i){
        var row=el("tr","clickable"),who=el("td","td-who");who.appendChild(headImg(p,28));
        row.onclick=function(){openPlayer(p);};row.title="Details zu "+(p.name||p.displayName);
        var nm=el("span",null,p.name||p.displayName);who.appendChild(nm);if(i===0)who.appendChild(el("em",null,"General"));
        var tc=el("td");if(p.tier){var b=el("span","tier-badge mini",p.tier);b.dataset.t=p.tier;tc.appendChild(b);}else tc.textContent="–";
        row.appendChild(who);row.appendChild(tc);row.appendChild(el("td",null,String(p.kills||0)));tbody.appendChild(row);
      });
      table.appendChild(tbody);dialog.appendChild(table);
    }else dialog.appendChild(el("p","note","Diesem Team sind noch keine Spieler zugeordnet."));

    if(dialog.showModal)dialog.showModal();else dialog.setAttribute("open","");
    close.focus();
  }

  if(teamsGrid){
    teamsGrid.addEventListener("keydown",function(e){
      var card=e.target.closest(".team-card");
      if(card&&e.target===card&&(e.key==="Enter"||e.key===" ")){e.preventDefault();openTeamStats(Number(card.dataset.team));}
    });
    teamsGrid.addEventListener("change",function(e){
      var s=e.target.closest(".team-add");if(!s||!s.value||!editing())return;
      setTeam(s.value,Number(s.dataset.team));
    });
    teamsGrid.addEventListener("click",function(e){
      if(e.target.closest(".team-add"))return; // Auswahlliste öffnet keine Statistik
      var rm=e.target.closest("[data-remove]");
      if(rm&&editing()){setTeam(rm.dataset.remove,null);return;}
      var b=e.target.closest(".heart-btn[data-team]");
      if(!b||!editing()){var card=e.target.closest(".team-card");if(card&&!b)openTeamStats(Number(card.dataset.team));return;}
      var n=Number(b.dataset.team),lost=maxHearts-Number(b.dataset.left),t=teams.filter(function(x){return x.team===n;})[0];
      if(!t){t={team:n,heartsLost:0};teams.push(t);}
      var before=t.heartsLost;if(before===lost)return;
      t.heartsLost=lost;renderTeams();say("Speichere …");
      post("/team",{team:n,heartsLost:lost})
        .then(function(){say("Team "+n+": "+(maxHearts-lost)+" von "+maxHearts+" Herzen übrig.");})
        .catch(function(e){t.heartsLost=before;renderTeams();say(e.message||"Speichern fehlgeschlagen.",true);if(e.status===401||e.status===403)logout(true);});
    });
  }

  // ---- Discord-Login fürs Team ----
  function renderAuth(){
    if(!authBox)return;
    authBox.textContent="";
    if(me){
      authBox.appendChild(el("span","tier-who","Angemeldet als "+me.name));
      var out=el("button","btn ghost","Abmelden");out.type="button";out.onclick=function(){logout(false);};
      authBox.appendChild(out);
    }else{
      // Team-Login per Einmal-Code: in Discord /login eingeben, Code hier eintragen
      var form=el("form","tier-login"),input=el("input"),go=el("button","btn ghost","Team-Login");
      input.name="code";input.placeholder="Code aus /login";input.autocomplete="one-time-code";
      input.maxLength=9;input.setAttribute("aria-label","Login-Code aus dem Discord-Befehl /login");
      go.type="submit";
      form.appendChild(input);form.appendChild(go);
      form.onsubmit=function(e){e.preventDefault();if(input.value.trim())redeem(input.value);else{input.focus();say("Gib in Discord /login ein und trag den Code hier ein.");}};
      authBox.appendChild(form);
    }
  }
  function redeem(code){
    say("Prüfe Code …");
    return fetch(WORKER+"/auth/code",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({code:code})})
      .then(function(r){return r.json().then(function(d){if(!r.ok)throw new Error(d.error||"Anmeldung fehlgeschlagen.");return d;});})
      .then(function(d){session=d.session;store(SESSION_KEY,session);me={name:d.name};renderAuth();rerender();say(board?"Angemeldet. Du kannst die Spieler jetzt einstufen.":"Angemeldet. Du kannst die Spieler jetzt bearbeiten.");})
      .catch(function(e){say(e.message,true);});
  }
  function logout(expired){
    session=null;me=null;selected=null;editId=null;store(SESSION_KEY,null);renderAuth();rerender();
    if(expired)say("Bitte melde dich neu an.",true);
  }
  function checkSession(){
    if(!session){renderAuth();return Promise.resolve();}
    return fetch(WORKER+"/auth/me",{headers:{Authorization:"Bearer "+session}})
      .then(function(r){if(!r.ok)throw new Error();return r.json();})
      .then(function(d){me=d;renderAuth();rerender();})
      .catch(function(){logout(false);});
  }

  // Button "Direkt anmelden" aus der /login-Antwort: tierlist.html#code=...
  var hash=location.hash.slice(1),linkCode=board&&hash.indexOf("code=")===0?hash.slice(5):null;
  if(linkCode)history.replaceState(null,"",location.pathname+location.search);
  session=read(SESSION_KEY);

  renderAuth();
  load().then(function(){if(!board&&!grid&&!teamsGrid&&!creatorGrid&&!socialsGrid)return;return linkCode?redeem(linkCode):checkSession();});
})();
