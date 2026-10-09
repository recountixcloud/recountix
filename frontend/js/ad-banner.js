(function(){
  // Safe URL validator for external links
  function isSafeExternalUrl(url) {
    try {
      const parsed = new URL(url, window.location.href);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (_) {
      return false;
    }
  }

  function imageCandidates(url){
    if(!url) return [];
    let u = String(url).trim().replace(/\\/g, '/');
    const list = [];

    // External URLs (Google Drive / Dropbox supported as fallback only)
    try {
      const parsed = new URL(u);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        if (parsed.hostname.includes('drive.google.com')) {
          const m = parsed.pathname.match(/\/file\/d\/([^/]+)/);
          const id = m && m[1] ? m[1] : parsed.searchParams.get('id');
          if (id) list.push(`https://drive.google.com/uc?export=view&id=${encodeURIComponent(id)}`);
        } else if (parsed.hostname.includes('dropbox.com')) {
          parsed.searchParams.set('raw', '1');
          parsed.searchParams.delete('dl');
          list.push(parsed.toString());
        }
        list.push(u);
        return [...new Set(list)];
      }
    } catch (_) {}

    // Local project paths
    u = u.replace(/^\.\//, '');
    const noLeading = u.replace(/^\//, '');
    const withoutFrontend = noLeading.replace(/^frontend\//i, '');

    list.push(new URL(withoutFrontend, document.baseURI).href);

    if (/^assets\//i.test(withoutFrontend)) {
      list.push(new URL('../' + withoutFrontend, document.baseURI).href);
    }

    if (/^frontend\//i.test(noLeading)) {
      list.push(new URL('../' + noLeading, document.baseURI).href);
    }

    // Only allow http: or https:
    return [...new Set(list)].filter(isSafeExternalUrl);
  }

  function loadWithFallback(img, candidates, onSuccess, onFailure){
    let i = 0;
    const tryNext = () => {
      if (i >= candidates.length) {
        onFailure();
        return;
      }
      const src = candidates[i++];
      img.onload = () => onSuccess(src);
      img.onerror = tryNext;
      img.src = src;
    };
    tryNext();
  }

  document.addEventListener('DOMContentLoaded', async () => {
    const slot = document.getElementById('recountixAdSlot');
    if (!slot || typeof sbGetActiveAds !== 'function') return;

    try {
      const ads = await sbGetActiveAds(currentShopId());
      if (!ads.length) return;
      const ad = ads[Math.floor(Math.random() * ads.length)];

      // Validate link_url to prevent javascript: XSS
      const hasSafeLink = ad.link_url && isSafeExternalUrl(ad.link_url);
      const card = document.createElement(hasSafeLink ? 'a' : 'div');
      card.className = 'rx-ad-card';

      if (hasSafeLink) {
        card.href = ad.link_url;
        card.target = '_blank';
        card.rel = 'noopener sponsored';
        card.addEventListener('click', () => sbTrackAdClick(ad.id));
      }

      const copy = document.createElement('div');
      copy.className = 'rx-ad-copy';

      const label = document.createElement('span');
      label.className = 'rx-ad-label';
      label.textContent = 'Sponsored';

      const title = document.createElement('div');
      title.className = 'rx-ad-title';
      title.textContent = ad.title || '';

      const text = document.createElement('p');
      text.className = 'rx-ad-text';
      text.textContent = ad.description || '';

      copy.append(label, title, text);
      card.append(copy);

      if (ad.image_url) {
        const media = document.createElement('div');
        media.className = 'rx-ad-media';

        const img = document.createElement('img');
        img.className = 'rx-ad-image';
        img.alt = ad.title || 'Sponsored campaign';
        img.decoding = 'async';
        img.loading = 'eager';

        const sponsored = document.createElement('span');
        sponsored.className = 'rx-ad-overlay-label';
        sponsored.textContent = 'Sponsored';

        media.append(img, sponsored);
        card.append(media);

        const candidates = imageCandidates(ad.image_url);
        const localFallback = new URL('assets/ads/recovery-banner.png', document.baseURI).href;
        if (!candidates.includes(localFallback)) candidates.push(localFallback);

        loadWithFallback(
          img,
          candidates,
          (loadedSrc) => {
            card.classList.add('has-image', 'image-ready');
            console.info('Ad image loaded:', loadedSrc);
          },
          () => {
            card.classList.remove('image-ready');
            media.remove();
            console.warn('Ad image failed to load. Tried:', candidates);
          }
        );
      }

      if (hasSafeLink) {
        const cta = document.createElement('span');
        cta.className = 'rx-ad-cta';
        cta.textContent = ad.cta_text || 'Learn More';
        card.append(cta);
      }

      slot.append(card);
      slot.hidden = false;
    } catch (e) {
      console.warn('Ad banner', e);
    }
  });
})();
