/**
 * Lottie Animation Builder
 *
 * Generates Lottie-compatible JSON animation data programmatically.
 * Each animation is a 64x64 canvas, 30fps, looping.
 * Used for workflow node icons and admin console icons.
 */

// ─── Types ────────────────────────────────────────────────────────
export interface LottieAnimationData {
  v: string;      // Version
  fr: number;     // Frame rate
  ip: number;     // In point
  op: number;     // Out point (frames)
  w: number;      // Width
  h: number;      // Height
  nm: string;     // Name
  ddd: number;    // 3D = 0
  assets: any[];
  layers: any[];
}

type RGBA = [number, number, number, number]; // 0-1 range

// ─── Color Helpers ────────────────────────────────────────────────
export function hexToRGBA(hex: string): RGBA {
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b, 1];
}

function rgba(r: number, g: number, b: number, a = 1): RGBA {
  return [r, g, b, a];
}

// ─── Keyframe Helpers ─────────────────────────────────────────────
function staticValue(k: number | number[]) {
  return { a: 0, k };
}

function animatedValue(keyframes: Array<{ t: number; s: number[]; e?: number[] }>) {
  return { a: 1, k: keyframes };
}

function easeInOut() {
  return { i: { x: [0.4], y: [1] }, o: { x: [0.6], y: [0] } };
}

// ─── Shape Primitives ─────────────────────────────────────────────
function ellipseShape(size: number[], position: number[] = [0, 0]) {
  return { ty: 'el', d: 1, s: staticValue(size), p: staticValue(position) };
}

function rectShape(size: number[], position: number[] = [0, 0], roundness = 0) {
  return { ty: 'rc', d: 1, s: staticValue(size), p: staticValue(position), r: staticValue(roundness) };
}

function fillShape(color: RGBA) {
  return { ty: 'fl', c: staticValue(color as any), o: staticValue(100), r: 1 };
}

function strokeShape(color: RGBA, width: number) {
  return { ty: 'st', c: staticValue(color as any), o: staticValue(100), w: staticValue(width), lc: 2, lj: 2 };
}

type AnimatedOrStatic = number | number[] | { a: number; k: any };

function transformGroup(
  position: AnimatedOrStatic = [0, 0],
  anchor: AnimatedOrStatic = [0, 0],
  scale: AnimatedOrStatic = [100, 100],
  rotation: AnimatedOrStatic = 0,
  opacity: AnimatedOrStatic = 100
) {
  const toVal = (v: AnimatedOrStatic) =>
    typeof v === 'object' && !Array.isArray(v) && 'a' in v ? v : staticValue(v as number | number[]);
  return {
    ty: 'tr',
    p: toVal(position),
    a: toVal(anchor),
    s: toVal(scale),
    r: toVal(rotation),
    o: toVal(opacity),
  };
}

function group(shapes: any[], transform?: any) {
  return {
    ty: 'gr',
    it: transform ? [...shapes, transform] : shapes,
    nm: 'Group',
  };
}

function pathShape(vertices: number[][], inTangents?: number[][], outTangents?: number[][], closed = true) {
  const v = vertices;
  const i = inTangents || vertices.map(() => [0, 0]);
  const o = outTangents || vertices.map(() => [0, 0]);
  return {
    ty: 'sh',
    d: 1,
    ks: staticValue({ v, i, o, c: closed } as any),
  };
}

// ─── Layer Builder ────────────────────────────────────────────────
function shapeLayer(
  name: string,
  shapes: any[],
  transform?: {
    position?: any;
    anchor?: any;
    scale?: any;
    rotation?: any;
    opacity?: any;
  }
): any {
  const t = transform || {};
  return {
    ty: 4,
    nm: name,
    sr: 1,
    st: 0,
    op: 90, // 3s at 30fps
    ip: 0,
    ks: {
      o: t.opacity || staticValue(100),
      r: t.rotation || staticValue(0),
      p: t.position || staticValue([32, 32, 0]),
      a: t.anchor || staticValue([0, 0, 0]),
      s: t.scale || staticValue([100, 100, 100]),
    },
    shapes,
  };
}

// ─── Animation Wrapper ────────────────────────────────────────────
function createAnimation(name: string, layers: any[]): LottieAnimationData {
  return {
    v: '5.7.4',
    fr: 30,
    ip: 0,
    op: 90, // 3 seconds at 30fps
    w: 64,
    h: 64,
    nm: name,
    ddd: 0,
    assets: [],
    layers,
  };
}

// ═══════════════════════════════════════════════════════════════════
// ANIMATION FACTORIES
// ═══════════════════════════════════════════════════════════════════

/**
 * Pulsing ring with inner dot - used for triggers, signals
 */
export function createPulsingRing(color: string, innerColor?: string): LottieAnimationData {
  const c = hexToRGBA(color);
  const ic = innerColor ? hexToRGBA(innerColor) : c;

  // Outer ring that pulses
  const outerRing = shapeLayer('ring', [
    group([
      ellipseShape([40, 40]),
      strokeShape(c, 3),
      transformGroup([0, 0], [0, 0],
        animatedValue([
          { t: 0, s: [80, 80], e: [110, 110] },
          { t: 45, s: [110, 110], e: [80, 80] },
          { t: 90, s: [80, 80] },
        ]),
      ),
    ]),
  ]);

  // Inner filled circle
  const innerDot = shapeLayer('dot', [
    group([
      ellipseShape([16, 16]),
      fillShape(ic),
      transformGroup([0, 0], [0, 0],
        animatedValue([
          { t: 0, s: [100, 100], e: [120, 120] },
          { t: 45, s: [120, 120], e: [100, 100] },
          { t: 90, s: [100, 100] },
        ]),
      ),
    ]),
  ]);

  // Expanding echo ring
  const echo = shapeLayer('echo', [
    group([
      ellipseShape([40, 40]),
      strokeShape([...c.slice(0, 3), 0.4] as RGBA, 1.5),
      transformGroup([0, 0], [0, 0],
        animatedValue([
          { t: 0, s: [80, 80], e: [160, 160] },
          { t: 60, s: [160, 160] },
        ]),
        0,
        animatedValue([
          { t: 0, s: [60], e: [0] },
          { t: 60, s: [0] },
        ]),
      ),
    ]),
  ]);

  return createAnimation('pulsing-ring', [outerRing, innerDot, echo]);
}

/**
 * Rotating gear/cog - used for settings, tools, MCP
 */
export function createRotatingGear(color: string): LottieAnimationData {
  const c = hexToRGBA(color);

  // Create gear teeth as a star-like path
  const teeth = 8;
  const outerR = 18;
  const innerR = 13;
  const vertices: number[][] = [];
  for (let i = 0; i < teeth * 2; i++) {
    const angle = (Math.PI * 2 * i) / (teeth * 2) - Math.PI / 2;
    const r = i % 2 === 0 ? outerR : innerR;
    vertices.push([Math.cos(angle) * r, Math.sin(angle) * r]);
  }

  const gear = shapeLayer('gear', [
    group([
      pathShape(vertices),
      fillShape(c),
      // Center hole
      ellipseShape([10, 10]),
      { ty: 'fl', c: staticValue([0.07, 0.07, 0.09, 1] as any), o: staticValue(100), r: 1 },
      transformGroup([0, 0], [0, 0], [100, 100],
        animatedValue([
          { t: 0, s: [0], e: [360] },
          { t: 90, s: [360] },
        ]),
      ),
    ]),
  ]);

  return createAnimation('rotating-gear', [gear]);
}

/**
 * Neural network - connected nodes pulsing
 */
export function createNeuralNetwork(color: string, accentColor?: string): LottieAnimationData {
  const c = hexToRGBA(color);
  // theme-allow: Lottie renders from baked animation JSON and cannot read CSS
  // vars; default to the brand signal-orange instead of the old purple.
  const ac = accentColor ? hexToRGBA(accentColor) : hexToRGBA('#FF5722');

  // Node positions in a mini network layout
  const nodes = [
    [-14, -10], [0, -16], [14, -10],
    [-10, 6], [10, 6],
    [0, 16],
  ];

  // Connections between nodes
  const connections = [
    [0, 3], [0, 4], [1, 3], [1, 4], [2, 4], [2, 3],
    [3, 5], [4, 5],
  ];

  const layers: any[] = [];

  // Connection lines
  connections.forEach(([from, to], idx) => {
    const line = shapeLayer(`conn-${idx}`, [
      group([
        pathShape([nodes[from], nodes[to]], [[0, 0], [0, 0]], [[0, 0], [0, 0]], false),
        strokeShape([...c.slice(0, 3), 0.4] as RGBA, 1.5),
        transformGroup([0, 0], [0, 0], [100, 100], 0,
          animatedValue([
            { t: idx * 5, s: [30], e: [80] },
            { t: idx * 5 + 30, s: [80], e: [30] },
            { t: 90, s: [30] },
          ]),
        ),
      ]),
    ]);
    layers.push(line);
  });

  // Node circles
  nodes.forEach(([x, y], idx) => {
    const isMiddle = idx >= 3 && idx < 5;
    const nodeColor = isMiddle ? ac : c;
    const node = shapeLayer(`node-${idx}`, [
      group([
        ellipseShape([7, 7]),
        fillShape(nodeColor),
        transformGroup([x, y], [0, 0],
          animatedValue([
            { t: idx * 8, s: [90, 90], e: [120, 120] },
            { t: idx * 8 + 25, s: [120, 120], e: [90, 90] },
            { t: 90, s: [90, 90] },
          ]),
        ),
      ]),
    ]);
    layers.push(node);
  });

  return createAnimation('neural-network', layers);
}

/**
 * Lightning bolt with flash - used for triggers, power
 */
export function createLightningBolt(color: string): LottieAnimationData {
  const c = hexToRGBA(color);

  const bolt = shapeLayer('bolt', [
    group([
      pathShape([
        [-2, -20], [6, -4], [0, -4], [8, 4], [-2, 4], [4, 20], [-8, 0], [-2, 0], [-8, -8],
      ]),
      fillShape(c),
      transformGroup([0, -2], [0, 0],
        animatedValue([
          { t: 0, s: [100, 100], e: [110, 110] },
          { t: 10, s: [110, 110], e: [100, 100] },
          { t: 20, s: [100, 100] },
          { t: 60, s: [100, 100], e: [115, 115] },
          { t: 65, s: [115, 115], e: [100, 100] },
          { t: 75, s: [100, 100] },
          { t: 90, s: [100, 100] },
        ]),
        0,
        animatedValue([
          { t: 0, s: [100], e: [100] },
          { t: 55, s: [100], e: [40] },
          { t: 60, s: [40], e: [100] },
          { t: 65, s: [100], e: [40] },
          { t: 70, s: [40], e: [100] },
          { t: 90, s: [100] },
        ]),
      ),
    ]),
  ]);

  // Glow effect
  const glow = shapeLayer('glow', [
    group([
      ellipseShape([48, 48]),
      fillShape([...c.slice(0, 3), 0.15] as RGBA),
      transformGroup([0, 0], [0, 0],
        animatedValue([
          { t: 0, s: [80, 80], e: [80, 80] },
          { t: 55, s: [80, 80], e: [130, 130] },
          { t: 70, s: [130, 130], e: [80, 80] },
          { t: 90, s: [80, 80] },
        ]),
      ),
    ]),
  ]);

  return createAnimation('lightning-bolt', [glow, bolt]);
}

/**
 * Flowing arrows / data flow - for transform, merge
 */
export function createFlowingArrows(color: string): LottieAnimationData {
  const c = hexToRGBA(color);

  const layers: any[] = [];
  const offsets = [-12, 0, 12];

  offsets.forEach((yOff, idx) => {
    const arrow = shapeLayer(`arrow-${idx}`, [
      group([
        pathShape([[-16, 0], [8, 0], [4, -5]], [[0, 0], [0, 0], [0, 0]], [[0, 0], [0, 0], [0, 0]], false),
        strokeShape(c, 2.5),
        pathShape([[8, 0], [4, 5]], [[0, 0], [0, 0]], [[0, 0], [0, 0]], false),
        strokeShape(c, 2.5),
        transformGroup(
          animatedValue([
            { t: idx * 10, s: [-24, yOff], e: [24, yOff] },
            { t: idx * 10 + 60, s: [24, yOff] },
          ]),
          [0, 0],
          [100, 100],
          0,
          animatedValue([
            { t: idx * 10, s: [0], e: [100] },
            { t: idx * 10 + 15, s: [100] },
            { t: idx * 10 + 45, s: [100], e: [0] },
            { t: idx * 10 + 60, s: [0] },
          ]),
        ),
      ]),
    ]);
    layers.push(arrow);
  });

  return createAnimation('flowing-arrows', layers);
}

/**
 * Code brackets with cursor - for code, openagentic
 */
export function createCodeBrackets(color: string): LottieAnimationData {
  const c = hexToRGBA(color);

  // Left bracket <
  const leftBracket = shapeLayer('left', [
    group([
      pathShape([[0, -14], [-10, 0], [0, 14]], [[0, 0], [0, 0], [0, 0]], [[0, 0], [0, 0], [0, 0]], false),
      strokeShape(c, 2.5),
      transformGroup([-12, 0]),
    ]),
  ]);

  // Right bracket >
  const rightBracket = shapeLayer('right', [
    group([
      pathShape([[0, -14], [10, 0], [0, 14]], [[0, 0], [0, 0], [0, 0]], [[0, 0], [0, 0], [0, 0]], false),
      strokeShape(c, 2.5),
      transformGroup([12, 0]),
    ]),
  ]);

  // Blinking cursor in center
  const cursor = shapeLayer('cursor', [
    group([
      rectShape([2, 16]),
      fillShape(c),
      transformGroup([0, 0], [0, 0], [100, 100], 0,
        animatedValue([
          { t: 0, s: [100] },
          { t: 15, s: [100], e: [0] },
          { t: 20, s: [0], e: [0] },
          { t: 35, s: [0], e: [100] },
          { t: 40, s: [100] },
          { t: 55, s: [100], e: [0] },
          { t: 60, s: [0], e: [0] },
          { t: 75, s: [0], e: [100] },
          { t: 80, s: [100] },
          { t: 90, s: [100] },
        ]),
      ),
    ]),
  ]);

  // Slash /
  const slash = shapeLayer('slash', [
    group([
      pathShape([[4, -14], [-4, 14]], [[0, 0], [0, 0]], [[0, 0], [0, 0]], false),
      strokeShape([...c.slice(0, 3), 0.5] as RGBA, 1.5),
      transformGroup([0, 0]),
    ]),
  ]);

  return createAnimation('code-brackets', [leftBracket, rightBracket, slash, cursor]);
}

/**
 * Branching path - for condition, decision
 */
export function createBranchingPath(color: string, trueColor: string, falseColor: string): LottieAnimationData {
  const c = hexToRGBA(color);
  const tc = hexToRGBA(trueColor);
  const fc = hexToRGBA(falseColor);

  // Diamond shape
  const diamond = shapeLayer('diamond', [
    group([
      pathShape([[0, -12], [10, 0], [0, 12], [-10, 0]]),
      fillShape(c),
      transformGroup([0, -6], [0, 0],
        animatedValue([
          { t: 0, s: [100, 100], e: [108, 108] },
          { t: 45, s: [108, 108], e: [100, 100] },
          { t: 90, s: [100, 100] },
        ]),
      ),
    ]),
  ]);

  // True path (right)
  const truePath = shapeLayer('true', [
    group([
      pathShape([[0, 6], [0, 12], [12, 18]], [[0, 0], [0, 0], [0, 0]], [[0, 0], [0, 0], [0, 0]], false),
      strokeShape(tc, 2),
      // Arrow head
      ellipseShape([5, 5]),
      fillShape(tc),
      transformGroup([12, 18], [0, 0],
        animatedValue([
          { t: 20, s: [0, 0], e: [100, 100] },
          { t: 40, s: [100, 100] },
          { t: 90, s: [100, 100] },
        ]),
      ),
    ]),
  ]);

  // False path (left)
  const falsePath = shapeLayer('false', [
    group([
      pathShape([[0, 6], [0, 12], [-12, 18]], [[0, 0], [0, 0], [0, 0]], [[0, 0], [0, 0], [0, 0]], false),
      strokeShape(fc, 2),
      ellipseShape([5, 5]),
      fillShape(fc),
      transformGroup([-12, 18], [0, 0],
        animatedValue([
          { t: 20, s: [0, 0], e: [100, 100] },
          { t: 40, s: [100, 100] },
          { t: 90, s: [100, 100] },
        ]),
      ),
    ]),
  ]);

  return createAnimation('branching-path', [diamond, truePath, falsePath]);
}

/**
 * Looping arrows - for loop, iteration
 */
export function createLoopArrows(color: string): LottieAnimationData {
  const c = hexToRGBA(color);

  const loop = shapeLayer('loop', [
    group([
      // Circular arc (top half)
      ellipseShape([28, 28]),
      strokeShape(c, 2.5),
      transformGroup([0, 0], [0, 0], [100, 100],
        animatedValue([
          { t: 0, s: [0], e: [360] },
          { t: 90, s: [360] },
        ]),
      ),
    ]),
  ]);

  // Arrow head on the circle
  const arrowHead = shapeLayer('arrow', [
    group([
      pathShape([[0, -4], [5, 0], [0, 4]], [[0, 0], [0, 0], [0, 0]], [[0, 0], [0, 0], [0, 0]], false),
      fillShape(c),
      transformGroup([14, 0], [0, 0], [100, 100],
        animatedValue([
          { t: 0, s: [0], e: [360] },
          { t: 90, s: [360] },
        ]),
      ),
    ]),
  ]);

  return createAnimation('loop-arrows', [loop, arrowHead]);
}

/**
 * Hourglass / timer - for wait, delay
 */
export function createHourglass(color: string): LottieAnimationData {
  const c = hexToRGBA(color);

  const glass = shapeLayer('glass', [
    group([
      // Top triangle
      pathShape([[-10, -18], [10, -18], [0, -2]]),
      fillShape([...c.slice(0, 3), 0.3] as RGBA),
      // Bottom triangle
      pathShape([[-10, 18], [10, 18], [0, 2]]),
      fillShape([...c.slice(0, 3), 0.6] as RGBA),
      // Frame lines
      pathShape([[-12, -20], [12, -20]], [[0, 0], [0, 0]], [[0, 0], [0, 0]], false),
      strokeShape(c, 2),
      pathShape([[-12, 20], [12, 20]], [[0, 0], [0, 0]], [[0, 0], [0, 0]], false),
      strokeShape(c, 2),
      transformGroup([0, 0], [0, 0], [100, 100],
        animatedValue([
          { t: 0, s: [0] },
          { t: 40, s: [0], e: [180] },
          { t: 50, s: [180] },
          { t: 90, s: [180] },
        ]),
      ),
    ]),
  ]);

  // Sand particle falling
  const sand = shapeLayer('sand', [
    group([
      ellipseShape([3, 3]),
      fillShape(c),
      transformGroup(
        animatedValue([
          { t: 5, s: [0, -8], e: [0, 8] },
          { t: 35, s: [0, 8] },
        ]),
        [0, 0],
        [100, 100],
        0,
        animatedValue([
          { t: 0, s: [0], e: [100] },
          { t: 5, s: [100] },
          { t: 30, s: [100], e: [0] },
          { t: 35, s: [0] },
        ]),
      ),
    ]),
  ]);

  return createAnimation('hourglass', [glass, sand]);
}

/**
 * Shield with checkmark - for approval, security
 */
export function createShieldCheck(color: string, checkColor?: string): LottieAnimationData {
  const c = hexToRGBA(color);
  // theme-allow: Lottie animation JSON literal — default to brand success green.
  const cc = checkColor ? hexToRGBA(checkColor) : hexToRGBA('#22C55E');

  const shield = shapeLayer('shield', [
    group([
      pathShape([
        [0, -18], [14, -10], [14, 4], [0, 18], [-14, 4], [-14, -10],
      ]),
      fillShape([...c.slice(0, 3), 0.2] as RGBA),
      strokeShape(c, 2),
      transformGroup([0, 0], [0, 0],
        animatedValue([
          { t: 0, s: [90, 90], e: [100, 100] },
          { t: 20, s: [100, 100] },
          { t: 90, s: [100, 100] },
        ]),
      ),
    ]),
  ]);

  // Checkmark that draws in
  const check = shapeLayer('check', [
    group([
      pathShape([[-6, 0], [-2, 5], [7, -6]], [[0, 0], [0, 0], [0, 0]], [[0, 0], [0, 0], [0, 0]], false),
      strokeShape(cc, 2.5),
      transformGroup([0, 1], [0, 0],
        animatedValue([
          { t: 20, s: [0, 0], e: [100, 100] },
          { t: 35, s: [100, 100] },
          { t: 90, s: [100, 100] },
        ]),
        0,
        animatedValue([
          { t: 15, s: [0], e: [100] },
          { t: 30, s: [100] },
          { t: 90, s: [100] },
        ]),
      ),
    ]),
  ]);

  return createAnimation('shield-check', [shield, check]);
}

/**
 * Hand / palm for human approval
 */
export function createHandRaise(color: string): LottieAnimationData {
  const c = hexToRGBA(color);

  const hand = shapeLayer('hand', [
    group([
      // Palm
      rectShape([16, 14], [0, 4], 3),
      fillShape(c),
      // Fingers
      rectShape([3, 10], [-5, -8], 1.5),
      fillShape(c),
      rectShape([3, 12], [-1.5, -10], 1.5),
      fillShape(c),
      rectShape([3, 11], [2, -9], 1.5),
      fillShape(c),
      rectShape([3, 8], [5.5, -6], 1.5),
      fillShape(c),
      // Thumb
      rectShape([8, 3], [-10, 0], 1.5),
      fillShape(c),
      transformGroup([0, 2], [0, 0],
        animatedValue([
          { t: 0, s: [100, 100] },
          { t: 20, s: [100, 100], e: [105, 105] },
          { t: 40, s: [105, 105], e: [100, 100] },
          { t: 90, s: [100, 100] },
        ]),
        animatedValue([
          { t: 0, s: [0] },
          { t: 15, s: [0], e: [-8] },
          { t: 30, s: [-8], e: [8] },
          { t: 45, s: [8], e: [0] },
          { t: 90, s: [0] },
        ]),
      ),
    ]),
  ]);

  return createAnimation('hand-raise', [hand]);
}

/**
 * Globe with orbiting dot - for HTTP, web
 */
export function createGlobe(color: string): LottieAnimationData {
  const c = hexToRGBA(color);

  const globe = shapeLayer('globe', [
    group([
      ellipseShape([28, 28]),
      strokeShape(c, 2),
      // Horizontal line
      pathShape([[-14, 0], [14, 0]], [[0, 0], [0, 0]], [[0, 0], [0, 0]], false),
      strokeShape([...c.slice(0, 3), 0.5] as RGBA, 1.5),
      // Vertical ellipse
      ellipseShape([14, 28]),
      strokeShape([...c.slice(0, 3), 0.5] as RGBA, 1.5),
      transformGroup(),
    ]),
  ]);

  // Orbiting dot
  const dot = shapeLayer('dot', [
    group([
      ellipseShape([5, 5]),
      fillShape(c),
      transformGroup([16, 0]),
    ]),
  ], {
    rotation: animatedValue([
      { t: 0, s: [0], e: [360] },
      { t: 90, s: [360] },
    ]),
  });

  return createAnimation('globe', [globe, dot]);
}

/**
 * Rocket - for agent spawn
 */
export function createRocket(color: string): LottieAnimationData {
  const c = hexToRGBA(color);

  const rocket = shapeLayer('rocket', [
    group([
      // Body
      pathShape([
        [0, -16], [6, -4], [6, 8], [3, 14], [-3, 14], [-6, 8], [-6, -4],
      ]),
      fillShape(c),
      // Window
      ellipseShape([5, 5]),
      fillShape([1, 1, 1, 0.3] as RGBA),
      transformGroup([0, -4]),
    ]),
  ], {
    position: animatedValue([
      { t: 0, s: [32, 34, 0], e: [32, 30, 0] },
      { t: 45, s: [32, 30, 0], e: [32, 34, 0] },
      { t: 90, s: [32, 34, 0] },
    ]),
  });

  // Exhaust particles
  const exhaust = shapeLayer('exhaust', [
    group([
      ellipseShape([4, 4]),
      fillShape([...c.slice(0, 3), 0.5] as RGBA),
      transformGroup(
        animatedValue([
          { t: 0, s: [0, 16], e: [0, 28] },
          { t: 30, s: [0, 28] },
        ]),
        [0, 0],
        animatedValue([
          { t: 0, s: [100, 100], e: [40, 40] },
          { t: 30, s: [40, 40] },
        ]),
        0,
        animatedValue([
          { t: 0, s: [80], e: [0] },
          { t: 30, s: [0] },
        ]),
      ),
    ]),
  ]);

  return createAnimation('rocket', [exhaust, rocket]);
}

/**
 * Target / crosshair - for multi-agent orchestrator
 */
export function createTarget(color: string): LottieAnimationData {
  const c = hexToRGBA(color);

  const target = shapeLayer('target', [
    group([
      // Outer ring
      ellipseShape([30, 30]),
      strokeShape(c, 2),
      // Middle ring
      ellipseShape([18, 18]),
      strokeShape([...c.slice(0, 3), 0.6] as RGBA, 1.5),
      // Center dot
      ellipseShape([6, 6]),
      fillShape(c),
      // Crosshairs
      pathShape([[-18, 0], [18, 0]], [[0, 0], [0, 0]], [[0, 0], [0, 0]], false),
      strokeShape([...c.slice(0, 3), 0.3] as RGBA, 1),
      pathShape([[0, -18], [0, 18]], [[0, 0], [0, 0]], [[0, 0], [0, 0]], false),
      strokeShape([...c.slice(0, 3), 0.3] as RGBA, 1),
      transformGroup([0, 0], [0, 0],
        animatedValue([
          { t: 0, s: [95, 95], e: [105, 105] },
          { t: 45, s: [105, 105], e: [95, 95] },
          { t: 90, s: [95, 95] },
        ]),
      ),
    ]),
  ]);

  return createAnimation('target', [target]);
}

/**
 * Chain links - generic graph/chain icon
 */
export function createChainLinks(color: string): LottieAnimationData {
  const c = hexToRGBA(color);

  const link1 = shapeLayer('link1', [
    group([
      rectShape([12, 20], [-4, 0], 5),
      strokeShape(c, 2.5),
      transformGroup([0, 0], [0, 0], [100, 100],
        animatedValue([
          { t: 0, s: [-5] },
          { t: 45, s: [-5], e: [5] },
          { t: 90, s: [5] },
        ]),
      ),
    ]),
  ]);

  const link2 = shapeLayer('link2', [
    group([
      rectShape([12, 20], [4, 0], 5),
      strokeShape([...c.slice(0, 3), 0.7] as RGBA, 2.5),
      transformGroup([0, 0], [0, 0], [100, 100],
        animatedValue([
          { t: 0, s: [5] },
          { t: 45, s: [5], e: [-5] },
          { t: 90, s: [-5] },
        ]),
      ),
    ]),
  ]);

  return createAnimation('chain-links', [link1, link2]);
}

/**
 * Test tube / flask - for synth
 */
export function createTestTube(color: string): LottieAnimationData {
  const c = hexToRGBA(color);

  const tube = shapeLayer('tube', [
    group([
      pathShape([
        [-6, -16], [6, -16], [6, 6], [10, 16], [-10, 16], [-6, 6],
      ]),
      strokeShape(c, 2),
      // Liquid inside (bottom)
      pathShape([
        [-5, 4], [5, 4], [5, 6], [9, 15], [-9, 15], [-5, 6],
      ]),
      fillShape([...c.slice(0, 3), 0.4] as RGBA),
      transformGroup([0, 0], [0, 0], [100, 100],
        animatedValue([
          { t: 0, s: [-3] },
          { t: 30, s: [-3], e: [3] },
          { t: 60, s: [3], e: [-3] },
          { t: 90, s: [-3] },
        ]),
      ),
    ]),
  ]);

  // Bubble
  const bubble = shapeLayer('bubble', [
    group([
      ellipseShape([4, 4]),
      fillShape([...c.slice(0, 3), 0.6] as RGBA),
      transformGroup(
        animatedValue([
          { t: 0, s: [2, 10], e: [-2, -4] },
          { t: 45, s: [-2, -4] },
          { t: 60, s: [2, 10], e: [-1, 0] },
          { t: 90, s: [-1, 0] },
        ]),
        [0, 0],
        animatedValue([
          { t: 0, s: [60, 60], e: [100, 100] },
          { t: 20, s: [100, 100], e: [0, 0] },
          { t: 45, s: [0, 0] },
          { t: 60, s: [60, 60], e: [80, 80] },
          { t: 80, s: [80, 80], e: [0, 0] },
          { t: 90, s: [0, 0] },
        ]),
      ),
    ]),
  ]);

  return createAnimation('test-tube', [tube, bubble]);
}

/**
 * People / crew - generic team icon
 */
export function createCrew(color: string): LottieAnimationData {
  const c = hexToRGBA(color);

  const positions = [[-10, 0], [0, -4], [10, 0]];

  const layers = positions.map(([x, y], idx) => {
    return shapeLayer(`person-${idx}`, [
      group([
        // Head
        ellipseShape([8, 8]),
        fillShape(idx === 1 ? c : [...c.slice(0, 3), 0.6] as RGBA),
        transformGroup([0, -8]),
        // Body
        rectShape([10, 10], [0, 2], 3),
        fillShape(idx === 1 ? c : [...c.slice(0, 3), 0.6] as RGBA),
        transformGroup([x, y + 4], [0, 0],
          animatedValue([
            { t: idx * 10, s: [90, 90], e: [105, 105] },
            { t: idx * 10 + 30, s: [105, 105], e: [90, 90] },
            { t: 90, s: [90, 90] },
          ]),
        ),
      ]),
    ]);
  });

  return createAnimation('crew', layers);
}

/**
 * Sparkle / magic wand - for OpenAgentic LLM
 */
export function createSparkle(color: string): LottieAnimationData {
  const c = hexToRGBA(color);

  // Main star
  const star = shapeLayer('star', [
    group([
      pathShape([
        [0, -16], [4, -4], [16, 0], [4, 4], [0, 16], [-4, 4], [-16, 0], [-4, -4],
      ]),
      fillShape(c),
      transformGroup([0, 0], [0, 0],
        animatedValue([
          { t: 0, s: [100, 100], e: [85, 85] },
          { t: 45, s: [85, 85], e: [100, 100] },
          { t: 90, s: [100, 100] },
        ]),
        animatedValue([
          { t: 0, s: [0], e: [45] },
          { t: 90, s: [45] },
        ]),
      ),
    ]),
  ]);

  // Small sparkle dots
  const sparkles = [
    { pos: [14, -14], delay: 0 },
    { pos: [-14, 14], delay: 15 },
    { pos: [16, 10], delay: 30 },
    { pos: [-12, -12], delay: 45 },
  ];

  const sparkleLayers = sparkles.map(({ pos, delay }, idx) =>
    shapeLayer(`sparkle-${idx}`, [
      group([
        ellipseShape([3, 3]),
        fillShape([...c.slice(0, 3), 0.7] as RGBA),
        transformGroup(pos as number[], [0, 0],
          animatedValue([
            { t: delay, s: [0, 0], e: [120, 120] },
            { t: delay + 15, s: [120, 120], e: [0, 0] },
            { t: delay + 30, s: [0, 0] },
          ]),
        ),
      ]),
    ])
  );

  return createAnimation('sparkle', [star, ...sparkleLayers]);
}

/**
 * Merge arrows - two arrows converging
 */
export function createMergeArrows(color: string): LottieAnimationData {
  const c = hexToRGBA(color);

  // Top arrow coming down-right
  const top = shapeLayer('top', [
    group([
      pathShape([[-14, -10], [0, 4]], [[0, 0], [0, 0]], [[0, 0], [0, 0]], false),
      strokeShape(c, 2.5),
      transformGroup([0, 0], [0, 0], [100, 100], 0,
        animatedValue([
          { t: 0, s: [60], e: [100] },
          { t: 30, s: [100] },
          { t: 90, s: [100] },
        ]),
      ),
    ]),
  ]);

  // Bottom arrow coming up-right
  const bottom = shapeLayer('bottom', [
    group([
      pathShape([[14, -10], [0, 4]], [[0, 0], [0, 0]], [[0, 0], [0, 0]], false),
      strokeShape([...c.slice(0, 3), 0.7] as RGBA, 2.5),
      transformGroup([0, 0], [0, 0], [100, 100], 0,
        animatedValue([
          { t: 10, s: [60], e: [100] },
          { t: 40, s: [100] },
          { t: 90, s: [100] },
        ]),
      ),
    ]),
  ]);

  // Combined output arrow going down
  const output = shapeLayer('output', [
    group([
      pathShape([[0, 4], [0, 18]], [[0, 0], [0, 0]], [[0, 0], [0, 0]], false),
      strokeShape(c, 2.5),
      // Arrow head
      pathShape([[-4, 14], [0, 18], [4, 14]], [[0, 0], [0, 0], [0, 0]], [[0, 0], [0, 0], [0, 0]], false),
      fillShape(c),
      transformGroup([0, 0], [0, 0], [100, 100], 0,
        animatedValue([
          { t: 20, s: [0], e: [100] },
          { t: 50, s: [100] },
          { t: 90, s: [100] },
        ]),
      ),
    ]),
  ]);

  // Center merge dot
  const dot = shapeLayer('dot', [
    group([
      ellipseShape([6, 6]),
      fillShape(c),
      transformGroup([0, 4], [0, 0],
        animatedValue([
          { t: 15, s: [0, 0], e: [120, 120] },
          { t: 30, s: [120, 120], e: [100, 100] },
          { t: 90, s: [100, 100] },
        ]),
      ),
    ]),
  ]);

  return createAnimation('merge-arrows', [top, bottom, output, dot]);
}

/**
 * Robot / A2A - agent communication
 */
export function createRobot(color: string): LottieAnimationData {
  const c = hexToRGBA(color);

  const robot = shapeLayer('robot', [
    group([
      // Head
      rectShape([22, 16], [0, -6], 4),
      fillShape(c),
      // Eyes
      ellipseShape([4, 4]),
      fillShape([1, 1, 1, 0.9] as RGBA),
      transformGroup([-5, -8]),
      ellipseShape([4, 4]),
      fillShape([1, 1, 1, 0.9] as RGBA),
      transformGroup([5, -8]),
      // Antenna
      pathShape([[0, -14], [0, -20]], [[0, 0], [0, 0]], [[0, 0], [0, 0]], false),
      strokeShape(c, 2),
      ellipseShape([4, 4]),
      fillShape(c),
      transformGroup([0, -20]),
      // Body
      rectShape([18, 12], [0, 8], 3),
      fillShape([...c.slice(0, 3), 0.7] as RGBA),
      transformGroup([0, 0], [0, 0],
        animatedValue([
          { t: 0, s: [100, 100], e: [102, 98] },
          { t: 30, s: [102, 98], e: [98, 102] },
          { t: 60, s: [98, 102], e: [100, 100] },
          { t: 90, s: [100, 100] },
        ]),
      ),
    ]),
  ]);

  // Signal waves from antenna
  const signal = shapeLayer('signal', [
    group([
      ellipseShape([10, 10]),
      strokeShape([...c.slice(0, 3), 0.4] as RGBA, 1),
      transformGroup([0, -20], [0, 0],
        animatedValue([
          { t: 0, s: [40, 40], e: [120, 120] },
          { t: 45, s: [120, 120] },
        ]),
        0,
        animatedValue([
          { t: 0, s: [60], e: [0] },
          { t: 45, s: [0] },
        ]),
      ),
    ]),
  ]);

  return createAnimation('robot', [signal, robot]);
}

/**
 * Python snake - for openagentic (python)
 */
export function createSnake(color: string): LottieAnimationData {
  const c = hexToRGBA(color);

  const snake = shapeLayer('snake', [
    group([
      // S-shaped body - simplified wavy path
      pathShape(
        [[-10, -12], [-4, -6], [4, 0], [-4, 6], [-10, 12], [0, 16], [10, 12]],
        [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]],
        [[0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]],
        false
      ),
      strokeShape(c, 3),
      // Head
      ellipseShape([6, 6]),
      fillShape(c),
      transformGroup([10, 12]),
      // Eye
      ellipseShape([2, 2]),
      fillShape([1, 1, 1, 0.9] as RGBA),
      transformGroup([11, 11]),
      transformGroup([0, 0], [0, 0],
        animatedValue([
          { t: 0, s: [100, 100] },
          { t: 30, s: [100, 100], e: [105, 95] },
          { t: 60, s: [105, 95], e: [100, 100] },
          { t: 90, s: [100, 100] },
        ]),
      ),
    ]),
  ]);

  return createAnimation('snake', [snake]);
}

// ═══════════════════════════════════════════════════════════════════
// ADMIN ICON FACTORIES
// ═══════════════════════════════════════════════════════════════════

/**
 * Generic pulsing icon with a symbol (for admin items)
 */
export function createPulsingDot(color: string): LottieAnimationData {
  const c = hexToRGBA(color);

  const dot = shapeLayer('dot', [
    group([
      ellipseShape([12, 12]),
      fillShape(c),
      transformGroup([0, 0], [0, 0],
        animatedValue([
          { t: 0, s: [100, 100], e: [120, 120] },
          { t: 45, s: [120, 120], e: [100, 100] },
          { t: 90, s: [100, 100] },
        ]),
      ),
    ]),
  ]);

  const ring = shapeLayer('ring', [
    group([
      ellipseShape([24, 24]),
      strokeShape([...c.slice(0, 3), 0.3] as RGBA, 1.5),
      transformGroup([0, 0], [0, 0],
        animatedValue([
          { t: 0, s: [80, 80], e: [110, 110] },
          { t: 45, s: [110, 110], e: [80, 80] },
          { t: 90, s: [80, 80] },
        ]),
      ),
    ]),
  ]);

  return createAnimation('pulsing-dot', [ring, dot]);
}

/**
 * Bar chart - for analytics, metrics
 */
export function createBarChart(color: string): LottieAnimationData {
  const c = hexToRGBA(color);
  const bars = [
    { x: -12, h: 14, delay: 0 },
    { x: -4, h: 22, delay: 8 },
    { x: 4, h: 18, delay: 16 },
    { x: 12, h: 26, delay: 24 },
  ];

  const layers = bars.map(({ x, h, delay }, idx) =>
    shapeLayer(`bar-${idx}`, [
      group([
        rectShape([6, h], [0, 0], 2),
        fillShape(idx === bars.length - 1 ? c : [...c.slice(0, 3), 0.5 + idx * 0.15] as RGBA),
        transformGroup([x, 14 - h / 2], [0, 0],
          animatedValue([
            { t: delay, s: [100, 0], e: [100, 100] },
            { t: delay + 20, s: [100, 100] },
            { t: 90, s: [100, 100] },
          ]),
        ),
      ]),
    ])
  );

  // Baseline
  const baseline = shapeLayer('baseline', [
    group([
      pathShape([[-18, 14], [18, 14]], [[0, 0], [0, 0]], [[0, 0], [0, 0]], false),
      strokeShape([...c.slice(0, 3), 0.4] as RGBA, 1),
      transformGroup(),
    ]),
  ]);

  return createAnimation('bar-chart', [...layers, baseline]);
}

/**
 * Database / cylinder - for data layer
 */
export function createDatabase(color: string): LottieAnimationData {
  const c = hexToRGBA(color);

  const db = shapeLayer('db', [
    group([
      // Body
      rectShape([24, 24], [0, 0], 0),
      fillShape([...c.slice(0, 3), 0.3] as RGBA),
      // Top ellipse
      ellipseShape([24, 8]),
      fillShape(c),
      transformGroup([0, -12]),
      // Middle line
      ellipseShape([24, 6]),
      strokeShape([...c.slice(0, 3), 0.5] as RGBA, 1),
      transformGroup([0, 0]),
      // Bottom ellipse
      ellipseShape([24, 8]),
      fillShape([...c.slice(0, 3), 0.6] as RGBA),
      transformGroup([0, 12]),
      transformGroup([0, 0], [0, 0],
        animatedValue([
          { t: 0, s: [100, 100], e: [100, 105] },
          { t: 45, s: [100, 105], e: [100, 100] },
          { t: 90, s: [100, 100] },
        ]),
      ),
    ]),
  ]);

  return createAnimation('database', [db]);
}

/**
 * Lock icon - for security
 */
export function createLock(color: string): LottieAnimationData {
  const c = hexToRGBA(color);

  const lock = shapeLayer('lock', [
    group([
      // Body
      rectShape([20, 16], [0, 6], 3),
      fillShape(c),
      // Shackle
      pathShape(
        [[-7, 0], [-7, -8], [7, -8], [7, 0]],
        [[0, 0], [0, -4], [0, 4], [0, 0]],
        [[0, -4], [4, 0], [0, 0], [0, 0]],
        false
      ),
      strokeShape(c, 2.5),
      // Keyhole
      ellipseShape([4, 4]),
      fillShape([0.07, 0.07, 0.09, 1] as RGBA),
      transformGroup([0, 4]),
      rectShape([2, 4], [0, 7]),
      fillShape([0.07, 0.07, 0.09, 1] as RGBA),
      transformGroup([0, 0], [0, 0],
        animatedValue([
          { t: 0, s: [100, 100], e: [105, 105] },
          { t: 45, s: [105, 105], e: [100, 100] },
          { t: 90, s: [100, 100] },
        ]),
      ),
    ]),
  ]);

  return createAnimation('lock', [lock]);
}

/**
 * Folder icon - actual folder shape with opening lid
 */
export function createFolder(color: string): LottieAnimationData {
  const c = hexToRGBA(color);

  const folder = shapeLayer('folder', [
    group([
      // Folder body
      pathShape([
        [-14, -6], [-14, 14], [14, 14], [14, -6], [4, -6], [2, -12], [-8, -12], [-10, -6],
      ]),
      fillShape([...c.slice(0, 3), 0.4] as RGBA),
      strokeShape(c, 1.5),
      // Tab
      pathShape([[-10, -6], [-8, -12], [2, -12], [4, -6]], [[0, 0], [0, 0], [0, 0], [0, 0]], [[0, 0], [0, 0], [0, 0], [0, 0]], false),
      strokeShape(c, 2),
      transformGroup([0, 2], [0, 0],
        animatedValue([
          { t: 0, s: [100, 100], e: [102, 98] },
          { t: 45, s: [102, 98], e: [100, 100] },
          { t: 90, s: [100, 100] },
        ]),
      ),
    ]),
  ]);

  return createAnimation('folder', [folder]);
}

/**
 * Server / cube icon - stacked horizontal lines
 */
export function createServerIcon(color: string): LottieAnimationData {
  const c = hexToRGBA(color);

  const layers = [-10, 0, 10].map((y, idx) =>
    shapeLayer(`rack-${idx}`, [
      group([
        rectShape([28, 8], [0, 0], 2),
        fillShape([...c.slice(0, 3), 0.3 + idx * 0.15] as RGBA),
        strokeShape(c, 1.5),
        // Status LED
        ellipseShape([3, 3]),
        fillShape(idx === 2 ? [...c.slice(0, 3), 1] as RGBA : [...c.slice(0, 3), 0.5] as RGBA),
        transformGroup([10, 0]),
        transformGroup([0, y], [0, 0],
          animatedValue([
            { t: idx * 10, s: [95, 95], e: [100, 100] },
            { t: idx * 10 + 20, s: [100, 100] },
            { t: 90, s: [100, 100] },
          ]),
        ),
      ]),
    ])
  );

  return createAnimation('server', layers);
}

/**
 * Logs / scrolling list lines
 */
export function createLogsList(color: string): LottieAnimationData {
  const c = hexToRGBA(color);

  const lines = [-10, -3, 4, 11].map((y, idx) =>
    shapeLayer(`line-${idx}`, [
      group([
        // Line
        rectShape([24 - idx * 3, 2], [0, 0], 1),
        fillShape([...c.slice(0, 3), 0.4 + idx * 0.15] as RGBA),
        // Bullet dot
        ellipseShape([3, 3]),
        fillShape(c),
        transformGroup([-14, 0]),
        transformGroup([2, y], [0, 0],
          animatedValue([
            { t: idx * 8, s: [0, 100], e: [100, 100] },
            { t: idx * 8 + 15, s: [100, 100] },
            { t: 90, s: [100, 100] },
          ]),
          0,
          animatedValue([
            { t: idx * 8, s: [0], e: [100] },
            { t: idx * 8 + 12, s: [100] },
            { t: 90, s: [100] },
          ]),
        ),
      ]),
    ])
  );

  return createAnimation('logs-list', lines);
}

/**
 * Grid of dots - for layout, grid view
 */
export function createGrid(color: string): LottieAnimationData {
  const c = hexToRGBA(color);

  const layers: any[] = [];
  const positions = [-10, 0, 10];
  let idx = 0;
  positions.forEach(x => {
    positions.forEach(y => {
      layers.push(
        shapeLayer(`dot-${idx}`, [
          group([
            rectShape([6, 6], [0, 0], 1.5),
            fillShape([...c.slice(0, 3), 0.5 + (idx / 9) * 0.5] as RGBA),
            transformGroup([x, y], [0, 0],
              animatedValue([
                { t: idx * 4, s: [0, 0], e: [100, 100] },
                { t: idx * 4 + 15, s: [100, 100] },
                { t: 90, s: [100, 100] },
              ]),
            ),
          ]),
        ])
      );
      idx++;
    });
  });

  return createAnimation('grid', layers);
}

/**
 * Users group - for user management
 */
export function createUsersGroup(color: string): LottieAnimationData {
  const c = hexToRGBA(color);

  const people = [
    { x: 0, y: -2, scale: 100, opacity: 100 },   // Center (main)
    { x: -14, y: 2, scale: 80, opacity: 70 },      // Left
    { x: 14, y: 2, scale: 80, opacity: 70 },       // Right
  ];

  const layers = people.map(({ x, y, scale, opacity }, idx) =>
    shapeLayer(`person-${idx}`, [
      group([
        // Head
        ellipseShape([7, 7]),
        fillShape(c),
        transformGroup([0, -6]),
        // Shoulders
        ellipseShape([12, 8]),
        fillShape([...c.slice(0, 3), 0.8] as RGBA),
        transformGroup([0, 4]),
        transformGroup([x, y], [0, 0],
          animatedValue([
            { t: idx * 12, s: [scale * 0.9, scale * 0.9], e: [scale, scale] },
            { t: idx * 12 + 20, s: [scale, scale] },
            { t: 90, s: [scale, scale] },
          ]),
          0,
          staticValue(opacity),
        ),
      ]),
    ])
  );

  return createAnimation('users-group', layers);
}
