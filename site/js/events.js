// Radius 2 – Live-Seite: Events aus der Mod (z. B. "Spieler hat ein Leben verloren").
// Die Mod schickt sie an den Worker (POST /api/events), hier werden die letzten angezeigt
// und alle 20 Sekunden aktualisiert.
(function(){
  var WORKER="https://mc-namen.typischtobi66.workers.dev";
  var feed=document.getElementById("event-feed"),status=document.getElementById("event-status");
  if(!feed)return;
  var shown="";

  function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
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
  function render(data){
    var events=data.events||[];
    var key=events.map(function(e){return e.id;}).join();
    status.textContent=data.configured===false?"Der Empfänger ist noch nicht eingerichtet.":"Aktualisiert sich automatisch · "+new Date().toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"})+" Uhr";
    if(key===shown){[].forEach.call(feed.querySelectorAll("time"),function(t){t.textContent=when(t.dateTime);});return;}
    shown=key;feed.textContent="";
    if(!events.length){feed.appendChild(el("p","note","Noch keine Events. Sobald auf dem Server etwas passiert, erscheint es hier."));return;}
    events.forEach(function(ev){
      var k=kind(ev),item=el("article","event ev-"+k[0]);
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
      item.appendChild(body);feed.appendChild(item);
    });
  }
  function load(){
    fetch(WORKER+"/events.json",{cache:"no-store"})
      .then(function(r){if(!r.ok)throw new Error(r.status);return r.json();})
      .then(render)
      .catch(function(){status.textContent="Events konnten gerade nicht geladen werden. Neuer Versuch in 20 Sekunden.";});
  }
  load();
  setInterval(function(){if(!document.hidden)load();},20000);
})();
