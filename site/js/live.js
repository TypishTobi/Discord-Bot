// Radius 2 – Live-Daten aus Discord: Team-Liste und Tierlist.
// Die Daten liefert der Cloudflare Worker (worker/worker.js); das Team meldet sich
// dort mit Discord an und kann die Spieler per Drag & Drop oder Antippen einstufen.
(function(){
  var WORKER="https://mc-namen.typischtobi66.workers.dev";
  var DEFAULT_TIERS=["S+","S","A+","A","B+","B","C+","C"];
  var SESSION_KEY="radius2-session";
  var board=document.getElementById("tier-board"),authBox=document.getElementById("tier-auth"),msg=document.getElementById("tier-msg");
  var players=[],tiers=DEFAULT_TIERS,session=null,me=null,selected=null;

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
      renderRoster();renderBoard();
    }).catch(function(){if(board)board.innerHTML='<p class="note">Die Tierlist konnte gerade nicht geladen werden.</p>';});
  }

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

  // ---- Discord-Login fürs Team ----
  function renderAuth(){
    if(!authBox)return;
    authBox.textContent="";
    if(me){
      authBox.appendChild(el("span","tier-who","Angemeldet als "+me.name));
      var out=el("button","btn ghost","Abmelden");out.type="button";out.onclick=function(){logout(false);};
      authBox.appendChild(out);
    }else{
      var a=el("a","btn ghost","Team-Login");
      a.href=WORKER+"/auth/login?return="+encodeURIComponent(location.origin+location.pathname);
      a.title="Nur für das Team: mit Discord anmelden, um die Tierlist zu bearbeiten";
      authBox.appendChild(a);
    }
  }
  function logout(expired){
    session=null;me=null;selected=null;store(SESSION_KEY,null);renderAuth();renderBoard();
    if(expired)say("Bitte melde dich neu an.",true);
  }
  function checkSession(){
    if(!session){renderAuth();return Promise.resolve();}
    return fetch(WORKER+"/auth/me",{headers:{Authorization:"Bearer "+session}})
      .then(function(r){if(!r.ok)throw new Error();return r.json();})
      .then(function(d){me=d;renderAuth();renderBoard();})
      .catch(function(){logout(false);});
  }

  // Rückkehr vom Discord-Login: #session=... oder #login=...
  var hash=location.hash.slice(1),notes={"login=kein-team":"Die Tierlist kann nur das Team ab Mod bearbeiten.","login=abgebrochen":"Anmeldung abgebrochen.","login=fehler":"Anmeldung fehlgeschlagen. Bitte versuche es noch einmal."};
  if(hash.indexOf("session=")===0){store(SESSION_KEY,hash.slice(8));}
  if(board&&(hash.indexOf("session=")===0||notes[hash])){
    history.replaceState(null,"",location.pathname+location.search+"#tierlist");
    if(notes[hash])say(notes[hash],hash!=="login=abgebrochen");
    setTimeout(function(){document.getElementById("tierlist").scrollIntoView();},0);
  }
  session=read(SESSION_KEY);

  renderAuth();
  load().then(function(){if(board)return checkSession();});
})();
