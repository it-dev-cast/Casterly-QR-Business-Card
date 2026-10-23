// A small stand-in for nexusAuth's REST API, used by the tests. It mimics the parts CardDesk calls:
// sign-in, token refresh, /me, logout, paged employee and company lists, and /uploads photos.
import crypto from "node:crypto";
import express from "express";

export const PNG_1PX = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000" +
  "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");

export function startFakeNexus() {
  const users = [
    { id: 1, email: "service@casterly.com", password: "service-pass", full_name: "CardDesk service", role: "admin", company_id: 1 },
    { id: 2, email: "admin@casterly.com", password: "admin-pass", full_name: "Asha Admin", role: "admin", company_id: 1 },
    { id: 3, email: "ops@orbit.com", password: "ops-pass", full_name: "Omar Operator", role: "operator", company_id: 2 },
    { id: 4, email: "viewer@casterly.com", password: "viewer-pass", full_name: "Vera Viewer", role: "read_only", company_id: 1 },
  ];
  const companies = [{ id: 1, name: "Casterly" }, { id: 2, name: "Orbit Retail" }];
  const sensitive = { bank_account_number: "123456789012", bank_ifsc: "HDFC0000001", pan_number: "ABCDE1234F", aadhaar_number: "123412341234", residence_proof_reference: "/private/proof.pdf" };
  const employees = [
    { id: 11, company_id: 1, first_name: "Ravi", last_name: "Kiran", full_name: "Ravi Kiran", email: "Ravikiran@casterly.com", employee_code: "CAS-011",
      designation: "Developer", department: "IT", phone_number: "+91 98450 00011", address: "Tower B Beacon, 4th Floor\nBengaluru 560022",
      linkedin_url: "https://linkedin.com/in/ravikiran", status: "active", photo_reference: "/uploads/employee_photos/ravi.png", ...sensitive },
    { id: 12, company_id: 1, first_name: "Nandeesh", last_name: "", full_name: "Nandeesh", email: "nandeesh@casterly.com", employee_code: "CAS-012",
      designation: "Designer", department: "Design", phone_number: null, address: null, linkedin_url: null, status: "on_leave", photo_reference: null, ...sensitive },
    { id: 13, company_id: 1, first_name: "Ex", last_name: "Employee", full_name: "Ex Employee", email: "ex@casterly.com", employee_code: "CAS-013",
      designation: "Former", department: "IT", status: "exited", photo_reference: null, ...sensitive },
    { id: 21, company_id: 2, first_name: "Daniel", last_name: "Okafor", full_name: "Daniel Okafor", email: "daniel@orbit.com", employee_code: "ORB-021",
      designation: "Sales Director", department: "Sales", phone_number: "+44 20 7946 0321", address: "14 King's Rd, London", status: "active",
      photo_reference: "/uploads/employee_photos/missing.png", ...sensitive },
  ];
  const tokens = new Map(); // access token -> user
  const state = { down: false, calls: { login: 0, employees: 0 }, users, employees, companies };

  const app = express();
  app.use(express.json());
  app.use((req, res, next) => (state.down ? res.status(502).json({ error_code: "DOWN", message: "nexusAuth is down" }) : next()));
  const issue = (u) => {
    const access = crypto.randomBytes(12).toString("hex");
    tokens.set(access, u);
    return { access_token: access, refresh_token: `r-${access}`, token_type: "bearer", expires_in: 900 };
  };
  const bearer = (req, res, next) => {
    const u = tokens.get(String(req.get("authorization") || "").replace(/^Bearer /, ""));
    if (!u) return res.status(401).json({ error_code: "AUTH_INVALID_TOKEN", message: "Invalid token." });
    req.user = u;
    next();
  };

  app.post("/api/v1/auth/login", (req, res) => {
    state.calls.login++;
    const u = users.find((x) => x.email === String(req.body?.email || "").toLowerCase() && x.password === req.body?.password);
    if (!u) return res.status(401).json({ error_code: "AUTH_INVALID_CREDENTIALS", message: "Invalid email or password." });
    res.json({ data: issue(u), meta: {} });
  });
  app.post("/api/v1/auth/refresh", (req, res) => {
    const access = String(req.body?.refresh_token || "").replace(/^r-/, "");
    const u = tokens.get(access);
    if (!u) return res.status(401).json({ error_code: "AUTH_INVALID_TOKEN", message: "Invalid refresh token." });
    res.json({ data: issue(u), meta: {} });
  });
  app.get("/api/v1/auth/me", bearer, (req, res) => {
    const { password, ...u } = req.user;
    res.json({ data: { ...u, is_active: true }, meta: {} });
  });
  app.post("/api/v1/auth/logout", bearer, (req, res) => res.json({ data: { message: "Logged out" }, meta: {} }));

  const page = (items, req) => {
    const limit = Number(req.query.limit || 20), offset = Number(req.query.offset || 0);
    const slice = items.slice(offset, offset + limit);
    return { items: slice, total: items.length, limit, offset, has_more: offset + slice.length < items.length };
  };
  app.get("/api/v1/employees", bearer, (req, res) => {
    state.calls.employees++;
    if (!["admin", "operator"].includes(req.user.role)) return res.status(403).json({ error_code: "FORBIDDEN", message: "Forbidden" });
    const list = employees.filter((e) => req.query.include_exited === "true" || e.status !== "exited");
    res.json({ data: page(list, req), meta: {} });
  });
  app.get("/api/v1/companies", bearer, (req, res) => res.json({ data: page(companies, req), meta: {} }));
  app.get("/uploads/employee_photos/ravi.png", (req, res) => res.type("image/png").send(PNG_1PX));

  return new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => {
      state.url = `http://127.0.0.1:${server.address().port}`;
      state.close = () => new Promise((r) => server.close(r));
      resolve(state);
    });
  });
}
