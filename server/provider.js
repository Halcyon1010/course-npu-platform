// The simulator and the HTTPS adapter share the same persistent platform queue.
const active = ["queued", "dispatching", "running", "cancelling"];
const now = () => Math.floor(Date.now() / 1000);
const query = (db, sql, ...args) => db.prepare(sql).bind(...args);
const rows = async (db, sql, ...args) =>
  (await query(db, sql, ...args).all()).results;
const run = (db, sql, ...args) => query(db, sql, ...args).run();
const one = (db, sql, ...args) => query(db, sql, ...args).first();
const modeFor = (env) => (env.COMPUTE_API_URL ? "remote" : "simulation");
const secondsFor = (env) => Math.max(1, Number(env.SIM_SECONDS) || 120);
const cardsFor = (env) =>
  Math.min(48, Math.max(0, Number(env.SIM_CARDS ?? 48)));

async function providerRequest(env, path, method = "GET", body) {
  const base = new URL(env.COMPUTE_API_URL);
  if (
    base.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(base.hostname)
  )
    throw Error("invalid_provider");
  const headers = { "Content-Type": "application/json" };
  if (env.COMPUTE_TOKEN) headers.Authorization = "Bearer " + env.COMPUTE_TOKEN;
  return fetch(base.href.replace(/\/$/, "") + path, {
    method,
    headers,
    body: body && JSON.stringify(body),
    redirect: "error",
    signal: AbortSignal.timeout(4000),
  });
}

async function simulate(env, time) {
  const db = env.DB;
  await run(
    db,
    "UPDATE jobs SET status='succeeded',finished=? WHERE mode='simulation' AND status='running' AND started<=?",
    time,
    time - secondsFor(env),
  );
  const queue = await rows(
    db,
    "SELECT * FROM jobs WHERE mode='simulation' AND status='queued' ORDER BY created,id LIMIT 48",
  );
  for (const j of queue) {
    const response = await run(
      db,
      `UPDATE jobs SET status='running',started=? WHERE id=? AND status='queued'
      AND cards <= ? - (SELECT COALESCE(SUM(cards),0) FROM jobs WHERE mode='simulation' AND status='running')`,
      time,
      j.id,
      cardsFor(env),
    );
    if (!response.meta.changes) break;
  }
}

async function storeRemote(env, j, info) {
  if (
    !["running", "succeeded", "failed", "cancelled", "cancelling"].includes(
      info.status,
    ) ||
    info.id !== j.id
  )
    throw Error("invalid_response");
  const terminal = !["running", "cancelling"].includes(info.status);
  await run(
    env.DB,
    `UPDATE jobs SET status=CASE WHEN status='cancelling' AND ?='running' THEN status ELSE ? END,
    started=COALESCE(started,?),finished=?,logs=?,result=?,message=?
    WHERE id=? AND status IN ('dispatching','running','cancelling')`,
    info.status,
    info.status,
    now(),
    terminal ? now() : null,
    info.log_id ?? null,
    info.result_id ?? null,
    info.error ?? null,
    j.id,
  );
}

async function syncRemote(env) {
  const db = env.DB;
  // Rotate reconciliation by oldest check to service all 48 running jobs.
  const pending = await rows(
    db,
    `SELECT * FROM jobs WHERE mode='remote' AND status IN ('running','dispatching','cancelling')
    ORDER BY COALESCE(last_checked,0),created,id LIMIT 8`,
  );
  for (const j of pending) {
    await run(
      db,
      "UPDATE jobs SET last_checked=? WHERE id=?",
      Date.now(),
      j.id,
    );
    const response = await providerRequest(
      env,
      "/jobs/" + j.id,
      j.status === "cancelling" ? "DELETE" : "GET",
    );
    if (response.status === 404 && j.status === "dispatching") {
      await run(
        db,
        "UPDATE jobs SET status='queued' WHERE id=? AND status='dispatching'",
        j.id,
      );
    } else if (response.ok) await storeRemote(env, j, await response.json());
    else throw Error("pending_reconciliation");
  }
  const capacity = await providerRequest(env, "/capacity");
  if (!capacity.ok) throw Error("capacity_unavailable");
  const cap = await capacity.json();
  if (
    !Number.isInteger(cap.free) ||
    !Number.isInteger(cap.total) ||
    cap.free < 0 ||
    cap.total < cap.free
  )
    throw Error("invalid_capacity");
  let free = cap.free;
  const queue = await rows(
    db,
    "SELECT * FROM jobs WHERE status='queued' AND mode='remote' ORDER BY created,id LIMIT 8",
  );
  for (const j of queue) {
    if (j.cards > free) break;
    const claimed = await run(
      db,
      "UPDATE jobs SET status='dispatching' WHERE id=? AND status='queued'",
      j.id,
    );
    if (!claimed.meta.changes) continue;
    const res = await providerRequest(env, "/jobs/" + j.id, "PUT", {
      cards: j.cards,
      artifact_id: j.artifact,
      runtime: j.runtime,
    });
    if (
      res.status === 409 &&
      (await res.clone().json()).error === "no_capacity"
    ) {
      await run(
        db,
        "UPDATE jobs SET status='queued' WHERE id=? AND status='dispatching'",
        j.id,
      );
      break;
    }
    if (res.status === 400 || res.status === 422) {
      await run(
        db,
        "UPDATE jobs SET status='failed',finished=?,message='provider_rejected' WHERE id=? AND status='dispatching'",
        now(),
        j.id,
      );
      continue;
    }
    if (!res.ok) throw Error("dispatch_uncertain");
    await storeRemote(env, j, await res.json());
    free -= j.cards;
  }
  await run(
    db,
    "UPDATE scheduler SET total=?,free=?,healthy=1,checked=? WHERE id=1",
    cap.total,
    free,
    now(),
  );
}

async function tick(env) {
  const db = env.DB,
    time = now(),
    owner = crypto.randomUUID();
  const lease = await run(
    db,
    "UPDATE scheduler SET owner=?,lease_until=? WHERE id=1 AND lease_until<=?",
    owner,
    time + 150,
    time,
  );
  if (!lease.meta.changes) return;
  try {
    await simulate(env, time);
    if (modeFor(env) === "remote") await syncRemote(env);
  } catch (error) {
    await run(db, "UPDATE scheduler SET healthy=0,checked=? WHERE id=1", time);
    console.error("Scheduler pass failed", error.name);
  } finally {
    await run(
      db,
      "UPDATE scheduler SET lease_until=?,owner=NULL WHERE id=1 AND owner=?",
      time + 2,
      owner,
    );
  }
}

function estimate(queue, running, total, duration, time, id) {
  // One interchangeable pool in simulation. Start an entire job on the first
  // instant at which enough lanes are simultaneously free.
  const lanes = [];
  for (const j of running)
    for (let i = 0; i < j.cards; i++)
      lanes.push(Math.max(0, j.started + duration - time));
  while (lanes.length < total) lanes.push(0);
  for (const j of queue) {
    if (j.cards > total) return null;
    lanes.sort((a, b) => a - b);
    const start = lanes[j.cards - 1];
    if (j.id === id) return start;
    for (let i = 0; i < j.cards; i++) lanes[i] = start + duration;
  }
  return null;
}
