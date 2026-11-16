(() => {
  'use strict';
  function initPresentations(reviewsPlaying) {
    const items = [...document.querySelectorAll('video')].filter(v => !v.parentElement.classList.contains('reviewVideo')).map(video => {
      const box = video.parentElement;
      box.classList.add('tapeteMedia', 'tapetePresentation');
      video.muted = true; video.defaultMuted = true; video.loop = true;
      video.autoplay = true; video.playsInline = true; video.controls = false;
      video.setAttribute('muted', ''); video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'tapeteMedia__play';
      button.textContent = '▶'; button.hidden = true;
      button.setAttribute('aria-label', 'Reproduzir apresentação');
      box.appendChild(button);
      const r = {video, box, button, visible:false, loaded:false, pending:false, blocked:false};
      function load() {
        if (r.loaded) return;
        r.loaded = true; video.preload = 'auto';
        if (video.dataset.src) video.src = video.dataset.src;
      }
      function play(manual=false) {
        if ((!r.visible && !manual) || document.hidden || reviewsPlaying() || r.pending || (!video.paused && !video.ended) || (r.blocked && !manual)) return;
        load(); r.pending = true; video.muted = true;
        if(manual && video.error)video.load();
        try {
          Promise.resolve(video.play()).then(() => {r.pending=false; r.blocked=false; button.hidden=true;}).catch(() => {
            r.pending=false;
            if (!r.visible || document.hidden || reviewsPlaying()) return;
            r.blocked=true; button.hidden=false;
          });
        } catch {r.pending=false; r.blocked=true; button.hidden=false;}
      }
      r.load=load; r.play=play;
      button.addEventListener('click', e => {e.preventDefault();play(true);});
      video.addEventListener('playing', () => {
        if (!r.visible || document.hidden || reviewsPlaying()) {video.pause();return;}
        box.classList.add('is-playing'); button.hidden=true;
      });
      video.addEventListener('pause', () => box.classList.remove('is-playing'));
      video.addEventListener('error', () => {r.pending=false;r.blocked=true;button.hidden=false;});
      return r;
    });
    const resume = () => items.forEach(r => r.play());
    const pause = () => items.forEach(r => {if(!r.video.paused)r.video.pause();});
    if ('IntersectionObserver' in window) {
      const preload = new IntersectionObserver(entries => entries.forEach(e => {
        if(e.isIntersecting){items.find(r=>r.video===e.target).load();preload.unobserve(e.target);}
      }), {rootMargin:'200px 0px'});
      const visible = new IntersectionObserver(entries => entries.forEach(e => {
        const r=items.find(r=>r.video===e.target);r.visible=e.isIntersecting&&e.intersectionRatio>=0.15;
        if(r.visible)r.play();else if(!r.video.paused)r.video.pause();
      }), {threshold:[0,0.15]});
      items.forEach(r=>{preload.observe(r.video);visible.observe(r.video);});
    } else {
      let scheduled=false;
      const update=()=>{scheduled=false;items.forEach(r=>{const b=r.video.getBoundingClientRect();r.visible=b.bottom>0&&b.top<innerHeight&&b.right>0&&b.left<innerWidth;if(r.visible)r.play();else if(!r.video.paused)r.video.pause();});};
      const schedule=()=>{if(!scheduled){scheduled=true;requestAnimationFrame(update);}};
      addEventListener('scroll',schedule,{passive:true});addEventListener('resize',schedule);update();
    }
    document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();else resume();});
    return {pause,resume};
  }
  function init() {
    const videos = [...document.querySelectorAll('.reviewVideo video')];
    function loadPoster(video) {
      if (!video.dataset.poster) return;
      video.poster = video.dataset.poster;
      delete video.dataset.poster;
    }
    if ('IntersectionObserver' in window) {
      const posters = new IntersectionObserver(entries => entries.forEach(entry => {
        if (entry.isIntersecting) { loadPoster(entry.target); posters.unobserve(entry.target); }
      }), {rootMargin:'360px 0px'});
      videos.forEach(video => posters.observe(video));
    } else videos.forEach(loadPoster);
    let active = null, sequence = 0;
    const records = videos.map(video => {
      const box = video.parentElement;
      box.classList.add('tapeteMedia');
      const review = box.classList.contains('reviewVideo');
      video.autoplay = false;
      video.preload = 'none';
      video.playsInline = true;
      video.controls = false;
      video.removeAttribute('controls');
      video.setAttribute('controlslist', 'nodownload nofullscreen noremoteplayback');
      video.disablePictureInPicture = true;
      video.disableRemotePlayback = true;
      video.muted = !review;
      video.setAttribute('webkit-playsinline', '');
      let button = box.querySelector('.reviewVideo__play');
      if (!button) {
        button = document.createElement('button');
        button.type = 'button';
        button.className = 'tapeteMedia__play';
        button.textContent = '▶';
        button.setAttribute('aria-label', 'Reproduzir vídeo: ' + (video.getAttribute('aria-label') || 'produto'));
        box.appendChild(button);
      }
      const status = document.createElement('span');
      status.className = 'tapeteMedia__status';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      status.hidden = true;
      box.appendChild(status);
      return { video, box, button, status, sound: box.querySelector('.reviewVideo__sound'), pending: 0 };
    });
    const presentations = initPresentations(() => records.some(r => !r.video.paused || r.pending));
    function syncSound(r) {
      if (!r.sound) return;
      r.sound.textContent = r.video.muted ? '🔇' : '🔊';
      r.sound.setAttribute('aria-label', r.video.muted ? 'Ativar áudio' : 'Silenciar vídeo');
    }
    function stopOthers(r) {
      records.forEach(other => {
        if (other === r) return;
        other.pending = 0;
        if (!other.video.paused) other.video.pause();
        other.box.classList.remove('is-playing', 'is-loading');
        other.status.hidden = true;
      });
    }
    function failed(r) {
      r.pending = 0;
      r.box.classList.remove('is-playing', 'is-loading');
      r.box.dataset.mediaState = 'error';
      r.status.textContent = 'Não foi possível carregar. Toque em play para tentar novamente.';
      r.status.hidden = false;
      presentations.resume();
    }
    function requestPlay(r) {
      loadPoster(r.video);
      const ticket = ++sequence;
      active = r;
      stopOthers(r);
      presentations.pause();
      r.pending = ticket;
      r.box.classList.add('is-loading');
      r.status.textContent = 'Carregando vídeo…';
      r.status.hidden = false;
      if (r.video.error) r.video.load();
      let attempt;
      try { attempt = r.video.play(); } catch { failed(r); return; }
      Promise.resolve(attempt).catch(error => {
        if (ticket !== sequence || active !== r) return;
        if (error?.name === 'AbortError' && r.video.paused) {
          r.pending = 0;
          r.box.classList.remove('is-loading');
          r.status.hidden = true;
          return;
        }
        // Muted playback can still succeed if the in-app browser refuses audio.
        if (error?.name === 'NotAllowedError' && !r.video.muted) {
          r.video.muted = true;
          syncSound(r);
          try { Promise.resolve(r.video.play()).catch(() => { if (ticket === sequence && active === r) failed(r); }); }
          catch { failed(r); }
        } else failed(r);
      });
    }
    records.forEach(r => {
      r.box.dataset.mediaState = 'poster';
      syncSound(r);
      r.button.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        if (r.pending) return;
        if (!r.video.paused && !r.video.ended) r.video.pause();
        else requestPlay(r);
      });
      r.sound?.addEventListener('click', event => {
        event.stopPropagation();
        r.video.muted = !r.video.muted;
        syncSound(r);
      });
      // With native controls removed, tapping the video pauses playback.
      r.video.addEventListener('click', () => {
        if (r.pending) return;
        if (!r.video.paused && !r.video.ended) {
          if (r.video.muted) r.video.muted = false;
          else r.video.pause();
        } else requestPlay(r);
      });
      r.video.addEventListener('volumechange', () => syncSound(r));
      r.video.addEventListener('play', () => {
        presentations.pause();
        if (r.video.paused) return;
        if (r.pending && r.pending !== sequence) { r.video.pause(); return; }
        if (active !== r) { sequence++; active = r; stopOthers(r); }
      });
      r.video.addEventListener('playing', () => {
        if (active !== r) { r.video.pause(); return; }
        r.pending = 0;
        r.box.classList.add('is-playing');
        r.box.classList.remove('is-loading');
        r.box.dataset.mediaState = 'playing';
        r.button.setAttribute('aria-label', 'Pausar vídeo');
        r.status.hidden = true;
      });
      ['waiting', 'stalled'].forEach(name => r.video.addEventListener(name, () => {
        if (active !== r || r.video.paused) return;
        r.box.classList.add('is-loading');
        r.box.dataset.mediaState = 'buffering';
        r.status.textContent = 'Carregando vídeo…';
        r.status.hidden = false;
        // Do not pause, reload or seek while buffering; native playback resumes.
      }));
      ['pause', 'ended'].forEach(name => r.video.addEventListener(name, () => {
        r.pending = 0;
        r.box.classList.remove('is-playing', 'is-loading');
        r.box.dataset.mediaState = 'paused';
        r.button.setAttribute('aria-label', 'Reproduzir vídeo');
        r.status.hidden = true;
        presentations.resume();
      }));
      r.video.addEventListener('error', () => failed(r));
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) return;
      sequence++;
      active = null;
      stopOthers(null);
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once:true});
  else init();
})();
