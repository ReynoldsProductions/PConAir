/* PConAir generated control panel — served at
   /packages/_runtime/pconair-controls.js. See specs/18-declarative-controls.md.

   The manifest declares WHAT an operator may change; this file decides HOW it
   is drawn. A package author writes zero HTML for the panel and gets a
   consistent one for free; the operator gets the same interaction model in
   every package.

   Loaded only by control pages (the generated shell loads it, and a
   hand-written control.html may too) — a render page never pays for it.

   ES5-safe, no modules, no build step: these pages are loaded by plain
   BrowserWindows and by whatever browser an operator has to hand. */
(function () {
  'use strict';

  var P = window.PConAir;
  if (!P || !P._registerControlPanel) {
    throw new Error('pconair-controls.js must load after /packages/_runtime/pconair.js');
  }

  var DEFAULT_DEBOUNCE_MS = 150;

  // ── small DOM helpers ───────────────────────────────────────────────────

  function h(tag, className, text) {
    var el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined && text !== null) el.textContent = String(text);
    return el;
  }

  function labelFor(id, text) {
    var l = h('label', 'pc-label', text);
    l.setAttribute('for', id);
    return l;
  }

  function button(className, text) {
    var b = h('button', className, text);
    b.type = 'button';
    return b;
  }

  function isArray(v) {
    return Object.prototype.toString.call(v) === '[object Array]';
  }

  function sameValue(a, b) {
    if (a === b) return true;
    if (typeof a === 'object' || typeof b === 'object') {
      try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; }
    }
    return false;
  }

  // ── the panel ───────────────────────────────────────────────────────────

  function controlPanel(el, opts) {
    opts = opts || {};
    if (!el) throw new Error('PConAir.controlPanel(el, opts): el is required');
    var packageId = opts.packageId;
    if (!packageId) throw new Error('PConAir.controlPanel(el, opts): opts.packageId is required');

    var debounceMs = typeof opts.debounceMs === 'number' ? opts.debounceMs : DEFAULT_DEBOUNCE_MS;
    var ownsClient = !opts.client;
    var client = opts.client || P.connect(packageId, { role: 'control' });

    var entries = [];
    var groupViews = [];
    var disposers = [];
    var destroyed = false;
    var nextId = 0;

    var notice = null;
    var banner = null;
    var errorLine = null;

    var handle = {
      el: el,
      client: client,
      ready: null,
      destroy: destroy,
    };

    if (opts.controls) {
      build({
        id: packageId,
        name: opts.name,
        controls: opts.controls,
        renders: opts.renders || [],
      });
      handle.ready = Promise.resolve(handle);
    } else {
      handle.ready = loadControls().then(function (doc) {
        if (!destroyed) build(doc);
        return handle;
      });
    }
    return handle;

    /* Fetch the one small document the panel needs (spec 18 §3.6) rather than
       the whole manifest. Operator-gated, so a panel opened without a
       session says so instead of rendering empty. */
    function loadControls() {
      return window
        .fetch('/api/packages/' + encodeURIComponent(packageId) + '/controls', {
          headers: { Accept: 'application/json' },
        })
        .then(function (res) {
          if (res.status === 401 || res.status === 403) {
            throw new Error('Sign in as an operator to use this control panel.');
          }
          if (!res.ok) throw new Error('This package declares no controls (' + res.status + ').');
          return res.text().then(function (text) {
            var body = null;
            try { body = text ? JSON.parse(text) : null; } catch (e) { body = null; }
            if (!body || !body.controls) throw new Error('Malformed controls document.');
            return body;
          });
        })
        .catch(function (err) {
          if (!destroyed) renderLoadError(err);
          throw err;
        });
    }

    function renderLoadError(err) {
      el.innerHTML = '';
      var p = h('p', 'pc-panel-load-error', (err && err.message) || 'Could not load controls.');
      p.setAttribute('role', 'alert');
      el.appendChild(p);
    }

    // ── build ─────────────────────────────────────────────────────────────

    function build(doc) {
      el.innerHTML = '';
      var root = h('div', 'pc-panel');
      root.setAttribute('data-package-id', doc.id || packageId);

      // 1. Header — name, presence, connection state.
      var header = h('header', 'pc-panel-header');
      header.appendChild(h('h1', 'pc-panel-title', doc.name || doc.id || packageId));
      var presenceEl = h('span', 'pc-panel-presence');
      presenceEl.setAttribute('data-presence', 'none');
      header.appendChild(presenceEl);
      var connEl = h('span', 'pc-panel-conn');
      header.appendChild(connEl);
      root.appendChild(header);

      /* Spec 16's drop-in indicator. Feature-detected because wave 2's merge
         order is not guaranteed; if it is missing the panel simply has no
         presence dot rather than failing to render. */
      if (typeof P.presenceIndicator === 'function') {
        try {
          var pi = P.presenceIndicator(presenceEl, client);
          if (pi && typeof pi.destroy === 'function') disposers.push(pi.destroy);
        } catch (e) { /* no indicator is better than no panel */ }
      }

      // Disconnected banner and the `delivered: 0` notice, both non-modal.
      banner = h('p', 'pc-panel-banner');
      banner.setAttribute('role', 'status');
      banner.hidden = true;
      banner.textContent =
        'Not connected to PConAir — edits are refused until the connection returns.';
      root.appendChild(banner);

      notice = h('p', 'pc-panel-notice');
      /* role=status, not alert: this is information, not a failure. */
      notice.setAttribute('role', 'status');
      notice.hidden = true;
      notice.textContent = 'Applied — no output is connected.';
      root.appendChild(notice);

      errorLine = h('p', 'pc-panel-error');
      errorLine.setAttribute('role', 'alert');
      errorLine.hidden = true;
      root.appendChild(errorLine);

      // 4. Groups, in manifest order.
      var form = h('div', 'pc-panel-groups');
      var groups = (doc.controls && doc.controls.groups) || [];
      for (var g = 0; g < groups.length; g++) {
        form.appendChild(buildGroup(groups[g], doc));
      }
      root.appendChild(form);

      el.appendChild(root);

      // Live wiring.
      disposers.push(client.on(syncAll));
      disposers.push(client.onConnection(applyConnection));
      applyConnection(client.connected);
      if (client.state) syncAll(client.state);
    }

    function buildGroup(group, doc) {
      var fs = document.createElement('fieldset');
      fs.className = 'pc-group';
      fs.setAttribute('data-group-id', group.id);
      var legend = document.createElement('legend');
      legend.className = 'pc-group-legend';
      legend.textContent = group.label;
      fs.appendChild(legend);

      var body = h('div', 'pc-group-fields');
      fs.appendChild(body);

      for (var i = 0; i < group.fields.length; i++) {
        var entry = buildField(group.fields[i], group, doc);
        entries.push(entry);
        entry.parent = body;
        body.appendChild(entry.anchor);
        if (entry.field.showIf) {
          /* Start hidden and let the first state frame decide. Showing it
             first and hiding it a frame later would flash a control the
             operator is not supposed to have yet. */
          entry.visible = false;
        } else {
          body.appendChild(entry.wrapper);
        }
      }

      groupViews.push({ group: group, el: fs });
      return fs;
    }

    function buildField(f, group, doc) {
      var id = 'pc-' + group.id + '-' + nextId++;
      var wrapper = h('div', 'pc-field');
      wrapper.setAttribute('data-span', f.span || 'full');
      wrapper.setAttribute('data-field-type', f.type);
      if (f.field) wrapper.setAttribute('data-field-path', f.field);

      var entry = {
        field: f,
        group: group,
        id: id,
        wrapper: wrapper,
        /* A comment node marks this field's position, so showIf can detach
           and re-attach the wrapper without moving (and un-focusing) any of
           its siblings. */
        anchor: document.createComment('pc-field ' + id),
        parent: null,
        visible: true,
        input: null,
        controls: [],
        timer: null,
        localDirty: false,
        needsSync: false,
        lastSent: undefined,
        readValue: function () { return undefined; },
        applyValue: function () {},
      };

      wrapper.appendChild(labelOrHeading(f, id));
      var control = buildControl(f, id, entry, doc);
      if (control) wrapper.appendChild(control);
      if (f.help) {
        var help = h('p', 'pc-help', f.help);
        help.id = id + '-help';
        wrapper.appendChild(help);
        if (entry.input) entry.input.setAttribute('aria-describedby', help.id);
      }
      var fieldError = h('p', 'pc-field-error');
      fieldError.setAttribute('role', 'alert');
      fieldError.hidden = true;
      wrapper.appendChild(fieldError);
      entry.errorEl = fieldError;

      return entry;
    }

    /* A `static` field has no control, so it gets a plain heading rather than
       a <label for> pointing at nothing. */
    function labelOrHeading(f, id) {
      if (f.type === 'static') return h('span', 'pc-static-label', f.label);
      return labelFor(id, f.label);
    }

    // ── controls, by field type ───────────────────────────────────────────

    function buildControl(f, id, entry, doc) {
      switch (f.type) {
        case 'text': return buildText(f, id, entry);
        case 'number': return buildNumber(f, id, entry);
        case 'toggle': return buildToggle(f, id, entry);
        case 'select': return buildSelect(f, id, entry);
        case 'color': return buildColor(f, id, entry);
        case 'static': return h('p', 'pc-static', f.text);
        default: {
          var todo = h('p', 'pc-static', 'Unsupported field type: ' + f.type);
          return todo;
        }
      }
    }

    function registerInput(entry, input) {
      entry.input = input;
      entry.controls.push(input);
      return input;
    }

    function buildText(f, id, entry) {
      var input;
      if (f.multiline || f.list) {
        input = document.createElement('textarea');
        input.className = 'pc-input pc-textarea';
      } else {
        input = document.createElement('input');
        input.type = 'text';
        input.className = 'pc-input';
      }
      input.id = id;
      if (f.maxLength) input.setAttribute('maxlength', String(f.maxLength));
      if (f.placeholder) input.setAttribute('placeholder', f.placeholder);

      entry.readValue = function () {
        if (f.list) return splitLines(input.value);
        return input.value;
      };
      entry.applyValue = function (v) {
        input.value = f.list ? (isArray(v) ? v.join('\n') : '') : v === null || v === undefined ? '' : String(v);
      };
      wireValueEvents(entry, input, { debounce: true });
      return registerInput(entry, input);
    }

    function splitLines(text) {
      var raw = String(text === null || text === undefined ? '' : text).split('\n');
      var out = [];
      for (var i = 0; i < raw.length; i++) {
        var line = raw[i].replace(/^\s+|\s+$/g, '');
        if (line.length > 0) out.push(line);
      }
      return out;
    }

    function buildNumber(f, id, entry) {
      var row = h('div', 'pc-number-row');
      var input = document.createElement('input');
      input.type = 'number';
      input.className = 'pc-input pc-number';
      input.id = id;
      if (typeof f.min === 'number') input.setAttribute('min', String(f.min));
      if (typeof f.max === 'number') input.setAttribute('max', String(f.max));
      if (typeof f.step === 'number') input.setAttribute('step', String(f.step));

      entry.readValue = function () {
        var n = parseFloat(input.value);
        return isNaN(n) ? 0 : clampNumber(f, n);
      };
      entry.applyValue = function (v) {
        input.value = v === null || v === undefined || v === '' ? '' : String(v);
      };
      wireValueEvents(entry, input, { debounce: true });

      // -/+ buttons, largest magnitude outermost: -10 -1 [input] +1 +10
      var bumps = isArray(f.bump) ? f.bump : [];
      for (var i = bumps.length - 1; i >= 0; i--) row.appendChild(bumpButton(f, entry, input, -Math.abs(bumps[i])));
      row.appendChild(input);
      for (var j = 0; j < bumps.length; j++) row.appendChild(bumpButton(f, entry, input, Math.abs(bumps[j])));

      registerInput(entry, input);
      return row;
    }

    function bumpButton(f, entry, input, delta) {
      var b = button('pc-bump', (delta > 0 ? '+' : '−') + Math.abs(delta));
      b.setAttribute('aria-label', (delta > 0 ? 'Increase' : 'Decrease') + ' ' + f.label + ' by ' + Math.abs(delta));
      b.addEventListener('click', function () {
        if (!ensureConnected(entry)) return;
        var cur = parseFloat(input.value);
        if (isNaN(cur)) cur = 0;
        var next = clampNumber(f, cur + delta);
        entry.applyValue(next);
        commitImmediate(entry);
      });
      entry.controls.push(b);
      return b;
    }

    function clampNumber(f, n) {
      if (typeof f.min === 'number' && n < f.min) return f.min;
      if (typeof f.max === 'number' && n > f.max) return f.max;
      return n;
    }

    function buildToggle(f, id, entry) {
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.className = 'pc-toggle';
      input.id = id;
      entry.readValue = function () { return !!input.checked; };
      entry.applyValue = function (v) { input.checked = !!v; };
      wireValueEvents(entry, input, { debounce: false });
      return registerInput(entry, input);
    }

    function buildSelect(f, id, entry) {
      var sel = document.createElement('select');
      sel.className = 'pc-input pc-select';
      sel.id = id;
      var choices = isArray(f.choices) ? f.choices : [];
      for (var i = 0; i < choices.length; i++) {
        var opt = document.createElement('option');
        opt.value = String(choices[i].id);
        opt.textContent = choices[i].label;
        sel.appendChild(opt);
      }
      entry.readValue = function () {
        // Hand back the declared id, with its declared type — an <option>
        // value is always a string, but the state leaf may be a number.
        for (var k = 0; k < choices.length; k++) {
          if (String(choices[k].id) === sel.value) return choices[k].id;
        }
        return sel.value;
      };
      entry.applyValue = function (v) {
        sel.value = v === null || v === undefined ? '' : String(v);
      };
      wireValueEvents(entry, sel, { debounce: false });
      return registerInput(entry, sel);
    }

    function buildColor(f, id, entry) {
      var row = h('div', 'pc-color-row');
      var input = document.createElement('input');
      input.type = 'color';
      input.className = 'pc-input pc-color';
      input.id = id;

      entry.readValue = function () { return input.value; };
      entry.applyValue = function (v) {
        var s = v === null || v === undefined ? '' : String(v);
        /* <input type="color"> normalises to #rrggbb, which loses "#fff" and
           cannot hold a named colour at all. Keep what state actually says
           alongside it so nothing silently rewrites an author's value. */
        input.setAttribute('data-pc-raw', s);
        var hex = toPickerHex(s);
        if (hex) input.value = hex;
      };
      wireValueEvents(entry, input, { debounce: true });
      registerInput(entry, input);
      row.appendChild(input);

      var swatches = isArray(f.swatches) ? f.swatches : [];
      for (var i = 0; i < swatches.length; i++) row.appendChild(swatchButton(f, entry, swatches[i]));
      return row;
    }

    /* #rgb -> #rrggbb, #rrggbbaa -> #rrggbb, anything else -> null (the
       picker keeps whatever it had; data-pc-raw carries the truth). */
    function toPickerHex(value) {
      if (!/^#[0-9a-fA-F]+$/.test(value)) return null;
      var body = value.slice(1);
      if (body.length === 3) return '#' + body[0] + body[0] + body[1] + body[1] + body[2] + body[2];
      if (body.length === 6 || body.length === 8) return '#' + body.slice(0, 6);
      return null;
    }

    function swatchButton(f, entry, value) {
      var b = button('pc-swatch', '');
      b.setAttribute('aria-label', f.label + ': ' + value);
      b.setAttribute('data-swatch', value);
      /* Validated at load by controls-validate.ts, and again here, because
         this writes straight into a style property. */
      if (P.isValidColorValue(value)) b.style.backgroundColor = value;
      b.addEventListener('click', function () {
        if (!ensureConnected(entry)) return;
        entry.applyValue(value);
        /* Commit the DECLARED value, not the picker's reading of it: a
           swatch of "#fff" must stay "#fff", not become "#ffffff". */
        commitExplicit(entry, value);
      });
      entry.controls.push(b);
      return b;
    }

    // ── value events ──────────────────────────────────────────────────────

    /* The interaction rules of §3.4, in one place, because getting them
       wrong per-field is exactly what every hand-written panel did.

       - Typing debounces at 150 ms, so naming a player does not emit a patch
         per keystroke; `change`, `blur` and Enter commit immediately.
       - A focused input is never overwritten by an incoming state frame
         (syncAll marks it `needsSync` instead); it reconciles on blur, but
         only if the operator was not mid-edit — otherwise blur commits their
         work rather than throwing it away. */
    function wireValueEvents(entry, input, cfg) {
      if (cfg.debounce) {
        input.addEventListener('input', function () {
          entry.localDirty = true;
          scheduleCommit(entry);
        });
      }
      input.addEventListener('change', function () {
        commitImmediate(entry);
      });
      input.addEventListener('blur', function () {
        if (entry.localDirty) {
          commitPending(entry);
          return;
        }
        if (entry.needsSync) {
          entry.needsSync = false;
          reconcile(entry);
        }
      });
      if (input.tagName !== 'TEXTAREA') {
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.keyCode === 13) commitPending(entry);
        });
      }
    }

    /* Flush a debounce early (blur, Enter) without forcing a resend of a
       value already in flight. */
    function commitPending(entry) {
      if (entry.timer) {
        window.clearTimeout(entry.timer);
        entry.timer = null;
      }
      commitValue(entry, entry.readValue());
    }

    function scheduleCommit(entry) {
      if (entry.timer) window.clearTimeout(entry.timer);
      entry.timer = window.setTimeout(function () {
        entry.timer = null;
        commitValue(entry, entry.readValue());
      }, debounceMs);
    }

    function commitImmediate(entry) {
      commitExplicit(entry, entry.readValue());
    }

    /* Commit a value the caller already has, bypassing readValue — used where
       the input cannot represent the authoritative value faithfully (a colour
       swatch) or where there is no input at all (a bump button). */
    function commitExplicit(entry, value) {
      if (entry.timer) {
        window.clearTimeout(entry.timer);
        entry.timer = null;
      }
      entry.localDirty = true;
      commitValue(entry, value);
    }

    function commitValue(entry, value) {
      var f = entry.field;
      if (!f.field) return;
      if (!ensureConnected(entry)) return;
      /* The client half of §3.3's colour rule. The server is the real gate
         (POST /state rejects with 400), but refusing here too means a typo
         is explained next to the input instead of coming back as a generic
         request failure. */
      if (f.type === 'color' && !P.isValidColorValue(value)) {
        setFieldError(entry, 'Not a valid colour — use a hex value like #c8a24a, or a named colour.');
        reconcile(entry);
        return;
      }
      /* Dedupe: browsers fire `change` after typing then blurring, so the
         debounced patch and the change event would otherwise send the same
         value twice. `lastSent` is cleared on rejection so a retry is never
         swallowed. */
      if (sameValue(value, entry.lastSent)) return;
      entry.lastSent = value;
      var patch = P.buildPatch(client.state, f.field, value);
      setFieldError(entry, null);
      client.patch(patch).then(
        function (body) {
          entry.localDirty = false;
          showDelivered(body && body.delivered);
          /* Only reconcile if a NEWER frame actually arrived while the
             operator held focus. Re-applying the same client.state the patch
             was built from would put the pre-edit value back — and then the
             `change` that follows a blur would send it to the server as if
             the operator had asked for it. */
          if (entry.needsSync && document.activeElement !== entry.input) {
            entry.needsSync = false;
            reconcile(entry);
          }
        },
        function (err) {
          entry.localDirty = false;
          entry.lastSent = undefined;
          setFieldError(entry, (err && err.message) || 'Rejected');
          // Optimistic then reconciled: a rejected patch visibly reverts to
          // the last state the server told us about.
          reconcile(entry);
        }
      );
    }

    /* Silently swallowing an operator's edit during a dropout is worse than
       refusing it (§3.4): they would carry on believing the graphic changed.
       So an edit made while disconnected is refused out loud and the input
       snaps back to the last value the server confirmed. */
    function ensureConnected(entry) {
      if (client.connected) return true;
      setFieldError(entry, 'Not connected — this edit was refused, not applied.');
      reconcile(entry);
      return false;
    }

    function reconcile(entry) {
      if (!entry.field.field) return;
      entry.applyValue(P.getPath(client.state, entry.field.field));
    }

    function setFieldError(entry, message) {
      if (!entry.errorEl) return;
      entry.errorEl.hidden = !message;
      entry.errorEl.textContent = message || '';
      if (message) {
        errorLine.hidden = false;
        errorLine.textContent = message;
      }
    }

    function showDelivered(delivered) {
      if (typeof delivered !== 'number' || !notice) return;
      notice.hidden = delivered > 0;
    }

    // ── state and connection ──────────────────────────────────────────────

    /* §3.2's showIf: "logo position" appears only once "show logo" is on.
       Comparison is strict, so "12" never matches 12 — a manifest that meant
       the number should say the number. */
    function showIfMatches(f, state) {
      if (!f.showIf) return true;
      return P.getPath(state, f.showIf.field) === f.showIf.equals;
    }

    /* Detach or re-attach one field around its own anchor comment. Doing it
       this way, rather than re-appending the whole group, means a field
       appearing never moves — and so never un-focuses — any of its siblings,
       and it comes back in its manifest position rather than at the end. */
    function setFieldVisible(entry, visible) {
      if (entry.visible === visible) return;
      entry.visible = visible;
      if (visible) {
        entry.parent.insertBefore(entry.wrapper, entry.anchor.nextSibling);
      } else {
        /* A hidden field must not finish a debounce it had already armed:
           the operator can no longer see what it would send. */
        if (entry.timer) {
          window.clearTimeout(entry.timer);
          entry.timer = null;
        }
        entry.localDirty = false;
        if (entry.wrapper.parentNode) entry.wrapper.parentNode.removeChild(entry.wrapper);
      }
    }

    function syncAll(state) {
      var i;
      for (i = 0; i < entries.length; i++) {
        setFieldVisible(entries[i], showIfMatches(entries[i].field, state));
      }
      for (i = 0; i < entries.length; i++) {
        var entry = entries[i];
        if (!entry.visible) continue;
        if (!entry.field.field) continue;
        /* Never clobber a focused input (§3.4). hoops/control.html's syncInput
           is the reference for this rule; here it is applied once for every
           field type instead of being re-hand-written per input. The frame is
           remembered and applied on blur. */
        if (entry.input && document.activeElement === entry.input) {
          entry.needsSync = true;
          continue;
        }
        entry.applyValue(P.getPath(state, entry.field.field));
      }
    }

    function applyConnection(connected) {
      if (banner) banner.hidden = !!connected;
      if (!el.firstChild) return;
      var root = el.firstChild;
      if (connected) root.removeAttribute('data-pc-disconnected');
      else root.setAttribute('data-pc-disconnected', '');
      for (var i = 0; i < entries.length; i++) {
        var list = entries[i].controls;
        for (var j = 0; j < list.length; j++) {
          if (connected) list[j].removeAttribute('aria-disabled');
          else list[j].setAttribute('aria-disabled', 'true');
        }
      }
    }

    // ── teardown ──────────────────────────────────────────────────────────

    function destroy() {
      destroyed = true;
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].timer) window.clearTimeout(entries[i].timer);
      }
      for (var d = 0; d < disposers.length; d++) {
        try { disposers[d](); } catch (e) { /* a bad disposer must not stop the rest */ }
      }
      disposers = [];
      if (ownsClient) {
        try { client.close(); } catch (e) { /* ignore */ }
      }
      el.innerHTML = '';
    }
  }

  P._registerControlPanel(controlPanel);
})();
