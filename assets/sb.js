"use strict";
/* =====================================================================
 *  최소 Supabase 클라이언트 (외부 라이브러리 없이 fetch 사용)
 *  · apikey 헤더: 항상 공개 키
 *  · Authorization 헤더: 로그인한 관리자의 토큰, 비로그인 시 공개 키와 동일 값
 *  · 로그인 토큰은 메모리에만 보관(새로고침·창 닫기 시 자동 로그아웃)
 * ===================================================================== */
const SB = (() => {
  const base = () => CONFIG.SUPABASE_URL.replace(/\/+$/, "");
  let session = null;               // { access_token, refresh_token, expires_at, user }
  let refreshing = null;

  const headers = (extra = {}) => ({
    apikey: CONFIG.SUPABASE_KEY,
    Authorization: "Bearer " + (session ? session.access_token : CONFIG.SUPABASE_KEY),
    ...extra
  });

  async function errorOf(r) {
    let msg = r.statusText || "요청 실패", code = "";
    try {
      const j = await r.json();
      msg = j.message || j.msg || j.error_description || j.error || msg;
      code = j.code || j.error_code || "";
    } catch { /* 본문 없음 */ }
    const e = new Error(msg); e.status = r.status; e.code = String(code); return e;
  }

  function setSession(j) {
    session = {
      access_token: j.access_token,
      refresh_token: j.refresh_token,
      expires_at: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600),
      user: j.user || (session && session.user)
    };
  }

  async function authPost(path, body) {
    const r = await fetch(base() + "/auth/v1/" + path, {
      method: "POST",
      headers: { apikey: CONFIG.SUPABASE_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!r.ok) throw await errorOf(r);
    return r.json();
  }

  async function refresh() {
    if (!session) return;
    if (!refreshing) refreshing = authPost("token?grant_type=refresh_token", { refresh_token: session.refresh_token })
      .then(setSession)
      .catch(e => { session = null; throw e; })
      .finally(() => { refreshing = null; });
    return refreshing;
  }

  async function req(method, path, { body, extra, raw } = {}) {
    if (session && Date.now() / 1000 > session.expires_at - 60) await refresh();
    const r = await fetch(base() + path, { method, headers: headers(extra), body });
    if (!r.ok) throw await errorOf(r);
    if (raw) return r;
    const t = await r.text();
    return t ? JSON.parse(t) : null;
  }
  const json = { "Content-Type": "application/json" };
  const encPath = p => p.split("/").map(encodeURIComponent).join("/");

  return {
    get user() { return session && session.user; },
    get loggedIn() { return !!session; },

    async signIn(email, password) {
      setSession(await authPost("token?grant_type=password", { email, password }));
      return session.user;
    },
    async signOut() {
      if (!session) return;
      try { await fetch(base() + "/auth/v1/logout", { method: "POST", headers: headers() }); } catch { /* 무시 */ }
      session = null;
    },
    updatePassword: password => req("PUT", "/auth/v1/user", { body: JSON.stringify({ password }), extra: json }),

    insert: (table, row) => req("POST", "/rest/v1/" + table,
      { body: JSON.stringify(row), extra: { ...json, Prefer: "return=minimal" } }),
    select: (table, query) => req("GET", "/rest/v1/" + table + "?" + query),
    update: (table, filter, patch) => req("PATCH", "/rest/v1/" + table + "?" + filter,
      { body: JSON.stringify(patch), extra: { ...json, Prefer: "return=minimal" } }),
    remove: (table, filter) => req("DELETE", "/rest/v1/" + table + "?" + filter, { extra: { Prefer: "return=minimal" } }),
    rpc: (fn, args = {}) => req("POST", "/rest/v1/rpc/" + fn, { body: JSON.stringify(args), extra: json }),

    /* 1000건 이상도 모두 가져오기 */
    async selectAll(table, query, page = 1000) {
      const out = [];
      for (let off = 0; ; off += page) {
        const rows = await this.select(table, `${query}&limit=${page}&offset=${off}`);
        out.push(...rows);
        if (rows.length < page) return out;
      }
    },

    upload: (bucket, path, file) => req("POST", `/storage/v1/object/${bucket}/${encPath(path)}`,
      { body: file, extra: { "Content-Type": file.type, "x-upsert": "false", "cache-control": "no-store" } }),
    download: async (bucket, path) =>
      (await req("GET", `/storage/v1/object/authenticated/${bucket}/${encPath(path)}`, { raw: true })).blob(),
    removeFiles: (bucket, paths) => req("DELETE", `/storage/v1/object/${bucket}`,
      { body: JSON.stringify({ prefixes: paths }), extra: json })
  };
})();
