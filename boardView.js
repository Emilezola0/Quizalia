// Virtual board: constants and the visual board (cells + animated pawns).
// Pure presentation — all game rules live in board.js.

export const PAWNS = [
    { id: "p1", label: "Bleu", color: "#5aa9ff", shape: "circle" },
    { id: "p2", label: "Violet", color: "#b28dff", shape: "square" },
    { id: "p3", label: "Rose", color: "#ff8fb1", shape: "triangle" },
    { id: "p4", label: "Turquoise", color: "#2ec4c4", shape: "diamond" },
    { id: "p5", label: "Orange", color: "#ff9f43", shape: "hexagon" },
    { id: "p6", label: "Blanc", color: "#e8ecf5", shape: "star" },
    { id: "p7", label: "Lime", color: "#b6d94c", shape: "cross" },
    { id: "p8", label: "Sable", color: "#c9a27e", shape: "pentagon" }
];
export const PAWN_BY_ID = Object.fromEntries(PAWNS.map(p => [p.id, p]));

const BASE_LAYOUT = {
    card: [3, 11, 19, 27, 35],
    eye: [7, 23, 31],
    theme: [14, 26, 34],
    roulette: [9, 21, 33],
    plus: [5, 16, 24, 36],
    minus: [13, 18, 30, 37]
};

export const CELL_NAMES = { card: "Carte", eye: "Œil", theme: "Thème", roulette: "Roulette", plus: "+3", minus: "−3" };
const CELL_COLORS = { card: "var(--c-card)", eye: "var(--c-eye)", theme: "var(--c-theme)", roulette: "var(--accent)", plus: "var(--good)", minus: "var(--bad)" };

export const CELL_ICONS = {
    card: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M9 8h6M9 12h6"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>',
    theme: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 4h9l9 9-8 8-9-9V4Z"/><circle cx="7.5" cy="8.5" r="1.3" fill="currentColor"/></svg>',
    roulette: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="3.5"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><circle cx="15" cy="9" r="1.2" fill="currentColor"/><circle cx="9" cy="15" r="1.2" fill="currentColor"/><circle cx="15" cy="15" r="1.2" fill="currentColor"/></svg>'
};

// Effect cells for a board of `size` cells (the 40-cell layout, scaled).
export function buildCellTypes(size) {
    const types = {};
    Object.keys(BASE_LAYOUT).forEach(type => {
        BASE_LAYOUT[type].forEach(i => {
            let j = Math.round(i * size / 40);
            while (types[j] && j < size - 1) j++;
            if (j >= 1 && j <= size - 1 && !types[j]) types[j] = type;
        });
    });
    return types;
}

export function legendHTML() {
    return Object.keys(CELL_NAMES).map(t => {
        const move = t === "plus" || t === "minus";
        const glyph = move ? CELL_NAMES[t] : CELL_ICONS[t].replace("<svg", '<svg width="14" height="14"');
        const label = t === "plus" ? "Avance de 3" : t === "minus" ? "Recule de 3" : CELL_NAMES[t];
        return `<span><b style="color:${CELL_COLORS[t]};background:color-mix(in srgb,${CELL_COLORS[t]} 14%,var(--surface-2))">${glyph}</b>${label}</span>`;
    }).join("");
}

export function pawnIconHTML(pawnId, extraClass = "") {
    const p = PAWN_BY_ID[pawnId];
    if (!p) return "";
    return `<span class="pawn-ico shape-${p.shape} ${extraClass}" style="--pc:${p.color}" title="${p.label}"></span>`;
}

const COLS = 8;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/**
 * Builds a board inside `root`. Teams are passed to update() as
 * [{ key, name, pawn, pos, status }]; pawns hop cell by cell towards `pos`.
 */
export function createBoardView(root) {
    root.classList.add("board");
    const layer = document.createElement("div");
    layer.className = "pawns";
    root.appendChild(layer);

    let size = 0;
    let cells = [];
    const pawns = new Map();

    function build(n) {
        size = n;
        const types = buildCellTypes(n);
        root.querySelectorAll(".cell").forEach(e => e.remove());
        cells = [];
        for (let i = 0; i <= n; i++) {
            const row = Math.floor(i / COLS);
            const k = i % COLS;
            const col = row % 2 === 0 ? k : COLS - 1 - k;
            const type = types[i];
            const el = document.createElement("div");
            el.className = "cell" + (i === 0 ? " start" : "") + (i === n ? " end" : "");
            el.style.gridRow = row + 1;
            el.style.gridColumn = col + 1;
            if (type) el.dataset.type = type;
            let inner = "";
            if (i === 0) inner = '<span class="t">DÉPART</span>';
            else if (i === n) inner = '<span class="t">FIN</span>';
            else if (type === "plus" || type === "minus") inner = `<span class="t">${CELL_NAMES[type]}</span>`;
            else if (type) inner = CELL_ICONS[type];
            el.innerHTML = `<span class="n">${i}</span>${inner}`;
            root.insertBefore(el, layer);
            cells.push(el);
        }
        placeAll();
    }

    function center(i) {
        const el = cells[i];
        return el ? { x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop + el.offsetHeight / 2 } : { x: 0, y: 0 };
    }

    function placeAll() {
        if (!cells.length) return;
        const groups = {};
        pawns.forEach(p => { (groups[p.display] = groups[p.display] || []).push(p); });
        Object.keys(groups).forEach(pos => {
            const g = groups[pos];
            const c = center(+pos);
            g.forEach((p, idx) => {
                let ox = 0, oy = 0;
                if (g.length > 1) {
                    const a = (idx / g.length) * Math.PI * 2 - Math.PI / 2;
                    const r = g.length === 2 ? 9 : 11;
                    ox = Math.cos(a) * r;
                    oy = Math.sin(a) * r;
                }
                p.el.style.transform = `translate(${c.x + ox}px, ${c.y + oy}px)`;
            });
        });
    }

    function makePawn(team) {
        const el = document.createElement("div");
        el.className = "pawn";
        el.innerHTML = "<i></i>";
        layer.appendChild(el);
        return el;
    }

    function skin(p, team) {
        const def = PAWN_BY_ID[team.pawn] || PAWNS[0];
        if (p.pawnId !== def.id) {
            p.pawnId = def.id;
            p.el.style.setProperty("--pc", def.color);
            p.el.firstChild.className = `shape-${def.shape}`;
        }
        p.el.title = team.name;
        p.el.classList.toggle("out", team.status === "out");
    }

    async function run(p) {
        p.running = true;
        while (p.display !== p.target) {
            const remaining = Math.abs(p.target - p.display);
            p.display += Math.sign(p.target - p.display);
            placeAll();
            p.el.classList.remove("hop");
            void p.el.offsetWidth;
            p.el.classList.add("hop");
            await sleep(remaining > 10 ? 70 : 230);
        }
        p.running = false;
        p.waiters.splice(0).forEach(resolve => resolve());
    }

    function update(teams) {
        const keys = new Set(teams.map(t => t.key));
        pawns.forEach((p, k) => {
            if (!keys.has(k)) { p.el.remove(); pawns.delete(k); }
        });
        teams.forEach(t => {
            const pos = clamp(t.pos || 0, 0, size);
            let p = pawns.get(t.key);
            if (!p) {
                p = { el: makePawn(t), display: pos, target: pos, running: false, waiters: [], pawnId: null };
                pawns.set(t.key, p);
            }
            skin(p, t);
            p.target = pos;
            if (!p.running && p.display !== p.target) run(p);
        });
        placeAll();
    }

    function setSize(n) {
        if (n === size) return;
        build(n);
        pawns.forEach(p => { p.display = clamp(p.display, 0, size); p.target = clamp(p.target, 0, size); });
        placeAll();
    }

    function whenIdle(key) {
        const p = pawns.get(key);
        if (!p || !p.running) return Promise.resolve();
        return new Promise(resolve => p.waiters.push(resolve));
    }

    if (typeof ResizeObserver !== "undefined") new ResizeObserver(placeAll).observe(root);

    return { setSize, update, whenIdle, resize: placeAll };
}
