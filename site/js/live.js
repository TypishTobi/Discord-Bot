// Radius 2 – Live-Daten aus Discord: Team-Liste, Tierlist und Spieler-Seite.
// Die Daten liefert der Cloudflare Worker (worker/worker.js); das Team meldet sich
// mit einem Einmal-Code aus dem Discord-Befehl /login an, kann die Spieler per
// Drag & Drop oder Antippen einstufen und Team, Kills, Herzen und Beschreibung pflegen.
(function(){
  var WORKER="https://mc-namen.typischtobi66.workers.dev";
  var DEFAULT_TIERS=["S+","S","A+","A","B+","B","C+","C"];
  var SESSION_KEY="radius2-session",MAX_DESCRIPTION=200;
  var board=document.getElementById("tier-board"),grid=document.getElementById("player-grid");
  var authBox=document.getElementById("team-auth"),msg=document.getElementById("team-msg");
  var players=[],tiers=DEFAULT_TIERS,teamCount=12,maxHearts=4,session=null,me=null,selected=null,editId=null;

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
      renderRoster();rerender();
    }).catch(function(){
      if(board)board.innerHTML='<p class="note">Die Tierlist konnte gerade nicht geladen werden.</p>';
      if(grid)grid.innerHTML='<p class="note">Die Spieler konnten gerade nicht geladen werden.</p>';
    });
  }
  function rerender(){renderBoard();renderPlayers();}

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
        var card=el("article","roster-card"),txt=el("div");
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
    if(editing()){c.tabIndex=0;c.setAttribute("role","button");c.draggable=true;c.setAttribute("aria-pressed",selected===p.id?"true":"false");c.title="Antippen, dann Tier wählen – oder ziehen";}
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
  function renderBoard(){
    if(!board)return;
    board.textContent="";
    if(!players.length){board.appendChild(el("p","note","Noch keine Spieler."));return;}
    board.classList.toggle("editing",editing());
    tiers.forEach(function(t){board.appendChild(row(t,t,players.filter(function(p){return p.tier===t;}).sort(byName)));});
    var open=players.filter(function(p){return !p.tier||tiers.indexOf(p.tier)<0;}).sort(byName);
    if(open.length||editing())board.appendChild(row(null,"Offen",open));
  }

  // ---- Bearbeiten: Ziehen (Maus) oder Antippen + Tier antippen (Touch/Tastatur) ----
  function move(id,tier){
    var p=players.filter(function(x){return x.id===id;})[0];if(!p||p.tier===tier)return;
    var before=p.tier;p.tier=tier;selected=null;renderBoard();
    say("Speichere …");
    fetch(WORKER+"/tierlist",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+session},body:JSON.stringify({player:id,tier:tier})})
      .then(function(r){return r.json().then(function(d){if(!r.ok)throw Object.assign(new Error(d.error||r.status),{status:r.status});return d;});})
      .then(function(){say((p.name||p.displayName)+" → "+(tier||"offen")+" gespeichert.");})
      .catch(function(e){p.tier=before;renderBoard();say(e.message||"Speichern fehlgeschlagen.",true);if(e.status===401||e.status===403)logout(true);});
  }
  if(board){
  board.addEventListener("click",function(e){
    if(!editing())return;
    var c=e.target.closest(".tchip"),lab=e.target.closest(".tier-label");
    if(c){
      var id=c.dataset.id;selected=selected===id?null:id;renderBoard();
      say(selected?"Jetzt das Ziel-Tier links antippen.":"");
      var again=board.querySelector('.tchip[data-id="'+id+'"]');if(again)again.focus();
    }
    else if(lab&&selected){move(selected,lab.parentNode.dataset.tier||null);}
  });
  board.addEventListener("keydown",function(e){var c=e.target.closest(".tchip");if(c&&editing()&&(e.key==="Enter"||e.key===" ")){e.preventDefault();c.click();}});
  board.addEventListener("dragstart",function(e){var c=e.target.closest&&e.target.closest(".tchip");if(c&&editing()){e.dataTransfer.setData("text/plain",c.dataset.id);e.dataTransfer.effectAllowed="move";c.classList.add("drag");}});
  board.addEventListener("dragend",function(e){var c=e.target.closest&&e.target.closest(".tchip");if(c)c.classList.remove("drag");});
  board.addEventListener("dragover",function(e){var r=e.target.closest(".tier-row");if(r&&editing()){e.preventDefault();e.dataTransfer.dropEffect="move";clearOver();r.classList.add("over");}});
  board.addEventListener("dragleave",function(e){var r=e.target.closest(".tier-row");if(r&&!r.contains(e.relatedTarget))r.classList.remove("over");});
  board.addEventListener("drop",function(e){var r=e.target.closest(".tier-row");if(!r||!editing())return;e.preventDefault();clearOver();move(e.dataTransfer.getData("text/plain"),r.dataset.tier||null);});
  }
  function clearOver(){[].forEach.call(board.querySelectorAll(".over"),function(x){x.classList.remove("over");});}

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
  function stat(label,value){var d=el("div"),dt=el("dt",null,label),dd=el("dd");if(typeof value==="string")dd.textContent=value;else dd.appendChild(value);d.appendChild(dt);d.appendChild(dd);return d;}
  function playerCard(p){
    var card=el("article","pcard");card.dataset.id=p.id;
    var top=el("div","pcard-top"),who=el("div");
    top.appendChild(headImg(p,56));
    who.appendChild(el("h3",null,p.name||p.displayName));
    if(p.minecraft)who.appendChild(el("p","mc","@"+p.minecraft));
    top.appendChild(who);
    var badge=el("span","tier-badge",p.tier||"–");if(p.tier)badge.dataset.t=p.tier;badge.title=p.tier?"Tier "+p.tier:"Noch nicht eingestuft";
    top.appendChild(badge);card.appendChild(top);

    var stats=el("dl","pstats"),hearts=el("span","hearts"),lost=Math.min(p.heartsLost||0,maxHearts);
    var h="";for(var i=0;i<maxHearts;i++)h+=heartSVG(i>=maxHearts-lost);hearts.innerHTML=h;
    hearts.setAttribute("aria-label",lost+" von "+maxHearts+" Herzen verloren");
    stats.appendChild(stat("Team",p.team?"Team "+p.team:"–"));
    stats.appendChild(stat("Kills",String(p.kills||0)));
    stats.appendChild(stat("Herzen verloren",hearts));
    card.appendChild(stats);
    card.appendChild(el("p","pdesc"+(p.description?"":" empty"),p.description||"Noch keine Beschreibung."));
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
    var hearts=el("input");hearts.type="number";hearts.min=0;hearts.max=maxHearts;hearts.value=p.heartsLost||0;field("Herzen verloren (0–"+maxHearts+")",hearts);
    var kills=el("input");kills.type="number";kills.min=0;kills.max=9999;kills.value=p.kills||0;field("Kills",kills);
    var desc=el("textarea");desc.maxLength=MAX_DESCRIPTION;desc.rows=3;desc.value=p.description||"";
    var count=el("small","pcount");function upd(){count.textContent=desc.value.length+"/"+MAX_DESCRIPTION;}desc.oninput=upd;upd();
    field("Kurze Beschreibung",desc).parentNode.appendChild(count);
    var row=el("div","pactions"),save=el("button","btn dc","Speichern"),cancel=el("button","btn ghost","Abbrechen");
    save.type="submit";cancel.type="button";cancel.onclick=function(){editId=null;renderPlayers();};
    row.appendChild(save);row.appendChild(cancel);f.appendChild(row);
    f.onsubmit=function(e){
      e.preventDefault();
      savePlayer(p,{team:team.value?Number(team.value):null,heartsLost:Number(hearts.value),kills:Number(kills.value),description:desc.value.trim()});
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
      .then(function(d){p.team=d.team;p.heartsLost=d.heartsLost;p.kills=d.kills;p.description=d.description;editId=null;renderPlayers();say((p.name||p.displayName)+" gespeichert.");})
      .catch(function(e){say(e.message||"Speichern fehlgeschlagen.",true);if(e.status===401||e.status===403)logout(true);});
  }
  if(grid){
    grid.addEventListener("click",function(e){
      var b=e.target.closest("[data-edit]");if(!b||!editing())return;
      editId=b.dataset.edit;renderPlayers();
      var f=grid.querySelector(".pform select");if(f)f.focus();
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
  load().then(function(){if(!board&&!grid)return;return linkCode?redeem(linkCode):checkSession();});
})();
