/**
 * game-core.js
 * Caelaria shared game systems: player progression, XP/levels,
 * achievement engine, HUD, toast notifications, and end-of-run summary.
 *
 * Usage: <script src="game-core.js"></script>
 * Then access via the global CaelariaGame object.
 */

const CaelariaGame = (() => {
  'use strict';

  // ── Level thresholds ─────────────────────────────────────────────────
  // LEVEL_XP[n] = total XP required to reach level n (1-indexed, level 1 = 0 XP)
  const LEVEL_XP = [0, 0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200];

  function getLevelFromXP(xp) {
    let level = 1;
    for (let i = 2; i < LEVEL_XP.length; i++) {
      if (xp >= LEVEL_XP[i]) level = i;
      else break;
    }
    return level;
  }

  function xpProgressInLevel(xp) {
    const lvl = getLevelFromXP(xp);
    const floor = LEVEL_XP[lvl] || 0;
    const ceil = LEVEL_XP[lvl + 1];
    if (!ceil) return 100;
    return Math.min(100, Math.round(((xp - floor) / (ceil - floor)) * 100));
  }

  // ── Achievement definitions ───────────────────────────────────────────
  const ACHIEVEMENTS = {
    first_escape: {
      id: 'first_escape',
      name: 'First Escape',
      desc: 'Complete your first escape room',
      icon: '🔓',
      xpBonus: 50,
    },
    speed_runner: {
      id: 'speed_runner',
      name: 'Speed Runner',
      desc: 'Escape in under 2 minutes',
      icon: '⚡',
      xpBonus: 75,
    },
    no_hints: {
      id: 'no_hints',
      name: 'No Hints',
      desc: 'Complete an escape without using any hints',
      icon: '🧠',
      xpBonus: 100,
    },
    perfect_run: {
      id: 'perfect_run',
      name: 'Perfect Run',
      desc: 'Achieve a score of 90 or higher',
      icon: '⭐',
      xpBonus: 150,
    },
    explorer: {
      id: 'explorer',
      name: 'Explorer',
      desc: 'Examine every object in the room',
      icon: '🔍',
      xpBonus: 25,
    },
    lab_technician: {
      id: 'lab_technician',
      name: 'Lab Technician I',
      desc: 'Complete your first lab module',
      icon: '🧪',
      xpBonus: 50,
    },
    master_both: {
      id: 'master_both',
      name: 'Master of Both',
      desc: 'Complete both an escape room and a lab module',
      icon: '🎓',
      xpBonus: 200,
    },
  };

  // ── Persistence ───────────────────────────────────────────────────────
  const STORAGE_KEY = 'caelaria_player_v1';

  function _blank() {
    return { xp: 0, unlockedAchievements: [], completedModules: {}, bestScores: {}, achievedAt: {} };
  }

  function loadProfile() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return Object.assign(_blank(), JSON.parse(raw));
    } catch (_) { /* storage unavailable */ }
    return _blank();
  }

  function _save(profile) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(profile)); } catch (_) { /* ignore */ }
  }

  // ── XP API ────────────────────────────────────────────────────────────
  function addXP(amount, label) {
    const profile = loadProfile();
    const prevLevel = getLevelFromXP(profile.xp);
    profile.xp = Math.max(0, profile.xp + amount);
    const newLevel = getLevelFromXP(profile.xp);
    _save(profile);
    _xpToast(amount, label);
    if (newLevel > prevLevel) setTimeout(() => _levelUpToast(newLevel), 500);
    _refreshHUDXP();
    return { xp: profile.xp, level: newLevel, leveledUp: newLevel > prevLevel };
  }

  // ── Achievement API ───────────────────────────────────────────────────
  function unlockAchievement(id) {
    const def = ACHIEVEMENTS[id];
    if (!def) return false;
    const profile = loadProfile();
    if (profile.unlockedAchievements.includes(id)) return false;
    profile.unlockedAchievements.push(id);
    profile.achievedAt[id] = Date.now();
    _save(profile);
    _achievementToast(def);
    if (def.xpBonus) setTimeout(() => addXP(def.xpBonus, 'Achievement: ' + def.name), 900);
    return true;
  }

  // ── Module completion API ─────────────────────────────────────────────
  function completeModule(moduleId, result) {
    // result: { score, timeMs, xpEarned, achievementsEarned: string[] }
    const profile = loadProfile();
    profile.completedModules[moduleId] = (profile.completedModules[moduleId] || 0) + 1;
    if ((result.score || 0) > (profile.bestScores[moduleId] || 0)) {
      profile.bestScores[moduleId] = result.score;
    }
    _save(profile);
    if (result.xpEarned) addXP(result.xpEarned, 'Module complete');
    if (result.achievementsEarned) {
      result.achievementsEarned.forEach(id => unlockAchievement(id));
    }
    // Cross-module achievement
    const updated = loadProfile();
    if (updated.completedModules['escape-room'] && updated.completedModules['lab']) {
      setTimeout(() => unlockAchievement('master_both'), 2500);
    }
  }

  // ── Toast notifications ───────────────────────────────────────────────
  function _toastContainer() {
    let c = document.getElementById('cg-toasts');
    if (!c) {
      c = document.createElement('div');
      c.id = 'cg-toasts';
      Object.assign(c.style, {
        position: 'fixed',
        top: '3.5rem',
        right: '1rem',
        zIndex: '9999',
        display: 'flex',
        flexDirection: 'column',
        gap: '.45rem',
        maxWidth: '280px',
        pointerEvents: 'none',
      });
      document.body.appendChild(c);
    }
    return c;
  }

  function _toast(html, bg, duration) {
    const c = _toastContainer();
    const t = document.createElement('div');
    Object.assign(t.style, {
      background: bg,
      borderRadius: '8px',
      padding: '.5rem .85rem',
      color: '#fff',
      fontFamily: 'Inter,sans-serif',
      fontSize: '.8rem',
      lineHeight: '1.45',
      opacity: '0',
      transform: 'translateX(16px)',
      transition: 'all .28s ease',
      pointerEvents: 'none',
      boxShadow: '0 4px 16px rgba(0,0,0,.4)',
    });
    t.innerHTML = html;
    c.appendChild(t);
    requestAnimationFrame(() => {
      t.style.opacity = '1';
      t.style.transform = 'translateX(0)';
    });
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transform = 'translateX(16px)';
      setTimeout(() => t.remove(), 300);
    }, duration || 3000);
  }

  function _xpToast(amount, label) {
    _toast(
      `<strong>+${amount} XP</strong>${label ? ' &middot; ' + label : ''}`,
      'rgba(14,165,233,.92)'
    );
  }

  function _levelUpToast(level) {
    _toast(
      `🎉 <strong>Level Up!</strong> You are now Level&nbsp;${level}`,
      'rgba(34,197,94,.92)',
      4500
    );
  }

  function _achievementToast(def) {
    _toast(
      `${def.icon} <strong>${def.name}</strong><br><span style="color:rgba(255,255,255,.75);font-size:.74rem">${def.desc}</span>`,
      'rgba(234,179,8,.93)',
      5000
    );
  }

  // ── HUD ───────────────────────────────────────────────────────────────
  function createHUD(config) {
    // config: { objective, showTimer, showScore }
    if (document.getElementById('cg-hud')) return;
    const profile = loadProfile();
    const level = getLevelFromXP(profile.xp);
    const pct = xpProgressInLevel(profile.xp);

    const hud = document.createElement('div');
    hud.id = 'cg-hud';
    hud.setAttribute('role', 'region');
    hud.setAttribute('aria-label', 'Game status');
    Object.assign(hud.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      zIndex: '600',
      display: 'flex',
      alignItems: 'center',
      gap: '.65rem',
      padding: '.35rem 1rem',
      background: 'rgba(8,12,18,.93)',
      borderBottom: '1px solid rgba(14,165,233,.22)',
      backdropFilter: 'blur(10px)',
      fontFamily: 'Inter,sans-serif',
      fontSize: '.76rem',
      flexWrap: 'wrap',
      color: '#e2e8f0',
      minHeight: '2.4rem',
    });

    hud.innerHTML = `
      <span id="cg-hud-obj" style="flex:1;min-width:120px;color:#0ea5e9;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" aria-live="polite">
        📌 ${config.objective || 'Investigate'}
      </span>
      ${config.showTimer ? `<span id="cg-hud-timer" style="font-variant-numeric:tabular-nums;background:rgba(255,255,255,.06);padding:.15rem .45rem;border-radius:4px" aria-live="polite" aria-label="Time remaining">⏱ 05:00</span>` : ''}
      ${config.showScore ? `<span id="cg-hud-score-wrap" style="background:rgba(255,255,255,.06);padding:.15rem .45rem;border-radius:4px" aria-label="Score">⭐&nbsp;<span id="cg-score-val">100</span></span>` : ''}
      <span style="display:flex;align-items:center;gap:.35rem" aria-label="Level ${level}, ${profile.xp} XP">
        <span id="cg-level-label" style="color:#0ea5e9;font-weight:700;font-size:.72rem">Lv.${level}</span>
        <span style="display:inline-block;width:60px;height:5px;background:rgba(255,255,255,.1);border-radius:3px;overflow:hidden" aria-hidden="true">
          <span id="cg-xp-bar" style="display:block;height:100%;background:#0ea5e9;width:${pct}%;transition:.5s ease"></span>
        </span>
        <span id="cg-xp-label" style="color:#64748b">${profile.xp}&nbsp;XP</span>
      </span>
    `;

    document.body.insertBefore(hud, document.body.firstChild);
  }

  function updateHUD(updates) {
    if (updates.objective != null) {
      const el = document.getElementById('cg-hud-obj');
      if (el) el.textContent = '📌 ' + updates.objective;
    }
    if (updates.score != null) {
      const el = document.getElementById('cg-score-val');
      if (el) el.textContent = updates.score;
    }
    if (updates.timerText != null) {
      const el = document.getElementById('cg-hud-timer');
      if (el) el.textContent = '⏱ ' + updates.timerText;
    }
    if (updates.timerColor != null) {
      const el = document.getElementById('cg-hud-timer');
      if (el) el.style.color = updates.timerColor;
    }
  }

  function _refreshHUDXP() {
    const profile = loadProfile();
    const level = getLevelFromXP(profile.xp);
    const pct = xpProgressInLevel(profile.xp);
    const xpEl = document.getElementById('cg-xp-label');
    const barEl = document.getElementById('cg-xp-bar');
    const lvlEl = document.getElementById('cg-level-label');
    if (xpEl) xpEl.textContent = profile.xp + '\u00a0XP';
    if (barEl) barEl.style.width = pct + '%';
    if (lvlEl) lvlEl.textContent = 'Lv.' + level;
  }

  // ── End-of-run summary ────────────────────────────────────────────────
  function showSummary(result, callbacks) {
    // result: { score, timeMs, xpEarned, achievementsEarned: string[], message }
    // callbacks: { onRetry, onBack }
    const existing = document.getElementById('cg-summary');
    if (existing) existing.remove();

    const grade =
      result.score >= 90 ? { label: 'PERFECT',    color: '#f59e0b', icon: '🏆' } :
      result.score >= 70 ? { label: 'GREAT',      color: '#22c55e', icon: '⭐' } :
      result.score >= 50 ? { label: 'GOOD',       color: '#0ea5e9', icon: '✔' } :
                           { label: 'TRY AGAIN',  color: '#ef4444', icon: '↺' };

    const achHtml = (result.achievementsEarned || []).map(id => {
      const a = ACHIEVEMENTS[id];
      return a
        ? `<span style="display:inline-flex;align-items:center;gap:.3rem;padding:.28rem .65rem;background:rgba(234,179,8,.12);border:1px solid rgba(234,179,8,.28);border-radius:6px;font-size:.76rem">${a.icon} ${a.name}</span>`
        : '';
    }).join('');

    const overlay = document.createElement('div');
    overlay.id = 'cg-summary';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Run summary');
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '8000',
      background: 'rgba(0,0,0,.82)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'Inter,sans-serif',
    });

    overlay.innerHTML = `
      <div style="background:linear-gradient(180deg,#1a1f26,#10151c);border:1px solid rgba(14,165,233,.28);border-radius:16px;padding:2.4rem 1.8rem;max-width:400px;width:92%;text-align:center;box-shadow:0 0 60px rgba(14,165,233,.12)">
        <div style="font-size:2.8rem;margin-bottom:.35rem">${grade.icon}</div>
        <div style="font-family:'Orbitron',Orbitron,sans-serif;text-transform:uppercase;letter-spacing:.22rem;font-size:1.35rem;color:${grade.color};margin-bottom:.5rem">${grade.label}</div>
        <p style="color:#94a3b8;margin-bottom:1.4rem;font-size:.88rem;line-height:1.5">${result.message || 'Module complete'}</p>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.65rem;margin-bottom:1.4rem">
          <div style="background:rgba(255,255,255,.05);border-radius:8px;padding:.75rem .4rem">
            <div style="color:#475569;font-size:.65rem;text-transform:uppercase;letter-spacing:.08rem;margin-bottom:.3rem">Score</div>
            <div style="color:#e2e8f0;font-size:1.3rem;font-weight:700">${result.score}</div>
          </div>
          <div style="background:rgba(255,255,255,.05);border-radius:8px;padding:.75rem .4rem">
            <div style="color:#475569;font-size:.65rem;text-transform:uppercase;letter-spacing:.08rem;margin-bottom:.3rem">Time</div>
            <div style="color:#e2e8f0;font-size:1.3rem;font-weight:700">${formatTime(result.timeMs)}</div>
          </div>
          <div style="background:rgba(14,165,233,.08);border:1px solid rgba(14,165,233,.18);border-radius:8px;padding:.75rem .4rem">
            <div style="color:#0ea5e9;font-size:.65rem;text-transform:uppercase;letter-spacing:.08rem;margin-bottom:.3rem">XP</div>
            <div style="color:#0ea5e9;font-size:1.3rem;font-weight:700">+${result.xpEarned}</div>
          </div>
        </div>
        ${achHtml ? `<div style="display:flex;flex-wrap:wrap;gap:.4rem;justify-content:center;margin-bottom:1.4rem">${achHtml}</div>` : ''}
        <div style="display:flex;gap:.75rem;justify-content:center">
          <button id="cg-sum-retry" style="font-family:'Orbitron',Orbitron,sans-serif;text-transform:uppercase;letter-spacing:.1rem;font-size:.68rem;padding:.7rem 1.3rem;border:1px solid #0ea5e9;background:transparent;color:#0ea5e9;border-radius:6px;cursor:pointer;transition:.2s">Retry</button>
          <button id="cg-sum-back"  style="font-family:'Orbitron',Orbitron,sans-serif;text-transform:uppercase;letter-spacing:.1rem;font-size:.68rem;padding:.7rem 1.3rem;border:1px solid rgba(148,163,184,.22);background:transparent;color:#94a3b8;border-radius:6px;cursor:pointer;transition:.2s">Back</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const retry = document.getElementById('cg-sum-retry');
    const back  = document.getElementById('cg-sum-back');

    retry.addEventListener('click', () => { overlay.remove(); if (callbacks && callbacks.onRetry) callbacks.onRetry(); });
    back.addEventListener ('click', () => { overlay.remove(); if (callbacks && callbacks.onBack)  callbacks.onBack();  });

    retry.addEventListener('mouseenter', () => { retry.style.background = 'rgba(14,165,233,.15)'; });
    retry.addEventListener('mouseleave', () => { retry.style.background = 'transparent'; });
    back.addEventListener ('mouseenter', () => { back.style.background  = 'rgba(148,163,184,.08)'; });
    back.addEventListener ('mouseleave', () => { back.style.background  = 'transparent'; });

    const escFn = e => { if (e.key === 'Escape') { overlay.remove(); if (callbacks && callbacks.onBack) callbacks.onBack(); document.removeEventListener('keydown', escFn); } };
    document.addEventListener('keydown', escFn);

    setTimeout(() => retry.focus(), 50);
  }

  // ── Utility ───────────────────────────────────────────────────────────
  function formatTime(ms) {
    if (ms == null) return '--:--';
    const s = Math.floor(ms / 1000);
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }

  // ── Public surface ────────────────────────────────────────────────────
  return {
    getLevelFromXP,
    xpProgressInLevel,
    ACHIEVEMENTS,
    loadProfile,
    addXP,
    unlockAchievement,
    completeModule,
    createHUD,
    updateHUD,
    showSummary,
    formatTime,
  };
})();
