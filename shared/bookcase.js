// Draws the kid's bookcase as an SVG string: every full break they've ever
// taken stands on a shelf (books, spoons, fireballs in jars). It grows a new
// shelf whenever the last one fills, and keepsakes appear at milestones.
// Each item's look is seeded from its index + timestamp, so it never changes.

const W = 600;            // viewBox width
const SIDE = 22;          // side board thickness
const TOP = 30;           // cornice height
const ROW = 108;          // shelf row height (incl. plank)
const PLANK = 12;
const INNER = W - SIDE * 2;
const PAD = 12;           // breathing room at each end of a shelf
const GAP = 2;
const MIN_ROWS = 3;

const SPINES = ['#E5507A', '#6C6FF5', '#1FAE79', '#F29A1F', '#36B9E8', '#9B6BDF', '#FF6F5B', '#2FB5A5', '#C9A227', '#5B8DEF'];

// Keepsakes join the shelf right after these counts
export const MILESTONES = [
  { at: 10,  kind: 'plant',  note: '10 full breaks. Someone left a plant on your shelf.' },
  { at: 25,  kind: 'trophy', note: '25 full breaks. That’s a trophy.' },
  { at: 50,  kind: 'cat',    note: '50 full breaks. A cat has moved in. It isn’t leaving.' },
  { at: 100, kind: 'crown',  note: '100 full breaks. Honestly, impressive.' },
];

export function milestoneAt(count) {
  return MILESTONES.find(m => m.at === count) ?? null;
}

function rand(seed) {
  let t = (seed + 0x6D2B79F5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// ── Item art (drawn standing on y=0, growing upward; x from 0) ─────────────

function book(r, cls) {
  const w = 15 + Math.floor(r() * 11);
  const h = 56 + Math.floor(r() * 28);
  const c = SPINES[Math.floor(r() * SPINES.length)];
  const band = r() < 0.5 ? '#FFE7A8' : 'rgba(255,255,255,0.75)';
  const label = r() < 0.45
    ? `<rect x="${w * 0.22}" y="${-h * 0.62}" width="${w * 0.56}" height="${h * 0.16}" rx="1.5" fill="rgba(255,255,255,0.8)"/>`
    : '';
  return {
    w,
    h,
    svg: `<g class="bk-item ${cls}">
      <rect x="0" y="${-h}" width="${w}" height="${h}" rx="2.5" fill="${c}"/>
      <rect x="0" y="${-h}" width="${w * 0.3}" height="${h}" rx="2" fill="rgba(0,0,0,0.12)"/>
      <rect x="0" y="${-h + 6}" width="${w}" height="2.6" fill="${band}"/>
      <rect x="0" y="-9" width="${w}" height="2.6" fill="${band}"/>
      ${label}
    </g>`,
  };
}

function spoon(r, cls) {
  const h = 70 + Math.floor(r() * 10);
  const tint = r() < 0.2 ? '#E8C873' : '#C3CBD8'; // the odd golden spoon
  return {
    w: 18,
    h,
    svg: `<g class="bk-item ${cls}">
      <rect x="7" y="${-h + 20}" width="4.4" height="${h - 22}" rx="2.2" fill="${tint}"/>
      <rect x="7.6" y="${-h + 22}" width="1.6" height="${h - 28}" rx=".8" fill="rgba(255,255,255,0.55)"/>
      <ellipse cx="9.2" cy="${-h + 12}" rx="8" ry="12.5" fill="${tint}"/>
      <ellipse cx="7.6" cy="${-h + 10}" rx="3.6" ry="7" fill="rgba(255,255,255,0.6)"/>
      <ellipse cx="9.2" cy="-2.5" rx="5" ry="2.5" fill="${tint}"/>
    </g>`,
  };
}

function fireball(r, cls) {
  const blue = r() < 0.3;
  const outer = blue ? '#7FD3F7' : '#FF6A2B';
  const inner = blue ? '#E6F8FF' : '#FFC93C';
  return {
    w: 32,
    h: 50,
    svg: `<g class="bk-item ${cls}">
      <rect x="1" y="-42" width="30" height="42" rx="8" fill="rgba(214,240,255,0.55)" stroke="#A9D6EA" stroke-width="1.5"/>
      <g class="bk-flame">
        <path d="M16 -36c1.6 4.6 7.6 7 7.6 13.6 0 5.6-3.6 9.4-7.6 9.4s-7.6-3.8-7.6-9.4c0-3.6 2.4-5.4 3.4-8.2 1.4 1.4 1.8 3 1.4 4.8 2.6-2.6 3.4-6 2.8-10.2z" fill="${outer}"/>
        <path d="M16 -25c.8 2.4 4 3.6 4 7 0 2.8-1.8 4.6-4 4.6s-4-1.8-4-4.6c0-1.8 1.2-2.8 1.8-4.2.6.8.8 1.6.6 2.4 1.4-1.4 1.8-3 1.6-5.2z" fill="${inner}"/>
      </g>
      <rect x="4" y="-48" width="24" height="7" rx="2.5" fill="#B9875A"/>
      <rect x="5" y="-38" width="3" height="28" rx="1.5" fill="rgba(255,255,255,0.6)"/>
    </g>`,
  };
}

const KEEPSAKES = {
  plant: {
    w: 38, h: 64, svg: `<g class="bk-keep">
      <path d="M19 -30c-6-10-16-14-18-24 9 0 16 6 18 16 1-12 8-22 17-24-1 11-8 20-17 32z" fill="#3BB477"/>
      <path d="M19 -30c-2-8 0-18 6-24 1 8-1 16-6 24z" fill="#5FCB8F"/>
      <path d="M6 -30h26l-3 30H9z" fill="#E07B4F"/><rect x="4" y="-33" width="30" height="6" rx="2" fill="#C8643A"/>
    </g>`,
  },
  trophy: {
    w: 38, h: 66, svg: `<g class="bk-keep">
      <rect x="9" y="-10" width="20" height="10" rx="2" fill="#8A5A36"/>
      <rect x="16" y="-24" width="6" height="15" fill="#E9AE1C"/>
      <path d="M7 -60h24v12a12 12 0 0 1-24 0z" fill="#FFC93C"/>
      <path d="M7 -56H2a6 8 0 0 0 7 12M31 -56h5a6 8 0 0 1-7 12" fill="none" stroke="#FFC93C" stroke-width="3"/>
      <rect x="11" y="-57" width="3.5" height="14" rx="1.7" fill="rgba(255,255,255,0.6)"/>
    </g>`,
  },
  cat: {
    w: 60, h: 34, svg: `<g class="bk-keep bk-cat">
      <ellipse cx="30" cy="-13" rx="26" ry="13" fill="#5E5873"/>
      <circle cx="47" cy="-20" r="10" fill="#5E5873"/>
      <path d="M40 -27l1-9 6 6zM54 -27l-1-9-6 6z" fill="#5E5873"/>
      <path d="M43 -20q2 2 4 0M50 -20q2 2 4 0" stroke="#F3E1C7" stroke-width="1.4" fill="none" stroke-linecap="round"/>
      <path d="M6 -8q-8 2-4 -8" stroke="#5E5873" stroke-width="5" fill="none" stroke-linecap="round"/>
    </g>`,
  },
  crown: {
    w: 46, h: 46, svg: `<g class="bk-keep">
      <rect x="4" y="-10" width="38" height="10" rx="3" fill="#B8325F"/>
      <path d="M6 -12l-2-24 10 10 9-16 9 16 10-10-2 24z" fill="#FFC93C"/>
      <circle cx="23" cy="-20" r="3" fill="#E5507A"/><circle cx="12" cy="-18" r="2.2" fill="#36B9E8"/><circle cx="34" cy="-18" r="2.2" fill="#1FAE79"/>
    </g>`,
  },
};

const ITEM_ART = { book, spoon, fireball };

/**
 * @param {Array<{k: string, t: number}>} shelf
 * @param {{ since?: number, paintFilter?: string }} opts
 *   since: items earned after this get a sparkle; the very last one drops in.
 */
export function renderBookcase(shelf, { since = Infinity, paintFilter } = {}) {
  const items = Array.isArray(shelf) ? shelf : [];

  // Lay everything out left-to-right, wrapping onto new shelves
  const placed = [];
  let row = 0;
  let x = PAD;
  const put = art => {
    if (x + art.w > INNER - PAD) { row++; x = PAD; }
    placed.push({ ...art, row, x });
    x += art.w + GAP;
  };

  items.forEach((item, i) => {
    const r = (() => { let n = 0; return () => rand(i * 9973 + (item.t % 1e6) + n++ * 7919); })();
    const draw = ITEM_ART[item.k] ?? book;
    const isNew = item.t >= since;
    const cls = [isNew ? 'bk-new' : '', i === items.length - 1 && isNew ? 'bk-newest' : ''].join(' ');
    put(draw(r, cls));
    const keep = milestoneAt(i + 1);
    if (keep) { x += 4; put(KEEPSAKES[keep.kind]); x += 4; }
  });

  // Always show room to grow: an extra shelf once the last one is half full
  const lastFill = x / INNER;
  const rows = Math.max(MIN_ROWS, row + 1 + (lastFill > 0.5 ? 1 : 0));
  const H = TOP + rows * ROW + 16;

  const shelves = [];
  for (let i = 0; i < rows; i++) {
    const y = TOP + i * ROW;
    shelves.push(`
      <rect x="${SIDE}" y="${y}" width="${INNER}" height="${ROW - PLANK}" fill="url(#bk-back)"/>
      <rect x="${SIDE}" y="${y}" width="${INNER}" height="8" fill="rgba(90,52,24,0.10)"/>
      <rect x="${SIDE - 4}" y="${y + ROW - PLANK}" width="${INNER + 8}" height="${PLANK}" rx="2" fill="#B57A48"/>
      <rect x="${SIDE - 4}" y="${y + ROW - PLANK}" width="${INNER + 8}" height="3" fill="rgba(255,255,255,0.22)"/>`);
  }

  const things = placed.map(p => {
    const baseY = TOP + p.row * ROW + (ROW - PLANK);
    return `<g transform="translate(${SIDE + p.x} ${baseY})">${p.svg}</g>`;
  });

  // An empty bookcase shows where the first one will go
  const ghost = items.length ? '' : `
    <g transform="translate(${SIDE + PAD} ${TOP + ROW - PLANK})">
      <rect x="0" y="-70" width="22" height="70" rx="3" fill="none" stroke="#C9A27C" stroke-width="2" stroke-dasharray="5 4"/>
    </g>`;

  const sparkles = placed
    .filter(p => p.svg.includes('bk-new'))
    .map(p => {
      const cx = SIDE + p.x + p.w / 2;
      const cy = TOP + p.row * ROW + (ROW - PLANK) - p.h - 10;
      return `<path class="bk-sparkle" d="M${cx} ${cy - 7}l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#FFC93C"/>`;
    });

  const filter = paintFilter ? ` filter="url(#${paintFilter})"` : '';

  return `<svg class="bookcase" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img">
    <defs>
      <linearGradient id="bk-back" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#EBD3B2"/><stop offset="1" stop-color="#F6E6CF"/>
      </linearGradient>
    </defs>
    <g${filter}>
      <rect x="0" y="0" width="${W}" height="${H}" rx="14" fill="#C9905E"/>
      <rect x="0" y="0" width="${W}" height="${TOP}" rx="12" fill="#B57A48"/>
      <rect x="6" y="${H - 14}" width="${W - 12}" height="10" rx="4" fill="#A86E3E"/>
    </g>
    ${shelves.join('')}
    ${ghost}
    ${things.join('')}
    ${sparkles.join('')}
  </svg>`;
}
