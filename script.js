/*
Robust error-definition loader & renderer:
- Fetches /errors.txt and attempts JSON.parse first.
- If JSON.parse fails (file may have minor syntax issues), uses a tolerant regex extractor to pull each "code": { ... } block and parse string properties (title/message/buttonText/buttonUrl).
- Uses the explicit errcode from the URL query (errcode=123) when provided; if that code isn't present in the definitions, shows "Unknown error!" (no silent fallback to code 200).
- Renders legacy verstyle=1.0 boxed overlay or modern fullscreen otherwise.
- Ensures external links open safely (target=_blank rel=noopener noreferrer).
*/

(async () => {
  const overlay = document.getElementById('listErrorOverlay');
  if (!overlay) return;

  const params = new URLSearchParams(location.search);
  const verstyle = params.get('verstyle');
  // Read errcode from the query string (e.g. ?verstyle=1.0&errcode=422)
  const errcodeParam = params.get('errcode');

  // Fetch and parse /errors.txt with tolerant fallback parsing
  async function fetchDefs() {
    try {
      const res = await fetch('errors.txt', { cache: 'no-store' });
      if (!res.ok) throw new Error('failed to load defs');
      let txt = await res.text();

      // Quick repairs for common "almost-JSON" issues in errors.txt:
      // 1) Insert missing commas between adjacent top-level objects: "}{", "}\n \"KEY\"" -> "},\n \"KEY\""
      // 2) Remove trailing commas before a closing object: ",\n}" -> "\n}"
      // 3) Remove final trailing comma before EOF if present
      try {
        // add a comma between "}" and the next top-level key if missing
        txt = txt.replace(/}\s*"\s*([^"]+)"/g, '},\n"$1"');
        // remove trailing commas before a closing brace
        txt = txt.replace(/,\s*}/g, '}');
        // ensure the top-level object has proper commas (attempt to safely wrap content)
        // remove any stray dangling commas at end of file before final }
        txt = txt.replace(/,\s*([\]\}]\s*)$/gm, '$1');
      } catch (e) {
        // if repair fails, we'll fall back to tolerant extractor below
      }

      // Try strict JSON first after repairs
      try {
        const parsed = JSON.parse(txt);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch (e) {
        // fall through to tolerant parser
      }

      // Tolerant extractor: find top-level "KEY": { ... } pairs even if still imperfect.
      // This will extract common string properties: title, message, buttonText, buttonUrl
      const defs = {};
      // Use a regex to find occurrences of "KEY": { ... } at top-level
      const pairRe = /"([^"]+)"\s*:\s*\{([\s\S]*?)\}(?=\s*,|\s*$)/g;
      let m;
      while ((m = pairRe.exec(txt)) !== null) {
        const key = m[1];
        const body = m[2];

        const pickString = (prop) => {
          const re = new RegExp(`"${prop}"\\s*:\\s*("([\\s\\S]*?)")`, 'i');
          const mm = body.match(re);
          if (mm && mm[2] !== undefined) {
            // Unescape simple escapes (only basic ones)
            return mm[2].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
          }
          return undefined;
        };

        const obj = {};
        obj.code = pickString('code') || key;
        const title = pickString('title');
        if (title !== undefined) obj.title = title;
        const message = pickString('message');
        if (message !== undefined) obj.message = message;
        const btext = pickString('buttonText') || pickString('actionText');
        if (btext !== undefined) obj.buttonText = btext;
        const burl = pickString('buttonUrl') || pickString('actionUrl');
        if (burl !== undefined) obj.buttonUrl = burl;

        defs[obj.code] = obj;
      }

      return defs;
    } catch (e) {
      // couldn't fetch or parse -> return empty defs
      return {};
    }
  }

  const defs = await fetchDefs();

  // Use explicit errcode from hash if provided; otherwise treat as null (no auto-fallback)
  const code = (errcodeParam !== null && errcodeParam !== '') ? errcodeParam : null;
  const def = (code && defs && Object.prototype.hasOwnProperty.call(defs, code)) ? defs[code] : null;

  const data = def ? {
    title: def.title || 'Failed to load VM',
    message: (def.message !== undefined && def.message !== null && String(def.message).trim() !== '') ? def.message : 'Unknown error!',
    buttonText: def.buttonText || def.actionText || null,
    buttonUrl: def.buttonUrl || def.actionUrl || null
  } : {
    title: 'Unknown error',
    message: 'Unknown error!',
    buttonText: null,
    buttonUrl: null
  };

  // Render
  if (verstyle === '1.0') {
    overlay.style.position = 'fixed';
    overlay.style.top = '0';
    overlay.style.right = '16px';
    overlay.style.zIndex = '2600';
    overlay.style.maxWidth = '360px';
    overlay.style.pointerEvents = 'none';
    overlay.style.display = 'block';

    const hasButton = data.buttonUrl && data.buttonUrl !== '#';
    const actionHtml = hasButton
      ? `<a id="actionBtn" class="btn" href="${escapeAttr(data.buttonUrl)}">${escapeHtml(data.buttonText || 'Open')}</a>`
      : '';

    overlay.innerHTML = `
      <div class="errorBox" style="pointer-events:auto;">
        <div class="errorContent">
          <h2>${escapeHtml(data.title)}</h2>
          <p class="code">Error code: <strong>${escapeHtml(code)}</strong></p>
          <div class="messageRow">
            <div class="whoops">${escapeHtml(data.message)}</div>
            ${actionHtml}
          </div>
          <p class="discord">Try again later or <a href="https://discord.gg/hBwz45hq4z">join our Discord</a></p>
        </div>
      </div>
    `;
    if (hasButton) setAnchorSafety(overlay.querySelector('#actionBtn'));
    // Make the Discord link safe for opening new tabs
  setAnchorSafety(overlay.querySelector('a[href="https://discord.gg/hBwz45hq4z"]'));
  } else {
    overlay.style.position = 'fixed';
    overlay.style.inset = '0';
    overlay.style.zIndex = '999999';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.pointerEvents = 'auto';
    overlay.style.background = '#000';
    overlay.style.color = '#ff3b3b';
    overlay.style.fontFamily = 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial';
    overlay.style.padding = '20px';
    overlay.style.boxSizing = 'border-box';

    const hasButton2 = data.buttonUrl && data.buttonUrl !== '#';
    const actionHtml2 = hasButton2
      ? `<a id="actionBtn" href="${escapeAttr(data.buttonUrl)}" style="background:transparent;border:1px solid #ff3b3b;color:#ff3b3b;padding:10px 14px;border-radius:8px;text-decoration:none;">${escapeHtml(data.buttonText || 'Open')}</a>`
      : '';

    overlay.innerHTML = `
      <div style="max-width:900px; width:100%; text-align:center; padding:28px;">
        <h1 style="margin:0 0 12px;font-size:22px;color:#ff3b3b;">${escapeHtml(data.title)}</h1>
        <p style="margin:0 0 18px;font-size:16px;color:#ff6b6b;">${escapeHtml(data.message)}</p>
        <p style="margin:0 0 18px;font-size:14px;color:#ff6b6b;">Error code: <strong>${escapeHtml(code)}</strong></p>
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
          ${actionHtml2}
          <a href="https://discord.gg/hBwz45hq4z" style="background:transparent;border:1px solid #ff3b3b;color:#ff3b3b;padding:10px 14px;border-radius:8px;text-decoration:none;">Join our Discord</a>
        </div>
      </div>
    `;
    if (hasButton2) setAnchorSafety(overlay.querySelector('#actionBtn'));
    setAnchorSafety(overlay.querySelectorAll('a[href="https://discord.gg/hBwz45hq4z"]'));
  }

  // utilities
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }
  function escapeAttr(s) {
    return escapeHtml(s).replaceAll('"', '&quot;');
  }

  function setAnchorSafety(nodes) {
    if (!nodes) return;
    const apply = (a) => {
      if (!a || !a.href) return;
      a.setAttribute('target', '_blank');
      const rel = (a.getAttribute('rel') || '').split(/\s+/).filter(Boolean);
      if (!rel.includes('noopener')) rel.push('noopener');
      if (!rel.includes('noreferrer')) rel.push('noreferrer');
      a.setAttribute('rel', rel.join(' '));
    };
    if (nodes instanceof NodeList || Array.isArray(nodes)) {
      nodes.forEach(apply);
    } else {
      apply(nodes);
    }
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && verstyle === '1.0') {
      overlay.style.display = 'none';
      overlay.style.pointerEvents = 'none';
    }
  });

})();
