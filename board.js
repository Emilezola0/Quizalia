// Virtual board game logic. The host (MJ) is the single writer of the board
// state; players only read it (and claim a pawn in the lobby).
//
// Firebase layout, under rooms/{code}:
//   board:       { enabled, size, phase: "normal"|"final", theme: {name, turns}|null, deck: [cardIndex] }
//   pawnClaims:  { pawnId: playerKey }
//   reveal:      { playerKey: { card, from, ts } }   // private "Œil" reveal
//   players/{key}: { name, pawn, pos, status: "active"|"survie"|"out", recoils, hand: [cardIndex] }

import { PAWNS, createBoardView, legendHTML, buildCellTypes, pawnIconHTML } from "./boardView.js";

const $ = id => document.getElementById(id);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const asArr = v => Array.isArray(v) ? v.filter(x => x != null) : (v ? Object.values(v) : []);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const shuffle = arr => {
    const r = [...arr];
    for (let i = r.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [r[i], r[j]] = [r[j], r[i]];
    }
    return r;
};

const S = {
    env: null,
    data: null,
    cards: [],
    cardsReady: Promise.resolve(),
    enabled: false,
    tab: "questions",
    types: {},
    hostView: null,
    playerView: null,
    selected: new Set(),
    history: [],
    queue: [],
    bannerActive: false,
    lastPhase: null,
    lastCorrect: null,
    closedRevealTs: 0,
    revealOpen: false,
    defaultRecul: 5,
    repairing: new Set()
};

const code = () => S.env.getLobbyCode();
const role = () => S.env.getRole();
const myKey = () => S.env.getPlayerKey();
function upRoom(paths) {
    return S.env.update(S.env.ref(S.env.db, `rooms/${code()}`), paths).catch(err => console.error("board update failed", err));
}

//#region Cards
const COND_FR = { Before: "Avant", After: "Après", Question: "Question", Buzz: "Buzz", "Phase Finale": "Phase finale" };

function loadCards() {
    return new Promise(resolve => {
        Papa.parse("cards.tsv" + (window.APP_ASSET_QUERY || ""), {
            download: true,
            header: true,
            skipEmptyLines: true,
            delimiter: "\t",
            complete: res => {
                S.cards = res.data.map(row => {
                    const first = row[Object.keys(row)[0]];
                    return {
                        name: String(row.Nom ?? first ?? "").trim(),
                        conds: String(row["Condition d'usage"] ?? "").split(",").map(s => s.trim()).filter(Boolean),
                        duration: String(row.Duration ?? "").trim(),
                        desc: String(row.Description ?? "").trim()
                    };
                }).filter(c => c.name);
                resolve();
            },
            error: () => resolve()
        });
    });
}

const cardName = i => S.cards[i]?.name ?? "Carte inconnue";

function cardHTML(i) {
    const c = S.cards[i];
    if (!c) return '<div class="gcard"><b>Carte inconnue</b></div>';
    const dur = /^(\d+)Q$/i.test(c.duration) ? c.duration.replace(/Q/i, "") + " questions" : c.duration;
    const tags = c.conds.map(x => `<span class="ctag">${esc(COND_FR[x] ?? x)}</span>`).join("")
        + (dur ? `<span class="ctag dur">${esc(dur)}</span>` : "");
    return `<div class="gcard"><b>${esc(c.name)}</b>${tags ? `<div class="gcard-tags">${tags}</div>` : ""}<p>${esc(c.desc)}</p></div>`;
}
//#endregion

//#region State helpers
function boardOf() { return S.data?.board || {}; }
function sizeOf() { return clamp(parseInt(boardOf().size, 10) || 40, 20, 60); }
function phaseOf() { return boardOf().phase === "final" ? "final" : "normal"; }
function deckOf() { return asArr(boardOf().deck); }

function teamsOf(d = S.data) {
    return Object.entries(d?.players || {}).map(([key, p]) => ({
        key,
        name: p.name,
        pawn: p.pawn,
        pos: p.pos || 0,
        status: p.status || "active",
        recoils: p.recoils || 0,
        hand: asArr(p.hand)
    }));
}
const teamByKey = key => teamsOf().find(t => t.key === key);
const posLabel = t => phaseOf() === "final" ? `HP ${t.pos}` : `Case ${t.pos}`;
//#endregion

//#region Tabs, status bar, toast
export function applyTabs() {
    const isHost = role() === "host";
    const game = $("game");
    const on = S.enabled && game && !game.hidden;

    $("viewTabs").hidden = !on;
    $("boardBar").hidden = !on;

    const plateau = on && S.tab === "plateau";
    $("hostView").hidden = !isHost || plateau;
    $("playerView").hidden = isHost || plateau;
    $("hostBoardView").hidden = !(isHost && plateau);
    $("playerBoardView").hidden = !(!isHost && plateau);

    if (on) {
        const [a, b] = $("viewTabs").querySelectorAll("button");
        a.textContent = isHost ? "Questions" : "Buzzer";
        a.classList.toggle("active", !plateau);
        b.classList.toggle("active", plateau);
        if (plateau) (isHost ? S.hostView : S.playerView)?.resize();
    }
}

function setTab(tab) {
    S.tab = tab;
    applyTabs();
}

function renderBar() {
    const b = boardOf();
    const final = phaseOf() === "final";
    const isHost = role() === "host";
    const th = b.theme;
    let html = `<span class="chip${final ? " on" : ""}">${final ? "Phase finale" : "Phase normale"}</span>`;
    if (th) {
        html += `<span class="chip theme">Thème imposé : ${esc(th.name)} · ${th.turns} tour${th.turns > 1 ? "s" : ""}`
            + (isHost ? ' <button class="sm ghost" data-act="nextTurn">Tour suivant</button>' : "") + "</span>";
    }
    if (isHost) html += `<span class="chip">Pioche : ${deckOf().length} carte${deckOf().length > 1 ? "s" : ""}</span>`;
    $("boardBar").innerHTML = html;
}

function toast(title, sub) {
    const el = $("phaseToast");
    el.innerHTML = `<b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}`;
    el.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => { el.hidden = true; }, 3200);
}

function showModal(html) {
    const m = $("cardModal");
    m.innerHTML = `<div class="modal-box">${html}</div>`;
    m.hidden = false;
}
function closeModal() {
    const m = $("cardModal");
    if (S.revealOpen) S.closedRevealTs = S.data?.reveal?.[myKey()]?.ts ?? S.closedRevealTs;
    m.hidden = true;
    m.innerHTML = "";
    S.revealOpen = false;
}
//#endregion

//#region Lobby (host toggle + pawn picker)
function renderLobby() {
    const d = S.data;
    if (!d) return;
    const b = d.board || {};
    const playing = d.status === "playing";
    const isHost = role() === "host";

    const hostBox = $("lobbyBoardHost");
    hostBox.hidden = !isHost || playing;
    if (!hostBox.hidden) {
        if (!hostBox.dataset.built) {
            hostBox.dataset.built = "1";
            hostBox.innerHTML = `
                <label class="lb-row"><input type="checkbox" id="lbEnable"> <span>Plateau virtuel</span></label>
                <div id="lbSizeRow" class="lb-row" hidden><label>Dernière case <input type="number" id="lbSize" min="20" max="60" value="40"></label></div>
                <p class="lb-hint">Pour jouer sans plateau physique : chaque équipe choisit un pion et le MJ pilote les déplacements.</p>`;
            $("lbEnable").addEventListener("change", e => {
                upRoom({ "board/enabled": e.target.checked, "board/size": clamp(parseInt($("lbSize").value, 10) || 40, 20, 60), "board/phase": "normal" });
            });
            $("lbSize").addEventListener("change", e => {
                const v = clamp(parseInt(e.target.value, 10) || 40, 20, 60);
                e.target.value = v;
                upRoom({ "board/size": v });
            });
        }
        $("lbEnable").checked = !!b.enabled;
        $("lbSizeRow").hidden = !b.enabled;
        if (document.activeElement !== $("lbSize")) $("lbSize").value = b.size || 40;
    }

    const picker = $("pawnPicker");
    picker.hidden = !(role() === "player" && b.enabled && !playing);
    if (!picker.hidden) {
        const claims = d.pawnClaims || {};
        const me = d.players?.[myKey()];
        picker.innerHTML = `<h3>Choisis ton pion</h3><div class="picks">${PAWNS.map(p => {
            const owner = claims[p.id];
            const mine = me?.pawn === p.id;
            const taken = owner && owner !== myKey();
            return `<button class="pick${mine ? " mine" : ""}" data-pawn="${p.id}"${taken ? " disabled" : ""}>
                <span class="pawn-ico big shape-${p.shape}" style="--pc:${p.color}"></span>
                <span>${p.label}</span><small>${mine ? "ton pion" : taken ? "pris" : "libre"}</small></button>`;
        }).join("")}</div>`;
    }
}

async function claimPawn(pawnId) {
    const key = myKey();
    const me = S.data?.players?.[key];
    if (!key || me?.pawn === pawnId) return;
    const claimRef = S.env.ref(S.env.db, `rooms/${code()}/pawnClaims/${pawnId}`);
    const res = await S.env.runTransaction(claimRef, cur => (cur === null || cur === key) ? key : undefined);
    if (!res.committed) return;
    const upd = { [`players/${key}/pawn`]: pawnId };
    if (me?.pawn) upd[`pawnClaims/${me.pawn}`] = null;
    upRoom(upd);
}
//#endregion

//#region Host: history (undo)
function snapshot() {
    const d = S.data;
    const snap = { players: {}, phase: phaseOf(), theme: boardOf().theme || null, deck: deckOf() };
    teamsOf(d).forEach(t => { snap.players[t.key] = { pos: t.pos, status: t.status, recoils: t.recoils, hand: t.hand }; });
    S.history.push(snap);
    if (S.history.length > 30) S.history.shift();
    renderHostFoot();
}

function undo() {
    const s = S.history.pop();
    if (!s) return;
    const upd = {};
    Object.entries(s.players).forEach(([k, p]) => {
        if (!S.data.players?.[k]) return;
        upd[`players/${k}/pos`] = p.pos;
        upd[`players/${k}/status`] = p.status;
        upd[`players/${k}/recoils`] = p.recoils;
        upd[`players/${k}/hand`] = p.hand.length ? p.hand : null;
    });
    upd["board/phase"] = s.phase;
    upd["board/theme"] = s.theme;
    upd["board/deck"] = s.deck.length ? s.deck : null;
    S.queue = [];
    S.bannerActive = false;
    hideBanner();
    upRoom(upd);
    renderHostFoot();
}
//#endregion

//#region Host: banner (effects queue)
function hideBanner() {
    const b = $("bvBanner");
    if (!b) return;
    b.hidden = true;
    b.innerHTML = "";
}

function queueBanner(fn) {
    S.queue.push(fn);
    if (!S.bannerActive) nextBanner();
}

function nextBanner() {
    const f = S.queue.shift();
    if (f) { S.bannerActive = true; f(nextBanner); }
    else { S.bannerActive = false; hideBanner(); }
}

function show(o) {
    const b = $("bvBanner");
    b.hidden = false;
    const more = S.queue.length ? `<div class="more">${S.queue.length} autre${S.queue.length > 1 ? "s" : ""} effet${S.queue.length > 1 ? "s" : ""} en attente</div>` : "";
    b.innerHTML = `<div class="kick">${o.kick}</div><h3>${o.title}</h3>${o.html || ""}${o.text ? `<p>${o.text}</p>` : ""}<div class="acts"></div>${more}`;
    const acts = b.querySelector(".acts");
    (o.actions || []).forEach(a => {
        if (a.select) {
            const wrap = document.createElement("div");
            wrap.className = "bv-select-row";
            const sel = document.createElement("select");
            sel.innerHTML = a.select.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join("");
            const btn = document.createElement("button");
            btn.textContent = a.label;
            btn.addEventListener("click", () => { lock(); a.fn(sel.value); });
            wrap.append(sel, btn);
            acts.appendChild(wrap);
            return;
        }
        const btn = document.createElement("button");
        btn.textContent = a.label;
        if (!a.primary) btn.className = "ghost";
        btn.addEventListener("click", () => { lock(); a.fn(); });
        acts.appendChild(btn);
    });
    function lock() { acts.querySelectorAll("button").forEach(x => { x.disabled = true; }); }
}
//#endregion

//#region Host: moves and effects
async function moveTeams(keys, delta, opts = {}) {
    const d = S.data;
    const size = sizeOf();
    const final = phaseOf() === "final";
    const moved = [];
    const upd = {};
    keys.forEach(k => {
        const t = teamByKey(k);
        if (!t || t.status === "out") return;
        const to = clamp(t.pos + delta, 0, size);
        if (to === t.pos) return;
        upd[`players/${k}/pos`] = to;
        if (final && to < t.pos) upd[`players/${k}/recoils`] = t.recoils + 1;
        moved.push({ key: k, from: t.pos, to });
    });
    if (!moved.length) return;
    snapshot();
    upRoom(upd);
    await Promise.all(moved.map(m => S.hostView.whenIdle(m.key)));
    if (!opts.noEffects) moved.forEach(m => afterLand(m.key, m.from, m.to));
}

function afterLand(key, from, to) {
    const t = teamByKey(key);
    if (!t) return;
    const size = sizeOf();
    const final = phaseOf() === "final";

    if (!final && to >= size) {
        upRoom({ "board/phase": "final" });
        queueBanner(done => show({
            kick: `Case ${size}`,
            title: "Phase finale !",
            text: `${esc(t.name)} a atteint la dernière case. Les positions deviennent des HP et les effets des cases sont désactivés. Une bonne réponse sert à faire reculer une équipe (recul par défaut : ${S.defaultRecul}).`,
            actions: [{ label: "Compris", primary: true, fn: done }]
        }));
        return;
    }

    if (final) {
        if (to === 0 && t.status === "active") {
            upRoom({ [`players/${key}/status`]: "survie" });
            queueBanner(done => show({
                kick: "Case 0 · phase finale",
                title: `${esc(t.name)} passe en survie`,
                text: "Protégée tant qu'elle répond juste (et une bonne réponse lui donne une carte). Si une autre équipe répond juste avant elle, ou si elle échoue : élimination.",
                actions: [{ label: "Compris", primary: true, fn: done }]
            }));
        }
        if (to < from && t.recoils >= 2 && t.status !== "out") {
            queueBanner(done => show({
                kick: "Phase finale",
                title: `${esc(t.name)} a reculé ${t.recoils} fois`,
                text: "Elle peut piocher une carte.",
                actions: [
                    { label: "Piocher une carte", primary: true, fn: () => { upRoom({ [`players/${key}/recoils`]: 0 }); drawFlow(key, done); } },
                    { label: "Pas maintenant", fn: done }
                ]
            }));
        }
        return;
    }

    const type = S.types[to];
    if (type && to > 0 && to < size) queueBanner(done => effect(key, type, done));
}

function effect(key, type, done) {
    const t = teamByKey(key);
    if (!t || t.status === "out") { done(); return; }
    const who = esc(t.name);
    const skip = { label: "Ignorer", fn: done };

    if (type === "plus" || type === "minus") {
        const d = type === "plus" ? 3 : -3;
        show({
            kick: `Case ${d > 0 ? "+3" : "−3"}`,
            title: `${who} ${d > 0 ? "avance" : "recule"} de 3`,
            text: "Effet obligatoire de la case.",
            actions: [
                { label: `Appliquer ${d > 0 ? "+3" : "−3"}`, primary: true, fn: async () => { await moveTeams([key], d); done(); } },
                skip
            ]
        });
    } else if (type === "card") {
        show({
            kick: "Case Carte",
            title: `${who} pioche`,
            text: "Piochez une carte. Avec déjà 2 cartes, l'équipe garde celle qu'elle veut et remet l'autre sous le paquet.",
            actions: [{ label: "Piocher une carte", primary: true, fn: () => drawFlow(key, done) }, skip]
        });
    } else if (type === "eye") {
        eyeFlow(key, done);
    } else if (type === "theme") {
        const themes = S.env.getThemes();
        show({
            kick: "Case Thème",
            title: `${who} impose un thème`,
            text: "Le thème choisi reste actif pendant 3 tours.",
            actions: [
                ...(themes.length ? [{ select: themes, label: "Valider", fn: name => { snapshot(); upRoom({ "board/theme": { name, turns: 3 } }); done(); } }] : []),
                skip
            ]
        });
    } else if (type === "roulette") {
        show({
            kick: "Case Roulette · optionnelle",
            title: `${who} tente sa chance ?`,
            text: "Elle peut passer son tour. Dé de 1 à 3 : recule de 3 cases. De 4 à 6 : avance de 3 cases.",
            actions: [
                { label: "Lancer le dé", primary: true, fn: () => rollDie(key, done) },
                { label: "Elle passe", fn: done }
            ]
        });
    }
}

async function rollDie(key, done) {
    const t = teamByKey(key);
    show({ kick: "Case Roulette", title: "Le dé roule…", html: '<div class="die" id="bvDie">?</div>', actions: [] });
    let v = 1;
    for (let i = 0; i < 9; i++) {
        v = 1 + Math.floor(Math.random() * 6);
        const el = $("bvDie");
        if (el) el.textContent = v;
        await sleep(70 + i * 18);
    }
    const win = v >= 4;
    show({
        kick: "Case Roulette",
        title: `${v} : ${win ? "succès" : "échec"}`,
        html: `<div class="die">${v}</div>`,
        text: `${esc(t?.name)} ${win ? "avance" : "recule"} de 3 cases.`,
        actions: [
            { label: `Appliquer ${win ? "+3" : "−3"}`, primary: true, fn: async () => { await moveTeams([key], win ? 3 : -3); done(); } },
            { label: "Ne rien faire", fn: done }
        ]
    });
}

function drawFlow(key, done) {
    const t = teamByKey(key);
    const deck = deckOf();
    if (!t) { done(); return; }
    if (!deck.length) {
        show({ kick: "Cartes", title: "Pioche vide", text: "Il n'y a plus de carte à piocher.", actions: [{ label: "OK", primary: true, fn: done }] });
        return;
    }
    const card = deck[0];
    const rest = deck.slice(1);
    const who = esc(t.name);

    if (t.hand.length < 2) {
        snapshot();
        upRoom({ "board/deck": rest.length ? rest : null, [`players/${key}/hand`]: [...t.hand, card] });
        show({
            kick: "Cartes", title: `${who} reçoit une carte`, html: cardHTML(card),
            actions: [{ label: "Terminé", primary: true, fn: done }]
        });
        return;
    }

    const discard = (idx) => {
        snapshot();
        const hand = [...t.hand];
        const out = idx === 2 ? card : hand[idx];
        if (idx < 2) hand[idx] = card;
        upRoom({ "board/deck": [...rest, out], [`players/${key}/hand`]: hand });
        done();
    };
    show({
        kick: "Cartes",
        title: `${who} a déjà 2 cartes`,
        html: cardHTML(card),
        text: "Carte piochée ci-dessus. Laquelle est défaussée (remise sous la pioche) ?",
        actions: [
            { label: `Défausser « ${esc(cardName(t.hand[0]))} »`, fn: () => discard(0) },
            { label: `Défausser « ${esc(cardName(t.hand[1]))} »`, fn: () => discard(1) },
            { label: "Défausser la nouvelle", primary: true, fn: () => discard(2) }
        ]
    });
}

function eyeFlow(viewerKey, done) {
    const viewer = teamByKey(viewerKey);
    const who = esc(viewer?.name);
    const others = teamsOf().filter(t => t.key !== viewerKey && t.status !== "out" && t.hand.length > 0);
    if (!others.length) {
        show({ kick: "Case Œil", title: `${who} voit une carte`, text: "Aucune autre équipe n'a de carte à montrer.", actions: [{ label: "OK", primary: true, fn: done }] });
        return;
    }
    const reveal = (target, idx) => {
        const card = target.hand[idx];
        upRoom({ [`reveal/${viewerKey}`]: { card, from: target.name, ts: Date.now() } });
        show({
            kick: "Case Œil",
            title: "Carte montrée en privé",
            html: cardHTML(card),
            text: `Visible uniquement sur l'écran de ${who} (carte de ${esc(target.name)}).`,
            actions: [{ label: "Terminé", primary: true, fn: () => { upRoom({ [`reveal/${viewerKey}`]: null }); done(); } }]
        });
    };
    const pickCard = target => {
        if (target.hand.length === 1) { reveal(target, 0); return; }
        show({
            kick: "Case Œil",
            title: `Quelle carte de ${esc(target.name)} ?`,
            actions: [
                { label: "Carte 1", primary: true, fn: () => reveal(target, 0) },
                { label: "Carte 2", primary: true, fn: () => reveal(target, 1) }
            ]
        });
    };
    show({
        kick: "Case Œil",
        title: `${who} voit une carte`,
        text: "Elle peut voir 1 seule carte de n'importe quelle équipe. Quelle équipe observe-t-elle ?",
        actions: [
            ...others.map(o => ({ label: `${o.name} (${o.hand.length})`, fn: () => pickCard(o) })),
            { label: "Ignorer", fn: done }
        ]
    });
}

function themeNext() {
    const th = boardOf().theme;
    if (!th) return;
    snapshot();
    upRoom({ "board/theme": th.turns <= 1 ? null : { name: th.name, turns: th.turns - 1 } });
}

function eliminate(key) {
    const t = teamByKey(key);
    if (!t) return;
    snapshot();
    S.selected.delete(key);
    const upd = { [`players/${key}/status`]: "out", [`players/${key}/hand`]: null };
    if (t.hand.length) upd["board/deck"] = [...deckOf(), ...t.hand];
    upRoom(upd);
}

function revive(key) {
    snapshot();
    upRoom({ [`players/${key}/status`]: "active" });
}

function startRoll() {
    const upd = {};
    teamsOf().forEach(t => { if (t.status !== "out") upd[`players/${t.key}/pos`] = 1 + Math.floor(Math.random() * 6); });
    if (!Object.keys(upd).length) return;
    snapshot();
    upRoom(upd);
}

function resetBoard() {
    if (!confirm("Réinitialiser le plateau ? Positions, cartes et phase repartent de zéro.")) return;
    const upd = { "board/phase": "normal", "board/theme": null, "board/deck": shuffle(S.cards.map((_, i) => i)), reveal: null };
    teamsOf().forEach(t => {
        upd[`players/${t.key}/pos`] = 0;
        upd[`players/${t.key}/status`] = "active";
        upd[`players/${t.key}/recoils`] = 0;
        upd[`players/${t.key}/hand`] = null;
    });
    S.history = [];
    S.queue = [];
    S.bannerActive = false;
    hideBanner();
    upRoom(upd);
    renderHostFoot();
}

function openCardModal(key, idx) {
    const t = teamByKey(key);
    const card = t?.hand[idx];
    if (card == null) return;
    const others = teamsOf().filter(o => o.key !== key && o.status !== "out" && o.hand.length < 2);
    showModal(`
        <p class="label">Carte de ${esc(t.name)}</p>
        ${cardHTML(card)}
        <div class="modal-acts">
            <button data-m="discard">Défausser (sous la pioche)</button>
            ${others.length ? `<span class="bv-select-row"><select id="mGive">${others.map(o => `<option value="${o.key}">${esc(o.name)}</option>`).join("")}</select><button class="ghost" data-m="give">Donner à</button></span>` : ""}
            <button class="ghost" data-m="close">Fermer</button>
        </div>`);
    $("cardModal").querySelector(".modal-acts").onclick = e => {
        const m = e.target.dataset.m;
        if (!m) return;
        if (m === "discard") {
            snapshot();
            const hand = t.hand.filter((_, i) => i !== idx);
            upRoom({ "board/deck": [...deckOf(), card], [`players/${key}/hand`]: hand.length ? hand : null });
        } else if (m === "give") {
            const to = teamByKey($("mGive").value);
            if (to) {
                snapshot();
                const hand = t.hand.filter((_, i) => i !== idx);
                upRoom({ [`players/${key}/hand`]: hand.length ? hand : null, [`players/${to.key}/hand`]: [...to.hand, card] });
            }
        }
        closeModal();
    };
}
//#endregion

//#region Host panel (build + render)
function buildHostPanel() {
    const root = $("hostBoardView");
    root.innerHTML = `
        <div class="bv-layout">
            <section class="card bv-board-card">
                <div id="hostBoard"></div>
                <div class="bv-legend">${legendHTML()}</div>
            </section>
            <aside class="card bv-panel">
                <div class="bv-head"><h2>Panneau MJ</h2><span class="label" id="bvMode"></span></div>
                <div id="bvHint" class="bv-hint" hidden></div>
                <div id="bvBanner" class="bv-banner" hidden></div>
                <div id="bvTeams" class="bv-teams"></div>
                <div class="bv-sel">
                    <div class="bv-sel-head"><span class="label" id="bvSelLabel"></span><button class="ghost sm" data-act="selAll">Tout cocher</button></div>
                    <div class="bv-quick">${[-5, -4, -3, -2, -1, 1, 2, 3, 4, 5].map(d =>
                        `<button class="${d < 0 ? "neg" : "pos"}" data-act="quick" data-d="${d}">${d > 0 ? "+" : "−"}${Math.abs(d)}</button>`).join("")}</div>
                    <div class="bv-default">
                        <label class="label">Recul par défaut <input type="number" id="bvDefault" min="1" max="20" value="${S.defaultRecul}"></label>
                        <button class="sm def" data-act="defaultRecul"></button>
                    </div>
                </div>
                <div class="bv-foot" id="bvFoot"></div>
            </aside>
        </div>`;
    S.hostView = createBoardView($("hostBoard"));
}

// Wired once (the container survives session resets, its content does not).
function wireHostEvents() {
    const root = $("hostBoardView");
    root.addEventListener("click", e => {
        const b = e.target.closest("[data-act]");
        if (!b || b.disabled) return;
        const key = b.dataset.key;
        switch (b.dataset.act) {
            case "quick": moveTeams([...S.selected], parseInt(b.dataset.d, 10)); break;
            case "defaultRecul": moveTeams([...S.selected], -S.defaultRecul); break;
            case "move": moveTeams([key], parseInt(b.dataset.d, 10)); break;
            case "selAll": {
                const active = teamsOf().filter(t => t.status !== "out");
                const all = active.every(t => S.selected.has(t.key));
                S.selected = new Set(all ? [] : active.map(t => t.key));
                renderHost();
                break;
            }
            case "draw": queueBanner(done => drawFlow(key, done)); break;
            case "eliminate": eliminate(key); break;
            case "revive": revive(key); break;
            case "card": openCardModal(key, parseInt(b.dataset.i, 10)); break;
            case "hintSel": S.selected = new Set([key]); renderHost(); break;
            case "hintClose": S.lastCorrect = null; renderHost(); break;
            case "startRoll": startRoll(); break;
            case "undo": undo(); break;
            case "reset": resetBoard(); break;
        }
    });
    root.addEventListener("change", e => {
        if (e.target.matches("[data-sel]")) {
            const k = e.target.dataset.sel;
            e.target.checked ? S.selected.add(k) : S.selected.delete(k);
            renderHostSel();
        } else if (e.target.id === "bvDefault") {
            S.defaultRecul = clamp(parseInt(e.target.value, 10) || 5, 1, 20);
            e.target.value = S.defaultRecul;
            renderHostSel();
        }
    });
}

function renderHost() {
    if (!S.hostView) return;
    const teams = teamsOf();
    const final = phaseOf() === "final";
    S.selected.forEach(k => { if (!teams.find(t => t.key === k && t.status !== "out")) S.selected.delete(k); });

    $("bvMode").textContent = final ? "Position = HP" : "Position = case";
    $("bvTeams").innerHTML = teams.length ? teams.map(t => {
        const tag = t.status === "survie" ? '<span class="tag">Survie</span>' : t.status === "out" ? '<span class="tag out">Éliminée</span>' : "";
        const chips = t.hand.map((c, i) => `<button class="gchip" data-act="card" data-key="${t.key}" data-i="${i}" title="Voir la carte">${esc(cardName(c))}</button>`).join("");
        const steps = t.status === "out"
            ? `<button class="sm ghost" data-act="revive" data-key="${t.key}">Réactiver</button>`
            : `<button class="sm ghost" data-act="move" data-key="${t.key}" data-d="-1" aria-label="Reculer ${esc(t.name)} de 1">−1</button><button class="sm ghost" data-act="move" data-key="${t.key}" data-d="1" aria-label="Avancer ${esc(t.name)} de 1">+1</button>`;
        const sub = [chips];
        if (t.status !== "out") sub.push(`<button class="sm ghost" data-act="draw" data-key="${t.key}">Piocher</button>`);
        if (t.status === "survie") {
            sub.push(`<button class="sm" data-act="draw" data-key="${t.key}">Bonne réponse → carte</button>`);
            sub.push(`<button class="sm ghost" data-act="eliminate" data-key="${t.key}">Éliminer</button>`);
        }
        return `<div class="bv-team${t.status === "out" ? " out" : ""}">
            <input type="checkbox" data-sel="${t.key}" aria-label="Cocher ${esc(t.name)}"${S.selected.has(t.key) ? " checked" : ""}${t.status === "out" ? " disabled" : ""}>
            ${pawnIconHTML(t.pawn, "big")}
            <div class="bv-info"><div class="nm">${esc(t.name)}</div><div class="pos"><span>${posLabel(t)}</span>${tag}</div></div>
            <div class="bv-steps">${steps}</div>
            <div class="bv-sub">${sub.join("")}</div>
        </div>`;
    }).join("") : '<p class="lb-hint">Aucune équipe.</p>';

    renderHostSel();
    renderHostHint();
    renderHostFoot();
}

function renderHostSel() {
    const n = S.selected.size;
    $("bvSelLabel").textContent = n === 0 ? "Aucune équipe cochée" : `${n} équipe${n > 1 ? "s" : ""} cochée${n > 1 ? "s" : ""}`;
    document.querySelectorAll("#hostBoardView [data-act='quick'], #hostBoardView [data-act='defaultRecul']").forEach(b => { b.disabled = n === 0; });
    const def = document.querySelector("#hostBoardView [data-act='defaultRecul']");
    if (def) def.textContent = `Reculer de ${S.defaultRecul}`;
}

function renderHostHint() {
    const h = $("bvHint");
    const lc = S.lastCorrect;
    if (!lc) { h.hidden = true; return; }
    const t = teamsOf().find(x => x.name === lc.name);
    const final = phaseOf() === "final";
    h.hidden = false;
    let text = `<b>${esc(lc.name)}</b> a répondu juste.`;
    let btn = "";
    if (t?.status === "survie") {
        text += " En survie, elle peut piocher une carte.";
        btn = `<button class="sm" data-act="draw" data-key="${t.key}">Piocher une carte</button>`;
    } else if (final) {
        text += " Elle choisit à l'oral une équipe à faire reculer.";
    } else if (t && !S.selected.has(t.key)) {
        btn = `<button class="sm" data-act="hintSel" data-key="${t.key}">Cocher cette équipe</button>`;
    }
    h.innerHTML = `<span>${text}</span><span class="bv-hint-acts">${btn}<button class="sm ghost" data-act="hintClose" aria-label="Fermer">✕</button></span>`;
}

function renderHostFoot() {
    const foot = $("bvFoot");
    if (!foot) return;
    const teams = teamsOf().filter(t => t.status !== "out");
    const canRoll = phaseOf() === "normal" && teams.length > 0 && teams.every(t => t.pos === 0);
    foot.innerHTML = `${canRoll ? '<button class="sm" data-act="startRoll">🎲 Jet de départ</button>' : ""}
        <button class="sm ghost" data-act="undo"${S.history.length ? "" : " disabled"}>↶ Annuler</button>
        <button class="sm ghost" data-act="reset">Réinitialiser le plateau</button>`;
}
//#endregion

//#region Player panel
function buildPlayerPanel() {
    $("playerBoardView").innerHTML = `
        <div class="bv-layout">
            <section class="card bv-board-card">
                <div id="playerBoard"></div>
                <div class="bv-legend">${legendHTML()}</div>
            </section>
            <aside class="card bv-panel">
                <div class="bv-head"><h2>Le plateau</h2><span class="label" id="pvMode"></span></div>
                <div id="pvTeams" class="bv-teams"></div>
                <div class="label" id="pvHandLabel"></div>
                <div id="pvHand" class="pv-hand"></div>
            </aside>
        </div>`;
    S.playerView = createBoardView($("playerBoard"));
}

function renderPlayer() {
    if (!S.playerView) return;
    const teams = teamsOf();
    const key = myKey();
    const me = teams.find(t => t.key === key);
    $("pvMode").textContent = phaseOf() === "final" ? "Position = HP" : "Position = case";
    $("pvTeams").innerHTML = teams.map(t => {
        const tag = t.status === "survie" ? '<span class="tag">Survie</span>' : t.status === "out" ? '<span class="tag out">Éliminée</span>' : "";
        return `<div class="bv-team pv${t.key === key ? " me" : ""}${t.status === "out" ? " out" : ""}">
            ${pawnIconHTML(t.pawn, "big")}
            <div class="bv-info"><div class="nm">${esc(t.name)}${t.key === key ? " (toi)" : ""}</div><div class="pos"><span>${posLabel(t)}</span>${tag}</div></div>
        </div>`;
    }).join("");
    const hand = me?.hand || [];
    $("pvHandLabel").textContent = `Tes cartes · ${hand.length}/2`;
    $("pvHand").innerHTML = hand.length ? hand.map(cardHTML).join("") : '<p class="lb-hint">Aucune carte pour le moment.</p>';
}

function renderReveal() {
    const r = S.data?.reveal?.[myKey()];
    if (!r) {
        if (S.revealOpen) closeModal();
        return;
    }
    if (r.ts === S.closedRevealTs || S.revealOpen) return;
    S.revealOpen = true;
    showModal(`<p class="label">Œil · carte de ${esc(r.from)}</p>${cardHTML(r.card)}<div class="modal-acts"><button data-m="close">Fermer</button></div>`);
}
//#endregion

//#region Host: start / repair / lifecycle
export async function prepareStart(data) {
    if (!data?.board?.enabled) return {};
    await S.cardsReady;
    const claims = { ...(data.pawnClaims || {}) };
    const upd = {};
    Object.entries(data.players || {}).forEach(([k, p], idx) => {
        upd[`players/${k}/pos`] = 0;
        upd[`players/${k}/status`] = "active";
        upd[`players/${k}/recoils`] = 0;
        upd[`players/${k}/hand`] = null;
        if (!p.pawn) {
            const free = PAWNS.find(x => !claims[x.id]);
            const id = (free || PAWNS[idx % PAWNS.length]).id;
            upd[`players/${k}/pawn`] = id;
            if (free) { claims[id] = k; upd[`pawnClaims/${id}`] = k; }
        }
    });
    upd["board/phase"] = "normal";
    upd["board/theme"] = null;
    upd["board/deck"] = shuffle(S.cards.map((_, i) => i));
    upd.reveal = null;
    return upd;
}

// A team that joins after the game started has no position yet.
function repairLateJoiners() {
    if (role() !== "host" || S.data.status !== "playing") return;
    const claims = { ...(S.data.pawnClaims || {}) };
    const upd = {};
    Object.entries(S.data.players || {}).forEach(([k, p], idx) => {
        if (p.pos !== undefined || S.repairing.has(k)) return;
        S.repairing.add(k);
        upd[`players/${k}/pos`] = 0;
        upd[`players/${k}/status`] = "active";
        upd[`players/${k}/recoils`] = 0;
        if (!p.pawn) {
            const free = PAWNS.find(x => !claims[x.id]);
            const id = (free || PAWNS[idx % PAWNS.length]).id;
            upd[`players/${k}/pawn`] = id;
            if (free) { claims[id] = k; upd[`pawnClaims/${id}`] = k; }
        }
    });
    if (Object.keys(upd).length) upRoom(upd);
}

// Extra paths to clear when the host removes a team (kick).
export function kickUpdates(data, key) {
    const p = data?.players?.[key];
    const upd = {};
    if (!p) return upd;
    if (p.pawn && data.pawnClaims?.[p.pawn] === key) upd[`pawnClaims/${p.pawn}`] = null;
    upd[`reveal/${key}`] = null;
    const hand = asArr(p.hand);
    if (hand.length) upd["board/deck"] = [...asArr(data.board?.deck), ...hand];
    S.selected.delete(key);
    return upd;
}

export function onCorrect(winnerName) {
    if (!S.enabled || role() !== "host" || !winnerName) return;
    S.lastCorrect = { name: winnerName };
    const t = teamsOf().find(x => x.name === winnerName);
    S.selected = new Set(t && phaseOf() === "normal" && t.status !== "out" ? [t.key] : []);
    setTab("plateau");
    renderHost();
}

export const pawnIcon = id => pawnIconHTML(id);

export function resetBoardState() {
    S.data = null;
    S.enabled = false;
    S.hostView = null;
    S.playerView = null;
    S.selected = new Set();
    S.history = [];
    S.queue = [];
    S.bannerActive = false;
    S.lastPhase = null;
    S.lastCorrect = null;
    S.tab = "questions";
    S.revealOpen = false;
    S.repairing = new Set();
    ["hostBoardView", "playerBoardView", "boardBar", "pawnPicker"].forEach(id => { const el = $(id); if (el) { el.innerHTML = ""; el.hidden = true; } });
    const hb = $("lobbyBoardHost");
    if (hb) { hb.innerHTML = ""; hb.hidden = true; delete hb.dataset.built; }
    $("viewTabs").hidden = true;
    closeModal();
    $("phaseToast").hidden = true;
}

export function onData(data) {
    S.data = data;
    const b = data.board || {};
    S.enabled = !!b.enabled;
    renderLobby();

    if (!S.enabled) {
        applyTabs();
        return;
    }

    const isHost = role() === "host";
    const size = sizeOf();
    S.types = buildCellTypes(size);

    if (isHost && !S.hostView) buildHostPanel();
    if (!isHost && !S.playerView) buildPlayerPanel();
    const view = isHost ? S.hostView : S.playerView;
    view.setSize(size);
    view.update(teamsOf().map(t => ({ key: t.key, name: t.name, pawn: t.pawn, pos: t.pos, status: t.status })));

    if (isHost) {
        repairLateJoiners();
        renderHost();
        // A buzz needs the Questions tab (winner panel + Correct / Wrong).
        if (data.winner && S.tab === "plateau") S.tab = "questions";
    } else {
        renderPlayer();
        renderReveal();
    }

    renderBar();
    applyTabs();

    const phase = phaseOf();
    if (S.lastPhase === "normal" && phase === "final") toast("PHASE FINALE", "Les positions deviennent des HP");
    S.lastPhase = phase;
}

export function initBoard(env) {
    S.env = env;
    S.cardsReady = loadCards();
    wireHostEvents();

    $("viewTabs").addEventListener("click", e => {
        const b = e.target.closest("button");
        if (b) setTab(b.dataset.tab);
    });
    $("boardBar").addEventListener("click", e => {
        if (e.target.dataset.act === "nextTurn") themeNext();
    });
    $("pawnPicker").addEventListener("click", e => {
        const b = e.target.closest("[data-pawn]");
        if (b && !b.disabled) claimPawn(b.dataset.pawn);
    });
    $("cardModal").addEventListener("click", e => {
        if (e.target === $("cardModal") || e.target.dataset.m === "close") closeModal();
    });
}
//#endregion
