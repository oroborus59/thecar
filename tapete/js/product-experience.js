(() => {
  'use strict';
  const tabs=[...document.querySelectorAll('.comparisonTabs [role="tab"]')];
  function selectTab(tab,focus=false){
    tabs.forEach(item=>{const selected=item===tab;item.setAttribute('aria-selected',String(selected));item.tabIndex=selected?0:-1;const panel=document.getElementById(item.getAttribute('aria-controls'));if(panel)panel.hidden=!selected;});
    if(focus)tab.focus();
  }
  tabs.forEach((tab,index)=>{
    tab.addEventListener('click',()=>selectTab(tab));
    tab.addEventListener('keydown',event=>{
      let next;
      if(event.key==='ArrowRight')next=(index+1)%tabs.length;
      if(event.key==='ArrowLeft')next=(index-1+tabs.length)%tabs.length;
      if(event.key==='Home')next=0;
      if(event.key==='End')next=tabs.length-1;
      if(next!==undefined){event.preventDefault();selectTab(tabs[next],true);}
    });
  });
  const rail=document.getElementById('reviewRail');
  if(!rail)return;
  const cards=[...rail.querySelectorAll('.customerCard')],previous=document.getElementById('reviewsPrevious'),next=document.getElementById('reviewsNext'),position=document.getElementById('reviewPosition'),fill=document.getElementById('reviewProgressFill');
  if(!cards.length||!previous||!next)return;
  const maxScroll=()=>Math.max(0,rail.scrollWidth-rail.clientWidth);
  const cardStart=card=>card.offsetLeft-cards[0].offsetLeft;
  const behavior=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth';
  function update(){
    const max=maxScroll(),left=rail.scrollLeft,right=left+rail.clientWidth;
    previous.disabled=left<=2;next.disabled=max<=2||left>=max-2;
    if(rail.clientWidth<=0)return;
    const visible=cards.map((card,index)=>({index,left:cardStart(card),width:card.offsetWidth})).filter(card=>card.left+card.width>left+Math.min(60,card.width*.2)&&card.left<right-Math.min(60,card.width*.2));
    if(visible.length&&position){const first=visible[0].index+1,last=visible[visible.length-1].index+1,text=first===last?'Vídeo '+first+' de '+cards.length:'Vídeos '+first+'–'+last+' de '+cards.length;if(position.textContent!==text)position.textContent=text;}
    if(fill)fill.style.width=(rail.scrollWidth>0?Math.min(100,Math.max(0,(left+rail.clientWidth)/rail.scrollWidth*100)):0)+'%';
  }
  function go(left){const target=Math.max(0,Math.min(maxScroll(),left));if(typeof rail.scrollTo==='function')rail.scrollTo({left:target,behavior:behavior()});else{rail.scrollLeft=target;update();}}
  const step=()=>cards.length>1?cardStart(cards[1]):rail.clientWidth;
  previous.addEventListener('click',()=>go(rail.scrollLeft-step()));
  next.addEventListener('click',()=>go(rail.scrollLeft+step()));
  rail.addEventListener('keydown',event=>{
    if(event.target!==rail)return;
    if(event.key==='ArrowRight'){event.preventDefault();go(rail.scrollLeft+step());}
    if(event.key==='ArrowLeft'){event.preventDefault();go(rail.scrollLeft-step());}
    if(event.key==='Home'){event.preventDefault();go(0);}
    if(event.key==='End'){event.preventDefault();go(maxScroll());}
  });
  let frame=false;
  const schedule=()=>{if(frame)return;frame=true;requestAnimationFrame(()=>{frame=false;update();});};
  rail.addEventListener('scroll',schedule,{passive:true});
  window.addEventListener('resize',schedule);
  if('ResizeObserver'in window)new ResizeObserver(schedule).observe(rail);
  let drag=null,suppressClick=false;
  rail.addEventListener('pointerdown',event=>{
    if(event.pointerType!=='mouse'||event.button!==0||event.target.closest('button,a,video,input,select'))return;
    drag={id:event.pointerId,x:event.clientX,left:rail.scrollLeft,moved:false};
  });
  rail.addEventListener('pointermove',event=>{
    if(!drag||drag.id!==event.pointerId)return;
    const distance=event.clientX-drag.x;
    if(!drag.moved&&Math.abs(distance)>6){drag.moved=true;rail.classList.add('is-dragging');rail.setPointerCapture?.(event.pointerId);}
    if(!drag.moved)return;
    event.preventDefault();rail.scrollLeft=Math.max(0,Math.min(maxScroll(),drag.left-distance));schedule();
  });
  function finishDrag(event){if(!drag||event.pointerId!==drag.id)return;if(drag.moved){suppressClick=true;setTimeout(()=>suppressClick=false,0);}drag=null;rail.classList.remove('is-dragging');}
  rail.addEventListener('pointerup',finishDrag);
  rail.addEventListener('pointercancel',finishDrag);
  rail.addEventListener('lostpointercapture',finishDrag);
  window.addEventListener('pointerup',finishDrag);
  rail.addEventListener('click',event=>{if(suppressClick){event.preventDefault();event.stopPropagation();}},{capture:true});
  update();
})();
