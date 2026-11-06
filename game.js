'use strict';

/**
 * BIBLIÁN JETPACK — motor de juego (HTML5 Canvas 2D, ilustración HD).
 *
 * El mundo se simula en "unidades de mundo" con una altura lógica fija (WORLD_H)
 * y se dibuja directamente a la resolución nativa de la pantalla (con devicePixelRatio)
 * y suavizado de alta calidad, para que los fondos de Biblián y el personaje se vean nítidos.
 * Si la pantalla es estrecha (móvil vertical) se garantiza un ancho visible mínimo
 * (MIN_VIEW_W) para conservar el tiempo de reacción ante los obstáculos.
 */
(() => {
  // =====================================================================
  // CONFIGURACIÓN
  // =====================================================================
  const CONFIG = {
    WORLD_H: 540,
    MIN_VIEW_W: 640,
    CEILING_Y: 30,
    GROUND_Y: 462,

    GRAVITY: 1860,
    THRUST: 4800,
    THRUST_RESPONSE: 10,
    AIR_DRAG: 0.6,
    MAX_RISE: 560,
    MAX_FALL: 780,

    // Dificultad progresiva: arranca lento y sube con el tiempo vivo y los focos recogidos.
    BASE_SPEED: 250,
    MAX_SPEED: 560,
    RAMP_SECONDS: 180, // segundos vivo que, por sí solos, llevan a la dificultad máxima
    RAMP_LIGHTBULBS: 400, // focos que, por sí solos, llevan a la dificultad máxima
    GAP_EASY: 1.9, // segundos entre obstáculos al empezar
    GAP_HARD: 1.05, // segundos entre obstáculos en la dificultad máxima
    SPEED_LERP: 1.5,
    PX_PER_METER: 24,

    PHYSICS_STEP: 1 / 120,
    MAX_FRAME_DT: 1 / 20,

    LIGHTBULB_R: 13,
    LIGHTBULB_SPACING: 34,
    ZAPPER_R: 10,
    NODE_R: 14,

    MAX_PARTICLES: 700,
    STORAGE_KEY: 'biblian-jetpack:record-kw',
    MUTE_KEY: 'biblian-jetpack:muted',
    // Cambiar el sufijo al vaciar la tabla del servidor: cada aparato olvida su último puntaje guardado.
    BOARD_KEY: 'biblian-jetpack:leaderboard:2',
    PROFILE_KEY: 'biblian-jetpack:player-profile:2',
    BOARD_SIZE: 10,
  };

  // Datos de la campaña: al cambiar estos valores se actualizan el juego, la pantalla final
  // y la imagen para compartir.
  const CAMPAIGN = {
    gameName: 'BIBLIÁN JETPACK',
    slogan: '¡Juntos iluminamos Biblián!',
    hashtag: '#IluminaBiblián',
    shareUrl: '', // vacío = dirección actual de la página
    lightGoalKw: 100, // energía necesaria para iluminar Biblián al 100 %
    // Aviso de privacidad: completar con los datos reales antes de difundir el juego.
    privacyOwner: '[Nombre de la organización o persona responsable de la campaña]',
    privacyContact: '[correo o WhatsApp para pedir ver, corregir o borrar datos]',
    privacyUntil: '[fecha en que se borrarán los datos, p. ej. 30 días después de la elección]',
    privacyVersion: '2026-11-03',
  };

  // Deben coincidir con PARISHES en server.py.
  const PARISHES = ['Centro Urbano', 'Nazón', 'San Francisco de Sageo', 'Turupamba', 'Jerusalén'];

  const ASSETS = {
    far: 'assets/bg_far.jpg',
    sanctuary: 'assets/santuario.png',
    town: 'assets/biblian_casas.png',
    player: 'assets/jugador.png',
    train: 'assets/tren.png',
    obelisk: 'assets/obelisco.png',
    letters: 'assets/letras.png',
    tunnel: 'assets/tunel.png',
    market: 'assets/mercado.png',
    iglesia: 'assets/iglesia.png',
    lightbulb: 'assets/foco.png',
    lista2: 'assets/logo_lista2.png',
    lista4: 'assets/logo_lista4.jpg',
    fanBoy: 'assets/crowd/crowd_boy.png',
    fanGirl: 'assets/crowd/crowd_girl.png',
    fanMan: 'assets/crowd/crowd_man.png',
    fanWoman: 'assets/crowd/crowd_woman.png',
    fanPoncho: 'assets/crowd/crowd_poncho.png',
    fanFlag: 'assets/crowd/crowd_flag.png',
    fanAbuelo: 'assets/crowd/crowd_abuelo.png',
    fanAbuela: 'assets/crowd/crowd_abuela.png',
    fanKid: 'assets/crowd/crowd_kid.png',
    fanJoven: 'assets/crowd/crowd_joven.png',
    fanBarba: 'assets/crowd/crowd_barba.png',
  };
  // Se incrementa al regenerar las imágenes para invalidar la caché del navegador.
  const ASSET_VERSION = 'hd14';

  const TAU = Math.PI * 2;
  // El fondo avanza más lento que el vuelo para que cada lugar se quede un rato en pantalla.
  const PARALLAX = { far: 0.03, sanctuary: 0.16, town: 0.3, poles: 0.5, front: 1 };
  // Los pies del piloto van en el asfalto, debajo de la acera (que termina en GROUND_Y + 22).
  const ROAD_Y = CONFIG.GROUND_Y + 40;

  // Público de la acera: personas sueltas y grupos con cartel. El texto se dibuja en el juego.
  const CROWD_KEYS = [
    'fanBoy', 'fanGirl', 'fanMan', 'fanWoman', 'fanPoncho', 'fanFlag',
    'fanAbuelo', 'fanAbuela', 'fanKid', 'fanJoven', 'fanBarba',
  ];
  const SIGN_PHRASES = [
    '¡VAMOS ZHINDÓN!',
    'BIBLIÁN CONTIGO',
    '¡SÍ SE PUEDE!',
    'ILUMINA BIBLIÁN',
    'CON ZHINDÓN',
    '¡ADELANTE!',
  ];
  const CROWD = {
    HEIGHT: 80,
    FOOT: 13,
  };
  // Altura en unidades de mundo de cada capa ilustrada y proporción ancho/alto de cada imagen.
  const LAYER_H = { far: 600, sanctuary: 400, iglesia: 268, town: 205, letters: 125, obelisk: 290, tunnel: 235, train: 104, market: 210 };
  const ASPECT = {
    town: 1058 / 420, sanctuary: 1020 / 720, iglesia: 1235 / 654, letters: 1000 / 298,
    obelisk: 600 / 739, tunnel: 960 / 704, train: 1000 / 386, market: 2597 / 737,
  };
  const layerW = (key) => LAYER_H[key] * ASPECT[key];

  // Recorrido por escenas: cada lugar emblemático aparece solo, separado del siguiente por
  // tramos de casas lo bastante largos para que nunca coincidan dos en pantalla.
  // 'T' = bloque de casas, '@x' = marca de escena (Santuario al fondo o paso del tren).
  const STREET_PLAN = [
    'T', 'T', 'T', 'T', 'T', 'T', '@sanctuary', 'T', 'T', 'T', 'T', 'T', 'T',
    'iglesia', 'T', 'T', 'T', 'T', 'T', 'T',
    'letters', 'T', 'T', 'T', 'T', 'T', 'T',
    '@train', 'T', 'T', 'T', 'T', 'T',
    'market', 'T', 'T', 'T', 'T', 'T', 'T',
    'obelisk', 'T', 'T', 'T', 'T', 'T',
    'tunnel', 'T', 'T', 'T', 'T', 'T',
  ];
  const LANDMARK_GAP = 50;
  const STREET = (() => {
    const items = [];
    const marks = {};
    let x = 0;
    let flip = false;
    for (const p of STREET_PLAN) {
      if (p[0] === '@') {
        marks[p.slice(1)] = x;
      } else if (p === 'T') {
        items.push({ key: 'town', x, w: layerW('town'), h: LAYER_H.town, flip });
        flip = !flip;
        x += layerW('town');
      } else {
        x += LANDMARK_GAP;
        items.push({ key: p, x, w: layerW(p), h: LAYER_H[p], flip: false });
        x += layerW(p) + LANDMARK_GAP;
      }
    }
      return { items, marks, period: x };
  })();
  const TRAIN_CHIMNEY = { x: 0.83, y: 0.04 };
  const POLE_SPACING = 430;
  const POLE_TOP = 270;
  const LAMP_X = 24;
  const LAMP_Y = POLE_TOP + 46;
  const SKY_TOP_COLOR = '#372172';

  // Hoja del personaje: 0-3 carrera, 4 y 6-9 vuelo, 5 y 10 caída, 11 agachado (impulso/aterrizaje).
  const PLAYER_FRAMES = { run: 0, fly: [6, 7, 8, 9], fall: [5, 10], crouch: 11 };
  const PLAYER_FRAME_COUNT = 12;
  const frameGroup = (f) => (f < 4 ? 0 : f === 4 || (f >= 6 && f <= 9) ? 1 : f === 5 || f === 10 ? 2 : 3);
  // Unidades de mundo por píxel del sprite (200 px de alto → 80 unidades).
  const PLAYER_SCALE = 0.4;
  const PLAYER_PAD = 10;
  const NOZZLE = { x: -18, y: 9 };

  const NR = CONFIG.NODE_R;
  const ZAP_MIN_Y = CONFIG.CEILING_Y + NR + 4;
  const ZAP_MAX_Y = CONFIG.GROUND_Y - NR - 2;
  const LIGHTBULB_MIN_Y = CONFIG.CEILING_Y + CONFIG.LIGHTBULB_R + 8;
  const LIGHTBULB_MAX_Y = CONFIG.GROUND_Y - CONFIG.LIGHTBULB_R - 8;

  const ZAPPER_COLORS = [
    { core: '#ff3b5c', light: '#ffb3c0', rgb: '255,59,92' },
    { core: '#3bd8ff', light: '#c4f4ff', rgb: '59,216,255' },
  ];
  const THRUST_COLORS = ['#fff7a8', '#ffe600', '#ffd000', '#7df9ff', '#ffffff', '#b8f6ff'];

  // =====================================================================
  // UTILIDADES
  // =====================================================================
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  // Lerp independiente del framerate (suavizado exponencial).
  const damp = (a, b, rate, dt) => lerp(a, b, 1 - Math.exp(-rate * dt));
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];

  function pointSegDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax;
    const dy = by - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
    return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
  }

  function pointRectDist(px, py, r) {
    const dx = Math.max(r.x - px, 0, px - (r.x + r.w));
    const dy = Math.max(r.y - py, 0, py - (r.y + r.h));
    return Math.hypot(dx, dy);
  }

  const pointInRect = (px, py, r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h;
  const cross = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

  function segsIntersect(ax, ay, bx, by, cx, cy, dx, dy) {
    const d1 = cross(cx, cy, dx, dy, ax, ay);
    const d2 = cross(cx, cy, dx, dy, bx, by);
    const d3 = cross(ax, ay, bx, by, cx, cy);
    const d4 = cross(ax, ay, bx, by, dx, dy);
    return (d1 > 0) !== (d2 > 0) && (d3 > 0) !== (d4 > 0);
  }

  // Distancia exacta entre un segmento y un rectángulo alineado a ejes.
  function segRectDist(ax, ay, bx, by, r) {
    if (pointInRect(ax, ay, r) || pointInRect(bx, by, r)) return 0;
    const x1 = r.x, y1 = r.y, x2 = r.x + r.w, y2 = r.y + r.h;
    if (
      segsIntersect(ax, ay, bx, by, x1, y1, x2, y1) ||
      segsIntersect(ax, ay, bx, by, x2, y1, x2, y2) ||
      segsIntersect(ax, ay, bx, by, x2, y2, x1, y2) ||
      segsIntersect(ax, ay, bx, by, x1, y2, x1, y1)
    ) return 0;
    return Math.min(
      pointRectDist(ax, ay, r),
      pointRectDist(bx, by, r),
      pointSegDist(x1, y1, ax, ay, bx, by),
      pointSegDist(x2, y1, ax, ay, bx, by),
      pointSegDist(x2, y2, ax, ay, bx, by),
      pointSegDist(x1, y2, ax, ay, bx, by)
    );
  }

  // =====================================================================
  // DOM Y LIENZOS
  // =====================================================================
  const $ = (id) => document.getElementById(id);
  const canvas = $('gameCanvas');
  const mainCtx = canvas.getContext('2d', { alpha: false });
  // Contexto de dibujo activo: apunta a fxCtx mientras se dibuja un grupo que se filtrará junto.
  let ctx = mainCtx;
  const CAN_FILTER = typeof ctx.filter === 'string';
  // Capa auxiliar del tamaño del lienzo para aplicar el filtro de "ciudad apagada" una sola vez
  // por grupo: un drawImage con filtro por cada casa o persona es carísimo en móviles.
  const fxCanvas = document.createElement('canvas');
  const fxCtx = fxCanvas.getContext('2d');

  const dom = {
    root: $('game'),
    energy: $('energyValue'),
    distance: $('distanceValue'),
    record: $('recordValue'),
    toast: $('toast'),
    startScreen: $('startScreen'),
    startRecord: $('startRecord'),
    overScreen: $('gameOverScreen'),
    goDistance: $('goDistance'),
    goEnergy: $('goEnergy'),
    goRecord: $('goRecord'),
    goBadge: $('goNewRecord'),
    goLight: $('goLight'),
    goSlogan: $('goSlogan'),
    retry: $('retryButton'),
    share: $('shareButton'),
    sound: $('soundButton'),
    lightValue: $('lightValue'),
    lightFill: $('lightFill'),
    boardList: $('leaderboardList'),
    scoreForm: $('scoreForm'),
    scoreName: $('scoreName'),
    scorePhone: $('scorePhone'),
    parishField: $('parishField'),
    scoreParish: $('scoreParish'),
    consentPrize: $('consentPrize'),
    privacy: $('privacy'),
    scoreError: $('scoreError'),
    scoreNote: $('scoreNote'),
    saveScore: $('saveScoreButton'),
    promo: $('promoVideo'),
    promoPlayer: $('promoPlayer'),
    promoUnmute: $('promoUnmute'),
    promoActions: $('promoActions'),
    promoMore: $('promoMore'),
    promoReplay: $('promoReplay'),
  };

  // =====================================================================
  // RECURSOS GRÁFICOS
  // =====================================================================
  const images = {};
  for (const [key, src] of Object.entries(ASSETS)) {
    const img = new Image();
    img.decoding = 'async';
    img.src = `${src}?v=${ASSET_VERSION}`;
    images[key] = img;
  }
  images.player.addEventListener('load', buildShockSprite);
  const ready = (img) => !!img && ((img.complete && img.naturalWidth > 0) || (img.width > 0 && img.height > 0));

  let shockSprite = null;

  // Silueta eléctrica del personaje para el destello al electrocutarse.
  function buildShockSprite() {
    const src = images.player;
    const c = document.createElement('canvas');
    c.width = src.naturalWidth;
    c.height = src.naturalHeight;
    const g = c.getContext('2d');
    g.drawImage(src, 0, 0);
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = '#c8fbff';
    g.fillRect(0, 0, c.width, c.height);
    shockSprite = c;
  }

  // Lado del sprite del foco en unidades de mundo (incluye margen para el resplandor).
  const LIGHTBULB_SIZE = Math.round(CONFIG.LIGHTBULB_R * 3.4);

  // Foco encendido dibujado a mano: se usa mientras assets/foco.png no exista o no haya cargado.
  // Las medidas están en una cuadrícula de 48 × 48 con el centro en (0, 0).
  function drawLightbulbShape(g, size) {
    const u = size / 48;
    g.save();
    g.translate(size / 2, size / 2 - u);
    g.scale(u, u);

    const glass = g.createRadialGradient(-3, -8, 1, 0, -5, 13);
    glass.addColorStop(0, '#fffef0');
    glass.addColorStop(0.35, '#fff27a');
    glass.addColorStop(0.75, '#ffd60a');
    glass.addColorStop(1, '#f5a300');
    g.fillStyle = glass;
    // shadowBlur no se escala con la transformación: va en píxeles reales.
    g.shadowColor = 'rgba(255, 214, 60, 0.95)';
    g.shadowBlur = 7 * u;
    g.beginPath();
    g.arc(0, -5, 11, Math.PI * 0.78, Math.PI * 0.22);
    g.quadraticCurveTo(5.5, 4, 5.5, 9);
    g.lineTo(-5.5, 9);
    g.quadraticCurveTo(-5.5, 4, -8.47, 2);
    g.fill();
    g.shadowBlur = 0;

    g.strokeStyle = '#ff8a00';
    g.lineWidth = 1.3;
    g.lineJoin = 'round';
    g.beginPath();
    g.moveTo(-3, 9);
    g.lineTo(-3, -3);
    g.lineTo(-1.5, -6);
    g.lineTo(0, -3);
    g.lineTo(1.5, -6);
    g.lineTo(3, -3);
    g.lineTo(3, 9);
    g.stroke();

    g.save();
    g.rotate(-0.5);
    g.fillStyle = 'rgba(255, 255, 255, 0.7)';
    g.beginPath();
    g.ellipse(-1, -11, 2.2, 4, 0, 0, TAU);
    g.fill();
    g.restore();

    const metal = g.createLinearGradient(-5.5, 0, 5.5, 0);
    metal.addColorStop(0, '#5c6379');
    metal.addColorStop(0.4, '#e2e6f0');
    metal.addColorStop(0.7, '#8a91a8');
    metal.addColorStop(1, '#3a3f52');
    g.fillStyle = metal;
    for (let i = 0; i < 3; i++) g.fillRect(-5.5, 9 + i * 2.2, 11, 1.8);
    g.fillStyle = '#2a2d3a';
    g.beginPath();
    g.moveTo(-3.5, 15.6);
    g.lineTo(3.5, 15.6);
    g.lineTo(1.6, 18);
    g.lineTo(-1.6, 18);
    g.fill();
    g.restore();
  }

  function makeLightbulbSprite(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const img = images.lightbulb;
    if (ready(img)) {
      const fit = (size * 0.78) / Math.max(img.naturalWidth, img.naturalHeight);
      const w = img.naturalWidth * fit;
      const h = img.naturalHeight * fit;
      g.shadowColor = 'rgba(255, 214, 60, 0.9)';
      g.shadowBlur = size * 0.12;
      g.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
    } else {
      drawLightbulbShape(g, size);
    }
    return c;
  }

  let lightbulbSprite = null;

  function buildLightbulbSprite() {
    lightbulbSprite = makeLightbulbSprite(Math.max(24, Math.ceil(LIGHTBULB_SIZE * view.scale * view.dpr)));
  }
  images.lightbulb.addEventListener('load', buildLightbulbSprite);

  function makeGlowSprite(size, rgb, alpha) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const g = c.getContext('2d');
    const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grd.addColorStop(0, `rgba(${rgb}, ${alpha})`);
    grd.addColorStop(1, `rgba(${rgb}, 0)`);
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
    return c;
  }

  const lightbulbGlow = makeGlowSprite(64, '255, 214, 60', 0.45);
  const thrustGlow = makeGlowSprite(64, '255, 230, 120', 0.7);
  const collectGlow = makeGlowSprite(128, '255, 220, 90', 0.55);

  // Degradados reutilizables (se interpretan en el sistema de coordenadas local de cada dibujo).
  const metalGrad = ctx.createLinearGradient(-6, 0, 6, 0);
  metalGrad.addColorStop(0, '#2f3344');
  metalGrad.addColorStop(0.35, '#a6aec6');
  metalGrad.addColorStop(0.6, '#5c6379');
  metalGrad.addColorStop(1, '#24263a');

  const poleGrad = ctx.createLinearGradient(-5, 0, 5, 0);
  poleGrad.addColorStop(0, '#1d1830');
  poleGrad.addColorStop(0.35, '#5d5578');
  poleGrad.addColorStop(1, '#1d1830');

  for (const c of ZAPPER_COLORS) {
    c.halo = `rgba(${c.rgb}, 0.25)`;
    c.beamWide = `rgba(${c.rgb}, 0.16)`;
    c.beamCore = `rgba(${c.rgb}, 0.32)`;
    c.orb = ctx.createRadialGradient(-3, -3, 0, 0, 0, 9);
    c.orb.addColorStop(0, '#ffffff');
    c.orb.addColorStop(0.35, c.light);
    c.orb.addColorStop(1, c.core);
  }

  // =====================================================================
  // ESTADO
  // =====================================================================
  const view = {
    cssW: 1, cssH: 1, dpr: 1,
    scale: 1,
    // Transformación mundo → píxel físico del frame actual: x_px = x * k + tx (tx/ty incluyen el temblor).
    k: 1, tx: 0, ty: 0,
    w: CONFIG.MIN_VIEW_W,
    offsetY: 0,
    top: 0, bottom: CONFIG.WORLD_H,
  };

  const game = {
    state: 'menu', // menu | playing | dying | gameover
    time: 0,
    scroll: 0,
    speed: CONFIG.BASE_SPEED * 0.55,
    targetSpeed: CONFIG.BASE_SPEED,
    runDistance: 0,
    deathMeters: 0,
    energy: 0,
    record: loadRecord(),
    newRecord: false,
    speedLevel: 0,
    aliveTime: 0,
    scoreSaved: false, // evita registrar dos veces la misma partida
    runId: '', // ticket del servidor: con él valida que el puntaje sea alcanzable en el tiempo jugado
    nextSpawnX: 0,
    patternCount: 0,
    lastPattern: '',
    deathTimer: 0,
    shake: 0,
    flash: 0,
    canRestart: false,
    light: 1, // nivel de iluminación de la ciudad mostrado (suavizado)
    lightStep: 0, // último 25 % alcanzado en la partida
    lightbulbCombo: 0,
    lastLightbulbTime: -1,
  };

  const player = {
    x: 150, y: ROAD_Y - 40,
    w: 40, h: 80,
    vy: 0,
    thrust: 0,
    onGround: true,
    runPhase: 0,
    tilt: 0,
    rot: 0, vr: 0,
    emitAcc: 0, dustAcc: 0,
    landImpact: 0,
  };

  // Estado puramente visual de la animación del personaje.
  const anim = {
    frame: 0, prevFrame: 0, blend: 1, blendTime: 0.1,
    squash: 0, squashV: 0, // muelle: >0 aplastado, <0 estirado
    wasGround: true, airVy: 0,
    glow: 0,
    trailAcc: 0,
    flyPhase: 0, fallPhase: 0,
    landTimer: 0,
    flip: 0, flipQueued: 0, // voltereta de celebración cada 100 m
  };
  // Pools de entidades: las activas son items[0..count). Al retirar una se intercambia con la
  // última activa y su objeto se reutiliza en el siguiente spawn, así la partida no genera basura
  // para el recolector (que en móviles de gama baja provoca tirones).
  function createPool(make, prewarm) {
    const pool = { items: [], count: 0, make };
    for (let i = 0; i < prewarm; i++) pool.items.push(make());
    return pool;
  }

  function acquire(pool) {
    if (pool.count === pool.items.length) pool.items.push(pool.make());
    return pool.items[pool.count++];
  }

  function release(pool, i) {
    const last = --pool.count;
    const freed = pool.items[i];
    pool.items[i] = pool.items[last];
    pool.items[last] = freed;
  }

  const TRAIL_MAX = 6;
  const POPUPS_MAX = 14;
  const SMOKE_MAX = 40;
  const trail = createPool(() => ({ x: 0, y: 0, frame: 0, rot: 0, life: 0, max: 0 }), TRAIL_MAX);
  const popups = createPool(() => ({ x: 0, y: 0, life: 0 }), POPUPS_MAX);

  // Tren turístico que recorre la calle de vez en cuando (coordenadas de la capa de la calle).
  const train = { active: false, x: 0, prevMark: undefined, smokeAcc: 0 };
  const smoke = createPool(() => ({ x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 0, r: 0 }), SMOKE_MAX);

  const lightbulbs = createPool(() => ({ x: 0, y: 0, phase: 0 }), 160);
  const zappers = createPool(() => ({
    x: 0, y: 0, len: 0, angle: 0, spin: 0, color: null, ax: 0, ay: 0, bx: 0, by: 0,
  }), 12);
  const particles = createPool(() => ({
    x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 0, size: 0, grow: 0,
    color: '#fff', kind: 'dot', g: 0, drag: 0, add: true, bounce: false,
  }), CONFIG.MAX_PARTICLES);

  function meters() {
    if (game.state === 'dying' || game.state === 'gameover') return game.deathMeters;
    return game.runDistance / CONFIG.PX_PER_METER;
  }

  // 0 al empezar y 1 en la dificultad máxima; el tiempo vivo y los focos suman por separado.
  const difficulty = () => clamp(
    game.aliveTime / CONFIG.RAMP_SECONDS + game.energy / CONFIG.RAMP_LIGHTBULBS, 0, 1,
  );

  // =====================================================================
  // PERSISTENCIA
  // =====================================================================
  function loadRecord() {
    try {
      return Math.max(0, parseInt(localStorage.getItem(CONFIG.STORAGE_KEY), 10) || 0);
    } catch {
      return 0;
    }
  }

  function saveRecord() {
    try {
      localStorage.setItem(CONFIG.STORAGE_KEY, String(game.record));
    } catch {
      /* almacenamiento no disponible (modo privado) */
    }
  }

  // =====================================================================
  // LEADERBOARD (compartido vía server.py; localStorage como respaldo sin conexión)
  // =====================================================================
  const PODIUM = ['🥇', '🥈', '🥉'];
  const letterCount = (s) => (String(s).match(/[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/g) || []).length;
  const digitsOnly = (s) => String(s).replace(/\D/g, '');
  const API = { board: 'api/leaderboard', scores: 'api/scores', run: 'api/run' };
  const board = { rows: [], online: false };

  async function api(path, options = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await fetch(path, { cache: 'no-store', ...options, signal: ctrl.signal });
      const data = await res.json().catch(() => ({}));
      return { ok: res.ok, status: res.status, data };
    } finally {
      clearTimeout(timer);
    }
  }

  function loadLeaderboard() {
    try {
      const rows = JSON.parse(localStorage.getItem(CONFIG.BOARD_KEY) || '[]');
      return Array.isArray(rows) ? rows : [];
    } catch {
      return [];
    }
  }

  function persistLeaderboard(rows) {
    try {
      localStorage.setItem(CONFIG.BOARD_KEY, JSON.stringify(rows));
    } catch {
      /* almacenamiento no disponible */
    }
  }

  function loadProfile() {
    try {
      return JSON.parse(localStorage.getItem(CONFIG.PROFILE_KEY) || 'null');
    } catch {
      return null;
    }
  }

  function persistProfile(profile) {
    try {
      localStorage.setItem(CONFIG.PROFILE_KEY, JSON.stringify(profile));
    } catch {
      /* almacenamiento no disponible */
    }
  }

  // Se guardan todas las partidas; el Top muestra solo la mejor de cada WhatsApp.
  function topScores(rows = loadLeaderboard()) {
    const best = new Map();
    for (const row of rows) {
      const current = best.get(row.whatsapp);
      if (!current || row.score > current.score) best.set(row.whatsapp, row);
    }
    return [...best.values()].sort((a, b) => b.score - a.score || a.at - b.at).slice(0, CONFIG.BOARD_SIZE);
  }

  function boardError(message, code) {
    const err = new Error(message);
    err.code = code;
    return err;
  }

  // Sube una sola vez los puntajes que se guardaron en este aparato antes de existir la tabla compartida.
  async function migrateLocalScores() {
    const MIGRATED_KEY = `${CONFIG.BOARD_KEY}:migrated`;
    try { if (localStorage.getItem(MIGRATED_KEY)) return; } catch { return; }
    for (const row of loadLeaderboard()) {
      const res = await api(API.scores, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: row.name, whatsapp: row.whatsapp, score: row.score }),
      });
      const profile = loadProfile();
      if (res.data.token && profile && profile.whatsapp === row.whatsapp) {
        persistProfile({ ...profile, token: res.data.token });
      }
    }
    try { localStorage.setItem(MIGRATED_KEY, '1'); } catch { /* sin almacenamiento */ }
  }

  async function fetchLeaderboard() {
    try {
      await migrateLocalScores();
      const res = await api(API.board);
      if (!res.ok) throw new Error('sin servidor');
      board.rows = res.data.top || [];
      board.online = true;
    } catch {
      board.rows = topScores();
      board.online = false;
    }
    return board.rows;
  }

  async function saveHighScore(nombre, whatsapp, score, consent = {}, place = {}) {
    const name = String(nombre || '').trim().replace(/\s+/g, ' ');
    const phone = digitsOnly(whatsapp);
    if (letterCount(name) < 3) throw boardError('Escribe tu nombre y apellido (mínimo 3 letras).', 'name');
    if (!/^\d{10}$/.test(phone)) throw boardError('El WhatsApp debe tener 10 dígitos.', 'phone');
    if (typeof place.esBiblian !== 'boolean') throw boardError('Indica si vives en el cantón Biblián.', 'biblian');
    if (place.esBiblian && !PARISHES.includes(place.parroquia)) throw boardError('Elige tu parroquia.', 'parish');
    if (!consent.prize) throw boardError('Debes aceptar el aviso de privacidad para participar.', 'consent');
    if (game.scoreSaved) throw boardError('El puntaje de esta partida ya quedó registrado.', 'saved');

    let res = null;
    try {
      res = await api(API.scores, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name, whatsapp: phone, score,
          run: game.runId,
          es_biblian: place.esBiblian,
          // Quien no vive en Biblián no envía parroquia: el campo se omite del todo.
          ...(place.esBiblian ? { parroquia: place.parroquia } : {}),
          consentPrize: true,
          privacyVersion: CAMPAIGN.privacyVersion,
        }),
      });
    } catch {
      res = null;
    }

    if (res && (res.ok || res.status === 400)) {
      board.online = true;
      if (!res.ok) throw boardError(res.data.error || 'No se pudo guardar el puntaje.', 'server');
      if (res.data.top) board.rows = res.data.top;
      persistProfile({ name, whatsapp: phone, token: res.data.token });
      game.scoreSaved = true;
      return { rows: board.rows, shared: true };
    }

    // Sin servidor: se guarda solo en este aparato.
    const rows = loadLeaderboard();
    rows.push({ name, whatsapp: phone, score, at: Date.now() });
    persistLeaderboard(rows);
    persistProfile({ name, whatsapp: phone });
    game.scoreSaved = true;
    board.rows = topScores(rows);
    board.online = false;
    return { rows: board.rows, shared: false };
  }

  function renderLeaderboard() {
    const rows = board.rows;
    const you = loadProfile();
    if (!rows.length) {
      dom.boardList.innerHTML = '<p class="board-empty">Sé el primero en entrar al Top 10 de Biblián.</p>';
      return;
    }
    dom.boardList.innerHTML = rows.map((row, i) => {
      const rank = PODIUM[i] || `${i + 1}.`;
      const isYou = you && (row.token ? row.token === you.token : row.whatsapp === you.whatsapp);
      const mine = isYou ? ' is-you' : '';
      const safeName = String(row.name).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
      }[c]));
      return `<li class="board-row${mine}"><span class="board-rank">${rank}</span><span class="board-name">${safeName}</span><span class="board-score">${row.score} kW</span></li>`;
    }).join('');
  }

  function setScoreError(msg) {
    dom.scoreError.hidden = !msg;
    dom.scoreError.textContent = msg || '';
  }

  function refreshScoreForm() {
    const profile = loadProfile();
    if (profile) {
      if (!dom.scoreName.value) dom.scoreName.value = profile.name || '';
      if (!dom.scorePhone.value) dom.scorePhone.value = profile.whatsapp || '';
    }
    const ok = !game.scoreSaved;
    dom.scoreForm.hidden = !ok;
    dom.scoreNote.hidden = ok;
    dom.scoreNote.textContent = ok ? '' : 'El puntaje de esta partida ya quedó registrado. ¡Juega otra vez para volver a participar!';
    setScoreError('');
  }

  // =====================================================================
  // SONIDO (sintetizado con Web Audio: no requiere archivos)
  // =====================================================================
  const sound = (() => {
    let ac = null;
    let master, sfxBus, musicBus, noiseBuf;
    let thrustGain, thrustFilter, humGain;
    let musicTimer = 0;
    let nextStepTime = 0;
    let step = 0;
    let muted = false;
    try { muted = localStorage.getItem(CONFIG.MUTE_KEY) === '1'; } catch { /* sin almacenamiento */ }

    const midi = (m) => 440 * 2 ** ((m - 69) / 12);
    const STEP_DUR = 60 / 132 / 4; // semicorcheas a 132 BPM
    // Progresión La m – Fa – Do – Sol: bajo y arpegio por compás.
    const BASS = [45, 41, 48, 43];
    const ARP = [[69, 72, 76, 81], [65, 69, 72, 77], [64, 67, 72, 76], [67, 71, 74, 79]];
    const ARP_ORDER = [0, 1, 2, 3, 2, 1, 0, 2];
    const BASS_STEPS = new Set([0, 3, 6, 8, 11, 14]);

    function init() {
      if (ac) {
        if (ac.state === 'suspended') ac.resume();
        return;
      }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();

      master = ac.createGain();
      master.gain.value = muted ? 0 : 0.9;
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      comp.connect(master);
      master.connect(ac.destination);

      sfxBus = ac.createGain();
      sfxBus.gain.value = 0.8;
      sfxBus.connect(comp);
      musicBus = ac.createGain();
      musicBus.gain.value = 0.22;
      musicBus.connect(comp);

      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

      // Soplido continuo del jetpack (ruido filtrado cuyo volumen sigue al empuje).
      const jet = ac.createBufferSource();
      jet.buffer = noiseBuf;
      jet.loop = true;
      thrustFilter = ac.createBiquadFilter();
      thrustFilter.type = 'lowpass';
      thrustFilter.frequency.value = 500;
      thrustGain = ac.createGain();
      thrustGain.gain.value = 0;
      jet.connect(thrustFilter).connect(thrustGain).connect(sfxBus);
      jet.start();

      // Zumbido eléctrico de los zappers cercanos.
      const hum = ac.createOscillator();
      hum.type = 'sawtooth';
      hum.frequency.value = 98;
      const humFilter = ac.createBiquadFilter();
      humFilter.type = 'lowpass';
      humFilter.frequency.value = 700;
      humGain = ac.createGain();
      humGain.gain.value = 0;
      hum.connect(humFilter).connect(humGain).connect(sfxBus);
      hum.start();

      nextStepTime = ac.currentTime + 0.1;
      musicTimer = setInterval(scheduleMusic, 25);
    }

    function tone({ type = 'sine', f0, f1 = f0, dur, vol = 0.3, attack = 0.005, when = 0, at, bus = sfxBus }) {
      const t = at ?? ac.currentTime + when;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(bus);
      o.start(t);
      o.stop(t + dur + 0.02);
    }

    function noise({ dur, vol = 0.2, freq = 1200, type = 'lowpass', when = 0, at, bus = sfxBus }) {
      const t = at ?? ac.currentTime + when;
      const src = ac.createBufferSource();
      src.buffer = noiseBuf;
      const f = ac.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      const g = ac.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(bus);
      src.start(t, Math.random() * 0.5);
      src.stop(t + dur + 0.02);
    }

    function scheduleMusic() {
      if (!ac || ac.state !== 'running') return;
      while (nextStepTime < ac.currentTime + 0.12) {
        const t = nextStepTime;
        const s = step % 16;
        const bar = Math.floor(step / 16) % 4;
        if (s === 0 || s === 8) tone({ f0: 150, f1: 45, dur: 0.22, vol: 0.55, at: t, bus: musicBus });
        if (s === 4 || s === 12) noise({ dur: 0.12, vol: 0.18, freq: 1800, type: 'bandpass', at: t, bus: musicBus });
        if (s % 2 === 1) noise({ dur: 0.04, vol: 0.07, freq: 7000, type: 'highpass', at: t, bus: musicBus });
        if (BASS_STEPS.has(s)) {
          tone({ type: 'square', f0: midi(BASS[bar]), dur: STEP_DUR * 1.6, vol: 0.13, at: t, bus: musicBus });
        }
        if (s % 2 === 0) {
          const note = ARP[bar][ARP_ORDER[s / 2]];
          tone({ type: 'triangle', f0: midi(note), dur: STEP_DUR * 1.8, vol: 0.1, at: t, bus: musicBus });
        }
        nextStepTime += STEP_DUR;
        step++;
      }
    }

    const ready = () => !!ac && ac.state === 'running';

    return {
      init,
      get muted() { return muted; },

      toggleMute() {
        muted = !muted;
        try { localStorage.setItem(CONFIG.MUTE_KEY, muted ? '1' : '0'); } catch { /* sin almacenamiento */ }
        if (ac) master.gain.setTargetAtTime(muted ? 0 : 0.9, ac.currentTime, 0.05);
        return muted;
      },

      suspend() { if (ac && ac.state === 'running') ac.suspend(); },
      resume() { if (ac && ac.state === 'suspended') ac.resume(); },

      // Ajustes continuos por frame: empuje, zumbido cercano y volumen de la música según el estado.
      update(thrust, hum, state) {
        if (!ready()) return;
        const t = ac.currentTime;
        thrustGain.gain.setTargetAtTime(0.2 * thrust, t, 0.05);
        thrustFilter.frequency.setTargetAtTime(400 + 1500 * thrust, t, 0.05);
        humGain.gain.setTargetAtTime(0.06 * hum, t, 0.08);
        const music = state === 'playing' ? 0.3 : state === 'menu' ? 0.22 : 0.1;
        musicBus.gain.setTargetAtTime(music, t, 0.3);
      },

      lightbulb(combo) {
        if (!ready()) return;
        const f = midi(81 + Math.min(combo, 12));
        tone({ type: 'triangle', f0: f, dur: 0.08, vol: 0.2 });
        tone({ type: 'triangle', f0: f * 1.5, dur: 0.14, vol: 0.16, when: 0.05 });
      },

      land(k) {
        if (!ready()) return;
        tone({ f0: 140, f1: 50, dur: 0.16, vol: 0.45 * k });
        noise({ dur: 0.1, vol: 0.18 * k, freq: 900 });
      },

      zap() {
        if (!ready()) return;
        noise({ dur: 0.55, vol: 0.5, freq: 3000, type: 'bandpass' });
        tone({ type: 'sawtooth', f0: 900, f1: 60, dur: 0.6, vol: 0.25 });
        tone({ type: 'square', f0: 1400, f1: 200, dur: 0.25, vol: 0.12 });
      },

      milestone() {
        if (!ready()) return;
        [72, 76, 79, 84].forEach((m, i) => tone({ type: 'triangle', f0: midi(m), dur: 0.16, vol: 0.18, when: i * 0.08 }));
      },

      lightUp(full) {
        if (!ready()) return;
        const notes = full ? [72, 76, 79, 84, 88, 91] : [76, 79, 84];
        notes.forEach((m, i) => tone({ f0: midi(m), dur: full ? 0.9 : 0.5, vol: 0.14, when: i * 0.07 }));
        if (full) noise({ dur: 0.8, vol: 0.08, freq: 6000, type: 'highpass', when: 0.1 });
      },

      click() {
        if (!ready()) return;
        tone({ type: 'triangle', f0: 880, f1: 1320, dur: 0.07, vol: 0.12 });
      },
    };
  })();

  // =====================================================================
  // ENTRADA: CONTROL "ONE-TOUCH" (teclado, ratón y táctil)
  // =====================================================================
  const input = { keys: new Set(), mouse: false, touches: 0 };
  const THRUST_KEYS = new Set(['Space', 'ArrowUp', 'KeyW']);
  const isHolding = () => input.keys.size > 0 || input.mouse || input.touches > 0;
  const isUiTarget = (t) => t instanceof Element && !!t.closest('button, a, input, textarea, select, label, form, .promo');

  function releaseInput() {
    input.keys.clear();
    input.mouse = false;
    input.touches = 0;
  }

  function onPress() {
    sound.init();
    if (game.state === 'menu') startGame();
  }

  function setMuteUI() {
    dom.sound.classList.toggle('muted', sound.muted);
    dom.sound.setAttribute('aria-pressed', String(sound.muted));
    dom.sound.setAttribute('aria-label', sound.muted ? 'Activar sonido' : 'Silenciar sonido');
  }

  function toggleMute() {
    sound.init();
    sound.toggleMute();
    setMuteUI();
    sound.click();
  }

  window.addEventListener('keydown', (e) => {
    if (isUiTarget(e.target) || !dom.promo.hidden) return;
    if (THRUST_KEYS.has(e.code)) {
      e.preventDefault();
      if (game.state === 'gameover') {
        if (!e.repeat) restart();
        if (game.state !== 'playing') return;
      }
      input.keys.add(e.code);
      if (!e.repeat) onPress();
    } else if (e.code === 'Enter' && game.state === 'gameover') {
      e.preventDefault();
      restart();
    } else if (e.code === 'KeyM' && !e.repeat) {
      toggleMute();
    }
  });

  window.addEventListener('keyup', (e) => {
    if (THRUST_KEYS.has(e.code)) input.keys.delete(e.code);
  });

  window.addEventListener('mousedown', (e) => {
    if (e.button !== 0 || isUiTarget(e.target)) return;
    input.mouse = true;
    onPress();
  });

  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) input.mouse = false;
  });

  window.addEventListener('touchstart', (e) => {
    if (isUiTarget(e.target)) return;
    e.preventDefault();
    input.touches = e.touches.length;
    onPress();
  }, { passive: false });

  const onTouchEnd = (e) => {
    input.touches = e.touches.length;
    if (!isUiTarget(e.target)) e.preventDefault();
  };
  window.addEventListener('touchend', onTouchEnd, { passive: false });
  window.addEventListener('touchcancel', onTouchEnd, { passive: false });
  window.addEventListener('touchmove', (e) => {
    if (e.target instanceof Element && e.target.closest('#gameOverScreen, input, textarea, form')) return;
    e.preventDefault();
  }, { passive: false });

  // Bloqueo de zoom / gestos nativos (iOS Safari, trackpads, doble toque).
  ['gesturestart', 'gesturechange', 'gestureend'].forEach((type) =>
    document.addEventListener(type, (e) => e.preventDefault(), { passive: false })
  );
  document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
  document.addEventListener('contextmenu', (e) => e.preventDefault());
  window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });

  window.addEventListener('blur', releaseInput);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      releaseInput();
      saveRecord();
      sound.suspend();
    } else if (dom.promo.hidden) {
      sound.resume();
    }
  });
  window.addEventListener('pagehide', saveRecord);

  dom.retry.addEventListener('click', (e) => {
    e.stopPropagation();
    sound.init();
    restart();
  });

  dom.sound.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleMute();
    dom.sound.blur();
  });

  dom.share.addEventListener('click', (e) => {
    e.stopPropagation();
    shareScore();
    dom.share.blur();
  });

  dom.scoreForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    sound.init();
    sound.click();
    dom.saveScore.disabled = true;
    setScoreError('');
    try {
      const answer = dom.scoreForm.elements.es_biblian.value;
      const { shared } = await saveHighScore(dom.scoreName.value, dom.scorePhone.value, game.energy, {
        prize: dom.consentPrize.checked,
      }, {
        esBiblian: answer === 'si' ? true : answer === 'no' ? false : null,
        parroquia: dom.scoreParish.value,
      });
      if (shared) {
        showPromoVideo();
        return;
      }
      refreshScoreForm();
      showToast(shared ? '¡PUNTAJE GUARDADO! YA COMPITES POR EL PREMIO' : 'SIN CONEXIÓN · GUARDADO SOLO EN ESTE APARATO');
    } catch (err) {
      setScoreError(err.message || 'No se pudo guardar el puntaje.');
    } finally {
      dom.saveScore.disabled = false;
      renderLeaderboard();
    }
  });

  // La parroquia solo se pregunta a quien vive en Biblián; con "No" se oculta y se vacía.
  dom.scoreForm.addEventListener('change', (e) => {
    if (e.target.name !== 'es_biblian') return;
    const livesInBiblian = e.target.value === 'si';
    dom.parishField.hidden = !livesInBiblian;
    dom.scoreParish.required = livesInBiblian;
    if (!livesInBiblian) dom.scoreParish.value = '';
  });

  // Video obligatorio tras registrar el puntaje; al terminar aparecen las dos opciones.
  // Si no hay video, falla o no arranca a tiempo, se va directo a la página para no dejar al jugador atrapado.
  const PROMO_START_TIMEOUT_MS = 8000;
  const PROMO_FILE_RE = /^[0-9a-f]{16}\.(?:mp4|webm)$/;
  let promoTimer = 0;

  function goToLanding() {
    clearTimeout(promoTimer);
    window.location.href = 'landing.html';
  }

  function showPromoActions() {
    dom.promoUnmute.hidden = true;
    dom.promoActions.hidden = false;
    dom.promoMore.focus();
  }

  function showPromoVideo() {
    const video = dom.promoPlayer;
    releaseInput();
    sound.suspend();
    dom.promoUnmute.hidden = true;
    dom.promoActions.hidden = true;
    dom.promo.hidden = false;
    video.muted = false;
    video.currentTime = 0;
    promoTimer = setTimeout(() => {
      if (video.paused || video.currentTime === 0) goToLanding();
    }, PROMO_START_TIMEOUT_MS);
    video.play().catch(() => {
      // Sin un toque reciente (sobre todo en iPhone) el navegador solo permite reproducir sin sonido.
      video.muted = true;
      dom.promoUnmute.hidden = false;
      return video.play();
    }).catch(goToLanding);
  }

  dom.promoPlayer.addEventListener('playing', () => clearTimeout(promoTimer));
  dom.promoPlayer.addEventListener('ended', showPromoActions);
  dom.promoPlayer.addEventListener('error', goToLanding);

  dom.promoUnmute.addEventListener('click', () => {
    dom.promoPlayer.muted = false;
    dom.promoUnmute.hidden = true;
  });

  dom.promoMore.addEventListener('click', goToLanding);

  dom.promoReplay.addEventListener('click', () => {
    dom.promoPlayer.pause();
    dom.promo.hidden = true;
    sound.resume();
    startGame();
  });

  // El video se elige en el panel: el primero de «Videos propios». Si no hay, queda assets/video-registro.mp4.
  api('api/config')
    .then((res) => {
      const first = res.ok && res.data.config && (res.data.config.media.videos || [])[0];
      if (first && PROMO_FILE_RE.test(first.file)) dom.promoPlayer.src = `uploads/videos/${first.file}`;
    })
    .catch(() => { /* sin servidor: se usa el archivo por defecto */ });

  document.querySelectorAll('[data-privacy-owner]').forEach((el) => { el.textContent = CAMPAIGN.privacyOwner; });
  document.querySelectorAll('[data-privacy-contact]').forEach((el) => { el.textContent = CAMPAIGN.privacyContact; });
  document.querySelectorAll('[data-privacy-until]').forEach((el) => { el.textContent = CAMPAIGN.privacyUntil; });
  document.querySelectorAll('[data-privacy]').forEach((link) => link.addEventListener('click', (e) => {
    e.preventDefault();
    dom.privacy.open = true;
    dom.privacy.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }));

  // Mientras la pantalla final está abierta, la tabla se refresca con los puntajes de otros aparatos.
  setInterval(() => {
    if (game.state !== 'gameover' || document.hidden) return;
    fetchLeaderboard().then(renderLeaderboard);
  }, 6000);

  // =====================================================================
  // REDIMENSIONADO RESPONSIVO
  // =====================================================================
  let vignetteGrad;

  function resize() {
    const rect = dom.root.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(rect.width || window.innerWidth));
    const cssH = Math.max(1, Math.round(rect.height || window.innerHeight));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    fxCanvas.width = canvas.width;
    fxCanvas.height = canvas.height;

    view.cssW = cssW;
    view.cssH = cssH;
    view.dpr = dpr;
    // En vertical el ancho manda: se garantiza un campo visual horizontal mínimo.
    view.scale = Math.min(cssH / CONFIG.WORLD_H, cssW / CONFIG.MIN_VIEW_W);
    view.k = view.scale * dpr;
    view.w = cssW / view.scale;
    view.offsetY = (cssH - CONFIG.WORLD_H * view.scale) * 0.5;
    view.top = -view.offsetY / view.scale;
    view.bottom = CONFIG.WORLD_H + view.offsetY / view.scale;

    player.x = clamp(view.w * 0.22, 120, 240);
    buildLightbulbSprite();
    warmLayers();

    const W = canvas.width, H = canvas.height;
    vignetteGrad = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.4, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    vignetteGrad.addColorStop(0, 'rgba(0, 0, 0, 0)');
    vignetteGrad.addColorStop(1, 'rgba(10, 0, 25, 0.4)');

    render();
  }

  window.onresize = resize;
  window.addEventListener('orientationchange', () => setTimeout(resize, 150));

  // =====================================================================
  // CICLO DE PARTIDA
  // =====================================================================
  function setScreen(el, visible) {
    el.classList.toggle('visible', visible);
    el.setAttribute('aria-hidden', String(!visible));
    el.inert = !visible;
  }

  function resetPlayer() {
    player.y = ROAD_Y - player.h / 2;
    player.vy = 0;
    player.thrust = 0;
    player.onGround = true;
    player.tilt = 0;
    player.rot = 0;
    player.vr = 0;
    player.emitAcc = 0;
    player.dustAcc = 0;
    player.landImpact = 0;

    anim.frame = anim.prevFrame = PLAYER_FRAMES.run;
    anim.blend = 1;
    anim.squash = anim.squashV = 0;
    anim.wasGround = true;
    anim.glow = 0;
    anim.landTimer = 0;
    anim.flip = anim.flipQueued = 0;
    trail.count = 0;
    popups.count = 0;
  }

  function startGame() {
    lightbulbs.count = 0;
    zappers.count = 0;
    particles.count = 0;

    game.runDistance = 0;
    game.deathMeters = 0;
    game.energy = 0;
    game.newRecord = false;
    game.speedLevel = 0;
    game.aliveTime = 0;
    game.scoreSaved = false;
    game.runId = '';
    api(API.run, { method: 'POST' })
      .then((res) => { if (res.ok) game.runId = res.data.run || ''; })
      .catch(() => { /* sin servidor: el puntaje se guarda solo en este aparato */ });
    game.targetSpeed = CONFIG.BASE_SPEED;
    game.patternCount = 0;
    game.lastPattern = '';
    game.nextSpawnX = view.w + 680;
    game.deathTimer = 0;
    game.shake = 0;
    game.flash = 0;
    game.canRestart = false;
    game.lightStep = 0;
    game.lightbulbCombo = 0;
    game.lastLightbulbTime = -1;
    shareCard = null;

    resetPlayer();
    game.state = 'playing';
    setScreen(dom.startScreen, false);
    setScreen(dom.overScreen, false);
    showToast('¡RECARGA BIBLIÁN! · RECOGE LOS FOCOS');
  }

  const lightTarget = () => Math.min(1, game.energy / CAMPAIGN.lightGoalKw);

  // Cada 25 % de energía se ilumina una parte más de la ciudad.
  function checkLightMilestone() {
    const step = Math.floor(lightTarget() * 4 + 1e-9);
    if (step <= game.lightStep) return;
    game.lightStep = step;
    const full = step >= 4;
    showToast(full ? '¡BIBLIÁN ILUMINADA AL 100 %!' : `BIBLIÁN ILUMINADA ${step * 25} %`);
    sound.lightUp(full);
    if (full) celebrateFullLight();
  }

  function restart() {
    if (game.state !== 'gameover' || !game.canRestart) return;
    startGame();
  }

  function killPlayer(z) {
    game.state = 'dying';
    game.deathMeters = game.runDistance / CONFIG.PX_PER_METER;
    game.deathTimer = 0;
    game.shake = 1;
    game.flash = 1;

    player.vy = -420;
    player.vr = rand(7, 10);
    player.onGround = false;

    burstDeath(player.x, player.y, z.color);
    sound.zap();

    if (game.energy > game.record) {
      game.record = game.energy;
      game.newRecord = true;
      saveRecord();
    }
    try { navigator.vibrate && navigator.vibrate(150); } catch { /* sin vibración */ }
  }

  function showGameOver() {
    game.state = 'gameover';
    game.canRestart = false;

    dom.goDistance.textContent = `${Math.floor(meters())} m`;
    dom.goEnergy.textContent = `${game.energy} kW`;
    dom.goRecord.textContent = `${game.record} kW`;
    dom.goBadge.hidden = !game.newRecord;
    dom.startRecord.textContent = `${game.record} kW`;
    dom.goLight.textContent = `${Math.round(lightTarget() * 100)} %`;
    dom.goSlogan.textContent = `${CAMPAIGN.slogan} ${CAMPAIGN.hashtag}`;
    renderLeaderboard();
    refreshScoreForm();
    fetchLeaderboard().then(renderLeaderboard);

    // La imagen se prepara de antemano: así el botón comparte al instante (requisito de iOS).
    shareCard = buildShareCard({ meters: Math.floor(meters()), energy: game.energy, light: lightTarget() });

    dom.retry.disabled = true;
    setScreen(dom.overScreen, true);
    setTimeout(() => {
      game.canRestart = true;
      dom.retry.disabled = false;
    }, 450);
  }

  function showToast(text) {
    dom.toast.textContent = text;
    dom.toast.classList.remove('show');
    void dom.toast.offsetWidth;
    dom.toast.classList.add('show');
  }

  // =====================================================================
  // GENERACIÓN PROCEDURAL DE OBSTÁCULOS Y FOCOS
  // =====================================================================
  function updateZapperEnds(z) {
    const hx = (Math.cos(z.angle) * z.len) / 2;
    const hy = (Math.sin(z.angle) * z.len) / 2;
    z.ax = z.x - hx;
    z.ay = z.y - hy;
    z.bx = z.x + hx;
    z.by = z.y + hy;
  }

  function addZapper(cx, cy, len, angle, spin = 0) {
    const z = acquire(zappers);
    z.x = cx;
    z.y = cy;
    z.len = len;
    z.angle = angle;
    z.spin = spin;
    z.color = pick(ZAPPER_COLORS);
    updateZapperEnds(z);
    return z;
  }

  function extents(len, angle) {
    return { hx: (Math.abs(Math.cos(angle)) * len) / 2, hy: (Math.abs(Math.sin(angle)) * len) / 2 };
  }

  const ZAPPER_PATTERNS = {
    single(x, d) {
      const len = rand(96, 145 + 28 * d);
      const angle = pick([0, Math.PI / 2, Math.PI / 2, Math.PI / 4, -Math.PI / 4]);
      const { hx, hy } = extents(len, angle);
      addZapper(x + hx + NR, rand(ZAP_MIN_Y + hy, ZAP_MAX_Y - hy), len, angle);
      return 2 * (hx + NR);
    },

    rotating(x, d) {
      const len = rand(108, 145);
      const r = len / 2;
      const spin = pick([-1, 1]) * rand(0.65, 1.05 + 0.35 * d);
      addZapper(x + r + NR, rand(ZAP_MIN_Y + r, ZAP_MAX_Y - r), len, rand(0, Math.PI), spin);
      return 2 * (r + NR);
    },

    gate(x, d) {
      const gap = rand(248, 286) - 18 * d;
      const center = rand(ZAP_MIN_Y + gap / 2 + 30, ZAP_MAX_Y - gap / 2 - 30);
      const topEnd = center - gap / 2;
      const botStart = center + gap / 2;
      const cx = x + NR;
      if (topEnd - ZAP_MIN_Y > 30) {
        const len = topEnd - ZAP_MIN_Y;
        addZapper(cx, ZAP_MIN_Y + len / 2, len, Math.PI / 2);
      }
      if (ZAP_MAX_Y - botStart > 30) {
        const len = ZAP_MAX_Y - botStart;
        addZapper(cx, botStart + len / 2, len, Math.PI / 2);
      }
      return 2 * NR;
    },

    stairs(x, d) {
      const count = d > 0.72 ? 3 : 2;
      const spacing = Math.max(game.speed, CONFIG.BASE_SPEED) * rand(0.85, 1.05);
      const startLow = Math.random() < 0.5;
      const mid = (ZAP_MIN_Y + ZAP_MAX_Y) / 2;
      let width = 0;
      for (let i = 0; i < count; i++) {
        const len = rand(110, 150);
        const angle = pick([0, Math.PI / 4, -Math.PI / 4]);
        const { hx, hy } = extents(len, angle);
        const low = (i % 2 === 0) === startLow;
        const cy = low ? rand(mid + 30, ZAP_MAX_Y - hy) : rand(ZAP_MIN_Y + hy, mid - 30);
        const cx = x + i * spacing + hx + NR;
        addZapper(cx, cy, len, angle);
        width = Math.max(width, cx + hx + NR - x);
      }
      return width;
    },
  };

  function isLightbulbSafe(x, y) {
    const R = CONFIG.LIGHTBULB_R;
    for (let i = 0; i < zappers.count; i++) {
      const z = zappers.items[i];
      if (Math.abs(z.x - x) > z.len / 2 + 80) continue;
      if (z.spin) {
        if (Math.hypot(x - z.x, y - z.y) < z.len / 2 + NR + R + 12) return false;
      } else if (pointSegDist(x, y, z.ax, z.ay, z.bx, z.by) < NR + R + 12) {
        return false;
      }
    }
    return true;
  }

  function addLightbulb(x, y) {
    const b = acquire(lightbulbs);
    b.x = x;
    b.y = y;
    b.phase = rand(0, TAU);
  }

  const LIGHTBULB_PATTERNS = ['line', 'wave', 'wave', 'block', 'arc', 'zigzag'];
  // Búfer reutilizable con los puntos del patrón (el mayor, 'block', usa 4 × 9 = 36).
  const lightbulbPts = { x: new Float64Array(64), y: new Float64Array(64), n: 0 };

  function addPt(px, py) {
    lightbulbPts.x[lightbulbPts.n] = px;
    lightbulbPts.y[lightbulbPts.n] = py;
    lightbulbPts.n++;
  }

  function spawnLightbulbs(x) {
    const S = CONFIG.LIGHTBULB_SPACING;
    const type = pick(LIGHTBULB_PATTERNS);
    lightbulbPts.n = 0;

    switch (type) {
      case 'line': {
        const n = randInt(8, 14);
        const y = rand(LIGHTBULB_MIN_Y, LIGHTBULB_MAX_Y);
        for (let i = 0; i < n; i++) addPt(i * S, y);
        break;
      }
      case 'wave': {
        const n = randInt(14, 22);
        const amp = rand(45, 90);
        const y0 = rand(LIGHTBULB_MIN_Y + amp, LIGHTBULB_MAX_Y - amp);
        const f = rand(0.35, 0.55);
        for (let i = 0; i < n; i++) addPt(i * S * 0.85, y0 + Math.sin(i * f) * amp);
        break;
      }
      case 'block': {
        const rows = randInt(2, 4);
        const cols = randInt(5, 9);
        const y0 = rand(LIGHTBULB_MIN_Y, LIGHTBULB_MAX_Y - (rows - 1) * S);
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) addPt(c * S, y0 + r * S);
        }
        break;
      }
      case 'arc': {
        const n = randInt(10, 14);
        const h = rand(70, 130);
        const yb = rand(LIGHTBULB_MIN_Y + h, LIGHTBULB_MAX_Y);
        for (let i = 0; i < n; i++) addPt(i * S, yb - Math.sin((i / (n - 1)) * Math.PI) * h);
        break;
      }
      default: {
        const n = 18;
        const amp = rand(50, 80);
        const y0 = rand(LIGHTBULB_MIN_Y + amp, LIGHTBULB_MAX_Y - amp);
        for (let i = 0; i < n; i++) {
          const t = (i % 8) / 8;
          const tri = t < 0.5 ? t * 4 - 1 : 3 - t * 4;
          addPt(i * S * 0.8, y0 + tri * amp);
        }
      }
    }

    let maxX = 0;
    for (let i = 0; i < lightbulbPts.n; i++) {
      const px = lightbulbPts.x[i];
      const py = lightbulbPts.y[i];
      const cx = x + CONFIG.LIGHTBULB_R + px;
      maxX = Math.max(maxX, px);
      if (isLightbulbSafe(cx, py)) addLightbulb(cx, py);
    }
    return maxX + CONFIG.LIGHTBULB_R * 2;
  }

  // Línea de focos que atraviesa un obstáculo por un hueco seguro (guía al jugador).
  function spawnLightbulbLineSafe(x0, width) {
    const S = CONFIG.LIGHTBULB_SPACING;
    const n = Math.max(3, Math.floor(width / S));
    for (let attempt = 0; attempt < 10; attempt++) {
      const y = rand(LIGHTBULB_MIN_Y, LIGHTBULB_MAX_Y);
      let ok = true;
      for (let i = 0; i < n && ok; i++) ok = isLightbulbSafe(x0 + i * S, y);
      if (ok) {
        for (let i = 0; i < n; i++) addLightbulb(x0 + i * S, y);
        return;
      }
    }
  }

  function spawnPattern() {
    const x = game.nextSpawnX;
    const d = difficulty();
    let width;
    let gapTime;

    const lightbulbTurn = game.patternCount === 0 || (game.lastPattern !== 'lightbulbs' && Math.random() < 0.52);
    if (lightbulbTurn) {
      width = spawnLightbulbs(x);
      game.lastPattern = 'lightbulbs';
      gapTime = rand(0.45, 0.8);
    } else {
      const r = Math.random();
      const rotChance = 0.05 + 0.16 * d;
      let kind = 'single';
      if (r < rotChance) kind = 'rotating';
      else if (r < rotChance + 0.22) kind = 'gate';
      else if (r < rotChance + 0.4 + 0.1 * d) kind = 'stairs';

      width = ZAPPER_PATTERNS[kind](x, d);
      if ((kind === 'single' || kind === 'gate') && Math.random() < 0.45) {
        spawnLightbulbLineSafe(x - 60, width + 120);
      }
      game.lastPattern = kind;
      gapTime = lerp(CONFIG.GAP_EASY, CONFIG.GAP_HARD, d) * rand(0.92, 1.22);
    }

    game.patternCount++;
    game.nextSpawnX = x + width + gapTime * Math.max(game.speed, CONFIG.BASE_SPEED);
  }

  // =====================================================================
  // PARTÍCULAS
  // =====================================================================
  // Recicla una partícula del pool con valores por defecto; devuelve null si se alcanzó el tope.
  // Cada emisor ajusta luego solo los campos que necesita (sin objetos de opciones temporales).
  function emit(x, y, life, kind, color) {
    if (particles.count >= CONFIG.MAX_PARTICLES) return null;
    const p = acquire(particles);
    p.x = x;
    p.y = y;
    p.vx = 0;
    p.vy = 0;
    p.life = life;
    p.max = life;
    p.size = 2;
    p.grow = 0;
    p.color = color;
    p.kind = kind;
    p.g = 0;
    p.drag = 0;
    p.add = true;
    p.bounce = false;
    return p;
  }

  const nozzle = { x: 0, y: 0 };

  function nozzlePos() {
    const c = Math.cos(player.tilt);
    const s = Math.sin(player.tilt);
    nozzle.x = player.x + NOZZLE.x * c - NOZZLE.y * s;
    nozzle.y = player.y + NOZZLE.x * s + NOZZLE.y * c;
    return nozzle;
  }

  const LIGHTBULB_BURST_COLORS = ['#fff7ae', '#ffd60a', '#ffe66d'];
  const FIREWORK_COLORS = ['#fff7ae', '#ffd60a', '#ffe66d', '#ffffff', '#7df9ff'];

  function emitThrustSpark() {
    const n = nozzlePos();
    const a = Math.PI / 2 + 0.35 + rand(-0.55, 0.55);
    const s = rand(240, 520);
    const p = emit(n.x + rand(-3, 3), n.y, rand(0.25, 0.55), Math.random() < 0.3 ? 'star' : 'streak', pick(THRUST_COLORS));
    if (!p) return;
    p.vx = Math.cos(a) * s - game.speed * 0.3;
    p.vy = Math.sin(a) * s + Math.max(0, player.vy) * 0.5;
    p.size = rand(2, 3);
    p.g = 600;
    p.drag = 2.2;
    p.bounce = true;
  }

  function emitDust(count, spread) {
    for (let i = 0; i < count; i++) {
      const p = emit(player.x + rand(-spread, spread), ROAD_Y - 2, rand(0.3, 0.55), 'smoke', '#c9c2dd');
      if (!p) return;
      p.vx = rand(-120, 60) - game.speed * 0.5;
      p.vy = rand(-90, -20);
      p.size = rand(3, 6);
      p.add = false;
      p.drag = 3;
    }
  }

  function emitZapperSpark(z) {
    const t = Math.random();
    const color = Math.random() < 0.5 ? z.color.light : '#fff7a8';
    const p = emit(lerp(z.ax, z.bx, t), lerp(z.ay, z.by, t), rand(0.15, 0.35), 'streak', color);
    if (!p) return;
    p.vx = rand(-160, 160);
    p.vy = rand(-200, 60);
    p.g = 400;
    p.drag = 3;
  }

  function emitRing(x, y, life, size, grow, color) {
    const p = emit(x, y, life, 'ring', color);
    if (!p) return null;
    p.size = size;
    p.grow = grow;
    return p;
  }

  function burstLightbulb(x, y) {
    for (let i = 0; i < 8; i++) {
      const a = rand(0, TAU);
      const s = rand(80, 220);
      const p = emit(x, y, 0.35, 'dot', pick(LIGHTBULB_BURST_COLORS));
      if (!p) break;
      p.vx = Math.cos(a) * s - game.speed * 0.3;
      p.vy = Math.sin(a) * s;
      p.size = rand(2, 3);
      p.drag = 4;
    }
    const ring = emitRing(x, y, 0.3, 8, 20, '#ffe66d');
    if (ring) ring.vx = -game.speed * 0.2;
  }

  // Fuegos artificiales dorados sobre la ciudad al iluminarla por completo.
  function celebrateFullLight() {
    game.flash = Math.max(game.flash, 0.35);
    for (let b = 0; b < 5; b++) {
      const cx = rand(view.w * 0.3, view.w * 0.95);
      const cy = rand(CONFIG.CEILING_Y + 60, CONFIG.GROUND_Y - 220);
      for (let i = 0; i < 22; i++) {
        const a = (i / 22) * TAU;
        const s = rand(140, 260);
        const p = emit(cx, cy, rand(0.7, 1.1), i % 3 === 0 ? 'star' : 'dot', pick(FIREWORK_COLORS));
        if (!p) break;
        p.vx = Math.cos(a) * s;
        p.vy = Math.sin(a) * s;
        p.size = rand(2, 3.2);
        p.g = 160;
        p.drag = 1.6;
      }
      emitRing(cx, cy, 0.5, 6, 70, '#ffe66d');
    }
  }

  function burstDeath(x, y, color) {
    for (let i = 0; i < 46; i++) {
      const a = rand(0, TAU);
      const s = rand(120, 620);
      const r = Math.random();
      const c = r < 0.25 ? color.core : r < 0.5 ? color.light : r < 0.75 ? '#ffffff' : '#fff3a0';
      const p = emit(x, y, rand(0.35, 0.9), 'streak', c);
      if (!p) break;
      p.vx = Math.cos(a) * s;
      p.vy = Math.sin(a) * s;
      p.size = rand(2, 3);
      p.g = 500;
      p.drag = 2;
      p.bounce = true;
    }
    emitRing(x, y, 0.45, 12, 90, color.core);
    emitRing(x, y, 0.3, 8, 60, '#ffffff');
  }

  function updateParticles(dt) {
    for (let i = particles.count - 1; i >= 0; i--) {
      const p = particles.items[i];
      p.life -= dt;
      if (p.life <= 0) {
        release(particles, i);
        continue;
      }
      if (p.drag) {
        const k = Math.exp(-p.drag * dt);
        p.vx *= k;
        p.vy *= k;
      }
      p.vy += p.g * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.bounce && p.y > ROAD_Y) {
        p.y = ROAD_Y;
        p.vy *= -0.35;
      }
    }
  }

  // =====================================================================
  // ACTUALIZACIÓN (FÍSICAS A PASO FIJO)
  // =====================================================================
  function updateSpeed(dt) {
    const level = Math.floor(meters() / 100);
    if (level > game.speedLevel) {
      game.speedLevel = level;
      if (game.targetSpeed < CONFIG.MAX_SPEED) showToast(`${level * 100} m · ¡VELOCIDAD +!`);
      anim.flipQueued = 3;
      sound.milestone();
    }
    game.aliveTime += dt;
    game.targetSpeed = lerp(CONFIG.BASE_SPEED, CONFIG.MAX_SPEED, difficulty());
    game.speed = damp(game.speed, game.targetSpeed, CONFIG.SPEED_LERP, dt);
  }

  function updatePlayer(dt, canFly) {
    const holding = canFly && isHolding();

    // El empuje no es instantáneo: se interpola hacia 0/1 para una respuesta "hidrodinámica".
    player.thrust = damp(player.thrust, holding ? 1 : 0, CONFIG.THRUST_RESPONSE, dt);

    const accel = CONFIG.GRAVITY - CONFIG.THRUST * player.thrust;
    player.vy += accel * dt;
    player.vy *= Math.exp(-CONFIG.AIR_DRAG * dt);
    player.vy = clamp(player.vy, -CONFIG.MAX_RISE, CONFIG.MAX_FALL);
    player.y += player.vy * dt;

    const top = CONFIG.CEILING_Y + player.h / 2;
    const bottom = ROAD_Y - player.h / 2;

    if (player.y <= top) {
      player.y = top;
      if (player.vy < 0) player.vy = 0;
    }

    if (player.y >= bottom) {
      if (!player.onGround && player.vy > 250) player.landImpact = Math.max(player.landImpact, player.vy);
      player.y = bottom;
      if (player.vy > 0) player.vy = 0;
      player.onGround = true;
    } else {
      player.onGround = false;
    }

    const tiltTarget = player.onGround ? 0 : clamp(-player.vy / CONFIG.MAX_RISE, -1, 1) * 0.12 + 0.03;
    player.tilt = damp(player.tilt, tiltTarget, 8, dt);
    player.runPhase += dt * (game.speed / 22) * (player.onGround ? 1 : 0.25);
  }

  function updateDeadPlayer(dt) {
    player.thrust = damp(player.thrust, 0, 10, dt);
    const restY = ROAD_Y - 24;

    if (!player.onGround) {
      player.vy = Math.min(player.vy + CONFIG.GRAVITY * dt, CONFIG.MAX_FALL * 1.4);
      player.y += player.vy * dt;
      player.rot += player.vr * dt;

      if (player.y < CONFIG.CEILING_Y + 30) {
        player.y = CONFIG.CEILING_Y + 30;
        player.vy = Math.abs(player.vy) * 0.3;
      }
      if (player.y >= restY) {
        player.y = restY;
        if (player.vy > 180) {
          player.landImpact = player.vy;
          player.vy = -player.vy * 0.38;
          player.vr *= 0.55;
        } else {
          player.vy = 0;
          player.onGround = true;
        }
      }
    } else {
      const target = Math.round((player.rot - Math.PI / 2) / Math.PI) * Math.PI + Math.PI / 2;
      player.rot = damp(player.rot, target, 10, dt);
    }

    game.deathTimer += dt;
  }

  function updateWorld(dx, dt) {
    for (let i = lightbulbs.count - 1; i >= 0; i--) {
      const b = lightbulbs.items[i];
      b.x -= dx;
      if (b.x < -40) release(lightbulbs, i);
    }

    for (let i = zappers.count - 1; i >= 0; i--) {
      const z = zappers.items[i];
      z.x -= dx;
      if (z.spin) z.angle += z.spin * dt;
      updateZapperEnds(z);
      if (z.x + z.len / 2 + NR < -60) release(zappers, i);
    }

    if (game.state === 'playing') {
      game.nextSpawnX -= dx;
      while (game.nextSpawnX < view.w + 120) spawnPattern();
    }
  }

  const hitbox = { x: 0, y: 0, w: 26, h: 64 };
  const pickupBox = { x: 0, y: 0, w: 38, h: 72 };

  function checkCollisions() {
    const hb = hitbox;
    hb.x = player.x - 12;
    hb.y = player.y - 32;
    const pickup = pickupBox;
    pickup.x = hb.x - 6;
    pickup.y = hb.y - 4;

    for (let i = lightbulbs.count - 1; i >= 0; i--) {
      const b = lightbulbs.items[i];
      if (Math.abs(b.x - player.x) > 50) continue;
      if (pointRectDist(b.x, b.y, pickup) <= CONFIG.LIGHTBULB_R) {
        game.energy += 1;
        game.lightbulbCombo = game.time - game.lastLightbulbTime < 0.35 ? game.lightbulbCombo + 1 : 0;
        game.lastLightbulbTime = game.time;
        sound.lightbulb(game.lightbulbCombo);
        checkLightMilestone();
        anim.glow = 1;
        if (popups.count < POPUPS_MAX) {
          const p = acquire(popups);
          p.x = b.x;
          p.y = b.y - 10;
          p.life = 0.6;
        }
        burstLightbulb(b.x, b.y);
        release(lightbulbs, i);
      }
    }

    for (let i = 0; i < zappers.count; i++) {
      const z = zappers.items[i];
      if (Math.abs(z.x - player.x) > z.len / 2 + NR + 50) continue;
      if (
        segRectDist(z.ax, z.ay, z.bx, z.by, hb) <= CONFIG.ZAPPER_R ||
        pointRectDist(z.ax, z.ay, hb) <= NR ||
        pointRectDist(z.bx, z.by, hb) <= NR
      ) {
        killPlayer(z);
        return;
      }
    }
  }

  function update(dt) {
    game.time += dt;

    switch (game.state) {
      case 'menu':
        game.speed = damp(game.speed, CONFIG.BASE_SPEED * 0.55, 2, dt);
        updatePlayer(dt, false);
        break;
      case 'playing':
        updateSpeed(dt);
        updatePlayer(dt, true);
        break;
      case 'dying':
      case 'gameover':
        game.speed = damp(game.speed, 0, game.state === 'dying' ? 1.3 : 3, dt);
        updateDeadPlayer(dt);
        break;
    }

    const dx = game.speed * dt;
    game.scroll += dx;
    if (game.state !== 'menu') game.runDistance += dx;

    updateWorld(dx, dt);

    if (game.state === 'playing') {
      checkCollisions();
    } else if (game.state === 'dying' && game.deathTimer > 1.35 && (player.onGround || game.deathTimer > 3)) {
      showGameOver();
    }
  }

  // Efectos visuales: se actualizan una vez por frame (no afectan a la jugabilidad).
  function updateEffects(dt) {
    const alive = game.state === 'menu' || game.state === 'playing';

    if (game.state === 'playing' && player.thrust > 0.2) {
      player.emitAcc += dt * 170 * player.thrust;
      while (player.emitAcc >= 1) {
        player.emitAcc -= 1;
        emitThrustSpark();
      }
    } else {
      player.emitAcc = 0;
    }

    if (alive && player.onGround && game.speed > 50) {
      player.dustAcc += dt * 9;
      while (player.dustAcc >= 1) {
        player.dustAcc -= 1;
        emitDust(1, 4);
      }
    }

    if (player.landImpact > 0) {
      sound.land(clamp(player.landImpact / 700, 0.3, 1));
      emitDust(Math.round(clamp(player.landImpact / 80, 4, 12)), 14);
      if (!alive) game.shake = Math.max(game.shake, 0.35);
      player.landImpact = 0;
    }

    for (let i = 0; i < zappers.count; i++) {
      const z = zappers.items[i];
      if (z.x < view.w + 40 && Math.random() < dt * 7) emitZapperSpark(z);
    }

    // En el menú la ciudad luce encendida; al jugar arranca "apagada" y se recarga con la energía.
    const lightGoal = game.state === 'menu' ? 1 : lightTarget();
    game.light = damp(game.light, lightGoal, 2.5, dt);

    let hum = 0;
    if (game.state === 'playing') {
      for (let i = 0; i < zappers.count; i++) {
        const z = zappers.items[i];
        if (Math.abs(z.x - player.x) > z.len / 2 + 260) continue;
        const d = pointSegDist(player.x, player.y, z.ax, z.ay, z.bx, z.by);
        hum = Math.max(hum, clamp(1 - d / 240, 0, 1));
      }
    }
    sound.update(game.state === 'playing' ? player.thrust : 0, hum, game.state);

    updatePlayerAnim(dt);
    updateParticles(dt);
    game.shake = Math.max(0, game.shake - dt * 2.2);
    game.flash = Math.max(0, game.flash - dt * 3);
  }

  // =====================================================================
  // ANIMACIÓN DEL PERSONAJE (solo visual)
  // =====================================================================
  const SPRING_K = 260;
  const SPRING_D = 15;

  function playerFrame(dead) {
    const { fly, fall } = PLAYER_FRAMES;
    if (dead) return fall[Math.floor(game.time * 9) % 2];
    if (player.onGround) {
      if (anim.landTimer > 0) return PLAYER_FRAMES.crouch;
      return PLAYER_FRAMES.run + (Math.floor(player.runPhase / (Math.PI / 2)) % 4);
    }
    if (player.thrust > 0.35 || player.vy < -60) return fly[Math.floor(anim.flyPhase) % fly.length];
    return fall[Math.floor(anim.fallPhase) % fall.length];
  }

  const trainWidth = () => layerW('train');

  // Posición en pantalla (capa de la calle) de una marca de escena, dentro del ciclo actual.
  function markScreenX(mark) {
    const P = STREET.period;
    const off = game.scroll * PARALLAX.town;
    return ((((mark - off) % P) + P) % P);
  }

  function updateTrain(dt) {
    const off = game.scroll * PARALLAX.town;
    const w = trainWidth();

    // El tren entra por la derecha cuando su escena llega al borde de la pantalla.
    const s = markScreenX(STREET.marks.train);
    const entered = train.prevMark !== undefined && train.prevMark > view.w && s <= view.w;
    train.prevMark = s;
    if (!train.active) {
      if (entered && game.speed > 60) {
        train.active = true;
        train.x = off + view.w + 20;
      }
    } else {
      // Avanza a la mitad de la velocidad de la calle: se ve circulando, pero cruza la pantalla.
      train.x += game.speed * PARALLAX.town * 0.5 * dt;
      const sx = train.x - off;
      if (sx + w < -40) {
        train.active = false;
      } else {
        train.smokeAcc += dt * 8;
        while (train.smokeAcc >= 1) {
          train.smokeAcc -= 1;
          if (smoke.count < SMOKE_MAX) {
            const p = acquire(smoke);
            p.x = train.x + w * TRAIN_CHIMNEY.x + rand(-2, 2);
            p.y = CONFIG.GROUND_Y + 4 - LAYER_H.train * (1 - TRAIN_CHIMNEY.y);
            p.vx = rand(-25, -5);
            p.vy = rand(-55, -35);
            p.life = rand(0.9, 1.4);
            p.max = 1.4;
            p.r = rand(3, 5);
          }
        }
      }
    }

    for (let i = smoke.count - 1; i >= 0; i--) {
      const p = smoke.items[i];
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy *= Math.exp(-0.8 * dt);
      p.r += 12 * dt;
      if (p.life <= 0) release(smoke, i);
    }
  }

  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

  function updatePlayerAnim(dt) {
    const dead = game.state === 'dying' || game.state === 'gameover';

    // Squash & stretch con un muelle amortiguado: se estira al despegar y se aplasta al aterrizar.
    if (!dead) {
      if (anim.wasGround && !player.onGround && player.vy < 0) anim.squashV -= 5.5;
      if (!anim.wasGround && player.onGround) {
        anim.squashV += clamp(anim.airVy / 110, 1.2, 7.5);
        if (anim.airVy > 260) anim.landTimer = 0.13;
      }
    }
    if (!player.onGround) anim.airVy = player.vy;
    anim.wasGround = player.onGround;
    anim.landTimer = Math.max(0, anim.landTimer - dt);

    // Ciclos de piernas en vuelo (más rápidos con más empuje) y brazos agitados al caer.
    anim.flyPhase += dt * (5 + 6 * player.thrust);
    anim.fallPhase += dt * 7;

    // Fundido cruzado entre poses (rápido dentro del mismo ciclo, más suave al cambiar de modo).
    const target = playerFrame(dead);
    if (target !== anim.frame) {
      const same = frameGroup(target) === frameGroup(anim.frame);
      anim.prevFrame = anim.frame;
      anim.frame = target;
      anim.blend = 0;
      anim.blendTime = same ? 0.06 : 0.1;
    }
    anim.blend = Math.min(1, anim.blend + dt / anim.blendTime);

    // Voltereta de celebración al superar cada 100 m (en cuanto el personaje esté en el aire).
    if (dead) {
      anim.flip = anim.flipQueued = 0;
    } else if (anim.flip > 0) {
      anim.flip += dt / 0.6;
      if (anim.flip >= 1) anim.flip = 0;
    } else if (anim.flipQueued > 0) {
      anim.flipQueued -= dt;
      if (!player.onGround && player.y < CONFIG.GROUND_Y - 120) {
        anim.flip = 1e-4;
        anim.flipQueued = 0;
      }
    }

    for (let i = popups.count - 1; i >= 0; i--) {
      const p = popups.items[i];
      p.life -= dt;
      p.x -= game.speed * dt;
      p.y -= 70 * dt;
      if (p.life <= 0) release(popups, i);
    }

    updateTrain(dt);

    let rest = 0;
    if (!dead && !player.onGround) {
      rest = -0.05 * player.thrust - 0.05 * clamp(player.vy / CONFIG.MAX_FALL, 0, 1);
    }
    anim.squashV += (-SPRING_K * (anim.squash - rest) - SPRING_D * anim.squashV) * dt;
    anim.squash = clamp(anim.squash + anim.squashV * dt, -0.28, 0.32);

    anim.glow = Math.max(0, anim.glow - dt * 2.5);

    // Estela de "imágenes fantasma" cuando el personaje se mueve rápido en vertical.
    const fast = !dead && !player.onGround && Math.abs(player.vy) > 380;
    if (fast) {
      anim.trailAcc += dt;
      if (anim.trailAcc > 0.035) {
        anim.trailAcc = 0;
        // Con la estela llena se reutiliza la imagen fantasma más antigua (la de menos vida).
        let t;
        if (trail.count < TRAIL_MAX) {
          t = acquire(trail);
        } else {
          t = trail.items[0];
          for (let i = 1; i < trail.count; i++) if (trail.items[i].life < t.life) t = trail.items[i];
        }
        t.x = player.x;
        t.y = player.y;
        t.frame = anim.frame;
        t.rot = player.tilt;
        t.life = t.max = 0.22;
      }
    } else {
      anim.trailAcc = 0;
    }
    for (let i = trail.count - 1; i >= 0; i--) {
      const t = trail.items[i];
      t.life -= dt;
      t.x -= game.speed * dt * 0.7;
      if (t.life <= 0) release(trail, i);
    }
  }

  // =====================================================================
  // RENDER: PRIMITIVAS
  // =====================================================================
  function circle(x, y, r) {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
    ctx.fill();
  }

  function strokeLine(ax, ay, bx, by, style, width) {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }

  function jagged(ax, ay, bx, by, amp, step, style, width) {
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const segs = Math.max(3, Math.round(len / step));
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      const o = (Math.random() * 2 - 1) * amp;
      ctx.lineTo(ax + dx * t + nx * o, ay + dy * t + ny * o);
    }
    ctx.lineTo(bx, by);
    ctx.stroke();
  }

  // Coordenada de mundo → borde de píxel físico más cercano. Se redondea en píxeles de pantalla
  // (no en unidades de mundo: con la escala del móvil una unidad son varios píxeles y el fondo
  // avanzaría a saltos).
  const snapX = (x) => (Math.round(x * view.k + view.tx) - view.tx) / view.k;
  const snapY = (y) => (Math.round(y * view.k + view.ty) - view.ty) / view.k;

  // Capas ilustradas preescaladas una vez al tamaño exacto en pantalla (se rehacen al cambiar la
  // escala). Así cada frame es una copia 1:1 alineada al píxel, en vez de reducir con suavizado
  // alto imágenes de hasta 2600 px. Llevan 1 px extra de ancho para que las copias contiguas se
  // solapen y nunca aparezca una costura.
  const LAYER_KEYS = ['far', 'sanctuary', 'town', 'iglesia', 'letters', 'obelisk', 'tunnel', 'train', 'market'];
  const LAYER_CACHE_MAX_PX = 6e6;
  const layerCache = {};

  function layerSize(key) {
    if (key === 'far') {
      const img = images.far;
      return { w: LAYER_H.far * (img.naturalWidth / img.naturalHeight), h: LAYER_H.far };
    }
    return { w: layerW(key), h: LAYER_H[key] };
  }

  function scaledLayer(key) {
    const img = images[key];
    if (!ready(img)) return null;
    const { w, h } = layerSize(key);
    const pw = Math.ceil(w * view.k) + 1;
    const ph = Math.round(h * view.k);
    let c = layerCache[key];
    if (c && c.width === pw && c.height === ph) return c;
    if (pw * ph > LAYER_CACHE_MAX_PX) return null;
    c = c || document.createElement('canvas');
    c.width = pw;
    c.height = ph;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    g.clearRect(0, 0, pw, ph);
    g.drawImage(img, 0, 0, pw, ph);
    layerCache[key] = c;
    return c;
  }

  // Se preparan al redimensionar y al cargar cada imagen, nunca a mitad de partida.
  function warmLayers() {
    for (const key of LAYER_KEYS) scaledLayer(key);
  }
  for (const key of LAYER_KEYS) images[key].addEventListener('load', warmLayers);

  function drawLayer(key, x, y, flip) {
    const img = images[key];
    if (!ready(img)) return;
    const cached = scaledLayer(key);
    let dx = snapX(x);
    const dy = snapY(y);
    let src, dw, dh;
    if (cached) {
      src = cached;
      dw = cached.width / view.k;
      dh = cached.height / view.k;
    } else {
      // Respaldo (capa demasiado grande para cachear): imagen original con 1 px de solape.
      const size = layerSize(key);
      src = img;
      dx -= 0.5 / view.k;
      dw = size.w + 1 / view.k;
      dh = size.h;
    }
    if (flip) {
      ctx.save();
      ctx.translate(dx + dw, dy);
      ctx.scale(-1, 1);
      ctx.drawImage(src, 0, 0, dw, dh);
      ctx.restore();
    } else {
      ctx.drawImage(src, dx, dy, dw, dh);
    }
  }

  // Filtro de "ciudad apagada": la cadena solo se rehace cuando cambia el nivel de luz.
  let cityFilterKey = -1;
  let cityFilterValue = '';

  function cityFilter() {
    const dim = 1 - game.light;
    if (!CAN_FILTER || dim <= 0.01) return '';
    const q = Math.round(dim * 1000);
    if (q !== cityFilterKey) {
      const d = q / 1000;
      cityFilterKey = q;
      cityFilterValue = `brightness(${(1 - 0.45 * d).toFixed(3)}) saturate(${(1 - 0.35 * d).toFixed(3)})`;
    }
    return cityFilterValue;
  }

  // Redirige el dibujo a fxCtx (con la misma transformación) para filtrar el grupo de una vez.
  // y0..y1 es la franja del mundo que ocupa el grupo: solo esa franja se limpia y se compone.
  const fxBand = { top: 0, h: 0 };

  function beginFiltered(y0, y1) {
    const H = fxCanvas.height;
    const top = clamp(Math.floor(y0 * view.k + view.ty) - 2, 0, H);
    const bottom = clamp(Math.ceil(y1 * view.k + view.ty) + 2, 0, H);
    fxBand.top = top;
    fxBand.h = bottom - top;
    fxCtx.setTransform(1, 0, 0, 1, 0, 0);
    fxCtx.clearRect(0, top, fxCanvas.width, fxBand.h);
    fxCtx.setTransform(view.k, 0, 0, view.k, view.tx, view.ty);
    fxCtx.globalAlpha = 1;
    fxCtx.globalCompositeOperation = 'source-over';
    fxCtx.filter = 'none';
    fxCtx.imageSmoothingEnabled = true;
    fxCtx.imageSmoothingQuality = 'high';
    fxCtx.lineCap = 'round';
    fxCtx.lineJoin = 'round';
    ctx = fxCtx;
  }

  function endFiltered(filter) {
    ctx = mainCtx;
    if (fxBand.h <= 0) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.filter = filter;
    ctx.drawImage(fxCanvas, 0, fxBand.top, fxCanvas.width, fxBand.h, 0, fxBand.top, fxCanvas.width, fxBand.h);
    ctx.restore();
  }

  // Repite una capa horizontalmente alternando copias en espejo (sin costuras visibles).
  function drawTiled(key, offset, bottom, height) {
    const img = images[key];
    if (!ready(img)) return;
    const w = img.naturalWidth * (height / img.naturalHeight);
    const y = bottom - height;
    const period = w * 2;
    const start = -(((offset % period) + period) % period);
    for (let i = 0, x = start; x < view.w + 1; i++, x += w) {
      if (x + w < 0) continue;
      drawLayer(key, x, y, i % 2 === 1);
    }
  }

  // =====================================================================
  // RENDER: PARALLAX (imágenes de Biblián)
  // =====================================================================
  function drawSky() {
    const top = view.top - 4;
    ctx.fillStyle = SKY_TOP_COLOR;
    ctx.fillRect(-10, top, view.w + 20, CONFIG.GROUND_Y - top);

    if (!ready(images.far)) return;
    const bottom = CONFIG.GROUND_Y + 30;
    drawTiled('far', game.scroll * PARALLAX.far, bottom, LAYER_H.far);

    // Fundido del borde superior de la imagen con el color del cielo.
    const imgTop = bottom - LAYER_H.far;
    if (imgTop > top) {
      ctx.fillStyle = gradients().skyFade;
      ctx.fillRect(-10, imgTop - 1, view.w + 20, 61);
    }
  }

  // Degradados fijos en coordenadas de mundo: se crean una sola vez, no en cada frame.
  let gradientCache = null;

  function gradients() {
    if (gradientCache) return gradientCache;
    const G = CONFIG.GROUND_Y;
    const linear = (y0, y1, stops) => {
      const grd = ctx.createLinearGradient(0, y0, 0, y1);
      for (const [at, color] of stops) grd.addColorStop(at, color);
      return grd;
    };
    const imgTop = G + 30 - LAYER_H.far;
    gradientCache = {
      skyFade: linear(imgTop, imgTop + 60, [[0, SKY_TOP_COLOR], [1, 'rgba(55, 33, 114, 0)']]),
      sidewalk: linear(G, G + 16, [[0, '#bdb7d6'], [0.15, '#958eb0'], [1, '#7c7599']]),
      curb: linear(G + 16, G + 22, [[0, '#736c90'], [1, '#433c5a']]),
      asphalt: linear(G + 22, CONFIG.WORLD_H, [[0, '#2c2a38'], [0.25, '#3d3b4c'], [1, '#33313f']]),
      lampCone: linear(LAMP_Y, G + 16, [[0, 'rgba(255, 220, 130, 0.28)'], [1, 'rgba(255, 200, 90, 0)']]),
    };
    return gradientCache;
  }

  // El Santuario solo aparece durante su escena; se mueve más lento que la calle (parallax),
  // anclado a su marca para que nunca coincida con los demás lugares.
  function drawSanctuary() {
    const img = images.sanctuary;
    if (!ready(img)) return;
    const h = LAYER_H.sanctuary;
    const w = layerW('sanctuary');
    const ratio = PARALLAX.sanctuary / PARALLAX.town;
    const off = game.scroll * PARALLAX.town;
    const P = STREET.period;
    const anchor = STREET.marks.sanctuary;
    const c0 = Math.floor((off - anchor) / P);
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      const s = c * P + anchor - off;
      const cx = view.w / 2 + (s - view.w / 2) * ratio;
      if (cx - w / 2 > view.w || cx + w / 2 < 0) continue;
      drawLayer('sanctuary', cx - w / 2, CONFIG.GROUND_Y - 28 - h, false);
    }
  }

  // Calle de Biblián: casas coloniales y, en su escena, mercado, letras, obelisco o túnel.
  function drawStreet() {
    const off = game.scroll * PARALLAX.town;
    const P = STREET.period;
    const bottom = CONFIG.GROUND_Y + 4;

    for (let c = Math.floor(off / P); ; c++) {
      const base = c * P - off;
      if (base > view.w) break;
      for (const it of STREET.items) {
        const x = base + it.x;
        if (x > view.w || x + it.w < 0) continue;
        drawLayer(it.key, x, bottom - it.h, it.flip);
      }
    }
  }

  // Vallas de campaña (Lista 2 y Lista 4) sobre la acera, en el corte entre dos casas contiguas para
  // no tapar el mercado, la iglesia ni los demás lugares. Se sortean al cargar la página y se repiten
  // con el recorrido de la calle, así avanzan a la misma velocidad que las casas.
  const BILLBOARD = {
    GROUND: CONFIG.GROUND_Y + 10, // pie del poste, sobre la acera (dentro de la franja con filtro de luz)
    POLE_H: 64,
    POLE_W: 7,
    LOGO_MAX_W: 112,
    LOGO_MAX_H: 84,
    PAD: 7,
    FRAME: 4,
    CHANCE: 0.4, // probabilidad de valla en cada corte entre casas
    TRAIN_CLEARANCE: 700, // el tren cruza la calle en su escena: ahí no hay vallas
  };
  const BILLBOARDS = (() => {
    const list = [];
    const items = STREET.items;
    for (let i = 1; i < items.length; i++) {
      if (items[i - 1].key !== 'town' || items[i].key !== 'town') continue;
      const x = items[i].x;
      if (Math.abs(x - STREET.marks.train) < BILLBOARD.TRAIN_CLEARANCE) continue;
      if (Math.random() < BILLBOARD.CHANCE) list.push({ x, logo: pick(['lista2', 'lista4']) });
    }
    return list;
  })();

  function drawBillboard(x, logoKey) {
    const img = images[logoKey];
    if (!ready(img)) return;
    const B = BILLBOARD;
    const scale = Math.min(B.LOGO_MAX_W / img.naturalWidth, B.LOGO_MAX_H / img.naturalHeight);
    const lw = img.naturalWidth * scale;
    const lh = img.naturalHeight * scale;
    const bw = lw + B.PAD * 2;
    const bh = lh + B.PAD * 2;
    const boardBottom = B.GROUND - B.POLE_H;
    const bx = x - bw / 2;
    const by = boardBottom - bh;

    ctx.fillStyle = '#2b2838';
    ctx.fillRect(x - B.POLE_W / 2, boardBottom, B.POLE_W, B.POLE_H);
    ctx.fillRect(x - 13, B.GROUND - 4, 26, 4);
    ctx.fillStyle = '#5a5672';
    ctx.fillRect(x - B.POLE_W / 2, boardBottom, 2, B.POLE_H);

    ctx.fillStyle = '#2b2838';
    ctx.fillRect(bx - B.FRAME, by - B.FRAME, bw + B.FRAME * 2, bh + B.FRAME * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(bx, by, bw, bh);
    ctx.drawImage(img, bx + B.PAD, by + B.PAD, lw, lh);
  }

  function drawBillboards() {
    const off = game.scroll * PARALLAX.town;
    const P = STREET.period;
    const margin = BILLBOARD.LOGO_MAX_W;
    for (let c = Math.floor(off / P) - 1; ; c++) {
      const base = c * P - off;
      if (base - margin > view.w) break;
      for (const b of BILLBOARDS) {
        const x = base + b.x;
        if (x < -margin || x > view.w + margin) continue;
        drawBillboard(x, b.logo);
      }
    }
  }

  // Hash estable por índice: los grupos no saltan de sitio al hacer scroll.
  function crowdHash(i, salt) {
    const x = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  let signSprites = null;
  let parade = null;

  function paintRoundRect(g, x, y, w, h, r) {
    g.beginPath();
    if (g.roundRect) g.roundRect(x, y, w, h, r);
    else g.rect(x, y, w, h);
  }

  function makeSignSprite(text) {
    const font = '28px "Lilita One", "Arial Black", system-ui, sans-serif';
    const measure = document.createElement('canvas').getContext('2d');
    measure.font = font;
    const boardH = 42;
    const c = document.createElement('canvas');
    c.width = Math.ceil(measure.measureText(text).width) + 48;
    c.height = boardH + 18;
    const g = c.getContext('2d');
    g.font = font;
    g.textAlign = 'center';
    g.textBaseline = 'middle';

    g.fillStyle = '#fffdf6';
    g.strokeStyle = '#5a2848';
    g.lineWidth = 4;
    paintRoundRect(g, 2, 2, c.width - 4, boardH - 4, 10);
    g.fill();
    g.stroke();

    g.fillStyle = '#ffd60a';
    paintRoundRect(g, 8, 7, c.width - 16, 7, 3);
    g.fill();

    g.lineWidth = 5;
    g.strokeStyle = 'rgba(90, 30, 60, 0.95)';
    g.strokeText(text, c.width / 2, 27);
    g.fillStyle = '#d4145a';
    g.fillText(text, c.width / 2, 27);

    g.strokeStyle = '#5a2848';
    g.lineWidth = 4;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(c.width / 2, boardH - 4);
    g.lineTo(c.width / 2, c.height - 2);
    g.stroke();
    return c;
  }

  function crowdSigns() {
    if (!signSprites) signSprites = SIGN_PHRASES.map(makeSignSprite);
    return signSprites;
  }

  // La calle se arma una sola vez: personas distintas en grupos, con o sin cartel.
  function crowdParade() {
    if (parade) return parade;
    if (!CROWD_KEYS.every((key) => ready(images[key]))) return null;

    const fans = CROWD_KEYS.map((key) => {
      const img = images[key];
      return {
        key,
        aspect: (img.naturalWidth || img.width) / (img.naturalHeight || img.height),
        kid: key === 'fanKid',
      };
    });
    const items = [];
    let x = 30;
    let i = 0;
    while (x < 7200) {
      const roll = crowdHash(i, 1);
      const count = roll < 0.22 ? 1 : roll < 0.58 ? 2 : 3;
      const used = new Set();
      const members = [];
      for (let n = 0; n < count; n++) {
        let at = (crowdHash(i, 10 + n) * fans.length) | 0;
        for (let t = 0; t < fans.length && used.has(fans[at].key); t++) at = (at + 1) % fans.length;
        used.add(fans[at].key);
        members.push(fans[at]);
      }

      let cursor = x;
      let tallest = 0;
      const phase = crowdHash(i, 5) * TAU;
      members.forEach((fan, n) => {
        const scale = (fan.kid ? 0.66 : 0.9) + crowdHash(i, 20 + n) * 0.1;
        const h = CROWD.HEIGHT * scale;
        const w = h * fan.aspect;
        items.push({
          kind: 'person',
          key: fan.key,
          x: cursor,
          w, h,
          flip: crowdHash(i, 30 + n) < 0.4,
          phase: phase + n * 0.4,
        });
        tallest = Math.max(tallest, h);
        cursor += w * 0.74;
      });

      const span = Math.max(8, cursor - x);
      const withSign = count > 1;
      if (withSign) {
        items.push({
          kind: 'sign',
          phrase: (crowdHash(i, 4) * SIGN_PHRASES.length) | 0,
          x: x + span * 0.5,
          head: tallest,
          span,
          phase,
        });
      }
      x = cursor + 78 + crowdHash(i, 6) * 70;
      i += 1;
    }
    parade = { items, period: x };
    return parade;
  }

  // Franja vertical (mundo) que ocupan el público y sus carteles, para filtrarla de una vez.
  const CROWD_BAND_TOP = CONFIG.GROUND_Y + CROWD.FOOT - CROWD.HEIGHT - 44;
  const CROWD_BAND_BOTTOM = CONFIG.GROUND_Y + CROWD.FOOT + 6;

  // Simpatizantes en la acera, anclados por los pies y con la luz de la ciudad.
  // Primero todas las sombras (sin filtro) y luego todas las figuras en una sola pasada filtrada.
  function drawCrowd(filter) {
    const layout = crowdParade();
    if (!layout) return;
    const signs = crowdSigns();
    const off = game.scroll * PARALLAX.town;
    const first = Math.floor((off - 40) / layout.period);
    const last = Math.ceil((off + view.w + 40) / layout.period);
    const feet = CONFIG.GROUND_Y + CROWD.FOOT;
    const items = layout.items;

    ctx.fillStyle = 'rgba(20, 10, 36, 0.3)';
    for (let k = first; k <= last; k++) {
      const base = k * layout.period - off;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.kind !== 'person') continue;
        const x = base + it.x;
        if (x > view.w + 12 || x + it.w < -12) continue;
        ctx.beginPath();
        ctx.ellipse(x + it.w / 2, feet + 1, Math.min(15, it.w * 0.2), 3, 0, 0, TAU);
        ctx.fill();
      }
    }

    if (filter) beginFiltered(CROWD_BAND_TOP, CROWD_BAND_BOTTOM);
    for (let k = first; k <= last; k++) {
      const base = k * layout.period - off;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const bob = Math.sin(game.time * 2.2 + it.phase) * 1.3;
        if (it.kind === 'person') {
          const img = images[it.key];
          if (!ready(img)) continue;
          const x = base + it.x;
          if (x > view.w + 12 || x + it.w < -12) continue;
          const y = snapY(feet - it.h + bob);
          if (it.flip) {
            ctx.save();
            ctx.translate(snapX(x + it.w), y);
            ctx.scale(-1, 1);
            ctx.drawImage(img, 0, 0, it.w, it.h);
            ctx.restore();
          } else {
            ctx.drawImage(img, snapX(x), y, it.w, it.h);
          }
        } else {
          const sign = signs[it.phrase];
          const aspect = sign.width / sign.height;
          let sw = it.span * 1.05;
          let sh = sw / aspect;
          if (sh > 30) {
            sh = 30;
            sw = sh * aspect;
          }
          const x = base + it.x - sw / 2;
          if (x > view.w + 20 || x + sw < -20) continue;
          ctx.drawImage(sign, snapX(x), snapY(feet - it.head - sh + 4 + bob), sw, sh);
        }
      }
    }
    if (filter) endFiltered(filter);
  }

  function drawTrain() {
    const off = game.scroll * PARALLAX.town;
    if (smoke.count) {
      ctx.fillStyle = 'rgb(150, 140, 165)';
      for (let i = 0; i < smoke.count; i++) {
        const p = smoke.items[i];
        const x = p.x - off;
        if (x + p.r < 0 || x - p.r > view.w) continue;
        ctx.globalAlpha = 0.65 * (p.life / p.max);
        circle(x, p.y, p.r);
      }
      ctx.globalAlpha = 1;
    }

    const img = images.train;
    if (!train.active || !ready(img)) return;
    const h = LAYER_H.train;
    const w = trainWidth();
    const sx = train.x - off;
    if (sx > view.w || sx + w < 0) return;
    // Traqueteo: pequeños saltos rítmicos de la carrocería.
    const chug = Math.abs(Math.sin(game.time * 10)) * 1.3;
    const bottom = CONFIG.GROUND_Y + 4;

    ctx.fillStyle = 'rgba(15, 8, 30, 0.3)';
    ctx.beginPath();
    ctx.ellipse(sx + w / 2, bottom - 2, w * 0.48, 4, 0, 0, TAU);
    ctx.fill();
    drawLayer('train', sx, bottom - h - chug, false);

    // Luz del farol del tren.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.55 + 0.2 * Math.sin(game.time * 7);
    ctx.drawImage(thrustGlow, sx + w * 0.86 - 18, bottom - h * 0.68 - chug - 18, 36, 36);
    ctx.restore();
  }

  function drawPopups() {
    if (!popups.count) return;
    ctx.save();
    ctx.font = '18px "Lilita One", "Arial Black", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = 'rgba(90, 40, 0, 0.85)';
    ctx.fillStyle = '#ffe14d';
    for (let i = 0; i < popups.count; i++) {
      const p = popups.items[i];
      const t = p.life / 0.6;
      const s = 1 + (1 - t) * 0.3;
      ctx.globalAlpha = Math.min(1, t * 2);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.scale(s, s);
      ctx.strokeText('+1', 0, 0);
      ctx.fillText('+1', 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }

  // Anclajes de los tres cables en cada poste: [dx, dy] alternados en un arreglo plano.
  const WIRES = [-16, 6, 16, 6, 0, 22];

  // Postes de luz y cableado eléctrico (capa intermedia rápida).
  function drawPoles() {
    const off = game.scroll * PARALLAX.poles;
    const first = Math.floor(off / POLE_SPACING) - 1;
    const last = Math.ceil((off + view.w) / POLE_SPACING) + 1;
    const G = CONFIG.GROUND_Y;

    ctx.strokeStyle = 'rgba(20, 14, 34, 0.85)';
    ctx.lineWidth = 1.6;
    for (let i = first; i < last; i++) {
      const x1 = i * POLE_SPACING - off;
      const x2 = (i + 1) * POLE_SPACING - off;
      for (let w = 0; w < WIRES.length; w += 2) {
        const dx = WIRES[w];
        const dy = WIRES[w + 1];
        ctx.beginPath();
        ctx.moveTo(x1 + dx, POLE_TOP + dy);
        ctx.quadraticCurveTo((x1 + x2) / 2 + dx, POLE_TOP + dy + 34, x2 + dx, POLE_TOP + dy);
        ctx.stroke();
      }
    }

    for (let i = first; i <= last; i++) {
      const x = i * POLE_SPACING - off;
      ctx.save();
      ctx.translate(x, 0);
      ctx.fillStyle = poleGrad;
      roundRect(-4.5, POLE_TOP - 8, 9, G - POLE_TOP + 14, 3);
      ctx.fillStyle = '#241e36';
      roundRect(-23, POLE_TOP + 1, 46, 6, 3);
      ctx.fillStyle = '#c9c4de';
      roundRect(-19, POLE_TOP - 4, 5, 7, 2);
      roundRect(14, POLE_TOP - 4, 5, 7, 2);
      ctx.fillStyle = '#3a3350';
      roundRect(-7, POLE_TOP + 17, 14, 10, 3);

      // Brazo con farola: se enciende cuando el nivel de energía supera su umbral.
      ctx.strokeStyle = '#241e36';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, LAMP_Y + 6);
      ctx.quadraticCurveTo(10, LAMP_Y - 6, LAMP_X, LAMP_Y - 2);
      ctx.stroke();
      const on = lampOn(i);
      ctx.fillStyle = '#241e36';
      roundRect(LAMP_X - 9, LAMP_Y - 5, 18, 6, 3);
      ctx.fillStyle = on ? '#fff6c8' : '#6d6888';
      roundRect(LAMP_X - 7, LAMP_Y, 14, 3.5, 1.5);
      ctx.restore();

      if (on) {
        const lx = x + LAMP_X;
        const flicker = 0.92 + 0.08 * Math.sin(game.time * 13 + i * 3.1);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        // El parpadeo se aplica con globalAlpha sobre un degradado fijo (mismo resultado).
        ctx.globalAlpha = flicker;
        ctx.fillStyle = gradients().lampCone;
        ctx.beginPath();
        ctx.moveTo(lx - 7, LAMP_Y + 3);
        ctx.lineTo(lx + 7, LAMP_Y + 3);
        ctx.lineTo(lx + 46, G + 16);
        ctx.lineTo(lx - 46, G + 16);
        ctx.closePath();
        ctx.fill();
        ctx.drawImage(thrustGlow, lx - 28, LAMP_Y - 26, 56, 56);
        ctx.restore();
      }
    }
  }

  // Cada farola tiene un umbral pseudoaleatorio fijo: la ciudad se enciende poco a poco.
  function lampOn(i) {
    const h = Math.sin(i * 12.9898) * 43758.5453;
    return h - Math.floor(h) < game.light - 0.02;
  }

  function drawRoad() {
    const G = CONFIG.GROUND_Y;
    const off = game.scroll * PARALLAX.front;
    const X0 = -10;
    const XW = view.w + 20;
    const bottom = view.bottom + 10;

    const grads = gradients();

    // Acera de baldosas
    ctx.fillStyle = grads.sidewalk;
    ctx.fillRect(X0, G, XW, 16);
    ctx.fillStyle = 'rgba(80, 72, 110, 0.7)';
    const J = 36;
    for (let x = -(off % J); x < view.w; x += J) ctx.fillRect(x, G + 2, 1.5, 14);
    ctx.fillRect(X0, G + 8, XW, 1.2);

    // Bordillo
    ctx.fillStyle = grads.curb;
    ctx.fillRect(X0, G + 16, XW, 6);

    // Asfalto
    ctx.fillStyle = grads.asphalt;
    ctx.fillRect(X0, G + 22, XW, bottom - G - 22);

    // Líneas viales blancas
    ctx.fillStyle = '#ebe8f4';
    const D = 100;
    for (let x = -(off % D); x < view.w + D; x += D) roundRect(x, G + 50, 48, 4, 2);

    // Marcas de distancia cada 100 m
    if (game.state !== 'menu') {
      const step = 100 * CONFIG.PX_PER_METER;
      const base = player.x - game.runDistance;
      const k0 = Math.max(1, Math.ceil((-20 - base) / step));
      const k1 = Math.floor((view.w + 20 - base) / step);
      ctx.fillStyle = 'rgba(255, 214, 10, 0.55)';
      for (let k = k0; k <= k1; k++) ctx.fillRect(base + k * step, G + 22, 4, CONFIG.WORLD_H - G - 22);
    }
  }

  // =====================================================================
  // RENDER: ENTIDADES
  // =====================================================================
  function drawLightbulbs() {
    const S = LIGHTBULB_SIZE;
    const t = game.time;

    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < lightbulbs.count; i++) {
      const b = lightbulbs.items[i];
      if (b.x > view.w + S || b.x < -S) continue;
      ctx.globalAlpha = 0.75 + 0.25 * Math.sin(t * 6 + b.phase);
      ctx.drawImage(lightbulbGlow, b.x - 34, b.y - 34, 68, 68);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    if (!lightbulbSprite) return;
    for (let i = 0; i < lightbulbs.count; i++) {
      const b = lightbulbs.items[i];
      if (b.x > view.w + S || b.x < -S) continue;
      ctx.save();
      ctx.translate(b.x, b.y + Math.sin(t * 3 + b.phase) * 2.5);
      ctx.rotate(Math.sin(t * 2.6 + b.phase) * 0.16);
      ctx.drawImage(lightbulbSprite, -S / 2, -S / 2, S, S);
      ctx.restore();
    }
  }

  // Poste de valla eléctrica: barra metálica perpendicular al haz con un emisor de neón.
  function drawEmitter(x, y, angle, c) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);

    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = c.halo;
    circle(0, 0, NR + 10);
    ctx.globalCompositeOperation = 'source-over';

    ctx.fillStyle = '#14121d';
    roundRect(-7, -21, 14, 42, 6);
    ctx.fillStyle = metalGrad;
    roundRect(-5, -19, 10, 38, 4);
    ctx.fillStyle = c.core;
    roundRect(-5, -15, 10, 2.5, 1);
    roundRect(-5, 12.5, 10, 2.5, 1);

    ctx.fillStyle = '#14121d';
    circle(0, 0, 11);
    ctx.fillStyle = c.orb;
    circle(0, 0, 8.5);
    ctx.restore();
  }

  function drawZapper(z) {
    const { ax, ay, bx, by, color: c } = z;
    const flick = 0.75 + Math.random() * 0.25;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = flick;
    strokeLine(ax, ay, bx, by, c.beamWide, 28);
    strokeLine(ax, ay, bx, by, c.beamCore, 13);
    ctx.globalAlpha = 1;
    jagged(ax, ay, bx, by, 9, 18, c.core, 3.5);
    jagged(ax, ay, bx, by, 7, 14, c.light, 2);
    jagged(ax, ay, bx, by, 4, 22, '#ffffff', 1.4);
    ctx.restore();

    drawEmitter(ax, ay, z.angle, c);
    drawEmitter(bx, by, z.angle, c);
  }

  function drawZappers() {
    for (let i = 0; i < zappers.count; i++) {
      const z = zappers.items[i];
      if (z.x - z.len / 2 - NR - 30 > view.w || z.x + z.len / 2 + NR + 30 < 0) continue;
      drawZapper(z);
    }
  }

  function sparkle(x, y, s) {
    const k = s * 0.28;
    ctx.beginPath();
    ctx.moveTo(x, y - s);
    ctx.quadraticCurveTo(x + k, y - k, x + s, y);
    ctx.quadraticCurveTo(x + k, y + k, x, y + s);
    ctx.quadraticCurveTo(x - k, y + k, x - s, y);
    ctx.quadraticCurveTo(x - k, y - k, x, y - s);
    ctx.fill();
  }

  function drawParticle(p) {
    const t = p.life / p.max;
    switch (p.kind) {
      case 'streak':
        ctx.globalAlpha = t;
        strokeLine(p.x, p.y, p.x - p.vx * 0.025, p.y - p.vy * 0.025, p.color, p.size * 0.8);
        break;
      case 'star':
        ctx.globalAlpha = t;
        ctx.fillStyle = p.color;
        sparkle(p.x, p.y, p.size * 2.2 * (0.5 + 0.5 * t));
        break;
      case 'ring':
        ctx.globalAlpha = t;
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2.5 * t + 0.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size + (1 - t) * p.grow, 0, TAU);
        ctx.stroke();
        break;
      case 'smoke':
        ctx.globalAlpha = t * 0.35;
        ctx.fillStyle = p.color;
        circle(p.x, p.y, p.size * (1 + (1 - t) * 1.4));
        break;
      default:
        ctx.globalAlpha = t;
        ctx.fillStyle = p.color;
        circle(p.x, p.y, p.size * 0.6 * (0.5 + 0.5 * t));
    }
  }

  function particleVisible(p) {
    const m = 30 + p.size * 3 + p.grow;
    return p.x > -m && p.x < view.w + m && p.y > view.top - m && p.y < view.bottom + m;
  }

  function drawParticles() {
    const items = particles.items;
    for (let i = 0; i < particles.count; i++) {
      const p = items[i];
      if (!p.add && particleVisible(p)) drawParticle(p);
    }
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < particles.count; i++) {
      const p = items[i];
      if (p.add && particleVisible(p)) drawParticle(p);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  // Llama + rayo eléctrico del jetpack (cae hacia atrás, como en la referencia).
  function drawThrust(dead) {
    const n = nozzlePos();
    const th = dead ? 0 : player.thrust;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Piloto encendido: luz suave que "respira" incluso sin empuje.
    if (!dead) {
      const idle = 0.35 + 0.15 * Math.sin(game.time * 6);
      ctx.globalAlpha = idle * (1 - th);
      ctx.fillStyle = 'rgb(125, 230, 255)';
      circle(n.x, n.y + 2, 3.5);
      ctx.globalAlpha = 1;
    }

    if (th >= 0.05) {
      const flick = 0.85 + Math.random() * 0.3;
      ctx.drawImage(thrustGlow, n.x - 34, n.y - 24, 68, 68);

      // La llama usa degradados fijos de longitud 1: se estiran con scale(1, L) y su opacidad
      // se modula con globalAlpha = empuje (mismo resultado que crearlos en cada frame).
      const flame = flameGradients();
      ctx.save();
      ctx.translate(n.x, n.y);
      ctx.rotate(0.42 + player.tilt);
      const L = (20 + 30 * th) * flick;
      const W = 6 + 2 * th;
      ctx.scale(1, L);
      ctx.globalAlpha = th;
      ctx.fillStyle = flame.outer;
      ctx.beginPath();
      ctx.moveTo(-W, 0);
      ctx.quadraticCurveTo(-W * 0.9, 0.55, 0, 1);
      ctx.quadraticCurveTo(W * 0.9, 0.55, W, 0);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = flame.inner;
      ctx.beginPath();
      ctx.moveTo(-W * 0.45, 0);
      ctx.quadraticCurveTo(0, 0.4, 0, 0.55);
      ctx.quadraticCurveTo(0, 0.4, W * 0.45, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();

      const len = 40 + 90 * th;
      const ex = n.x - len * 0.45;
      const ey = n.y + len;
      ctx.globalAlpha = th;
      jagged(n.x, n.y, ex, ey, 9 * th, 14, 'rgba(90, 210, 255, 0.5)', 5);
      jagged(n.x, n.y, ex, ey, 7 * th, 12, 'rgba(210, 250, 255, 0.85)', 1.6);
      jagged(n.x, n.y, n.x - len * 0.25, n.y + len * 0.6, 6, 10, 'rgba(255, 240, 140, 0.7)', 1.4);
    }
    ctx.restore();
  }

  let flameCache = null;

  function flameGradients() {
    if (flameCache) return flameCache;
    const outer = ctx.createLinearGradient(0, 0, 0, 1);
    outer.addColorStop(0, 'rgba(255, 250, 215, 0.95)');
    outer.addColorStop(0.35, 'rgba(255, 196, 60, 0.85)');
    outer.addColorStop(1, 'rgba(255, 90, 20, 0)');
    const inner = ctx.createLinearGradient(0, 0, 0, 0.55);
    inner.addColorStop(0, 'rgba(255, 255, 255, 1)');
    inner.addColorStop(1, 'rgba(160, 240, 255, 0)');
    flameCache = { outer, inner };
    return flameCache;
  }

  // Sombra en el suelo: se encoge y se desvanece con la altura.
  function drawShadow() {
    const feet = player.y + player.h / 2;
    const h = Math.max(0, ROAD_Y - feet);
    const t = clamp(1 - h / 360, 0.12, 1);
    ctx.globalAlpha = 0.38 * t;
    ctx.fillStyle = 'rgb(15, 8, 30)';
    ctx.beginPath();
    ctx.ellipse(player.x + 2, ROAD_Y + 2, 8 + 20 * t, 2 + 4 * t, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawPlayerFrame(src, frame, alpha) {
    const cw = src.width / PLAYER_FRAME_COUNT;
    const ch = src.height;
    const feet = player.h / 2;
    ctx.globalAlpha = alpha;
    ctx.drawImage(
      src, frame * cw, 0, cw, ch,
      (-cw * PLAYER_SCALE) / 2, feet - (ch - PLAYER_PAD) * PLAYER_SCALE,
      cw * PLAYER_SCALE, ch * PLAYER_SCALE
    );
  }

  function drawPlayer() {
    const sheet = images.player;
    const dead = game.state === 'dying' || game.state === 'gameover';
    const shock = dead && game.deathTimer < 0.7 && Math.floor(game.deathTimer * 18) % 2 === 0;

    drawShadow();
    if (!ready(sheet)) return;

    // Imágenes fantasma (estela de velocidad).
    for (let i = 0; i < trail.count; i++) {
      const t = trail.items[i];
      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.rotate(t.rot);
      drawPlayerFrame(sheet, t.frame, 0.28 * (t.life / t.max));
      ctx.restore();
    }
    ctx.globalAlpha = 1;

    if (anim.glow > 0) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = anim.glow;
      ctx.drawImage(collectGlow, player.x - 60, player.y - 60, 120, 120);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    drawThrust(dead);

    const running = !dead && player.onGround;
    const flying = !dead && !player.onGround;
    const t = game.time;

    // El sprite ya trae el ciclo de carrera. Solo un rebote corto, al ritmo de los pasos.
    const bob = running ? -Math.abs(Math.sin(player.runPhase)) * 4 : 0;
    const lean = running ? 0.05 : 0;
    const hover = flying ? Math.sin(t * 5.2) * 2.2 : 0;
    const sway = flying ? Math.sin(t * 2.6) * 0.035 : 0;

    const src = shock && shockSprite ? shockSprite : sheet;
    const feet = player.h / 2;
    const s = anim.squash;

    ctx.save();
    ctx.translate(player.x, player.y + bob + hover);
    ctx.rotate(dead ? player.rot : player.tilt + lean + sway + easeInOut(anim.flip) * TAU);
    ctx.translate(0, feet);
    ctx.scale(1 + s * 0.7, 1 - s);
    ctx.translate(0, -feet);

    if (shock) {
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(125, 249, 255, 0.35)';
      circle(0, 0, 50);
      ctx.globalCompositeOperation = 'source-over';
    }

    if (anim.blend < 1) drawPlayerFrame(src, anim.prevFrame, 1);
    drawPlayerFrame(src, anim.frame, anim.blend < 1 ? anim.blend : 1);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // Líneas de velocidad sutiles cuando el ritmo es alto.
  function drawSpeedLines() {
    const k = clamp((game.speed - 520) / 300, 0, 1);
    if (k <= 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = k;
    ctx.strokeStyle = 'rgba(220, 230, 255, 0.18)';
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 7; i++) {
      const seed = i * 97.13;
      const y = CONFIG.CEILING_Y + ((seed * 7.7) % (CONFIG.GROUND_Y - CONFIG.CEILING_Y));
      const len = 60 + (seed % 80);
      const x = view.w - ((game.scroll * 1.6 + seed * 13) % (view.w + len * 2));
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + len, y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // =====================================================================
  // RENDER: FRAME COMPLETO
  // =====================================================================
  function render() {
    let sx = 0, sy = 0;
    if (game.shake > 0) {
      const m = game.shake * game.shake * 8;
      sx = rand(-m, m);
      sy = rand(-m, m);
    }

    const k = view.k;
    view.tx = sx * k;
    view.ty = view.offsetY * view.dpr + sy * k;
    ctx = mainCtx;
    ctx.setTransform(k, 0, 0, k, view.tx, view.ty);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    drawSky();
    // Sin energía la ciudad se ve apagada; se va encendiendo a medida que se recolectan kW.
    // El filtro se aplica una sola vez al grupo completo (Santuario + calle + tren).
    const filter = cityFilter();
    if (filter) beginFiltered(view.top, CONFIG.GROUND_Y + 10);
    drawSanctuary();
    drawStreet();
    drawBillboards();
    drawTrain();
    if (filter) endFiltered(filter);
    drawPoles();
    drawRoad();
    drawCrowd(filter);
    drawSpeedLines();
    drawLightbulbs();
    drawZappers();
    drawParticles();
    drawPlayer();
    drawPopups();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = vignetteGrad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (game.flash > 0) {
      ctx.globalAlpha = game.flash * 0.7;
      ctx.fillStyle = 'rgb(220, 250, 255)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalAlpha = 1;
    }
  }

  // =====================================================================
  // HUD
  // =====================================================================
  const hudCache = { energy: -1, meters: -1, record: -1 };

  function bump(el) {
    if (el.animate) {
      el.animate(
        [{ transform: 'scale(1.18)' }, { transform: 'scale(1)' }],
        { duration: 180, easing: 'ease-out' }
      );
    }
  }

  function updateHUD() {
    const e = game.energy;
    if (e !== hudCache.energy) {
      dom.energy.textContent = `${e} kW`;
      if (e > hudCache.energy && hudCache.energy >= 0) bump(dom.energy);
      hudCache.energy = e;

      const pct = lightTarget();
      dom.lightValue.textContent = `${Math.round(pct * 100)} %`;
      dom.lightFill.style.transform = `scaleX(${pct})`;
      dom.lightFill.parentElement.classList.toggle('full', pct >= 1);
    }

    const m = Math.floor(meters());
    if (m !== hudCache.meters) {
      dom.distance.textContent = `${m} m`;
      hudCache.meters = m;
    }

    const r = Math.max(game.record, e);
    if (r !== hudCache.record) {
      dom.record.textContent = `Récord: ${r} kW`;
      hudCache.record = r;
    }
  }

  // =====================================================================
  // COMPARTIR PUNTAJE
  // =====================================================================
  let shareCard = null;

  function coverImage(g, img, x, y, w, h) {
    const k = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const iw = img.naturalWidth * k;
    const ih = img.naturalHeight * k;
    g.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  }

  function fitText(g, text, maxW, size, family) {
    let s = size;
    g.font = `${s}px ${family}`;
    while (g.measureText(text).width > maxW && s > 12) {
      s -= 2;
      g.font = `${s}px ${family}`;
    }
  }

  // Tarjeta 1080×1350 (formato vertical de redes sociales) con el puntaje y la ciudad de fondo.
  async function buildShareCard(stats) {
    const FONT = '"Lilita One", "Arial Black", system-ui, sans-serif';
    try { await document.fonts.load(`80px "Lilita One"`); } catch { /* fuente de respaldo */ }

    const W = 1080, H = 1350;
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';

    g.fillStyle = SKY_TOP_COLOR;
    g.fillRect(0, 0, W, H);
    if (ready(images.far)) coverImage(g, images.far, 0, 0, W, 1120);
    if (ready(images.sanctuary)) {
      const h = 760;
      const w = h * ASPECT.sanctuary;
      g.drawImage(images.sanctuary, W - w + 140, 1060 - h, w, h);
    }
    if (ready(images.town)) {
      const h = 330;
      const w = h * ASPECT.town;
      for (let x = -120, i = 0; x < W; x += w, i++) {
        g.save();
        if (i % 2) {
          g.translate(x + w, 0);
          g.scale(-1, 1);
          g.drawImage(images.town, 0, 1130 - h, w, h);
        } else {
          g.drawImage(images.town, x, 1130 - h, w, h);
        }
        g.restore();
      }
    }

    let grd = g.createLinearGradient(0, 1110, 0, H);
    grd.addColorStop(0, '#3c3a4a');
    grd.addColorStop(1, '#120a22');
    g.fillStyle = grd;
    g.fillRect(0, 1110, W, H - 1110);

    grd = g.createLinearGradient(0, 0, 0, 640);
    grd.addColorStop(0, 'rgba(15, 5, 36, 0.92)');
    grd.addColorStop(1, 'rgba(15, 5, 36, 0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, 640);

    // Personaje volando con su resplandor.
    const sheet = images.player;
    if (ready(sheet)) {
      const cw = sheet.naturalWidth / PLAYER_FRAME_COUNT;
      const ch = sheet.naturalHeight;
      const k = 2.3;
      g.save();
      g.translate(260, 820);
      g.globalCompositeOperation = 'lighter';
      g.drawImage(collectGlow, -260, -230, 520, 520);
      g.globalCompositeOperation = 'source-over';
      g.rotate(-0.12);
      g.drawImage(sheet, PLAYER_FRAMES.fly[0] * cw, 0, cw, ch, (-cw * k) / 2, (-ch * k) / 2, cw * k, ch * k);
      g.restore();
    }

    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.lineJoin = 'round';

    fitText(g, CAMPAIGN.gameName, W - 120, 96, FONT);
    g.lineWidth = 14;
    g.strokeStyle = 'rgba(90, 20, 70, 0.95)';
    g.strokeText(CAMPAIGN.gameName, W / 2, 130);
    grd = g.createLinearGradient(0, 50, 0, 140);
    grd.addColorStop(0, '#fff6b0');
    grd.addColorStop(0.5, '#ffd60a');
    grd.addColorStop(1, '#ff7a3d');
    g.fillStyle = grd;
    g.fillText(CAMPAIGN.gameName, W / 2, 130);

    g.font = `150px ${FONT}`;
    g.lineWidth = 16;
    g.strokeStyle = 'rgba(20, 8, 40, 0.9)';
    g.strokeText(`${stats.meters} m`, W / 2, 330);
    g.fillStyle = '#ffffff';
    g.fillText(`${stats.meters} m`, W / 2, 330);

    g.font = `84px ${FONT}`;
    g.lineWidth = 12;
    g.strokeText(`⚡ ${stats.energy} kW`, W / 2, 450);
    g.fillStyle = '#ffd60a';
    g.fillText(`⚡ ${stats.energy} kW`, W / 2, 450);

    g.font = `44px ${FONT}`;
    g.lineWidth = 9;
    const lightText = `Biblián iluminada al ${Math.round(stats.light * 100)} %`;
    g.strokeText(lightText, W / 2, 530);
    g.fillStyle = '#7df9ff';
    g.fillText(lightText, W / 2, 530);

    g.font = `92px ${FONT}`;
    g.lineWidth = 14;
    g.strokeStyle = 'rgba(20, 8, 40, 0.95)';
    g.strokeText('¿ME SUPERAS?', W / 2, 1215);
    g.fillStyle = '#ff4d8d';
    g.fillText('¿ME SUPERAS?', W / 2, 1215);

    fitText(g, `${CAMPAIGN.slogan} ${CAMPAIGN.hashtag}`, W - 100, 40, FONT);
    g.fillStyle = '#ffffff';
    g.fillText(`${CAMPAIGN.slogan} ${CAMPAIGN.hashtag}`, W / 2, 1285);

    return new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.9));
  }

  const shareUrl = () => CAMPAIGN.shareUrl || location.href.split(/[?#]/)[0];

  async function shareScore() {
    sound.init();
    sound.click();
    const url = shareUrl();
    const text = `¡Acabo de hacer ${game.energy} kW en el juego de Miguel Zhindón y estoy en el Top de Biblián! ¿Puedes superarme para ganar el premio? Juega aquí: ${url}`;

    let blob = null;
    try { blob = await shareCard; } catch { /* sin imagen */ }
    const file = blob ? new File([blob], 'biblian-jetpack.jpg', { type: 'image/jpeg' }) : null;

    try {
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: CAMPAIGN.gameName, text });
        return;
      }
      if (navigator.share) {
        await navigator.share({ title: CAMPAIGN.gameName, text, url });
        return;
      }
    } catch (err) {
      if (err && err.name === 'AbortError') return;
    }

    const wa = `https://wa.me/?text=${encodeURIComponent(text)}`;
    try { window.open(wa, '_blank', 'noopener'); } catch { /* sin ventana */ }
    try {
      await navigator.clipboard.writeText(text);
      showToast('WHATSAPP ABIERTO · TEXTO COPIADO');
    } catch {
      showToast('ABRE WHATSAPP PARA COMPARTIR');
    }
  }

  // =====================================================================
  // BUCLE PRINCIPAL
  // =====================================================================
  let lastTime = performance.now();

  function frame(now) {
    let dt = (now - lastTime) / 1000;
    lastTime = now;
    if (!(dt > 0)) dt = 0;
    if (dt > CONFIG.MAX_FRAME_DT) dt = CONFIG.MAX_FRAME_DT;

    // Sub-pasos fijos: físicas estables y sin "tunneling" a alta velocidad.
    let acc = dt;
    while (acc > 1e-6) {
      const step = Math.min(CONFIG.PHYSICS_STEP, acc);
      update(step);
      acc -= step;
    }

    updateEffects(dt);
    render();
    updateHUD();
    requestAnimationFrame(frame);
  }

  // =====================================================================
  // ARRANQUE
  // =====================================================================
  resetPlayer();
  resize();
  // Se arranca en la escena del Santuario, con la iglesia ya visible a la derecha.
  game.scroll = (STREET.marks.sanctuary - view.w * 0.95) / PARALLAX.town;
  if (document.fonts) document.fonts.ready.then(() => { signSprites = null; });
  setMuteUI();
  dom.startRecord.textContent = `${game.record} kW`;
  updateHUD();
  fetchLeaderboard();
  requestAnimationFrame(frame);
})();
