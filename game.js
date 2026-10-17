// Cosmic Surge - Built for start.ng
// Follows all start.ng protocols: iframe postMessage, HTTP session fallback, startng.json leaderboard, character rendering

const START_NG = 'https://start.ng';
const API_URL = 'https://api.start.ng';
const GAME_NAME = 'cosmic-surge';

// --- start.ng Integration Layer ---
let framePromise = null;

function connectFrame() {
  if (!framePromise) {
    framePromise = new Promise((resolve, reject) => {
      // If we are not running on start.ng, the iframe won't communicate cross-domain without start.ng origin,
      // but we still initialize it gracefully according to start.ng specs.
      const el = document.createElement('iframe');
      el.src = `${START_NG}/connect`;
      el.hidden = true;
      el.onload = () => resolve(el);
      el.onerror = (err) => {
        console.warn('start.ng connect iframe failed to load (offline or local dev)', err);
        resolve(null);
      };
      document.body.append(el);
    });
  }
  return framePromise;
}

async function askStartNg(message, replyType, timeoutMs = 3000) {
  try {
    const el = await connectFrame();
    if (!el || !el.contentWindow) return null;
    return new Promise((resolve) => {
      const requestId = Math.random().toString(36).slice(2);
      const timer = setTimeout(() => {
        removeEventListener('message', onMessage);
        resolve(null);
      }, timeoutMs);

      function onMessage(e) {
        if (e.origin !== START_NG || e.source !== el.contentWindow) return;
        if (e.data?.type === replyType && e.data.requestId === requestId) {
          clearTimeout(timer);
          removeEventListener('message', onMessage);
          resolve(e.data);
        }
      }

      addEventListener('message', onMessage);
      el.contentWindow.postMessage({ ...message, requestId }, START_NG);
    });
  } catch (err) {
    console.warn('askStartNg exception:', err);
    return null;
  }
}

// Session detection for HTTP API
const hashParams = new URLSearchParams(location.hash.slice(1));
if (hashParams.get('startng_session')) {
  sessionStorage.setItem('startng_session', hashParams.get('startng_session'));
  history.replaceState(null, '', location.pathname + location.search);
}
let currentSession = sessionStorage.getItem('startng_session');

// Player Data
let currentPlayer = {
  id: null,
  name: 'Cosmic Explorer',
  account: null,
  face: null,
  style: {
    body: 'female',
    primaryColor: '#06b6d4',
    secondaryColor: '#3b82f6',
    skinColor: '#8d5524',
    hairColor: '#17120f',
    hair: 'braids',
    hat: 'crown',
    accessory: 'backpack',
  },
  isSignedIn: false,
};

async function initPlayer() {
  const card = document.getElementById('player-card');
  const faceEl = document.getElementById('player-face');
  const nameEl = document.getElementById('player-name');
  const accountEl = document.getElementById('player-account');
  const signInBtn = document.getElementById('player-sign-in');
  const previewName = document.getElementById('preview-name');
  const previewDesc = document.getElementById('preview-desc');

  signInBtn.onclick = () => {
    location.href = `https://start.ng/?return_to=${encodeURIComponent(location.origin + location.pathname)}`;
  };

  // Try connect iframe first
  let userFound = false;
  const reply = await askStartNg({ type: 'startng:whoami' }, 'startng:user', 3000);
  if (reply && (reply.user || reply.guest)) {
    const user = reply.user;
    const guest = reply.guest;
    if (user) {
      currentPlayer.id = user.id;
      currentPlayer.name = user.name || 'Cosmic Explorer';
      currentPlayer.account = user.account || null;
      currentPlayer.face = user.face || null;
      if (user.style) currentPlayer.style = { ...currentPlayer.style, ...user.style };
      currentPlayer.isSignedIn = true;
      userFound = true;
    } else if (guest) {
      currentPlayer.name = guest.name || 'Guest Explorer';
      currentPlayer.face = guest.face || null;
      if (guest.style) currentPlayer.style = { ...currentPlayer.style, ...guest.style };
      currentPlayer.isSignedIn = false;
      userFound = true;
    }
  }

  // Fallback to HTTP API if session exists
  if (!userFound && currentSession) {
    try {
      const res = await fetch(`${API_URL}/games/${GAME_NAME}/player`, {
        headers: { Authorization: `Bearer ${currentSession}` },
      });
      if (res.ok) {
        const data = await res.json();
        currentPlayer.id = data.id;
        currentPlayer.name = data.name || 'Cosmic Explorer';
        if (data.style) currentPlayer.style = { ...currentPlayer.style, ...data.style };
        currentPlayer.isSignedIn = true;
        userFound = true;
      } else if (res.status === 401) {
        sessionStorage.removeItem('startng_session');
        currentSession = null;
      }
    } catch (e) {
      console.warn('HTTP player fetch failed', e);
    }
  }

  // Update UI Profile Card
  if (currentPlayer.face) {
    faceEl.src = currentPlayer.face;
  }
  nameEl.textContent = currentPlayer.name;
  previewName.textContent = currentPlayer.name;

  if (currentPlayer.isSignedIn) {
    accountEl.textContent = currentPlayer.account ? `@${currentPlayer.account}` : 'Signed in';
    signInBtn.hidden = true;
    previewDesc.textContent = 'start.ng Explorer';
  } else {
    accountEl.textContent = 'Guest Explorer';
    signInBtn.hidden = false;
    previewDesc.textContent = 'Guest Character';
  }

  drawCharacterAvatar(document.getElementById('preview-canvas'), currentPlayer.style, true);
}

// Re-check player on focus / visibility
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') initPlayer();
});
window.addEventListener('focus', () => initPlayer());

// Save Run to Leaderboard
async function submitScore(score, wave, crystals) {
  const statusEl = document.getElementById('score-status');
  statusEl.textContent = 'Transmitting flight telemetry to start.ng...';

  // 1. Try connect frame
  const postResult = await askStartNg({
    type: 'startng:score',
    stats: { score: Math.floor(score), wave: Math.floor(wave), crystals: Math.floor(crystals) },
  }, 'startng:scoreSaved', 4000);

  if (postResult && postResult.ok) {
    const res = postResult.result;
    statusEl.innerHTML = res.improved
      ? `🌟 <b>NEW RECORD!</b> Rank <b>#${res.rank}</b> on start.ng!`
      : `Telemetry logged! Global rank: <b>#${res.rank}</b> (Best: ${res.best})`;
    return;
  }

  // 2. Try HTTP session if available
  if (currentSession) {
    try {
      const res = await fetch(`${API_URL}/games/${GAME_NAME}/scores`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${currentSession}`,
        },
        body: JSON.stringify({
          stats: { score: Math.floor(score), wave: Math.floor(wave), crystals: Math.floor(crystals) },
        }),
      });
      if (res.ok) {
        const saved = await res.json();
        statusEl.innerHTML = saved.improved
          ? `🌟 <b>NEW PERSONAL BEST!</b> Rank <b>#${saved.rank}</b> on start.ng!`
          : `Run recorded! Global rank: <b>#${saved.rank}</b>`;
        return;
      }
    } catch (e) {
      console.warn('Score submission via HTTP failed', e);
    }
  }

  if (currentPlayer.isSignedIn) {
    statusEl.textContent = 'Score recorded locally (ready for start.ng sync)';
  } else {
    statusEl.innerHTML = `Great run! <a href="https://start.ng/?return_to=${encodeURIComponent(location.origin + location.pathname)}" style="color: #06b6d4; text-decoration: underline;">Sign in with start.ng</a> to lock your rank on the leaderboard!`;
  }
}

// Fetch and display Leaderboard
async function showLeaderboard() {
  const modal = document.getElementById('leaderboard-modal');
  const tbody = document.getElementById('board-tbody');
  modal.classList.remove('hidden');
  tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding: 20px;">Contacting start.ng satellite...</td></tr>';

  let entries = null;

  // 1. Try connect iframe
  const reply = await askStartNg({ type: 'startng:leaderboard', limit: 10 }, 'startng:leaderboardData', 3000);
  if (reply && reply.ok && reply.entries) {
    entries = reply.entries;
  }

  // 2. Try public HTTP API
  if (!entries) {
    try {
      const res = await fetch(`${API_URL}/games/${GAME_NAME}/leaderboard?limit=10`);
      if (res.ok) {
        entries = await res.json();
      }
    } catch (e) {
      console.warn('Leaderboard fetch failed', e);
    }
  }

  if (!entries || entries.length === 0) {
    tbody.innerHTML = `
      <tr><td colspan="5" style="text-align:center; padding: 25px; color:#94a3b8;">
        No public flights recorded yet.<br>Be the first astronaut to top the leaderboard!
      </td></tr>
    `;
    return;
  }

  tbody.innerHTML = entries.map((entry) => {
    const isMe = currentPlayer.id && entry.player_id === currentPlayer.id;
    const stats = entry.stats || { score: entry.score || 0, wave: 1, crystals: 0 };
    return `
      <tr class="${isMe ? 'my-rank' : ''}">
        <td><b>#${entry.rank}</b></td>
        <td style="display:flex; align-items:center; gap:8px;">
          <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${entry.color || '#06b6d4'}"></span>
          <span>${escapeHtml(entry.name || 'Anonymous')}</span>
          ${isMe ? '<span style="font-size:10px; color:#06b6d4;">(YOU)</span>' : ''}
        </td>
        <td><b>${(stats.score || 0).toLocaleString()}</b></td>
        <td>Sector ${stats.wave || 1}</td>
        <td>${(stats.crystals || 0).toLocaleString()} 💎</td>
      </tr>
    `;
  }).join('');
}

function escapeHtml(str) {
  return str.replace(/[&<>'"]/g, (tag) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;',
  }[tag] || tag));
}

// --- Synthesized Web Audio Engine ---
class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = localStorage.getItem('cosmic_surge_muted') === 'true';
    this.updateAudioButton();
  }

  init() {
    if (!this.ctx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AudioContext();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  toggle() {
    this.muted = !this.muted;
    localStorage.setItem('cosmic_surge_muted', this.muted);
    this.updateAudioButton();
  }

  updateAudioButton() {
    const btn = document.getElementById('btn-audio');
    if (btn) btn.textContent = this.muted ? '🔇 Muted' : '🔊 Sound';
  }

  playCrystal() {
    if (this.muted) return;
    this.init();
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(659.25, now); // E5
    osc.frequency.exponentialRampToValueAtTime(1318.51, now + 0.12); // E6
    gain.gain.setValueAtTime(0.2, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.16);
  }

  playSurgeActivate() {
    if (this.muted) return;
    this.init();
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(150, now);
    osc.frequency.exponentialRampToValueAtTime(800, now + 0.35);
    gain.gain.setValueAtTime(0.3, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.45);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.46);
  }

  playPowerup() {
    if (this.muted) return;
    this.init();
    const now = this.ctx.currentTime;
    [440, 554.37, 659.25, 880].forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + idx * 0.06);
      gain.gain.setValueAtTime(0.2, now + idx * 0.06);
      gain.gain.exponentialRampToValueAtTime(0.01, now + idx * 0.06 + 0.12);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now + idx * 0.06);
      osc.stop(now + idx * 0.06 + 0.13);
    });
  }

  playExplosion() {
    if (this.muted) return;
    this.init();
    const now = this.ctx.currentTime;
    const bufferSize = this.ctx.sampleRate * 0.4;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(450, now);
    filter.frequency.exponentialRampToValueAtTime(40, now + 0.35);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.4, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.38);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    noise.start(now);
  }

  playShieldHit() {
    if (this.muted) return;
    this.init();
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(500, now);
    osc.frequency.exponentialRampToValueAtTime(100, now + 0.2);
    gain.gain.setValueAtTime(0.25, now);
    gain.gain.exponentialRampToValueAtTime(0.01, now + 0.22);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + 0.23);
  }
}

const sound = new SoundEngine();

// --- Character Canvas Renderer ---
// Renders the start.ng character based on style attributes:
// body: female, male
// primaryColor: suit top
// secondaryColor: trousers
// skinColor, hairColor, hair, hat, accessory
function drawCharacterAvatar(canvas, style, isStanding = false) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const scale = w / 100;

  ctx.save();
  ctx.translate(cx, cy);

  const skin = style.skinColor || '#8d5524';
  const primary = style.primaryColor || '#06b6d4';
  const secondary = style.secondaryColor || '#3b82f6';
  const hair = style.hairColor || '#17120f';
  const isFemale = style.body === 'female';

  // Jetpack on back
  ctx.fillStyle = '#475569';
  ctx.fillRect(-18 * scale, -10 * scale, 8 * scale, 24 * scale);
  // Jetpack nozzle
  ctx.fillStyle = '#06b6d4';
  ctx.fillRect(-16 * scale, 14 * scale, 4 * scale, 5 * scale);

  // Jetpack Thruster Flame
  if (!isStanding) {
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.moveTo(-16 * scale, 19 * scale);
    ctx.lineTo(-14 * scale, (26 + Math.random() * 6) * scale);
    ctx.lineTo(-12 * scale, 19 * scale);
    ctx.fill();
  }

  // Legs / Boots
  ctx.fillStyle = secondary;
  ctx.fillRect(-6 * scale, 12 * scale, 5 * scale, 14 * scale);
  ctx.fillRect(2 * scale, 12 * scale, 5 * scale, 14 * scale);
  // Boots
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(-7 * scale, 24 * scale, 7 * scale, 6 * scale);
  ctx.fillRect(2 * scale, 24 * scale, 7 * scale, 6 * scale);

  // Torso / Suit
  ctx.fillStyle = primary;
  if (isFemale) {
    ctx.beginPath();
    ctx.moveTo(-9 * scale, -8 * scale);
    ctx.lineTo(9 * scale, -8 * scale);
    ctx.lineTo(7 * scale, 12 * scale);
    ctx.lineTo(-7 * scale, 12 * scale);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.fillRect(-9 * scale, -8 * scale, 18 * scale, 20 * scale);
  }

  // Suit Chest Emblem
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(0, -1 * scale, 3 * scale, 0, Math.PI * 2);
  ctx.fill();

  // Head / Neck
  ctx.fillStyle = skin;
  ctx.fillRect(-3 * scale, -12 * scale, 6 * scale, 5 * scale); // neck
  ctx.beginPath();
  ctx.arc(0, -18 * scale, 9 * scale, 0, Math.PI * 2); // head
  ctx.fill();

  // Visor / Face
  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.ellipse(3 * scale, -18 * scale, 6 * scale, 4 * scale, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#38bdf8';
  ctx.fillRect(4 * scale, -20 * scale, 4 * scale, 2 * scale); // visor shine

  // Hair styles: short, afro, braids, bun, ponytail, dreads, bald
  ctx.fillStyle = hair;
  switch (style.hair) {
    case 'afro':
      ctx.beginPath();
      ctx.arc(0, -21 * scale, 12 * scale, 0, Math.PI * 2);
      ctx.fill();
      // redraw face over
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.arc(0, -18 * scale, 8 * scale, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'braids':
    case 'dreads':
      ctx.beginPath();
      ctx.arc(-2 * scale, -21 * scale, 10 * scale, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(-10 * scale, -20 * scale, 4 * scale, 16 * scale);
      ctx.fillRect(-6 * scale, -18 * scale, 3 * scale, 14 * scale);
      break;
    case 'ponytail':
      ctx.beginPath();
      ctx.arc(0, -21 * scale, 9 * scale, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(-12 * scale, -24 * scale, 5 * scale, 14 * scale);
      break;
    case 'bun':
      ctx.beginPath();
      ctx.arc(0, -21 * scale, 9 * scale, Math.PI, 0);
      ctx.arc(-3 * scale, -27 * scale, 5 * scale, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'bald':
      break;
    default: // short
      ctx.beginPath();
      ctx.arc(0, -21 * scale, 9.5 * scale, Math.PI, 0);
      ctx.fill();
      break;
  }

  // Hat styles: cap, beanie, tophat, crown
  if (style.hat && style.hat !== 'none') {
    switch (style.hat) {
      case 'crown':
        ctx.fillStyle = '#facc15';
        ctx.beginPath();
        ctx.moveTo(-8 * scale, -26 * scale);
        ctx.lineTo(-4 * scale, -32 * scale);
        ctx.lineTo(0, -27 * scale);
        ctx.lineTo(4 * scale, -32 * scale);
        ctx.lineTo(8 * scale, -26 * scale);
        ctx.closePath();
        ctx.fill();
        break;
      case 'beanie':
        ctx.fillStyle = '#e11d48';
        ctx.beginPath();
        ctx.arc(0, -22 * scale, 9 * scale, Math.PI, 0);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(0, -30 * scale, 3 * scale, 0, Math.PI * 2);
        ctx.fill();
        break;
      case 'tophat':
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(-11 * scale, -25 * scale, 22 * scale, 3 * scale);
        ctx.fillRect(-7 * scale, -35 * scale, 14 * scale, 10 * scale);
        ctx.fillStyle = '#e11d48';
        ctx.fillRect(-7 * scale, -27 * scale, 14 * scale, 2 * scale);
        break;
      case 'cap':
        ctx.fillStyle = '#2563eb';
        ctx.beginPath();
        ctx.arc(0, -22 * scale, 9 * scale, Math.PI, 0);
        ctx.fill();
        ctx.fillRect(0, -24 * scale, 13 * scale, 3 * scale);
        break;
    }
  }

  // Accessories: glasses, earrings, beard, scarf, backpack
  if (style.accessory && style.accessory !== 'none') {
    switch (style.accessory) {
      case 'glasses':
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 1.5 * scale;
        ctx.strokeRect(1 * scale, -20 * scale, 4 * scale, 4 * scale);
        ctx.strokeRect(6 * scale, -20 * scale, 4 * scale, 4 * scale);
        break;
      case 'scarf':
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(-8 * scale, -9 * scale, 16 * scale, 5 * scale);
        ctx.fillRect(-6 * scale, -4 * scale, 4 * scale, 10 * scale);
        break;
      case 'beard':
        ctx.fillStyle = hair;
        ctx.beginPath();
        ctx.arc(2 * scale, -13 * scale, 5 * scale, 0, Math.PI);
        ctx.fill();
        break;
    }
  }

  ctx.restore();
}

// --- Main Game Engine ---
class CosmicSurgeGame {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.state = 'START'; // START, PLAYING, GAMEOVER

    this.score = 0;
    this.wave = 1;
    this.crystals = 0;
    this.combo = 1.0;
    this.comboTimer = 0;
    this.surgeEnergy = 0; // 0 to 100
    this.isSurging = false;
    this.surgeTimeLeft = 0;

    // Powerups
    this.hasShield = false;
    this.magnetTimer = 0;
    this.chronoTimer = 0;

    // Player vessel
    this.player = {
      x: 100,
      y: 200,
      vx: 0,
      vy: 0,
      radius: 20,
      tilt: 0,
    };

    // World collections
    this.stars = [];
    this.hazards = [];
    this.pickups = [];
    this.particles = [];
    this.floatingTexts = [];

    // Timing
    this.lastTime = 0;
    this.spawnTimer = 0;
    this.waveProgress = 0;

    // Input
    this.keys = {};
    this.touchActive = false;
    this.touchTarget = { x: 100, y: 200 };

    this.initCanvasSize();
    this.initStars();
    this.bindEvents();
    requestAnimationFrame((t) => this.loop(t));
  }

  initCanvasSize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = this.width;
    this.canvas.height = this.height;
  }

  initStars() {
    this.stars = [];
    const count = Math.min(180, Math.floor((this.width * this.height) / 5000));
    for (let i = 0; i < count; i++) {
      this.stars.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        size: Math.random() * 2 + 0.6,
        speed: Math.random() * 2 + 0.5,
        layer: Math.floor(Math.random() * 3),
        brightness: Math.random(),
      });
    }
  }

  bindEvents() {
    window.addEventListener('resize', () => {
      this.initCanvasSize();
      this.initStars();
    });

    window.addEventListener('keydown', (e) => {
      this.keys[e.key.toLowerCase()] = true;
      if (e.key === ' ' && this.state === 'PLAYING') {
        this.activateSurge();
      }
    });

    window.addEventListener('keyup', (e) => {
      this.keys[e.key.toLowerCase()] = false;
    });

    // Touch controls
    this.canvas.addEventListener('pointerdown', (e) => {
      this.touchActive = true;
      this.touchTarget.x = e.clientX;
      this.touchTarget.y = e.clientY;
    });

    this.canvas.addEventListener('pointermove', (e) => {
      if (this.touchActive) {
        this.touchTarget.x = e.clientX;
        this.touchTarget.y = e.clientY;
      }
    });

    window.addEventListener('pointerup', () => {
      this.touchActive = false;
    });

    // Mobile surge button
    const mobileSurge = document.getElementById('mobile-surge-btn');
    if (mobileSurge) {
      mobileSurge.addEventListener('click', () => {
        if (this.state === 'PLAYING') this.activateSurge();
      });
    }

    // UI Buttons
    document.getElementById('btn-start').onclick = () => this.start();
    document.getElementById('btn-restart').onclick = () => this.start();
    document.getElementById('btn-leaderboard').onclick = () => showLeaderboard();
    document.getElementById('btn-open-board').onclick = () => showLeaderboard();
    document.getElementById('btn-modal-board').onclick = () => showLeaderboard();
    document.getElementById('btn-close-board').onclick = () => {
      document.getElementById('leaderboard-modal').classList.add('hidden');
    };
    document.getElementById('btn-audio').onclick = () => sound.toggle();
    document.getElementById('btn-help').onclick = () => {
      alert("HOW TO PLAY COSMIC SURGE:\n\n• Use WASD / Arrow Keys or Touch to fly.\n• Collect Star Crystals for points & surge energy.\n• Press SPACE or Tap SURGE when meter is full to blast invincibly!\n• Grab Shields, Magnets & Chrono-Warps.\n• High scores save automatically to start.ng leaderboard!");
    };
  }

  start() {
    document.getElementById('start-overlay').classList.add('hidden');
    document.getElementById('gameover-overlay').classList.add('hidden');
    document.getElementById('hud').classList.remove('hidden');
    document.getElementById('mobile-controls').classList.remove('hidden');

    this.state = 'PLAYING';
    this.score = 0;
    this.wave = 1;
    this.crystals = 0;
    this.combo = 1.0;
    this.comboTimer = 0;
    this.surgeEnergy = 20; // starter surge
    this.isSurging = false;
    this.surgeTimeLeft = 0;
    this.hasShield = true; // start with 1 complimentary shield
    this.magnetTimer = 0;
    this.chronoTimer = 0;

    this.player.x = 120;
    this.player.y = this.height / 2;
    this.player.vx = 0;
    this.player.vy = 0;

    this.hazards = [];
    this.pickups = [];
    this.particles = [];
    this.floatingTexts = [];
    this.waveProgress = 0;
    this.lastTime = performance.now();

    sound.playPowerup();
    this.updateHUD();
  }

  activateSurge() {
    if (this.surgeEnergy >= 100 && !this.isSurging) {
      this.isSurging = true;
      this.surgeTimeLeft = 5.0; // 5 seconds of hyper surge
      this.surgeEnergy = 0;
      sound.playSurgeActivate();
      this.addFloatingText(this.player.x, this.player.y - 30, 'HYPER SURGE!', '#ec4899');
    }
  }

  gameOver(reason = 'Hull breached by cosmic hazard') {
    if (this.state !== 'PLAYING') return;
    this.state = 'GAMEOVER';

    sound.playExplosion();

    // Particle explosion for player
    for (let i = 0; i < 40; i++) {
      this.particles.push({
        x: this.player.x,
        y: this.player.y,
        vx: (Math.random() - 0.5) * 12,
        vy: (Math.random() - 0.5) * 12,
        size: Math.random() * 6 + 2,
        color: ['#06b6d4', '#ec4899', '#facc15', '#ffffff'][Math.floor(Math.random() * 4)],
        alpha: 1,
        life: 0.8,
      });
    }

    document.getElementById('hud').classList.add('hidden');
    document.getElementById('mobile-controls').classList.add('hidden');
    document.getElementById('gameover-reason').textContent = reason;
    document.getElementById('final-score').textContent = Math.floor(this.score).toLocaleString();
    document.getElementById('final-wave').textContent = this.wave;
    document.getElementById('final-crystals').textContent = this.crystals.toLocaleString();
    document.getElementById('gameover-overlay').classList.remove('hidden');

    submitScore(this.score, this.wave, this.crystals);
  }

  updateHUD() {
    document.getElementById('hud-score').textContent = Math.floor(this.score).toLocaleString();
    document.getElementById('hud-wave').textContent = this.wave;
    document.getElementById('hud-crystals').textContent = this.crystals;
    document.getElementById('hud-mult').textContent = `x${this.combo.toFixed(1)}`;

    const surgeFill = document.getElementById('surge-fill');
    surgeFill.style.width = `${Math.min(100, this.surgeEnergy)}%`;
    if (this.surgeEnergy >= 100) {
      surgeFill.classList.add('surge-ready');
    } else {
      surgeFill.classList.remove('surge-ready');
    }

    // Buffs
    const buffsEl = document.getElementById('hud-buffs');
    buffsEl.innerHTML = '';
    if (this.hasShield) {
      buffsEl.innerHTML += '<div class="buff-badge">🛡️ SHIELD READY</div>';
    }
    if (this.magnetTimer > 0) {
      buffsEl.innerHTML += `<div class="buff-badge" style="border-color:#06b6d4">🧲 MAGNET (${Math.ceil(this.magnetTimer)}s)</div>`;
    }
    if (this.chronoTimer > 0) {
      buffsEl.innerHTML += `<div class="buff-badge" style="border-color:#facc15">⏳ CHRONO (${Math.ceil(this.chronoTimer)}s)</div>`;
    }
    if (this.isSurging) {
      buffsEl.innerHTML += `<div class="buff-badge" style="border-color:#ec4899; animation:pulse-ready 0.5s infinite alternate">⚡ SURGE ACTIVE (${Math.ceil(this.surgeTimeLeft)}s)</div>`;
    }
  }

  addFloatingText(x, y, text, color = '#ffffff') {
    this.floatingTexts.push({ x, y, text, color, alpha: 1, vy: -1.5 });
  }

  loop(currentTime) {
    const dt = Math.min((currentTime - this.lastTime) / 1000, 0.1);
    this.lastTime = currentTime;

    this.update(dt);
    this.render();

    requestAnimationFrame((t) => this.loop(t));
  }

  update(dt) {
    // Background star movement
    const warpMult = this.isSurging ? 3.5 : 1.0;
    this.stars.forEach((s) => {
      s.x -= (s.speed + (s.layer * 1.5)) * 60 * dt * warpMult;
      if (s.x < 0) {
        s.x = this.width;
        s.y = Math.random() * this.height;
      }
    });

    if (this.state !== 'PLAYING') return;

    // Score accumulation
    this.score += 25 * dt * this.combo * (this.isSurging ? 3 : 1);
    this.waveProgress += dt;
    if (this.waveProgress > 30) {
      this.waveProgress = 0;
      this.wave++;
      this.addFloatingText(this.width / 2, 160, `ENTERING SECTOR ${this.wave}`, '#06b6d4');
      sound.playPowerup();
    }

    // Combo timer decay
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.combo = 1.0;
      }
    }

    // Timers
    if (this.isSurging) {
      this.surgeTimeLeft -= dt;
      if (this.surgeTimeLeft <= 0) {
        this.isSurging = false;
      }
    }

    if (this.magnetTimer > 0) this.magnetTimer -= dt;
    if (this.chronoTimer > 0) this.chronoTimer -= dt;

    // Player Movement
    const speed = this.isSurging ? 500 : 380;
    let targetVx = 0;
    let targetVy = 0;

    if (this.keys['arrowup'] || this.keys['w']) targetVy -= speed;
    if (this.keys['arrowdown'] || this.keys['s']) targetVy += speed;
    if (this.keys['arrowleft'] || this.keys['a']) targetVx -= speed;
    if (this.keys['arrowright'] || this.keys['d']) targetVx += speed;

    if (this.touchActive) {
      const dx = this.touchTarget.x - this.player.x;
      const dy = this.touchTarget.y - this.player.y;
      const dist = Math.hypot(dx, dy);
      if (dist > 15) {
        targetVx = (dx / dist) * speed;
        targetVy = (dy / dist) * speed;
      }
    }

    this.player.vx += (targetVx - this.player.vx) * 12 * dt;
    this.player.vy += (targetVy - this.player.vy) * 12 * dt;

    this.player.x += this.player.vx * dt;
    this.player.y += this.player.vy * dt;

    // Clamping to screen boundaries
    this.player.x = Math.max(30, Math.min(this.width - 30, this.player.x));
    this.player.y = Math.max(80, Math.min(this.height - 30, this.player.y));

    // Player tilt
    this.player.tilt = (this.player.vy / speed) * 0.25;

    // Engine exhaust particles
    if (Math.random() < 0.8) {
      this.particles.push({
        x: this.player.x - 22,
        y: this.player.y + 12 + (Math.random() - 0.5) * 4,
        vx: -Math.random() * 120 - 80,
        vy: (Math.random() - 0.5) * 20,
        size: Math.random() * 4 + 2,
        color: this.isSurging ? '#ec4899' : '#06b6d4',
        alpha: 0.9,
        life: 0.35,
      });
    }

    // Spawning Hazards & Pickups
    this.spawnTimer += dt;
    const spawnRate = Math.max(0.45, 1.2 - this.wave * 0.08);
    if (this.spawnTimer >= spawnRate) {
      this.spawnTimer = 0;
      this.spawnEntities();
    }

    // Update Hazards
    const hazardSpeedMult = (this.chronoTimer > 0 ? 0.45 : 1.0) * (1 + (this.wave - 1) * 0.08);
    for (let i = this.hazards.length - 1; i >= 0; i--) {
      const h = this.hazards[i];
      h.x -= h.vx * hazardSpeedMult * dt;
      h.y += h.vy * hazardSpeedMult * dt;
      h.rot += h.rotSpeed * dt;

      // Check collision with player
      const dist = Math.hypot(h.x - this.player.x, h.y - this.player.y);
      if (dist < h.radius + this.player.radius) {
        if (this.isSurging) {
          // Vaporize hazard in surge!
          sound.playExplosion();
          this.score += 350;
          this.addFloatingText(h.x, h.y, '+350 VAPORIZED', '#ec4899');
          this.hazards.splice(i, 1);
          continue;
        } else if (this.hasShield) {
          // Shield absorbs blow
          this.hasShield = false;
          sound.playShieldHit();
          this.addFloatingText(this.player.x, this.player.y - 25, 'SHIELD BROKEN!', '#38bdf8');
          this.hazards.splice(i, 1);
          continue;
        } else {
          this.gameOver('Vessel obliterated by high-velocity space hazard');
          return;
        }
      }

      if (h.x + h.radius < -50) {
        this.hazards.splice(i, 1);
      }
    }

    // Update Pickups
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.x -= p.speed * dt;

      // Magnet attraction
      if (this.magnetTimer > 0) {
        const dx = this.player.x - p.x;
        const dy = this.player.y - p.y;
        const dist = Math.hypot(dx, dy);
        if (dist < 320) {
          p.x += (dx / dist) * 360 * dt;
          p.y += (dy / dist) * 360 * dt;
        }
      }

      const dist = Math.hypot(p.x - this.player.x, p.y - this.player.y);
      if (dist < p.radius + this.player.radius + 6) {
        // Collect!
        if (p.type === 'crystal') {
          sound.playCrystal();
          this.crystals++;
          this.combo = Math.min(8.0, this.combo + 0.2);
          this.comboTimer = 3.5;
          this.surgeEnergy = Math.min(100, this.surgeEnergy + 8);
          const pts = Math.floor(100 * this.combo);
          this.score += pts;
          this.addFloatingText(p.x, p.y, `+${pts}`, '#06b6d4');
        } else if (p.type === 'shield') {
          sound.playPowerup();
          this.hasShield = true;
          this.addFloatingText(p.x, p.y, 'SHIELD RESTORED!', '#38bdf8');
        } else if (p.type === 'magnet') {
          sound.playPowerup();
          this.magnetTimer = 8.0;
          this.addFloatingText(p.x, p.y, 'MAGNET SURGE 8s!', '#06b6d4');
        } else if (p.type === 'chrono') {
          sound.playPowerup();
          this.chronoTimer = 6.0;
          this.addFloatingText(p.x, p.y, 'TIME DILATION 6s!', '#facc15');
        }
        this.pickups.splice(i, 1);
        continue;
      }

      if (p.x + p.radius < -30) {
        this.pickups.splice(i, 1);
      }
    }

    // Update Particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const part = this.particles[i];
      part.x += part.vx * dt;
      part.y += part.vy * dt;
      part.alpha -= dt / part.life;
      if (part.alpha <= 0) {
        this.particles.splice(i, 1);
      }
    }

    // Update Floating Text
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.y += ft.vy;
      ft.alpha -= dt * 1.2;
      if (ft.alpha <= 0) {
        this.floatingTexts.splice(i, 1);
      }
    }

    this.updateHUD();
  }

  spawnEntities() {
    const y = Math.random() * (this.height - 140) + 90;

    // 70% hazard, 30% crystal/powerup
    if (Math.random() < 0.65) {
      // Spawn asteroid or plasma gate
      const isComet = Math.random() < 0.25;
      const radius = isComet ? 14 : Math.random() * 22 + 16;
      this.hazards.push({
        x: this.width + 60,
        y,
        vx: isComet ? 420 : Math.random() * 120 + 200,
        vy: (Math.random() - 0.5) * 60,
        radius,
        rot: 0,
        rotSpeed: (Math.random() - 0.5) * 3,
        isComet,
        color: isComet ? '#f97316' : '#64748b',
      });
    } else {
      // Spawn Pickup
      const roll = Math.random();
      let type = 'crystal';
      let color = '#06b6d4';

      if (roll < 0.12 && !this.hasShield) {
        type = 'shield';
        color = '#38bdf8';
      } else if (roll < 0.22) {
        type = 'magnet';
        color = '#a855f7';
      } else if (roll < 0.32) {
        type = 'chrono';
        color = '#facc15';
      }

      this.pickups.push({
        x: this.width + 40,
        y,
        speed: 180,
        radius: type === 'crystal' ? 12 : 16,
        type,
        color,
        pulse: Math.random() * Math.PI,
      });
    }
  }

  render() {
    this.ctx.fillStyle = '#070913';
    this.ctx.fillRect(0, 0, this.width, this.height);

    // Draw background nebula clouds
    this.renderNebula();

    // Draw Stars
    this.renderStars();

    // Draw Pickups
    this.renderPickups();

    // Draw Hazards
    this.renderHazards();

    // Draw Particles
    this.renderParticles();

    // Draw Player Vessel (only if playing or start)
    if (this.state === 'PLAYING') {
      this.renderPlayer();
    }

    // Draw Floating Texts
    this.renderFloatingTexts();
  }

  renderNebula() {
    const grad = this.ctx.createRadialGradient(
      this.width * 0.7, this.height * 0.4, 80,
      this.width * 0.7, this.height * 0.4, this.width * 0.6
    );
    const waveHue = (this.wave * 45) % 360;
    grad.addColorStop(0, `hsla(${waveHue}, 80%, 45%, 0.15)`);
    grad.addColorStop(0.6, `hsla(${(waveHue + 60) % 360}, 80%, 30%, 0.08)`);
    grad.addColorStop(1, 'transparent');
    this.ctx.fillStyle = grad;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  renderStars() {
    this.ctx.save();
    for (const s of this.stars) {
      this.ctx.fillStyle = s.layer === 2 ? '#ffffff' : (s.layer === 1 ? '#93c5fd' : '#c084fc');
      this.ctx.globalAlpha = 0.4 + s.brightness * 0.6;
      this.ctx.beginPath();
      this.ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.restore();
  }

  renderPickups() {
    this.ctx.save();
    for (const p of this.pickups) {
      p.pulse += 0.06;
      const glow = Math.sin(p.pulse) * 3 + 6;

      this.ctx.shadowBlur = glow;
      this.ctx.shadowColor = p.color;
      this.ctx.fillStyle = p.color;

      if (p.type === 'crystal') {
        // Prismatic diamond crystal
        this.ctx.beginPath();
        this.ctx.moveTo(p.x, p.y - p.radius);
        this.ctx.lineTo(p.x + p.radius * 0.8, p.y);
        this.ctx.lineTo(p.x, p.y + p.radius);
        this.ctx.lineTo(p.x - p.radius * 0.8, p.y);
        this.ctx.closePath();
        this.ctx.fill();
      } else {
        // Orb with powerup icon
        this.ctx.beginPath();
        this.ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        this.ctx.fill();

        this.ctx.shadowBlur = 0;
        this.ctx.fillStyle = '#070913';
        this.ctx.font = 'bold 12px sans-serif';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        const icon = p.type === 'shield' ? '🛡️' : (p.type === 'magnet' ? '🧲' : '⏳');
        this.ctx.fillText(icon, p.x, p.y);
      }
    }
    this.ctx.restore();
  }

  renderHazards() {
    this.ctx.save();
    for (const h of this.hazards) {
      this.ctx.save();
      this.ctx.translate(h.x, h.y);
      this.ctx.rotate(h.rot);

      if (h.isComet) {
        // Fiery streaking comet
        this.ctx.shadowBlur = 15;
        this.ctx.shadowColor = '#f97316';
        this.ctx.fillStyle = '#fb923c';
        this.ctx.beginPath();
        this.ctx.arc(0, 0, h.radius, 0, Math.PI * 2);
        this.ctx.fill();
        // Tail
        this.ctx.fillStyle = 'rgba(249, 115, 22, 0.4)';
        this.ctx.beginPath();
        this.ctx.moveTo(0, -h.radius * 0.8);
        this.ctx.lineTo(40, 0);
        this.ctx.lineTo(0, h.radius * 0.8);
        this.ctx.fill();
      } else {
        // Rocky jagged asteroid
        this.ctx.fillStyle = '#334155';
        this.ctx.strokeStyle = '#64748b';
        this.ctx.lineWidth = 2;
        this.ctx.beginPath();
        const pts = 7;
        for (let i = 0; i < pts; i++) {
          const angle = (i / pts) * Math.PI * 2;
          const r = h.radius * (0.8 + 0.3 * Math.sin(i * 3));
          const px = Math.cos(angle) * r;
          const py = Math.sin(angle) * r;
          if (i === 0) this.ctx.moveTo(px, py);
          else this.ctx.lineTo(px, py);
        }
        this.ctx.closePath();
        this.ctx.fill();
        this.ctx.stroke();

        // Crater fissure
        this.ctx.fillStyle = '#1e293b';
        this.ctx.beginPath();
        this.ctx.arc(-h.radius * 0.3, -h.radius * 0.2, h.radius * 0.25, 0, Math.PI * 2);
        this.ctx.fill();
      }

      this.ctx.restore();
    }
    this.ctx.restore();
  }

  renderPlayer() {
    this.ctx.save();
    this.ctx.translate(this.player.x, this.player.y);
    this.ctx.rotate(this.player.tilt);

    // Hyper surge glow aura
    if (this.isSurging) {
      this.ctx.shadowBlur = 30;
      this.ctx.shadowColor = '#ec4899';
      this.ctx.strokeStyle = '#ec4899';
      this.ctx.lineWidth = 4;
      this.ctx.beginPath();
      this.ctx.arc(0, 0, this.player.radius * 1.8, 0, Math.PI * 2);
      this.ctx.stroke();
    }

    // Shield Aura
    if (this.hasShield) {
      this.ctx.shadowBlur = 18;
      this.ctx.shadowColor = '#38bdf8';
      this.ctx.strokeStyle = 'rgba(56, 189, 248, 0.7)';
      this.ctx.lineWidth = 2.5;
      this.ctx.beginPath();
      this.ctx.arc(0, 0, this.player.radius * 1.4, 0, Math.PI * 2);
      this.ctx.stroke();
    }

    // Render character via offscreen canvas or custom draw
    const charCanvas = document.createElement('canvas');
    charCanvas.width = 64;
    charCanvas.height = 64;
    drawCharacterAvatar(charCanvas, currentPlayer.style, false);
    this.ctx.drawImage(charCanvas, -32, -32);

    this.ctx.restore();
  }

  renderParticles() {
    this.ctx.save();
    for (const p of this.particles) {
      this.ctx.globalAlpha = Math.max(0, p.alpha);
      this.ctx.fillStyle = p.color;
      this.ctx.beginPath();
      this.ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      this.ctx.fill();
    }
    this.ctx.restore();
  }

  renderFloatingTexts() {
    this.ctx.save();
    this.ctx.font = 'bold 15px var(--font-mono), sans-serif';
    this.ctx.textAlign = 'center';
    for (const ft of this.floatingTexts) {
      this.ctx.globalAlpha = Math.max(0, ft.alpha);
      this.ctx.fillStyle = ft.color;
      this.ctx.shadowBlur = 8;
      this.ctx.shadowColor = ft.color;
      this.ctx.fillText(ft.text, ft.x, ft.y);
    }
    this.ctx.restore();
  }
}

// Boot game & player
window.addEventListener('DOMContentLoaded', () => {
  initPlayer();
  window.gameInstance = new CosmicSurgeGame();
});
