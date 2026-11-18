import "../scripts/build.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { storage } from "../scripts/storage.mjs";
const {
  default: worker,
  tick,
  passwordHash,
} = await import("../dist/server/index.js");

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "course-compute-test-"));
  const env = { ...storage(root), SIM_CARDS: "4", SIM_SECONDS: "120" };
  t.after(() => {
    env.close();
    rmSync(root, { recursive: true, force: true });
  });
  const request = (path, { cookie = "", method = "GET", body } = {}) =>
    worker.fetch(
      new Request("http://localhost/api/" + path, {
        method,
        headers: { "X-Workspace": "1", Cookie: cookie },
        body,
      }),
      env,
      { waitUntil: () => {} },
    );
  const demo = async () =>
    (await request("demo", { method: "POST", body: "{}" })).headers
      .get("Set-Cookie")
      .split(";")[0];
  const submit = (cookie, cards) => {
    const f = new FormData();
    f.set("name", "Test");
    f.set("cards", String(cards));
    f.set("runtime", "course-base");
    return request("jobs", { method: "POST", cookie, body: f });
  };
  const advance = async () => {
    env.DB.prepare("UPDATE scheduler SET lease_until=0").bind().run();
    await tick(env);
  };
  return { env, request, demo, submit, advance };
}

test("TA previews isolate student records and submissions reach the authorized inbox", async (t) => {
  const { env, request, demo, submit } = fixture(t);
  const student = await demo();
  const suggestion = async (cookie, message, extra = {}) =>
    request("suggestions", {
      cookie,
      method: "POST",
      body: JSON.stringify({ category: "website", message, ...extra }),
    });
  assert.equal((await suggestion("", "Guest")).status, 401);
  assert.equal((await suggestion(student, "  ")).status, 400);
  assert.equal((await suggestion(student, "x".repeat(2001))).status, 400);
  const saved = await suggestion(student, "Improve queue notices", {
    student: "spoof",
  });
  assert.equal(saved.status, 201);
  const { id } = await saved.json();
  await submit(student, 4);
  assert.equal(
    (await request("ta?section=inbox&sample=1", { cookie: student })).status,
    403,
  );
  assert.equal((await request("ta?section=processes")).status, 401);
  assert.equal(
    (await request("demo", { method: "POST", body: '{"role":"ta"}' })).status,
    401,
  );
  env.TA_ACCOUNT_IDS = "staff1";
  env.DB.prepare("INSERT INTO accounts VALUES(?,?,?)")
    .bind("staff1", "salt", await passwordHash("course-ta-password", "salt"))
    .run();
  const studentLogin = await request("login", {
    method: "POST",
    body: JSON.stringify({ student: "staff1", password: "course-ta-password" }),
  });
  const studentRole = studentLogin.headers.get("Set-Cookie").split(";")[0];
  assert.equal(
    (await request("ta?section=queue", { cookie: studentRole })).status,
    403,
  );
  const login = await request("login", {
    method: "POST",
    body: JSON.stringify({
      student: "staff1",
      password: "course-ta-password",
      role: "ta",
    }),
  });
  const staff = login.headers.get("Set-Cookie").split(";")[0];
  const proc = await (
    await request("ta?section=processes", { cookie: staff })
  ).json();
  assert.ok(proc.records.some((p) => p.until > proc.at));
  assert.ok(proc.records.some((p) => p.until && p.until < proc.at));
  assert.ok(
    proc.records.every((p) => p.started < proc.at && p.pid && p.student),
  );
  assert.equal(
    (
      await (
        await request("ta?section=queue&sample=1", { cookie: staff })
      ).json()
    ).preview,
    true,
  );
  const inbox = await (
    await request("ta?section=inbox", { cookie: staff })
  ).json();
  assert.equal(inbox.preview, false);
  assert.equal(inbox.records[0].id, id);
  assert.notEqual(inbox.records[0].student, "spoof");
  assert.equal(inbox.records[0].message, "Improve queue notices");
  const queue = await (
    await request("ta?section=queue", { cookie: staff })
  ).json();
  assert.equal(queue.records[0].cards, 4);
  env.COMPUTE_API_URL = "https://provider.example/v1";
  assert.equal(
    (await request("ta?section=inbox", { cookie: student })).status,
    403,
  );
  assert.equal((await request("ta?section=inbox")).status, 401);
  assert.equal(
    (await (await request("ta?section=processes", { cookie: staff })).json())
      .connected,
    false,
  );
});

test("group allocation, one active job, queue ETA, owner access and results", async (t) => {
  const { env, request, demo, submit, advance } = fixture(t);
  const a = await demo(),
    b = await demo();
  const first = await submit(a, 4);
  assert.equal(first.status, 201);
  const { id } = await first.json();
  assert.equal((await submit(a, 1)).status, 409);
  await advance();
  assert.equal((await submit(b, 2)).status, 201);
  await advance();
  const state = await (await request("state", { cookie: b })).json();
  assert.equal(state.free, 0);
  assert.equal(state.jobs[0].ahead, 0);
  assert.ok(state.jobs[0].wait > 0);
  assert.equal(
    (await request("jobs/" + id + "/log", { cookie: b })).status,
    404,
  );
  env.DB.prepare("UPDATE jobs SET started=started-125 WHERE id=?")
    .bind(id)
    .run();
  await advance();
  const download = await request("jobs/" + id + "/result", { cookie: a });
  assert.equal((await download.json()).simulation, true);
  const next = await (await request("state", { cookie: b })).json();
  assert.equal(next.jobs[0].status, "running");
  assert.equal(next.free, 2);
  await request("jobs/" + next.jobs[0].id + "/cancel", {
    method: "POST",
    cookie: b,
    body: "{}",
  });
  assert.equal((await submit(b, 1)).status, 201);
});
test("course identity, SSH mapping and logout", async (t) => {
  const { env, request } = fixture(t);
  env.DEBUG_SSH_HOST = "lab.example.edu";
  env.DB.prepare("INSERT INTO accounts VALUES(?,?,?)")
    .bind("20261234", "salt", await passwordHash("example-password", "salt"))
    .run();
  const auth = await request("login", {
    method: "POST",
    body: JSON.stringify({ student: "20261234", password: "example-password" }),
  });
  assert.equal(auth.status, 200);
  const cookie = auth.headers.get("Set-Cookie").split(";")[0];
  assert.equal(
    (await (await request("state", { cookie })).json()).ssh,
    "ssh s20261234@lab.example.edu",
  );
  await request("logout", { method: "POST", cookie, body: "{}" });
  assert.equal((await (await request("state", { cookie })).json()).user, null);
});
test("HTTP resource adapter dispatches all cards with stable ID and reconciles cancellation", async (t) => {
  const { env, advance } = fixture(t);
  env.COMPUTE_API_URL = "https://provider.example/v1";
  env.COMPUTE_TOKEN = "test-only";
  const id = crypto.randomUUID();
  env.DB.prepare(
    "INSERT INTO jobs(id,student,name,cards,mode,runtime,status,created,artifact) VALUES(?,?,?,4,'remote','course-base','queued',1,?)",
  )
    .bind(id, "123", "Remote", "input-" + id)
    .run();
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, opts) => {
    calls.push([url, opts]);
    if (url.endsWith("/capacity"))
      return Response.json({ total: 48, free: 48 });
    assert.equal(url, "https://provider.example/v1/jobs/" + id);
    return Response.json({
      id,
      status: opts.method === "DELETE" ? "cancelled" : "running",
      log_id: null,
      result_id: null,
    });
  });
  await advance();
  const put = calls.find((x) => x[1].method === "PUT");
  assert.equal(JSON.parse(put[1].body).cards, 4);
  assert.equal(put[1].headers.Authorization, "Bearer test-only");
  env.DB.prepare("UPDATE jobs SET status='cancelling' WHERE id=?")
    .bind(id)
    .run();
  await advance();
  assert.equal(
    env.DB.prepare("SELECT status FROM jobs WHERE id=?").bind(id).first()
      .status,
    "cancelled",
  );
});
