// Radius 2 – Live-Seite: Events aus der Mod (z. B. "Spieler hat ein Leben verloren").
// Die Mod schickt sie an den Worker (POST /api/events), hier werden die letzten angezeigt.
// Die Seite fragt alle 5 Sekunden nach neuen Events (und sofort, wenn man zum Tab zurückkehrt);
// neue Events werden kurz hervorgehoben. Das Team kann nach dem Login (/login, siehe live.js)
// einzelne oder alle Events löschen.
(function(){
  var WORKER="https://mc-namen.typischtobi66.workers.dev",POLL_MS=5000;
  var feed=document.getElementById("event-feed"),status=document.getElementById("event-status");
  var tools=document.getElementById("event-tools"),msg=document.getElementById("team-msg");
  if(!feed)return;
  var shown="",session=null,last={events:[]},known=null;

  function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
  function say(text,bad){if(!msg)return;msg.textContent=text||"";msg.classList.toggle("bad",!!bad);}
  // Symbol nach Stichworten im Titel/Text
  function kind(ev){
    var t=(ev.title+" "+ev.description).toLowerCase();
    if(/herz|leben|heart|life/.test(t))return ["heart","❤"];
    if(/kill|tot|tod|stirbt|gestorben|death|died/.test(t))return ["kill","⚔"];
    if(/join|beigetreten|betritt|online/.test(t))return ["join","➜"];
    if(/leave|verlassen|offline/.test(t))return ["leave","←"];
    return ["info","●"];
  }
  function when(iso){
    var d=new Date(iso);if(isNaN(d))return "";
    var s=Math.round((Date.now()-d)/1000);
    if(s<60)return "gerade eben";
    if(s<3600)return "vor "+Math.floor(s/60)+" min";
    if(s<86400)return "vor "+Math.floor(s/3600)+" h";
    return d.toLocaleString("de-DE",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});
  }
  function render(data,force){
    last=data;
    var events=data.events||[];
    var key=events.map(function(e){return e.id;}).join()+"|"+!!session;
    status.textContent=data.configured===false?"Der Empfänger ist noch nicht eingerichtet.":"Aktualisiert sich automatisch · "+new Date().toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"})+" Uhr";
    renderTools(events.length);
    if(key===shown&&!force){[].forEach.call(feed.querySelectorAll("time"),function(t){t.textContent=when(t.dateTime);});return;}
    shown=key;feed.textContent="";
    // Beim ersten Laden ist nichts "neu"; danach wird jedes unbekannte Event hervorgehoben
    var isNew=function(id){return known&&!known[id];};
    var seen={};events.forEach(function(e){seen[e.id]=1;});
    if(!events.length){feed.appendChild(el("p","note","Noch keine Events. Sobald auf dem Server etwas passiert, erscheint es hier."));known=seen;return;}
    events.forEach(function(ev){
      var k=kind(ev),item=el("article","event ev-"+k[0]+(isNew(ev.id)?" fresh":""));
      if(ev.color!=null)item.style.setProperty("--ev",("#"+Number(ev.color).toString(16).padStart(6,"0")));
      item.appendChild(el("span","ev-icon",k[1]));
      var body=el("div","ev-body"),head=el("div","ev-head");
      head.appendChild(el("strong",null,ev.title));
      if(ev.server)head.appendChild(el("span","ev-server",ev.server));
      var t=el("time",null,when(ev.time));t.dateTime=ev.time;head.appendChild(t);
      body.appendChild(head);
      if(ev.description)body.appendChild(el("p",null,ev.description));
      if(ev.fields&&ev.fields.length){
        var dl=el("dl","ev-fields");
        ev.fields.forEach(function(f){var d=el("div");d.appendChild(el("dt",null,f.name));d.appendChild(el("dd",null,f.value));dl.appendChild(d);});
        body.appendChild(dl);
      }
      item.appendChild(body);
      if(session){var rm=el("button","team-rm ev-rm","×");rm.type="button";rm.dataset.delete=ev.id;rm.title="Event löschen";rm.setAttribute("aria-label","Event „"+ev.title+"“ löschen");item.appendChild(rm);}
      feed.appendChild(item);
    });
    known=seen;
  }
  function renderTools(count){
    if(!tools)return;
    tools.textContent="";
    if(!session||!count)return;
    var all=el("button","btn ghost","Alle Events löschen");all.type="button";
    all.onclick=function(){if(confirm("Wirklich alle "+count+" Events löschen? Das lässt sich nicht rückgängig machen."))remove({all:true});};
    tools.appendChild(all);
  }
  function remove(what){
    say("Lösche …");
    fetch(WORKER+"/events/delete",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+session},body:JSON.stringify(what)})
      .then(function(r){return r.json().then(function(d){if(!r.ok)throw new Error(d.error||r.status);return d;});})
      .then(function(d){
        var rest=what.all?[]:(last.events||[]).filter(function(e){return e.id!==what.id;});
        render({events:rest,configured:last.configured},true);
        say(d.removed===1?"Event gelöscht.":d.removed+" Events gelöscht.");
      })
      .catch(function(e){say(/fetch/i.test(e.message)?"Löschen fehlgeschlagen: Der Worker antwortet nicht richtig – ist der neueste Worker-Code deployt?":e.message||"Löschen fehlgeschlagen.",true);});
  }
  feed.addEventListener("click",function(e){
    var b=e.target.closest("[data-delete]");if(b&&session)remove({id:b.dataset.delete});
  });
  // Login-Status kommt von live.js
  document.addEventListener("radius-auth",function(e){
    session=e.detail.session;render(last,true);
  });
  function load(){
    fetch(WORKER+"/events.json",{cache:"no-store"})
      .then(function(r){if(!r.ok)throw new Error(r.status);return r.json();})
      .then(function(d){render(d);})
      .catch(function(){status.textContent="Events konnten gerade nicht geladen werden. Neuer Versuch in wenigen Sekunden.";});
  }
  load();
  setInterval(function(){if(!document.hidden)load();},POLL_MS);
  document.addEventListener("visibilitychange",function(){if(!document.hidden)load();});
})();
