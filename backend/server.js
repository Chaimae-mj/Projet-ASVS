// server.js
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const { v4: uuidv4 } = require("uuid");
const express = require("express");
const cors = require("cors");
const fs = require("fs");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const pool = require("./db");

let fetch;
try {
  const nodeFetch = require("node-fetch");
  fetch = typeof nodeFetch === "function" ? nodeFetch : nodeFetch.default;
} catch {
  fetch = globalThis.fetch;
}
if (!fetch) throw new Error("No fetch available");

const app = express();

/* ======================
   BASIC MIDDLEWARES
====================== */
app.use(
  cors({
    origin: "http://localhost:4200",
    credentials: true,
  })
);
app.use(express.json());

console.log("JWT_SECRET exists?", !!process.env.JWT_SECRET);

/* ======================
   HELPERS
====================== */
function flattenFromCategories(parsed) {
  // parsed = { categories: [ { requirements: [...] } ], version: "4.0" }
  const cats = Array.isArray(parsed?.categories) ? parsed.categories : [];

  const out = [];
  for (const cat of cats) {
    const reqs = Array.isArray(cat?.requirements) ? cat.requirements : [];
    for (const r of reqs) {
      const rid = String(r?.id || "").trim();          // "1.1.1"
      if (!rid) continue;

      // level can be "L2" or number; convert to number 1/2/3 if possible
      const lvlRaw = r?.level;
      const lvl =
        typeof lvlRaw === "number"
          ? lvlRaw
          : String(lvlRaw || "")
              .toUpperCase()
              .replace("LEVEL", "")
              .replace("L", "")
              .trim();

      const lvlNum = Number(lvl);
      const asvsLevel = Number.isFinite(lvlNum) && lvlNum > 0 ? lvlNum : null;

      out.push({
        // ✅ old shape used by your code/UI/DB
        "#": rid,
        "Area": String(r?.area || cat?.name || "").trim(),
        "ASVS Level": asvsLevel,
        "CWE": String(r?.cwe || "").trim(),
        "NIST": String(r?.nist || "").trim(),
        "Verification Requirement": String(r?.description || r?.title || "").trim(),

        // ✅ extra helpful fields (optional)
        "Title": String(r?.title || "").trim(),
        "Category": String(cat?.name || "").trim(),
        "Category Key": String(cat?.key || "").trim(),
        "Chapter": String(cat?.chapter || "").trim(),
        "Icon": String(cat?.icon || "").trim(),
      });
    }
  }
  return out;
}

function loadAsvsJson() {
  const filePath = path.join(__dirname, "data", "asvs.json");
  const raw = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw);

  // ✅ old formats
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.requirements)) return parsed.requirements;

  // ✅ NEW format: { categories: [...] }
  if (Array.isArray(parsed?.categories)) {
    const flat = flattenFromCategories(parsed);
    if (!flat.length) throw new Error("asvs.json categories loaded but no requirements found");
    return flat;
  }

  throw new Error("asvs.json must be an array or {requirements:[]} or {categories:[]}");
}

function extractFirstJson(text) {
  if (!text) return null;

  // Step 1: strip ALL markdown fences (```json ... ``` or ``` ... ```)
  let cleaned = String(text)
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/gi, "")
    .trim();

  // Step 2: try direct parse
  try { return JSON.parse(cleaned); } catch {}

  // Step 3: extract first { ... } block (handles text before/after JSON)
  const start = cleaned.indexOf("{");
  const end   = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  const candidate = cleaned.slice(start, end + 1);
  try { return JSON.parse(candidate); } catch {}

  // Step 4: try to fix common issues (trailing commas)
  try {
    const fixed = candidate
      .replace(/,\s*([}\]])/g, "$1")   // remove trailing commas
      .replace(/([{,]\s*)(\w+):/g, '$1"$2":'); // unquoted keys
    return JSON.parse(fixed);
  } catch {
    return null;
  }
}

function normalizeCodeToString(code) {
  if (!code) return "";
  if (typeof code === "string") return code;

  if (typeof code === "object") {
    const entries = Object.entries(code);
    return entries
      .map(([file, content]) => `// ===== File: ${file} =====\n${String(content ?? "")}`)
      .join("\n\n");
  }

  return String(code);
}

function ensureAiSchema(parsed, fallbackReqId, fallbackLang) {
  const out = typeof parsed === "object" && parsed ? parsed : {};

  out.requirementId = String(out.requirementId || fallbackReqId || "");
  out.language = String(out.language || fallbackLang || "");

  out.summary = typeof out.summary === "string" ? out.summary : "";
  out.what_to_do = Array.isArray(out.what_to_do) ? out.what_to_do.map(String) : [];
  out.evidence = typeof out.evidence === "string" ? out.evidence : "";
  out.assumptions = Array.isArray(out.assumptions) ? out.assumptions.map(String) : [];
  out.questions = Array.isArray(out.questions) ? out.questions.map(String) : [];

  if (Array.isArray(out.files)) out.files = out.files.map(String);
  else if (typeof out.files === "string" && out.files.trim()) {
    out.files = out.files
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } else out.files = [];

  out.code = normalizeCodeToString(out.code);

  return out;
}

const LANG_PROFILE = {
  javascript: {
    backend: "Node.js (Express)",
    focus:
      "Express middleware, JWT validation, input validation, MySQL queries, security headers, rate limit, logging.",
  },
  java: {
    backend: "Spring Boot",
    focus: "Spring Security filter chain, controllers, services, validation annotations, security config.",
  },
  python: {
    backend: "FastAPI",
    focus: "Dependencies, pydantic validation, JWT auth, middleware, SQLAlchemy patterns.",
  },
  csharp: {
    backend: ".NET (ASP.NET Core)",
    focus: "Middleware, controllers, JWT bearer auth, EF Core patterns, validation.",
  },
  php: {
    backend: "Laravel",
    focus: "Middleware, FormRequest validation, guards/policies, secure config, logging.",
  },
  go: {
    backend: "Gin",
    focus: "middleware, handlers, JWT, validation, SQL usage, secure defaults.",
  },
  kotlin: {
    backend: "Ktor",
    focus: "plugins, routing, auth, serialization, secure patterns.",
  },
};

/* ======================
   HEALTH CHECK
====================== */
app.get("/ping", (req, res) => {
  res.json({ ok: true, file: "server.js", time: new Date().toISOString() });
});

app.get("/debug/db", async (req, res) => {
  try {
    const [rows] = await pool.execute("SELECT 1 as ok");
    res.json(rows[0]);
  } catch (err) {
    console.error("❌ DB ERROR:", err);
    res.status(500).json({ error: String(err?.message || err) });
  }
});

/* ======================
   AUTH MIDDLEWARES
====================== */
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "No token provided" });

  const token = authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Invalid token format" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = { ...decoded, role: String(decoded.role || "").toUpperCase() };
    next();
  } catch (err) {
    console.log("❌ JWT VERIFY FAILED:", err?.name, err?.message);
    return res.status(401).json({ error: "Invalid token" });
  }
}

function roleMiddleware(roles) {
  const normalizedRoles = (roles || []).map((r) => String(r || "").toUpperCase());
  return (req, res, next) => {
    const userRole = String(req.user?.role || "").toUpperCase();
    console.log("🔐 Role check:", { required: normalizedRoles, got: userRole });
    if (!normalizedRoles.includes(userRole)) {
      return res.status(403).json({ error: "Access denied" });
    }
    next();
  };
}

/* ======================
   AUTH ROUTES
====================== */
app.post("/auth/login", async (req, res) => {
  try {
    const email = String(req.body?.email || "").trim();
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }

    const [rows] = await pool.execute(
      "SELECT id, name, email, role, password_hash FROM users WHERE LOWER(email) = LOWER(?)",
      [email]
    );

    if (!rows || rows.length === 0) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const user = rows[0];

    if (!user.password_hash) {
      return res.status(500).json({ error: "User has no password_hash in DB" });
    }

    if (!process.env.JWT_SECRET) {
      return res.status(500).json({ error: "JWT_SECRET is missing" });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: "Invalid credentials" });

    const normalizedRole = String(user.role || "").toUpperCase();

    const token = jwt.sign(
      { id: user.id, role: normalizedRole, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: "1d" }
    );

    return res.json({ token, role: normalizedRole });
  } catch (err) {
    console.error("❌ LOGIN ERROR RAW:", err);
    return res.status(500).json({
      error: String(err?.message || err || "Unknown error"),
      stack: err?.stack || null,
    });
  }
});

app.post("/auth/register", authMiddleware, roleMiddleware(["ADMIN"]), async (req, res) => {
  try {
    const name = String(req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim();
    const password = String(req.body?.password || "");
    const role = String(req.body?.role || "").toUpperCase();

    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: "All fields required" });
    }

    const allowedRoles = ["ADMIN", "DEVELOPER", "AUDITOR"];
    if (!allowedRoles.includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.execute(
      "INSERT INTO users (id, name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)",
      [uuidv4(), name, email, hashedPassword, role]
    );

    return res.status(201).json({ message: "User created ✅" });
  } catch (err) {
    console.error("❌ REGISTER ERROR:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  }
});

/* ======================
   REQUIREMENTS
====================== */
app.get("/requirements", authMiddleware, (req, res) => {
  try {
    res.json(loadAsvsJson());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ======================
   PROJECTS
====================== */
app.get("/projects", authMiddleware, roleMiddleware(["ADMIN", "AUDITOR", "DEVELOPER"]), async (req, res) => {
  try {
    const [rows] = await pool.execute("SELECT * FROM projects ORDER BY name");
    res.json(rows);
  } catch (err) {
    console.error("❌ GET PROJECTS ERROR:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

app.post("/projects", authMiddleware, roleMiddleware(["ADMIN"]), async (req, res) => {
  const name = String(req.body?.name || "").trim();
  if (!name) return res.status(400).json({ error: "name is required" });

  const projectId = uuidv4();

  let requirements = [];
  try {
    requirements = loadAsvsJson();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

  const reqIds = requirements.map((r) => r["#"]).filter(Boolean);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute("INSERT INTO projects (id, name) VALUES (?, ?)", [projectId, name]);

    for (const rid of reqIds) {
      await conn.execute(
        `INSERT INTO project_requirements
         (id, project_id, requirement_id, status, applicability, comment, tool_used, source_code_reference)
         VALUES (?, ?, ?, 'UNTESTED', 'YES', '', '', '')
         ON DUPLICATE KEY UPDATE project_id = project_id`,
        [uuidv4(), projectId, rid]
      );
    }

    await conn.commit();
    return res.status(201).json({ id: projectId, name });
  } catch (err) {
    await conn.rollback();
    console.error("❌ CREATE PROJECT ERROR:", err);
    return res.status(500).json({ error: err.message || "Internal server error" });
  } finally {
    conn.release();
  }
});

/* ======================
   CHECKLIST
====================== */
app.get(
  "/projects/:projectId/requirements",
  authMiddleware,
  roleMiddleware(["ADMIN", "DEVELOPER", "AUDITOR"]),
  async (req, res) => {
    const { projectId } = req.params;

    let requirements = [];
    try {
      requirements = loadAsvsJson();
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }

    try {
      const [rows] = await pool.execute(
        `SELECT requirement_id, applicability, status, comment, tool_used, source_code_reference
       FROM project_requirements
       WHERE project_id = ?`,
        [projectId]
      );

      const map = new Map(rows.map((r) => [r.requirement_id, r]));

      const merged = requirements.map((r) => {
        const id = r["#"];
        const progress = map.get(id) || {
          requirement_id: id,
          applicability: "YES",
          status: "UNTESTED",
          comment: "",
          tool_used: "",
          source_code_reference: "",
        };
        return { ...r, progress };
      });

      return res.json(merged);
    } catch (err) {
      console.error("❌ GET CHECKLIST ERROR:", err);
      return res.status(500).json({ error: err.message || "Internal server error" });
    }
  }
);

app.patch(
  "/projects/:projectId/requirements/:reqId",
  authMiddleware,
  roleMiddleware(["ADMIN", "DEVELOPER"]),
  async (req, res) => {
    const { projectId, reqId } = req.params;

    const allowedStatus = ["UNTESTED", "DONE", "IN_PROGRESS", "NOT_DONE", "NOT_APPLICABLE"];
    const allowedApp = ["YES", "NO", "NA"];

    const role = String(req.user?.role || "").toUpperCase();

    let payload = req.body || {};
    if (role === "ADMIN") {
      payload = {
        status: req.body?.status,
        applicability: req.body?.applicability,
      };
    }

    const status = payload?.status ? String(payload.status).toUpperCase() : null;
    const applicability = payload?.applicability ? String(payload.applicability).toUpperCase() : null;

    const comment = payload?.comment ?? null;
    const tool_used = payload?.tool_used ?? null;
    const source_code_reference = payload?.source_code_reference ?? null;

    if (status && !allowedStatus.includes(status)) return res.status(400).json({ error: "Invalid status" });
    if (applicability && !allowedApp.includes(applicability))
      return res.status(400).json({ error: "Invalid applicability" });

    const finalApplicability = applicability;
    const finalStatus = finalApplicability === "NA" ? "NOT_APPLICABLE" : status;

    if (!finalStatus && !finalApplicability && role !== "DEVELOPER") {
      return res.status(400).json({ error: "Nothing to update" });
    }

    try {
      await pool.execute(
        `INSERT INTO project_requirements
        (id, project_id, requirement_id, status, applicability, comment, tool_used, source_code_reference)
       VALUES
        (?, ?, ?, COALESCE(?, 'UNTESTED'), COALESCE(?, 'YES'),
         COALESCE(?, ''), COALESCE(?, ''), COALESCE(?, ''))
       ON DUPLICATE KEY UPDATE
        status = COALESCE(VALUES(status), status),
        applicability = COALESCE(VALUES(applicability), applicability),
        comment = CASE WHEN ? = 'DEVELOPER' THEN VALUES(comment) ELSE comment END,
        tool_used = CASE WHEN ? = 'DEVELOPER' THEN VALUES(tool_used) ELSE tool_used END,
        source_code_reference = CASE WHEN ? = 'DEVELOPER' THEN VALUES(source_code_reference) ELSE source_code_reference END`,
        [
          uuidv4(),
          projectId,
          reqId,
          finalStatus,
          finalApplicability,
          comment,
          tool_used,
          source_code_reference,
          role,
          role,
          role,
        ]
      );

      return res.json({ message: "Updated ✅" });
    } catch (err) {
      console.error("❌ PATCH REQUIREMENT ERROR:", err);
      return res.status(500).json({ error: err.message || "Internal server error" });
    }
  }
);

/* ======================
   STATS
====================== */
app.get(
  "/projects/:projectId/stats",
  authMiddleware,
  roleMiddleware(["ADMIN", "AUDITOR", "DEVELOPER"]),
  async (req, res) => {
    const { projectId } = req.params;

    let requirements = [];
    try {
      requirements = loadAsvsJson();
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }

    const total = requirements.length;

    try {
      const [rows] = await pool.execute(
        "SELECT requirement_id, applicability, status FROM project_requirements WHERE project_id = ?",
        [projectId]
      );

      const map = new Map(rows.map((r) => [r.requirement_id, r]));

      let applicable = 0;
      let done = 0;
      let in_progress = 0;
      let not_done = 0;
      let not_applicable = 0;
      let untested = 0;
      let no = 0;
      let na = 0;

      for (const r of requirements) {
        const id = r["#"];
        const pr = map.get(id) || { applicability: "YES", status: "UNTESTED" };

        const appv = String(pr.applicability || "YES").toUpperCase();
        const st = String(pr.status || "UNTESTED").toUpperCase();

        if (appv === "NO") { no++; continue; }
        if (appv === "NA") { na++; continue; }

        applicable++;

        if (st === "DONE") done++;
        else if (st === "IN_PROGRESS") in_progress++;
        else if (st === "NOT_APPLICABLE") not_applicable++;
        else if (st === "UNTESTED") untested++;
        else not_done++;
      }

      const compliance = applicable === 0 ? 0 : Math.round((done / applicable) * 100);

      return res.json({
        total,
        applicable,
        excluded: { no, na },
        status: { done, in_progress, not_done, not_applicable, untested },
        compliance_percent: compliance,
      });
    } catch (err) {
      console.error("❌ STATS ERROR:", err);
      return res.status(500).json({ error: err.message || "Internal server error" });
    }
  }
);

/* ======================

/* ======================
   AI SUGGEST (OpenRouter) — FREE MODELS, NO BILLING
====================== */
app.post("/ai/suggest", authMiddleware, roleMiddleware(["DEVELOPER"]), async (req, res) => {
  try {
    const { requirementId, title, requirementText, area, cwe, level, language } = req.body || {};

    if (!requirementId || !title || !language) {
      return res.status(400).json({ error: "requirementId, title, language are required" });
    }

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "OPENROUTER_API_KEY is missing in .env — get free key at https://openrouter.ai" });
    }

    const langKey = String(language).toLowerCase();
    const profile = LANG_PROFILE[langKey] || LANG_PROFILE.javascript;
    const model   = process.env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free";

    console.log("🔥 AI HIT (OpenRouter)", { requirementId, language: langKey, model });

    const prompt = `You are a senior application security architect helping a real production project.

Project stack: Angular frontend, Node.js (Express) backend, MySQL database, JWT authentication, ASVS checklist.

Generate a security implementation for TARGET LANGUAGE = ${langKey}
Backend style: ${profile.backend}
Focus: ${profile.focus}

Requirement:
Id: ${requirementId}
Title: ${title}
Text: ${requirementText || title}
Area: ${area || ""}
CWE: ${cwe || ""}
Level: ${level || ""}

CRITICAL RULES - FOLLOW EXACTLY:
1. Your ENTIRE response must be a single JSON object.
2. Do NOT write any text before or after the JSON.
3. Do NOT use markdown code fences (no backticks, no \`\`\`json).
4. Start your response with { and end with }.
5. All string values must be properly escaped.

{
  "requirementId": "${requirementId}",
  "language": "${langKey}",
  "summary": "8-10 lines explaining this control technically",
  "what_to_do": ["Step 1: WHERE + WHAT + WHY","Step 2","Step 3","Step 4","Step 5","Step 6","Step 7","Step 8"],
  "evidence": "10 lines audit-ready paragraph mentioning Express middleware, JWT, Angular guard, MySQL, logging, and how to verify",
  "files": ["relative/path/file1", "relative/path/file2"],
  "code": "Production-level code. Separate files with: === file: path/to/file ===",
  "assumptions": ["assumption 1", "assumption 2"],
  "questions": ["question 1", "question 2"]
}`;

    const controller = new AbortController();
    const t = setTimeout(() => controller.abort(), 60000);

    let r;
    try {
      r = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
          "HTTP-Referer": "http://localhost:4200",
          "X-Title": "ASVS Manager",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.2,
          max_tokens: 4096,
        }),
        signal: controller.signal,
      });
    } catch (fetchErr) {
      clearTimeout(t);
      if (fetchErr?.name === "AbortError") {
        return res.status(504).json({ error: "OpenRouter timeout" });
      }
      return res.status(502).json({
        error: "Cannot reach OpenRouter API",
        details: String(fetchErr?.message),
      });
    }

    clearTimeout(t);
    const rawText = await r.text();

    if (!r.ok) {
      console.error("❌ OPENROUTER ERROR:", r.status, rawText);
      return res.status(500).json({ error: "OpenRouter API error", status: r.status, details: rawText });
    }

    let orData;
    try {
      orData = JSON.parse(rawText);
    } catch (e) {
      return res.status(500).json({ error: "OpenRouter response not JSON", details: rawText });
    }

    const modelAnswer = String(orData?.choices?.[0]?.message?.content || "").trim();

    if (!modelAnswer) {
      return res.status(500).json({ error: "OpenRouter returned empty response", raw: orData });
    }

    console.log("✅ OpenRouter answer length:", modelAnswer.length);

    let parsed = extractFirstJson(modelAnswer);

    if (!parsed || typeof parsed !== "object") {
      parsed = {
        requirementId,
        language: langKey,
        summary: `AI suggestion for ${requirementId}`,
        what_to_do: [],
        evidence: "",
        files: [],
        code: modelAnswer,
        assumptions: [],
        questions: [],
      };
    }

    parsed = ensureAiSchema(parsed, requirementId, langKey);
    return res.json(parsed);

  } catch (err) {
    console.error("❌ AI ROUTE ERROR:", err);
    if (err?.name === "AbortError") {
      return res.status(504).json({ error: "AI request timeout" });
    }
    return res.status(500).json({ error: "AI error", details: String(err?.message || err) });
  }
});

/* ======================
   START
====================== */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log("✅ Server running on port " + PORT);
});