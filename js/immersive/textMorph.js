/**
 * Lightweight in-place text decode/scramble (shared RAF per call).
 * Pass click:false (default) for silent morphs — e.g. media hover.
 */

const MORPH_GLYPHS =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function isScrambleChar(ch) {
  return /[A-Za-z0-9]/.test(ch);
}

/** Passi irregolari: stesso densità media, ritmo leggermente swingato. */
function buildClickPattern(n, every, { jitter = 0.35, skipChance = 0 } = {}) {
  const set = new Set();
  if (n <= 0) return set;
  set.add(0);
  let i = 0;
  const base = Math.max(1, every | 0);
  while (i < n - 1) {
    const f = 1 + (Math.random() * 2 - 1) * Math.max(0, jitter);
    const step = Math.max(1, Math.round(base * f));
    i += step;
    if (i >= n - 1) break;
    if (skipChance > 0 && Math.random() < skipChance) continue;
    set.add(i);
  }
  set.add(n - 1);
  return set;
}

/**
 * Morph in-place: final width reserved, progressive lock.
 * @param {HTMLElement | null | undefined} el
 * @param {string} fullText
 * @param {{
 *   click?: boolean,
 *   clickEvery?: number,
 *   clickCount?: number,
 *   clickGain?: number,
 *   clickUniform?: boolean,
 *   clickFluid?: boolean,
 *   clickJitter?: number,
 *   clickSkip?: number,
 *   clickSound?: (opts: { space?: boolean, gain?: number, uniform?: boolean, fluid?: boolean }) => void,
 *   scrambleMs?: number,
 *   slowLock?: number,
 *   fastLock?: number,
 *   fastFrom?: number,
 *   startDelay?: number,
 * }} [opts]
 * @returns {Promise<void>}
 */
export function morphTextInPlace(el, fullText, opts = {}) {
  const {
    click = false,
    clickEvery = 1,
    clickCount = null,
    clickGain = 0.38,
    clickUniform = false,
    clickFluid = false,
    clickJitter = 0.35,
    clickSkip = 0,
    clickSound = null,
    scrambleMs = 20,
    slowLock = 94,
    fastLock = 60,
    fastFrom = -1,
    startDelay = 102,
  } = opts;

  return new Promise((resolve) => {
    if (!el) {
      resolve();
      return;
    }
    const text = String(fullText ?? "");
    el.classList.add("is-morphing", "text-morph");
    el.style.minWidth = `${Math.max(text.length, 1)}ch`;
    const chars = [...text];
    const locked = chars.map((ch) => !isScrambleChar(ch));
    const order = chars.map((_, idx) => idx).filter((idx) => isScrambleChar(chars[idx]));
    /** Indici lock su cui sparare click (inizio→fine, ritmo leggermente irregolare). */
    let clickAt = new Set();
    if (click && order.length) {
      if (clickCount != null && clickCount > 0) {
        const k = Math.min(Math.max(2, clickCount | 0), order.length);
        // Distribuisci k colpi con micro-sfasamento ritmico
        for (let i = 0; i < k; i += 1) {
          const t = k === 1 ? 0 : i / (k - 1);
          const swing = (Math.random() - 0.5) * 0.08 * clickJitter;
          const idx = Math.round(
            Math.min(1, Math.max(0, t + swing)) * (order.length - 1)
          );
          clickAt.add(idx);
        }
        clickAt.add(0);
        clickAt.add(order.length - 1);
      } else {
        clickAt = buildClickPattern(order.length, clickEvery, {
          jitter: clickJitter,
          skipChance: clickSkip,
        });
      }
    }
    let lockCount = 0;
    let lastScramble = 0;
    let nextLockAt = performance.now() + startDelay;

    const lockDelay = (charIndex) => {
      const fast =
        fastFrom >= 0 ? charIndex >= fastFrom : charIndex / chars.length > 0.55;
      return fast
        ? fastLock + Math.random() * (fastLock * 0.28)
        : slowLock + Math.random() * (slowLock * 0.28);
    };

    const paint = (now) => {
      const untilLock = Math.max(0, nextLockAt - now);
      const lockSpan = lockCount < order.length ? lockDelay(order[lockCount]) : 1;
      const settle = 1 - Math.min(1, untilLock / Math.max(lockSpan, 1));
      const nextIdx = order[lockCount];
      let out = "";
      for (let n = 0; n < chars.length; n += 1) {
        if (locked[n]) {
          out += chars[n];
          continue;
        }
        const near =
          n === nextIdx ? 0.2 + settle * 0.65 : n === order[lockCount + 1] ? 0.12 : 0;
        out +=
          near > 0 && Math.random() < near
            ? chars[n]
            : MORPH_GLYPHS[(Math.random() * MORPH_GLYPHS.length) | 0];
      }
      el.textContent = out;
    };

    const finish = () => {
      el.textContent = text;
      el.classList.add("is-in");
      el.classList.remove("is-morphing");
      resolve();
    };

    if (!order.length) {
      finish();
      return;
    }

    const frame = (now) => {
      if (now - lastScramble >= scrambleMs) {
        lastScramble = now;
        paint(now);
      }
      if (lockCount < order.length && now >= nextLockAt) {
        const idx = order[lockCount];
        locked[idx] = true;
        if (click && clickAt.has(lockCount) && typeof clickSound === "function") {
          // Accento leggero; fluid = tick più morbido/continuo
          const accent = clickFluid
            ? 0.92 + Math.random() * 0.12
            : 0.88 + Math.random() * 0.28;
          clickSound({
            space: false,
            gain: clickGain * accent,
            uniform: clickUniform,
            fluid: clickFluid,
          });
        }
        lockCount += 1;
        if (lockCount < order.length) {
          nextLockAt = now + lockDelay(order[lockCount]);
        }
      }
      if (lockCount >= order.length) {
        finish();
        return;
      }
      requestAnimationFrame(frame);
    };
    paint(performance.now());
    requestAnimationFrame(frame);
  });
}
