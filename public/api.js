// Small client for the CardDesk REST API.
window.Api = (() => {
  "use strict";

  class ApiError extends Error {
    constructor(message, status, details, code) {
      super(message);
      this.status = status;
      this.details = details || null;
      this.code = code || null;
    }
  }

  let onUnauthorized = null;

  async function request(method, url, { body, file } = {}) {
    const opts = { method, credentials: "same-origin", headers: { Accept: "application/json" } };
    if (file) {
      opts.body = file;
      opts.headers["Content-Type"] = file.type || "application/octet-stream";
    } else if (body !== undefined) {
      opts.body = JSON.stringify(body);
      opts.headers["Content-Type"] = "application/json";
    }

    let res;
    try {
      res = await fetch(url, opts);
    } catch {
      throw new ApiError("Can't reach the server. Check that it's running and try again.", 0);
    }
    if (res.status === 204) return null;

    let data = null;
    try { data = await res.json(); } catch { /* non-JSON response */ }

    if (!res.ok) {
      const err = new ApiError((data && data.error) || `Request failed (${res.status})`, res.status, data && data.details, data && data.code);
      if (res.status === 401 && onUnauthorized && !url.endsWith("/auth/login") && !url.endsWith("/auth/me")) onUnauthorized();
      throw err;
    }
    return data;
  }

  const enc = encodeURIComponent;

  return {
    ApiError,
    setUnauthorizedHandler(fn) { onUnauthorized = fn; },

    me: () => request("GET", "/api/auth/me"),
    login: (email, password) => request("POST", "/api/auth/login", { body: { email, password } }),
    logout: () => request("POST", "/api/auth/logout"),

    // Employees are read from nexusAuth; `refresh` asks the server to fetch them again now.
    listEmployees: ({ refresh = false } = {}) => request("GET", `/api/employees${refresh ? "?refresh=1" : ""}`),

    getSettings: () => request("GET", "/api/settings"),
    updateSettings: (data) => request("PUT", "/api/settings", { body: data }),
    upload: (blob) => request("POST", "/api/uploads", { file: blob }),

    getPublicCard: (slug) => request("GET", `/api/public/cards/${enc(slug)}`),
    publicVCardUrl: (slug) => `/api/public/cards/${enc(slug)}/vcard`,
    employeeVCardUrl: (id) => `/api/employees/${enc(id)}/vcard`,
  };
})();
