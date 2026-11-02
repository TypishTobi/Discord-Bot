// Radius 2 – Testseite fürs neue Design: Menü, Countdown und Live-Vorschau (nur lesen).
(function(){
  var WORKER="https://mc-namen.typischtobi66.workers.dev";
  function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}

  // Menü "Mehr" und Handy-Menü
  var more=document.querySelector(".more"),moreBtn=more&&more.querySelector("button");
  if(moreBtn){
    moreBtn.addEventListener("click",function(e){e.stopPropagation();var o=more.classList.toggle("open");moreBtn.setAttribute("aria-expanded",o);});
    document.addEventListener("click",function(){more.classList.remove("open");moreBtn.setAttribute("aria-expanded","false");});
    document.addEventListener("keydown",function(e){if(e.key==="Escape"){more.classList.remove("open");moreBtn.setAttribute("aria-expanded","false");}});
  }
  var toggle=document.querySelector(".menu-toggle"),mobile=document.getElementById("mobile-menu");
  if(toggle)toggle.addEventListener("click",function(){var o=mobile.classList.toggle("open");toggle.setAttribute("aria-expanded",o);toggle.setAttribute("aria-label",o?"Menü schließen":"Menü öffnen");});

  // Countdown bis 20.11.2026 18:00 (Europe/Berlin = UTC+1)
  var target=Date.parse("2026-11-20T18:00:00+01:00"),ids=["c-d","c-h","c-m","c-s"].map(function(i){return document.getElementById(i);});
  function pad(n){return String(n).padStart(2,"0");}
  (function tick(){
    var s=Math.max(0,Math.floor((target-Date.now())/1000));
    ids[0].textContent=Math.floor(s/86400);ids[1].textContent=pad(Math.floor(s%86400/3600));
    ids[2].textContent=pad(Math.floor(s%3600/60));ids[3].textContent=pad(s%60);
    if(s>0)setTimeout(tick,1000);
  })();

  // Live-Vorschau: Team-Herzen und die stärksten Spieler
  var HEART=["01100110","11111111","11111111","11111111","01111110","00111100","00011000"];
  function heart(lost){var r="";HEART.forEach(function(row,y){for(var x=0;x<8;x++)if(row[x]==="1")r+='<rect x="'+x+'" y="'+y+'" width="1" height="1"/>';});
    return '<svg class="'+(lost?"lost":"")+'" viewBox="0 0 8 7" shape-rendering="crispEdges" aria-hidden="true">'+r+'</svg>';}
  function rank(tiers,p){var i=tiers.indexOf(p.tier);return i<0?99:i;}
  fetch(WORKER+"/members.json",{cache:"no-store"}).then(function(r){return r.json();}).then(function(d){
    var players=[],seen={};(d.roles||[]).forEach(function(r){r.members.forEach(function(m){if(!seen[m.id]){seen[m.id]=1;players.push(m);}});});
    var tiers=d.tiers||[],max=d.maxHearts||4;
    function best(a,b){return rank(tiers,a)-rank(tiers,b)||((a.tierOrder||1e9)-(b.tierOrder||1e9))||(b.kills||0)-(a.kills||0);}

    var strip=document.getElementById("team-strip");strip.textContent="";
    (d.teams||[]).forEach(function(t){
      var left=max-Math.min(t.heartsLost||0,max),members=players.filter(function(p){return p.team===t.team;}).sort(best);
      var c=el("a","tcard"+(left===0?" out":""));c.href="../teams.html";c.style.textDecoration="none";
      var top=el("div","tc-top");top.appendChild(el("b",null,"Team "+t.team));top.appendChild(el("small",null,members.length+"/4"));c.appendChild(top);
      var h=el("div","hearts");var s="";for(var i=0;i<max;i++)s+=heart(i>=left);h.innerHTML=s;h.setAttribute("aria-label",left+" von "+max+" Herzen");c.appendChild(h);
      c.appendChild(el("div","tc-gen",members[0]?"General: "+(members[0].name||members[0].displayName):"Noch keine Spieler"));
      strip.appendChild(c);
    });

    var row=document.getElementById("player-row");row.textContent="";
    players.filter(function(p){return p.tier;}).sort(best).slice(0,8).forEach(function(p){
      var a=el("a","pchip");a.href="../spieler.html";
      var img=el("img");img.src="https://minotar.net/helm/"+encodeURIComponent(p.minecraftUuid||"MHF_Steve")+"/64.png";img.alt="";img.width=42;img.height=42;a.appendChild(img);
      var n=el("span",null,p.name||p.displayName);n.appendChild(el("small",null,p.team?"Team "+p.team:(p.minecraft?"@"+p.minecraft:"")));a.appendChild(n);
      var b=el("span","tier",p.tier);b.dataset.t=p.tier;a.appendChild(b);
      row.appendChild(a);
    });
  }).catch(function(){
    document.getElementById("team-strip").innerHTML='<p class="muted">Live-Daten gerade nicht erreichbar.</p>';
    document.getElementById("player-row").textContent="";
  });
})();
