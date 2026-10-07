/* ==========================================================
   Recountix – Supabase Client & Session
   Production SaaS Edition
========================================================== */

const SUPABASE_URL = "https://niroqvhpyrwulzwiyctl.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_s4PUJ-wsnfstBEeap9j2tQ_PgRUlZq7";

let supabaseClient = null;

function getSupabase() {
    if (supabaseClient) return supabaseClient;
    if (typeof supabase === "undefined" || !supabase.createClient) {
        console.error("Supabase SDK not loaded");
        return null;
    }
    supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false }
    });
    return supabaseClient;
}

const SESSION_KEYS = {
    loggedIn: "bk_isLoggedIn",
    userId: "bk_userId",
    username: "bk_username",
    role: "bk_role",
    shopId: "bk_shopId",
    shopName: "bk_shopName",
    displayName: "bk_displayName",
    remember: "bk_remember"
};

function storage() {
    try {
        if (localStorage.getItem(SESSION_KEYS.remember) === "true") return localStorage;
    } catch (e) {}
    return sessionStorage;
}

function setSession(user, shop, remember, sessionToken) {
    const store = remember ? localStorage : sessionStorage;
    if (remember) {
        localStorage.setItem(SESSION_KEYS.remember, "true");
        sessionStorage.removeItem(SESSION_KEYS.loggedIn);
    } else {
        localStorage.removeItem(SESSION_KEYS.remember);
        Object.values(SESSION_KEYS).forEach(k => {
            try { localStorage.removeItem(k); } catch (e) {}
        });
        try { localStorage.removeItem("bk_session_token"); } catch (e) {}
    }
    const s = store;
    s.setItem(SESSION_KEYS.loggedIn, "true");
    s.setItem(SESSION_KEYS.userId, (user && user.id) ? String(user.id) : "");
    s.setItem(SESSION_KEYS.username, (user && user.username) || "");
    s.setItem(SESSION_KEYS.role, (user && user.role) || "user");
    s.setItem(SESSION_KEYS.shopId, (user && user.shop_id) ? String(user.shop_id) : "");
    s.setItem(SESSION_KEYS.shopName, (shop && shop.name) || "");
    s.setItem(SESSION_KEYS.displayName, (user && (user.display_name || user.username)) || "");
    const tok = sessionToken || (user && (user.sessionToken || user.token)) || "";
    if (tok) s.setItem("bk_session_token", tok);
    else {
        try { s.removeItem("bk_session_token"); } catch (e) {}
    }
}

function clearSession() {
    try {
        localStorage.removeItem("bk_session_token");
        sessionStorage.removeItem("bk_session_token");
    } catch (e) {}
    Object.values(SESSION_KEYS).forEach(k => {
        try {
            localStorage.removeItem(k);
            sessionStorage.removeItem(k);
        } catch (e) {}
    });
}

function getSession() {
    const fromLocal = localStorage.getItem(SESSION_KEYS.loggedIn) === "true";
    const fromSession = sessionStorage.getItem(SESSION_KEYS.loggedIn) === "true";
    const active = fromLocal ? localStorage : (fromSession ? sessionStorage : sessionStorage);
    return {
        isLoggedIn: active.getItem(SESSION_KEYS.loggedIn) === "true",
        userId: active.getItem(SESSION_KEYS.userId) || "",
        username: active.getItem(SESSION_KEYS.username) || "",
        role: active.getItem(SESSION_KEYS.role) || "user",
        shopId: active.getItem(SESSION_KEYS.shopId) || "",
        shopName: active.getItem(SESSION_KEYS.shopName) || "",
        displayName: active.getItem(SESSION_KEYS.displayName) || "",
        sessionToken: active.getItem("bk_session_token") || ""
    };
}

function isSuperAdmin() {
    return getSession().role === "super_admin";
}

function isAdmin() {
    const r = getSession().role;
    return r === "admin" || r === "super_admin";
}

function currentShopId() {
    return getSession().shopId || null;
}

async function supabaseBoot() {
    getSupabase();
    return true;
}

window.SUPABASE_URL = SUPABASE_URL;
window.SUPABASE_ANON_KEY = SUPABASE_ANON_KEY;
window.getSupabase = getSupabase;
window.setSession = setSession;
window.clearSession = clearSession;
window.getSession = getSession;
window.isSuperAdmin = isSuperAdmin;
window.isAdmin = isAdmin;
window.currentShopId = currentShopId;
window.supabaseBoot = supabaseBoot;
