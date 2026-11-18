const enc = new TextEncoder();
const hex = (bytes) =>
  Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
async function digest(value) {
  return hex(await crypto.subtle.digest("SHA-256", enc.encode(value)));
}
async function passwordHash(password, salt) {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  return hex(
    await crypto.subtle.deriveBits(
      {
        name: "PBKDF2",
        hash: "SHA-256",
        iterations: 100000,
        salt: enc.encode(salt),
      },
      key,
      256,
    ),
  );
}
const reply = (data, status = 200, headers = {}) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
const reject = (error, status) => reply({ error }, status);
const makeCookie = (req, value, age) =>
  "session=" +
  value +
  "; Path=/; HttpOnly; SameSite=Strict; Max-Age=" +
  age +
  (new URL(req.url).protocol === "https:" ? "; Secure" : "");
async function session(req, env) {
  const match = (req.headers.get("cookie") || "").match(
    /(?:^|;\s*)session=([a-f0-9-]{36})/,
  );
  if (!match) return null;
  return one(
    env.DB,
    "SELECT student,demo,role FROM sessions WHERE token=? AND expires>?",
    await digest(match[1]),
    now(),
  );
}
async function login(req, env, demo) {
  const data = await req.json();
  const role = data.role ?? "student";
  if (!["student", "ta"].includes(role) || (demo && role !== "student"))
    return reject("bad_login", 401);
  let student;
  if (demo) {
    if (modeFor(env) !== "simulation") return reject("demo_off", 403);
    student = "demo-" + crypto.randomUUID().slice(0, 12);
  } else {
    student = String(data.student || "").trim();
    if (
      !/^[A-Za-z0-9_-]{1,40}$/.test(student) ||
      typeof data.password !== "string" ||
      data.password.length > 256
    )
      return reject("bad_login", 401);
    const identity = await digest(student),
      time = now();
    await run(
      env.DB,
      `INSERT INTO login_attempts VALUES(?,1,?) ON CONFLICT(identity) DO UPDATE SET
      attempts=CASE WHEN since<=? THEN 1 ELSE attempts+1 END,since=CASE WHEN since<=? THEN excluded.since ELSE since END`,
      identity,
      time,
      time - 600,
      time - 600,
    );
    if (
      (
        await one(
          env.DB,
          "SELECT attempts FROM login_attempts WHERE identity=?",
          identity,
        )
      ).attempts > 12
    )
      return reject("rate_limit", 429);
    const configured = role === "ta" ? configuredTA(env) : null;
    const account =
      configured?.student === student
        ? configured
        : await one(env.DB, "SELECT * FROM accounts WHERE student=?", student);
    const hash = await passwordHash(
      data.password,
      account?.salt || "unknown-student",
    );
    if (
      !account ||
      hash !== account.verifier ||
      (role === "ta" &&
        !isTeachingAssistant(env, { student, role, demo: false }))
    )
      return reject("bad_login", 401);
    await run(env.DB, "DELETE FROM login_attempts WHERE identity=?", identity);
  }
  const token = crypto.randomUUID();
  await run(env.DB, "DELETE FROM sessions WHERE expires<=?", now());
  await run(
    env.DB,
    "INSERT INTO sessions(token,student,demo,expires,role) VALUES(?,?,?,?,?)",
    await digest(token),
    student,
    +demo,
    now() + 28800,
    role,
  );
  return reply({ ok: true }, 200, {
    "Set-Cookie": makeCookie(req, token, 28800),
  });
}
async function dashboard(env, user) {
  const db = env.DB,
    mode = modeFor(env),
    time = now();
  const running = await rows(
    db,
    "SELECT cards,started FROM jobs WHERE mode=? AND status IN ('running','dispatching','cancelling')",
    mode,
  );
  const count = await one(
    db,
    "SELECT COUNT(*) AS n FROM jobs WHERE mode=? AND status='queued'",
    mode,
  );
  const cap = await one(db, "SELECT * FROM scheduler WHERE id=1");
  const sim = mode === "simulation",
    healthy = sim || !!(cap.healthy && time - cap.checked < 180);
  const total = sim ? cardsFor(env) : healthy ? cap.total : null;
  const free = sim
    ? Math.max(0, total - running.reduce((s, j) => s + j.cards, 0))
    : healthy
      ? cap.free
      : null;
  const jobs = user
    ? await rows(
        db,
        `SELECT id,name,cards,mode,runtime,status,created,started,finished,logs,result,message
    FROM jobs WHERE student=? ORDER BY created DESC,id DESC LIMIT 50`,
        user.student,
      )
    : [];
  for (const j of jobs)
    if (j.status === "queued" && j.mode === mode) {
      const ahead = await rows(
        db,
        "SELECT id,cards FROM jobs WHERE mode=? AND status='queued' AND (created,id)<=(?,?) ORDER BY created,id",
        mode,
        j.created,
        j.id,
      );
      j.ahead = Math.max(0, ahead.length - 1);
      j.wait = sim
        ? estimate(ahead, running, total, secondsFor(env), time, j.id)
        : null;
    }
  const host = env.DEBUG_SSH_HOST || "";
  const ssh =
    user && !user.demo && /^[a-zA-Z0-9.-]+$/.test(host)
      ? "ssh " + (env.SSH_USER_PREFIX ?? "s") + user.student + "@" + host
      : null;
  return {
    user,
    staff: isTeachingAssistant(env, user),
    mode,
    total,
    free,
    healthy,
    queued: count.n,
    running: running.length,
    jobs,
    ssh,
    debugCards: 16,
    trainingPlanned: 48,
    time,
  };
}
const sampleZip =
  "UEsDBBQAAAAAAEt/cl3urNSWPQAAAD0AAAAGAAAAcnVuLnNoIyEvYmluL3NoCm1rZGlyIC1wIC9vdXRwdXRzCmVjaG8gSGVsbG8gPiAvb3V0cHV0cy9yZXN1bHQudHh0ClBLAQIUABQAAAAAAEt/cl3urNSWPQAAAD0AAAAGAAAAAAAAAAAAAACAAQAAAABydW4uc2hQSwUGAAAAAAEAAQA0AAAAYQAAAAAA";
async function submit(req, env, user) {
  if (Number(req.headers.get("content-length")) > 9 * 1024 * 1024)
    return reject("zip_size", 413);
  const form = await req.formData(),
    name = String(form.get("name") || "").trim(),
    cards = Number(form.get("cards"));
  const runtime = form.get("runtime"),
    mode = modeFor(env);
  if (
    !name ||
    name.length > 80 ||
    !Number.isInteger(cards) ||
    cards < 1 ||
    cards > 4 ||
    !["course-base", "dockerfile"].includes(runtime)
  )
    return reject("invalid_job", 400);
  if (user.demo && mode !== "simulation") return reject("demo_off", 403);
  if (
    await one(
      env.DB,
      "SELECT id FROM jobs WHERE student=? AND status IN ('queued','dispatching','running','cancelling')",
      user.student,
    )
  )
    return reject("active_job", 409);
  const file = form.get("file");
  let bytes;
  if (file && typeof file.arrayBuffer === "function" && file.size > 0) {
    if (file.size > 8 * 1024 * 1024) return reject("zip_size", 413);
    bytes = new Uint8Array(await file.arrayBuffer());
    if (
      bytes.length < 22 ||
      bytes[0] !== 80 ||
      bytes[1] !== 75 ||
      bytes[2] !== 3 ||
      bytes[3] !== 4
    )
      return reject("zip_format", 400);
  } else if (mode === "simulation" && runtime === "course-base")
    bytes = Uint8Array.from(atob(sampleZip), (c) => c.charCodeAt(0));
  else return reject("zip_required", 400);
  const id = crypto.randomUUID(),
    artifact = "input-" + id;
  await env.BUCKET.put(artifact, bytes);
  try {
    await run(
      env.DB,
      "INSERT INTO jobs(id,student,name,cards,mode,runtime,status,created,artifact) VALUES(?,?,?,?,?,?,'queued',?,?)",
      id,
      user.student,
      name,
      cards,
      mode,
      runtime,
      now(),
      artifact,
    );
  } catch (err) {
    await env.BUCKET.delete(artifact);
    if (/unique/i.test(String(err))) return reject("active_job", 409);
    throw err;
  }
  return reply({ id }, 201);
}

async function api(req, env) {
  const path = new URL(req.url).pathname,
    method = req.method,
    mode = modeFor(env);
  if (
    method !== "GET" &&
    (req.headers.get("X-Workspace") !== "1" ||
      (req.headers.has("Origin") &&
        req.headers.get("Origin") !== new URL(req.url).origin))
  )
    return reject("forbidden", 403);
  if (path === "/api/login" && method === "POST") return login(req, env, false);
  if (path === "/api/demo" && method === "POST") return login(req, env, true);
  if (path === "/api/logout" && method === "POST") {
    const token = (req.headers.get("cookie") || "").match(
      /(?:^|;\s*)session=([a-f0-9-]{36})/,
    );
    if (token)
      await run(
        env.DB,
        "DELETE FROM sessions WHERE token=?",
        await digest(token[1]),
      );
    return reply({ ok: true }, 200, { "Set-Cookie": makeCookie(req, "", 0) });
  }
  const input = path.match(/^\/api\/inputs\/(input-[\w-]+)$/);
  if (input && method === "GET") {
    if (
      !env.COMPUTE_TOKEN ||
      req.headers.get("Authorization") !== "Bearer " + env.COMPUTE_TOKEN
    )
      return reject("forbidden", 403);
    const blob = await env.BUCKET.get(input[1]);
    return blob
      ? new Response(blob.body, {
          headers: {
            "Content-Type": "application/zip",
            "Cache-Control": "no-store",
          },
        })
      : reject("missing", 404);
  }
  const user = await session(req, env);
  if (path === "/api/ta/debug-extension" && method === "POST")
    return extendDebugProcess(req, env, user);
  if (path === "/api/ta" && method === "GET")
    return consoleView(req, env, user);
  if (path === "/api/state" && method === "GET") {
    if (mode === "simulation") await tick(env);
    return reply(await dashboard(env, user));
  }
  if (!user) return reject("sign_in", 401);
  if (path === "/api/suggestions" && method === "POST")
    return receiveSuggestion(req, env, user);
  if (path === "/api/jobs" && method === "POST") return submit(req, env, user);
  const match = path.match(
    /^\/api\/jobs\/([a-f0-9-]{36})\/(cancel|log|result)$/,
  );
  if (!match) return reject("missing", 404);
  const j = await one(
    env.DB,
    "SELECT * FROM jobs WHERE id=? AND student=?",
    match[1],
    user.student,
  );
  if (!j) return reject("missing", 404);
  if (match[2] === "cancel" && method === "POST") {
    await run(
      env.DB,
      `UPDATE jobs SET status=CASE WHEN mode='simulation' OR status='queued' THEN 'cancelled' ELSE 'cancelling' END,
      finished=CASE WHEN mode='simulation' OR status='queued' THEN ? ELSE finished END WHERE id=? AND status IN ('queued','running','dispatching')`,
      now(),
      j.id,
    );
    return reply({ ok: true });
  }
  if (method !== "GET") return reject("missing", 404);
  const result = match[2] === "result";
  if (result && j.status !== "succeeded") return reject("missing", 404);
  if (j.mode === "simulation") {
    const data = result
      ? {
          simulation: true,
          job: j.id,
          name: j.name,
          cards: j.cards,
          status: j.status,
          started: j.started,
          finished: j.finished,
        }
      : {
          simulation: true,
          created: j.created,
          started: j.started,
          finished: j.finished,
          status: j.status,
        };
    return result
      ? new Response(JSON.stringify(data, null, 2), {
          headers: {
            "Content-Type": "application/json",
            "Content-Disposition":
              'attachment; filename="simulation-result.json"',
            "Cache-Control": "no-store",
          },
        })
      : reply(data);
  }
  const key = result ? j.result : j.logs;
  if (!key || mode !== "remote") return reject("not_ready", 404);
  const upstream = await providerRequest(
    env,
    "/artifacts/" + encodeURIComponent(key),
  );
  if (!upstream.ok) return reject("not_ready", 502);
  if (!result) return reply({ text: (await upstream.text()).slice(0, 16000) });
  return new Response(upstream.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": 'attachment; filename="result.zip"',
      "Cache-Control": "no-store",
    },
  });
}
