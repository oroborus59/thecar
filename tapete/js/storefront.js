(() => {
 'use strict';
 const base=new URL('../',document.currentScript?.src||new URL('js/storefront.js',location.href));
 const $=id=>document.getElementById(id),form=$('productForm');if(!form)return;
 const catalog=window.UltracarVehicles||{carro:{},picape:{}},vehicleModels=window.UltracarVehicleModels||{},tracking=window.TapetesTracking;
 const prices={sem:9790,com:12790};
 let attempted=false,models=[],customModel='',modelRevision=0,vehiclePromise=Promise.resolve(),searchPromise,searchSequence=0,searchTimer;
 const money=n=>(n/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
 const selected=name=>form.querySelector('input[name="'+name+'"]:checked')?.value||'';
 const vehicleType=()=>selected('tipo')==='picape'?'picape':'carro';
 function modelsForStyle(brand,style=selected('tipo')){if(style==='carro'||style==='picape')return vehicleModels[style]?.[brand]||[];return (window.UltracarVehicleStyles?.[style]?.[brand]||[]).map(i=>vehicleModels.carro?.[brand]?.[i]).filter(Boolean);}
 function brandsForStyle(){const style=selected('tipo');return style==='carro'||style==='picape'?catalog[style]||{}:window.UltracarVehicleStyles?.[style]||{};}
 const norm=s=>String(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
 const modelMatch=()=>models.includes($('carModel').value)?$('carModel').value:'';
 const selectedModel=()=>modelMatch()||($('carModel').value==='__custom__'?customModel:'');
 function readState(){return {kit:selected('kit'),tipo:vehicleType(),marca:$('carBrand').value,modelo:selectedModel(),ano:$('carYear').value,cor:selected('cor'),textura:'A'};}
 function clearModel(){models=[];customModel='';$('carModel').replaceChildren(new Option('Selecione a marca primeiro',''));$('carModel').disabled=true;$('carYear').value='';$('carYear').disabled=true;}
 function populateBrands(){modelRevision++;$('carBrand').replaceChildren(new Option('Selecione a marca',''));Object.keys(brandsForStyle()).sort((a,b)=>a.localeCompare(b,'pt-BR')).forEach(brand=>$('carBrand').add(new Option(brand,brand)));clearModel();}
 function populateYears(reset=true){if(reset)$('carYear').value='';$('carYear').disabled=!selectedModel();}
 function populateModelOptions(){const select=$('carModel');select.replaceChildren(new Option('Selecione o modelo',''));models.forEach(model=>select.add(new Option(model,model)));select.add(new Option('Não encontrei meu modelo','__other__'));select.disabled=false;}
 function populateModels(){
  const brand=$('carBrand').value,type=selected('tipo');modelRevision++;clearModel();if(!brand)return;
  const list=modelsForStyle(brand);models=Array.isArray(list)?list.slice().sort((a,b)=>a.localeCompare(b,'pt-BR')):[];
  populateModelOptions();populateYears(false);vehiclePromise=Promise.resolve();
  render();
 }
 function missingFields(){
  const s=readState(),year=Number(s.ano),type=selected('tipo');
  return [
   !['sem','com'].includes(s.kit)&&['configurador','kitError','Selecione o seu kit.'],
   !['carro','picape','suv','sedan','hatch','esportivo','conversivel'].includes(type)&&['vehicleTypeField','typeError','Selecione o tipo do seu veículo.'],
   !s.marca&&['carBrand','brandError','Selecione a marca.'],
   !selectedModel()&&['carModel','modelError','Selecione um modelo da lista ou use a pesquisa abaixo.'],
   (!/^\d{4}$/.test(s.ano)||year<1970||year>2027)&&['carYear','yearError','Selecione o ano do seu veículo.'],
   !['Preto','Cinza'].includes(s.cor)&&['carColorField','colorError','Selecione a cor dos tapetes.']
  ].filter(Boolean);
 }
 function buildCheckoutUrl(){const s=readState();if(missingFields().length)return null;const u=new URL('pagamento.html',base);Object.entries({kit:s.kit,tipo:s.tipo,marca:s.marca,modelo:s.modelo,ano:s.ano,cor:s.cor}).forEach(([k,v])=>u.searchParams.set(k,v));return u.href;}
 function renderErrors(){
  ['kitError','typeError','brandError','modelError','yearError','colorError'].forEach(id=>$(id).textContent='');
  ['configurador','vehicleTypeField','carBrand','carModel','carYear','carColorField'].forEach(id=>$(id).removeAttribute('aria-invalid'));
  if(!attempted){$('formMessage').hidden=true;$('formMessage').textContent='';return;}
  const missing=missingFields();missing.forEach(([field,error,message])=>{$(error).textContent=message;$(field).setAttribute('aria-invalid','true');});
  $('formMessage').hidden=!missing.length;$('formMessage').textContent=missing.length?'Complete as opções destacadas para continuar.':'';
 }
 function render(){
  const s=readState(),price=prices[s.kit]||prices.sem;
  $('heroPrice').textContent=money(price);$('heroInstallment').textContent='Pagamento via Pix';$('heroPixCopy').textContent='';$('heroCardPrice').textContent='Valor total do kit.';
  $('purchaseTotal').textContent=money(price);
  document.querySelectorAll('[data-kit-price]').forEach(el=>el.textContent=money(prices[el.dataset.kitPrice]));
  $('selectedColorLabel').textContent=s.cor;
  const found=Boolean(s.marca&&modelMatch()),manual=Boolean(s.marca&&!found&&selectedModel());$('vehicleFound').hidden=!(found||manual);$('vehicleFound').classList.toggle('is-manual',manual);$('vehicleFoundText').textContent=found?s.marca+' '+s.modelo+' encontrado no catálogo.':manual?'Modelo informado por você: '+s.marca+' '+s.modelo+'.':'';
  const href=buildCheckoutUrl();$('goToPayment').href=href||'#configurador';$('orderReview').hidden=!href;$('selectionSummary').textContent=href?(s.kit==='com'?'Kit com porta-malas':'Kit interno')+' · '+s.marca+' '+s.modelo+' · '+s.ano+' · '+s.cor:'';
  $('goToPayment').setAttribute('aria-disabled',String(!href));$('goToPayment').classList.remove('utmify-ic-checkout');
  renderErrors();
 }
 function searchIndex(){if(!searchPromise){const rows=[];Object.entries(vehicleModels).forEach(([type,brands])=>Object.entries(brands).forEach(([brand,names])=>names.forEach(model=>rows.push([type,brand,model]))));searchPromise=Promise.resolve(rows);}return searchPromise;}
 async function searchVehicles(query){
  const tokens=norm(query).split(' ').filter(Boolean);if(norm(query).length<2)return [];
  const type=vehicleType(),rows=await searchIndex();
  return rows.filter(row=>row[0]===type&&tokens.every(token=>norm(row[1]+' '+row[2]).includes(token))).sort((a,b)=>a[2].length-b[2].length||a[2].localeCompare(b[2],'pt-BR')).slice(0,10);
 }
 async function chooseSearchResult(row){
  let style=row[0];if(row[0]==='carro'){style=modelsForStyle(row[1]).includes(row[2])&&vehicleType()==='carro'?selected('tipo'):['suv','sedan','hatch','esportivo','conversivel'].find(t=>modelsForStyle(row[1],t).includes(row[2]))||'carro';}
  const radio=form.querySelector('input[name=tipo][value="'+style+'"]');radio.checked=true;populateBrands();$('carBrand').value=row[1];populateModels();const revision=modelRevision;await vehiclePromise;
  if(revision!==modelRevision||$('carBrand').value!==row[1]||vehicleType()!==row[0])return;
  if(!models.includes(row[2])){models.push(row[2]);$('carModel').add(new Option(row[2],row[2]));}$('carModel').value=row[2];populateYears();render();setSearchOpen(false);$('carYear').focus();
 }
 function setSearchOpen(open){$('vehicleSearchPanel').hidden=!open;$('vehicleSearchToggle').setAttribute('aria-expanded',String(open));if(open)$('vehicleSearchInput').focus();}
 function clearSearch(){clearTimeout(searchTimer);searchSequence++;$('vehicleSearchInput').value='';$('vehicleSearchResults').replaceChildren();$('vehicleSearchStatus').textContent='';setSearchOpen(false);}
 function offerManualModel(query){
  const brand=$('carBrand').value,type=selected('tipo'),model=String(query).trim().replace(/\s+/g,' ');
  if(!brand){$('vehicleSearchStatus').textContent+=' Selecione a marca para informar um modelo que não está na lista.';return;}
  if(model.length<2||model.length>120||/[<>\u0000-\u001f\u007f]/.test(model))return;
  const button=document.createElement('button');button.type='button';button.className='vehicleSearchResult vehicleSearchResult--manual';const title=document.createElement('strong'),hint=document.createElement('span');title.textContent='Usar “'+model+'” para '+brand;hint.textContent='Modelo informado por você';button.append(title,hint);
  button.addEventListener('click',async()=>{const revision=modelRevision;await vehiclePromise;if(revision!==modelRevision||$('carBrand').value!==brand||selected('tipo')!==type)return;customModel=model;[...$('carModel').options].filter(o=>o.value==='__custom__').forEach(o=>o.remove());$('carModel').add(new Option(model+' (informado)','__custom__'));$('carModel').disabled=false;$('carModel').value='__custom__';populateYears();render();setSearchOpen(false);$('carYear').focus();});$('vehicleSearchResults').append(button);
 }
 async function showSearchResults(){
  const sequence=++searchSequence,query=$('vehicleSearchInput').value;$('vehicleSearchResults').replaceChildren();
  if(norm(query).length<2){$('vehicleSearchStatus').textContent='Digite pelo menos duas letras para consultar.';return;}
  $('vehicleSearchStatus').textContent='Consultando o catálogo…';
  try{
   const results=await searchVehicles(query);if(sequence!==searchSequence)return;
   $('vehicleSearchStatus').textContent=results.length?'Veículo encontrado no catálogo. Selecione a opção correspondente abaixo.':'Não encontramos esse veículo. Tente a marca e o modelo, sem o ano.';
   for(const row of results){const button=document.createElement('button');button.type='button';button.className='vehicleSearchResult';const title=document.createElement('strong'),hint=document.createElement('span');title.textContent=row[1]+' '+row[2];hint.textContent='Usar este veículo';button.append(title,hint);button.addEventListener('click',()=>void chooseSearchResult(row));$('vehicleSearchResults').append(button);}
   if(!results.length)offerManualModel(query);
  }catch{if(sequence===searchSequence){$('vehicleSearchStatus').textContent='Não foi possível consultar agora. Toque em Buscar para tentar novamente ou informe o modelo.';offerManualModel(query);}}
 }
 $('vehicleSearchToggle').addEventListener('click',()=>setSearchOpen($('vehicleSearchPanel').hidden));
 $('vehicleSearchButton').addEventListener('click',()=>void showSearchResults());
 $('vehicleSearchInput').addEventListener('input',()=>{clearTimeout(searchTimer);searchSequence++;searchTimer=setTimeout(()=>void showSearchResults(),200);});
 $('vehicleSearchInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();clearTimeout(searchTimer);void showSearchResults();}});
 form.addEventListener('change',e=>{const input=e.target;if(input.name==='tipo'){clearSearch();populateBrands();}if(input.id==='carBrand'){clearSearch();populateModels();}if(input.id==='carModel'){populateYears();if(input.value==='__other__')setSearchOpen(true);else setSearchOpen(false);}render();
  if(input.name==='cor'){const gray={sem:'checkout/img/kit-cinza-sem',com:'checkout/img/kit-cinza-com'},black={sem:'images/kits/kit-interno',com:'images/kits/kit-completo'};document.querySelectorAll('[data-kit-image]').forEach(img=>{const kit=img.dataset.kitImage,base=selected('cor')==='Cinza'?gray[kit]:black[kit];img.srcset=base+'-160.webp 160w, '+base+'-320.webp 320w'+(selected('cor')==='Cinza'?'':', '+base+'.webp 480w');img.sizes='140px';img.src=base+'-320.webp';});}
 });
 form.addEventListener('input',e=>{if(e.target.id==='carYear')render();});
 function requestCheckout(e){const href=buildCheckoutUrl();if(href){$('goToPayment').href=href;return true;}e.preventDefault();attempted=true;render();const first=missingFields()[0];if(first){$(first[0]).scrollIntoView({block:'center',behavior:matchMedia('(prefers-reduced-motion:reduce)').matches?'auto':'smooth'});$(first[0]).focus({preventScroll:true});}return false;}
 $('goToPayment').addEventListener('click',requestCheckout);form.addEventListener('submit',e=>{e.preventDefault();if(requestCheckout(e))$('goToPayment').click();});
 const thumbs=[...document.querySelectorAll('.galleryThumb')],gallery=$('galleryViewport'),slides=gallery?[...gallery.querySelectorAll('.gallerySlide')]:[],galleryPrevious=$('galleryPrevious'),galleryNext=$('galleryNext');
 if(gallery&&slides.length){
  let galleryIndex=0,galleryFramePending=false,galleryResizePending=false;
  const slideLeft=index=>slides[index].offsetLeft-slides[0].offsetLeft;
  const galleryBehavior=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth';
  function loadGalleryImage(index){
   const slide=slides[index],img=slide?.querySelector('img');if(!img?.dataset.src)return;
   slide.querySelectorAll('source[data-srcset]').forEach(source=>{source.srcset=source.dataset.srcset;delete source.dataset.srcset;});
   if(img.dataset.srcset){img.srcset=img.dataset.srcset;delete img.dataset.srcset;}
   img.src=img.dataset.src;delete img.dataset.src;img.loading='eager';
  }
  function markGallery(index){
   const nextIndex=Math.max(0,Math.min(slides.length-1,index)),changed=galleryIndex!==nextIndex;
   const activeThumb=thumbs[nextIndex],thumbRail=activeThumb?.parentElement;
   let delta=0;
   if(changed&&activeThumb&&thumbRail){const r=activeThumb.getBoundingClientRect(),rail=thumbRail.getBoundingClientRect();delta=r.left<rail.left?r.left-rail.left:r.right>rail.right?r.right-rail.right:0;}
   galleryIndex=nextIndex;loadGalleryImage(galleryIndex);
   const count=(galleryIndex+1)+' / '+slides.length;
   if($('galleryCount').textContent!==count)$('galleryCount').textContent=count;
   thumbs.forEach((item,i)=>{item.classList.toggle('is-selected',i===galleryIndex);item.setAttribute('aria-pressed',String(i===galleryIndex));});
   if(thumbRail&&Math.abs(delta)>1){if(typeof thumbRail.scrollBy==='function')thumbRail.scrollBy({left:delta,behavior:galleryBehavior()});else thumbRail.scrollLeft+=delta;}
   if(galleryPrevious)galleryPrevious.disabled=galleryIndex===0;
   if(galleryNext)galleryNext.disabled=galleryIndex===slides.length-1;
  }
  function moveGallery(index,behavior=galleryBehavior()){
   const target=Math.max(0,Math.min(slides.length-1,index)),left=slideLeft(target);markGallery(target);
   if(typeof gallery.scrollTo==='function')gallery.scrollTo({left,behavior});else gallery.scrollLeft=left;
  }
  function syncGallery(){
   const width=gallery.clientWidth;if(width<=0)return;
   markGallery(Math.round(gallery.scrollLeft/width));
  }
  if('IntersectionObserver'in window){const observer=new IntersectionObserver(entries=>{entries.forEach(entry=>{if(entry.isIntersecting&&entry.intersectionRatio>.005){loadGalleryImage(slides.indexOf(entry.target));observer.unobserve(entry.target);}});},{root:gallery,threshold:[0,.01]});slides.slice(1).forEach(slide=>observer.observe(slide));}
  else slides.forEach((slide,index)=>loadGalleryImage(index));
  gallery.addEventListener('pointerdown',()=>{loadGalleryImage(galleryIndex-1);loadGalleryImage(galleryIndex+1);},{passive:true});
  thumbs.forEach((button,index)=>{
   button.addEventListener('click',()=>moveGallery(index));
   button.addEventListener('keydown',event=>{let next;if(event.key==='ArrowRight')next=(index+1)%thumbs.length;if(event.key==='ArrowLeft')next=(index-1+thumbs.length)%thumbs.length;if(event.key==='Home')next=0;if(event.key==='End')next=thumbs.length-1;if(next!==undefined){event.preventDefault();moveGallery(next);thumbs[next].focus();}});
  });
  galleryPrevious?.addEventListener('click',()=>moveGallery(galleryIndex-1));
  galleryNext?.addEventListener('click',()=>moveGallery(galleryIndex+1));
  gallery.addEventListener('scroll',()=>{if(galleryFramePending)return;galleryFramePending=true;requestAnimationFrame(()=>{galleryFramePending=false;syncGallery();});},{passive:true});
  gallery.addEventListener('keydown',event=>{if(event.target!==gallery)return;let next;if(event.key==='ArrowRight')next=galleryIndex+1;if(event.key==='ArrowLeft')next=galleryIndex-1;if(event.key==='Home')next=0;if(event.key==='End')next=slides.length-1;if(next!==undefined){event.preventDefault();moveGallery(next);}});
  function alignGallery(){if(galleryResizePending)return;galleryResizePending=true;requestAnimationFrame(()=>{galleryResizePending=false;moveGallery(galleryIndex,'auto');});}
  if('ResizeObserver'in window)new ResizeObserver(alignGallery).observe(gallery);else window.addEventListener('resize',alignGallery,{passive:true});
  markGallery(0);
 }
 function openDisclosure(){const target=document.getElementById(location.hash.slice(1));if(target?.tagName==='DETAILS')target.open=true;}addEventListener('hashchange',openDisclosure);openDisclosure();$('copyrightYear').textContent=new Date().getFullYear();populateBrands();render();
 if(tracking)tracking.cartFromLP=()=>{const s=readState();return {version:1,kit:s.kit,quantity:1,vehicle:{brand:s.marca,model:s.modelo,year:s.ano,color:s.cor,texture:'A',line:'1'}};};
 const ready=Promise.resolve(true);
 window.UltracarStorefront={getState:readState,buildCheckoutUrl,ready,whenVehiclesReady:()=>vehiclePromise,searchVehicles};
})();
