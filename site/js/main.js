(function(){
  var HEART=["01100110","11111111","11111111","11111111","01111110","00111100","00011000"];
  function heartSVG(lost){
    var r="";
    HEART.forEach(function(row,y){for(var x=0;x<8;x++){if(row[x]==="1")r+='<rect x="'+x+'" y="'+y+'" width="1" height="1"/>';}});
    return '<svg class="heart'+(lost?' lost':'')+'" viewBox="0 0 8 7" shape-rendering="crispEdges" aria-hidden="true">'+r+'</svg>';
  }
  var palettes=[["#5cd3f2","#1d4f7a"],["#9fe7c9","#1f5c4e"],["#f2c35c","#6a4b1a"],["#e58ea8","#5c2340"],["#b7a3f5","#3b2f6e"],["#7fb4ff","#1e3a6e"]];
  function avatar(seed,i){
    var c=document.createElement("canvas");c.width=8;c.height=8;c.className="avatar";
    var g=c.getContext("2d"),p=palettes[i%palettes.length],h=0;
    for(var k=0;k<seed.length;k++)h=(h*31+seed.charCodeAt(k))>>>0;
    g.fillStyle=p[1];g.fillRect(0,0,8,8);g.fillStyle=p[0];
    for(var y=0;y<8;y++)for(var x=0;x<4;x++){h=(h*1103515245+12345)>>>0;if((h>>16)&1){g.fillRect(x,y,1,1);g.fillRect(7-x,y,1,1);}}
    c.setAttribute("aria-hidden","true");
    return c;
  }
  var YT='<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>', GH='<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.55-.29-5.24-1.28-5.24-5.69 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.42-2.69 5.39-5.25 5.68.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z"/></svg>';
  var links=window.RADIUS_LINKS||{};
  function ytUrl(n){return links[n]||"https://www.youtube.com/results?search_query="+encodeURIComponent(n+" Minecraft");}
  function esc(s){var d=document.createElement("div");d.textContent=s;return d.innerHTML;}

  // 12 Teams mit je 4 Herzen und 4 Plätzen
  var tg=document.getElementById("teams-grid"),teams=window.RADIUS_TEAMS||[];
  for(var t=0;t<12;t++){
    var mem=teams[t]||[],el=document.createElement("article");el.className="team-card";
    var hs="";for(var k=0;k<4;k++)hs+=heartSVG(false);
    var slots="";for(var s=0;s<4;s++){slots+=mem[s]?'<li class="'+(s===0?"gen":"")+'">'+esc(mem[s])+(s===0?' <em>General</em>':'')+'</li>':'<li class="empty">'+(s===0?'General':'Platz '+(s+1))+'</li>';}
    el.innerHTML='<h3>Team '+(t+1)+'</h3><span class="hearts" aria-label="4 Team-Herzen">'+hs+'</span><ul>'+slots+'</ul>';
    tg.appendChild(el);
  }

  // Creator: Featured, Mitspielende, Zuschauer
  var cbox=document.getElementById("creators");
  (window.RADIUS_FEATURED||[]).forEach(function(c,i){
    var a=document.createElement("a");a.className="creator";a.href=ytUrl(c[0]);a.target="_blank";a.rel="noopener";
    a.setAttribute("aria-label",c[0]+" auf YouTube ansehen");
    var th=document.createElement("div");th.className="thumb";
    var cv=avatar(c[0],i+1);cv.className="avatar thumb-bg";th.appendChild(cv);
    th.insertAdjacentHTML("beforeend",'<span class="play">'+YT+'</span>');
    var info=document.createElement("div");info.className="c-info";
    info.innerHTML='<h3>'+esc(c[0])+'</h3><p class="tag">'+esc(c[1])+'</p><p class="c-text">'+esc(c[2]||"")+'</p><span class="btn yt">'+YT+' Auf YouTube ansehen</span>';
    a.appendChild(th);a.appendChild(info);cbox.appendChild(a);
  });
  function chips(list,id,off){
    var box=document.getElementById(id);
    list.forEach(function(n,i){
      var a=document.createElement("a");a.className="chip";a.href=ytUrl(n);a.target="_blank";a.rel="noopener";
      a.setAttribute("aria-label",n+" auf YouTube");
      a.appendChild(avatar(n,i+off));
      a.insertAdjacentHTML("beforeend",'<span class="chip-name">'+esc(n)+'</span><span class="chip-yt">'+YT+'</span>');
      box.appendChild(a);
    });
  }
  chips(window.RADIUS_PLAYERS||[],"cplay",0);
  chips(window.RADIUS_WATCHERS||[],"cwatch",3);

  // Staff (Karte im Stil: Bild, Name, Rolle, GitHub)
  var sbox=document.getElementById("staff");
  (window.RADIUS_STAFF||[]).forEach(function(m){
    var el=document.createElement("article");el.className="staff-card";
    var icon=m[3]?'<a class="gh" href="'+esc(m[3])+'" target="_blank" rel="noopener" aria-label="'+esc(m[0])+' auf GitHub">'+GH+'</a>':'<span class="gh" aria-hidden="true">'+GH+'</span>';
    el.innerHTML='<img src="'+esc(m[2])+'" alt="Profilbild von '+esc(m[0])+'" width="100" height="100"><h3>'+esc(m[0])+'</h3><p>'+esc(m[1])+'</p>'+icon;
    sbox.appendChild(el);
  });

  // Hero-Effekte: Regen, aufsteigende Pixel-Funken, Blitze (aus bei reduzierter Bewegung)
  (function(){
    var cv=document.getElementById("fx");if(!cv||matchMedia("(prefers-reduced-motion:reduce)").matches)return;
    var g=cv.getContext("2d"),flash=document.querySelector(".flash"),W,H,drops=[],bits=[],bolt=null,nextBolt=1800,visible=true,last=performance.now();
    function size(){var r=cv.parentNode.getBoundingClientRect(),d=Math.min(devicePixelRatio||1,2);W=r.width;H=r.height;cv.width=W*d;cv.height=H*d;g.setTransform(d,0,0,d,0,0);
      drops=[];for(var i=0;i<Math.round(W/10);i++)drops.push({x:Math.random()*W,y:Math.random()*H,l:10+Math.random()*16,v:8+Math.random()*8});
      bits=[];for(var j=0;j<Math.round(W/55);j++)bits.push({x:Math.random()*W,y:Math.random()*H,s:3+Math.floor(Math.random()*3)*2,v:.25+Math.random()*.5,a:.2+Math.random()*.5});}
    function makeBolt(){var x=W*(.12+Math.random()*.76),y=0,paths=[],main=[[x,y]];
      while(y<H*.6){y+=16+Math.random()*26;x+=(Math.random()-.5)*64;main.push([x,y]);
        if(Math.random()<.2){var b=[[x,y]],bx=x,by=y,dir=Math.random()<.5?-1:1;for(var k=0;k<4;k++){by+=12+Math.random()*18;bx+=dir*(10+Math.random()*26);b.push([bx,by]);}paths.push(b);}}
      paths.unshift(main);return {paths:paths,age:0};}
    function frame(now){
      var dt=Math.min(now-last,50);last=now;
      if(visible){
        g.clearRect(0,0,W,H);
        g.strokeStyle="rgba(190,235,255,.26)";g.lineWidth=1;g.beginPath();
        drops.forEach(function(p){g.moveTo(p.x,p.y);g.lineTo(p.x-p.l*.22,p.y+p.l);p.y+=p.v;p.x-=p.v*.22;if(p.y>H){p.y=-20;p.x=Math.random()*(W+80);}});g.stroke();
        bits.forEach(function(p){g.fillStyle="rgba(98,220,255,"+p.a+")";g.fillRect(Math.round(p.x),Math.round(p.y),p.s,p.s);p.y-=p.v;if(p.y<-8){p.y=H+8;p.x=Math.random()*W;}});
        nextBolt-=dt;if(!bolt&&nextBolt<=0){bolt=makeBolt();nextBolt=4500+Math.random()*5000;}
        var fl=0;
        if(bolt){bolt.age+=dt;var t=bolt.age,al=t<90?1:t<150?.15:t<230?.95:t<420?(1-(t-230)/190)*.6:0;
          if(t>430){bolt=null;}else{
            g.save();g.lineJoin="round";g.shadowColor="#62dcff";g.shadowBlur=22;g.strokeStyle="rgba(235,250,255,"+al+")";
            bolt.paths.forEach(function(p,i){g.lineWidth=i?1.4:3;g.beginPath();p.forEach(function(q,k){k?g.lineTo(q[0],q[1]):g.moveTo(q[0],q[1]);});g.stroke();});
            g.restore();fl=al*.26;}}
        flash.style.opacity=fl;
      }
      requestAnimationFrame(frame);
    }
    size();addEventListener("resize",size);
    if("IntersectionObserver" in window)new IntersectionObserver(function(e){visible=e[0].isIntersecting;}).observe(cv.parentNode);
    requestAnimationFrame(frame);
  })();

  // Navigation wird fest, sobald der Hero verlassen wird
  var nav=document.getElementById("nav");
  function navState(){nav.classList.toggle("solid",window.scrollY>60);}
  window.addEventListener("scroll",navState,{passive:true});navState();

  // Countdown bis 20.11.2026 18:00 (Europe/Berlin = UTC+1)
  var target=Date.parse("2026-11-20T18:00:00+01:00");
  var ids=["c-d","c-h","c-m","c-s"].map(function(id){return document.getElementById(id);});
  function pad(n){return String(n).padStart(2,"0");}
  function tick(){
    var ms=target-Date.now();
    if(ms<=0){document.getElementById("launch-sub").textContent="Radius 2 läuft. Viel Glück an alle Teams.";ids.forEach(function(e){e.textContent="00";});return;}
    var s=Math.floor(ms/1000);
    ids[0].textContent=Math.floor(s/86400);
    ids[1].textContent=pad(Math.floor(s%86400/3600));
    ids[2].textContent=pad(Math.floor(s%3600/60));
    ids[3].textContent=pad(s%60);
    setTimeout(tick,1000);
  }
  tick();
})();
