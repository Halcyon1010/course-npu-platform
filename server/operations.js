// Fixed inspection time keeps warning thresholds and extension dates consistent.
const sampleTime = Date.UTC(2026, 10, 18, 8, 0) / 1000;
const pageSize = 25;
const categories = ["training", "debug", "website", "other"];
const exampleJobs = [
  ["20260017", "resnet50-baseline", 4, 32],
  ["20260042", "vit-finetune", 2, 24],
  ["20260031", "unet-ablation", 1, 18],
  ["20260058", "qwen-lora", 4, 11],
  ["20260063", "optimizer-sweep", 2, 7],
  ["20260074", "linear-probe", 1, 2],
].map(([student, name, cards, minutes]) => ({
  student,
  name,
  cards,
  created: sampleTime - minutes * 60,
  status: "queued",
}));

const exampleProcesses = [
  ["20260031", "debug-01", 18472, 146, 38],
  ["20260042", "debug-02", 9310, 135, -12],
  ["20260058", "debug-02", 17041, 95, null],
  ["20260017", "debug-01", 20682, 48, null],
  ["20260017", "debug-01", 21796, 16, null],
].map(([student, node, pid, minutes, extra]) => ({
  student,
  node,
  pid,
  started: sampleTime - minutes * 60,
  until: extra === null ? null : sampleTime + extra * 60,
}));
const exampleSuggestions = [
  {
    id: "S02",
    student: "20260042",
    category: "training",
    created: sampleTime - 3600,
    message: "Show the requested card count in the queue notification.",
    zh: "希望排队通知里也显示申请的卡数。",
  },
  {
    id: "S01",
    student: "20260017",
    category: "debug",
    created: sampleTime - 7200,
    message: "Include the node name in the debug warning email.",
    zh: "建议在调试提醒邮件中附上节点名称。",
  },
];
function configuredTA(env) {
  return env.TA_LOGIN_RECORD ? JSON.parse(env.TA_LOGIN_RECORD) : null;
}
function isTeachingAssistant(env, user) {
  return (
    !!user &&
    !user.demo &&
    user.role === "ta" &&
    (configuredTA(env)?.student === user.student ||
      (env.TA_ACCOUNT_IDS || "")
        .split(",")
        .some((id) => id.trim() === user.student))
  );
}
async function receiveSuggestion(req, env, user) {
  let data;
  try {
    data = await req.json();
  } catch {
    return reject("invalid_suggestion", 400);
  }
  const message = typeof data?.message === "string" ? data.message.trim() : "";
  if (!categories.includes(data?.category) || !message || message.length > 2000)
    return reject("invalid_suggestion", 400);
  const saved = await one(
    env.DB,
    "INSERT INTO suggestions(student,category,message,created) VALUES(?,?,?,?) RETURNING id",
    user.student,
    data.category,
    message,
    now(),
  );
  return reply({ id: saved.id }, 201);
}
async function consoleView(req, env, user) {
  const staff = isTeachingAssistant(env, user),
    simulated = modeFor(env) === "simulation";
  if (!staff) return reject(user ? "forbidden" : "sign_in", user ? 403 : 401);
  const params = new URL(req.url).searchParams;
  const section = params.get("section") || "queue",
    offset = Number(params.get("offset") || 0);
  if (
    !["queue", "processes", "inbox"].includes(section) ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  )
    return reject("invalid_page", 400);
  const preview = simulated && params.get("sample") === "1";
  let records, total;
  if (preview || section === "processes") {
    const fixtures = {
      queue: exampleJobs,
      processes: simulated ? exampleProcesses : [],
      inbox: exampleSuggestions,
    };
    records = fixtures[section].slice(offset, offset + pageSize);
    total = fixtures[section].length;
  } else if (section === "inbox") {
    total = (await one(env.DB, "SELECT COUNT(*) AS n FROM suggestions")).n;
    records = await rows(
      env.DB,
      "SELECT id,student,category,message,created FROM suggestions ORDER BY id DESC LIMIT ? OFFSET ?",
      pageSize,
      offset,
    );
  } else {
    const mode = modeFor(env);
    total = (
      await one(
        env.DB,
        "SELECT COUNT(*) AS n FROM jobs WHERE mode=? AND status='queued'",
        mode,
      )
    ).n;
    records = await rows(
      env.DB,
      "SELECT student,name,cards,status,created FROM jobs WHERE mode=? AND status='queued' ORDER BY created,id LIMIT ? OFFSET ?",
      mode,
      pageSize,
      offset,
    );
  }
  return reply({
    section,
    records,
    total,
    offset,
    pageSize,
    preview,
    sample: preview || (section === "processes" && simulated),
    connected: section !== "processes" || simulated,
    at: preview || (section === "processes" && simulated) ? sampleTime : now(),
  });
}
