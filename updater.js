// Detects a new deployment and offers a one-click reload (no Ctrl+F5 needed).
// The deployed version is read from the <meta name="app-version"> of a fresh index.html.

const CHECK_EVERY_MS = 60_000;
const DEBUG_CHECK_EVERY_MS = 5_000;

const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) || location.protocol === "file:";
// Add ?debugUpdate to the URL to exercise the updater on localhost.
const debug = new URLSearchParams(location.search).has("debugUpdate");

export function initUpdater() {
    const current = window.APP_VERSION;
    const label = document.getElementById("appVersion");
    if (label && current) label.textContent = `Quizalia v${current}`;
    if (isLocal && !debug) return;

    const indexUrl = new URL("index.html", location.href).href;
    let dismissedVersion = null;
    let banner = null;

    async function fetchDeployed() {
        const res = await fetch(`${indexUrl}?_=${Date.now()}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const doc = new DOMParser().parseFromString(await res.text(), "text/html");
        return {
            version: doc.querySelector('meta[name="app-version"]')?.content || null,
            notes: doc.querySelector('meta[name="app-notes"]')?.content || ""
        };
    }

    async function check() {
        if (document.visibilityState === "hidden" || banner) return;
        try {
            const deployed = await fetchDeployed();
            if (deployed.version && deployed.version !== current && deployed.version !== dismissedVersion) {
                showBanner(deployed);
            }
        } catch {
            // Offline or server hiccup: try again at the next tick.
        }
    }

    function showBanner({ version, notes }) {
        banner = document.createElement("div");
        banner.className = "update-banner";
        banner.setAttribute("role", "alert");
        banner.innerHTML = `
            <div class="update-text">
                <b>Nouvelle version disponible</b>
                <span>v${version}${notes ? " · " + escapeHtml(notes) : ""}</span>
                <small>La page se recharge, ta partie en cours est conservée.</small>
            </div>
            <div class="update-acts">
                <button data-act="update">Mettre à jour</button>
                <button data-act="later" class="ghost">Plus tard</button>
            </div>`;
        banner.addEventListener("click", async e => {
            const act = e.target.dataset.act;
            if (act === "later") {
                dismissedVersion = version;
                banner.remove();
                banner = null;
            } else if (act === "update") {
                e.target.disabled = true;
                e.target.textContent = "Mise à jour…";
                try { await fetch(indexUrl, { cache: "reload" }); } catch { /* reload anyway */ }
                location.reload();
            }
        });
        document.body.appendChild(banner);
    }

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    setTimeout(check, 4000);
    setInterval(check, debug ? DEBUG_CHECK_EVERY_MS : CHECK_EVERY_MS);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("online", check);
}
