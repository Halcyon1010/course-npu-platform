import { operationsView } from "./console.js";
const by = (id) => document.getElementById(id);
let lang = localStorage.getItem("course-language") === "zh" ? "zh" : "en";
const t = (en, zh) => (lang === "zh" ? zh : en);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
let state = null,
  modalType = null,
  chosen = null,
  pending = false,
  fetchSeq = 0;
let loginRole = "student",
  sampleQueue = true;
const page = () =>
  location.hash === "#feedback"
    ? "feedback"
    : state?.staff
      ? "ta"
      : ["training", "debug"].includes(location.hash.slice(1))
        ? location.hash.slice(1)
        : "overview";
const names = () => ({
  overview: t("Overview", "概览"),
  training: t("Training jobs", "训练任务"),
  debug: t("Debug access", "调试入口"),
  ta: t("TA console", "助教管理端"),
  feedback: t("Feedback", "提建议"),
});
const statusName = (s) =>
  ({
    running: t("Running", "运行中"),
    queued: t("Queued", "排队中"),
    dispatching: t("Starting", "派发中"),
    cancelled: t("Cancelled", "已取消"),
    cancelling: t("Cancelling", "取消中"),
    succeeded: t("Completed", "已完成"),
    failed: t("Failed", "失败"),
  })[s] || s;
const userName = () =>
  state?.user?.demo ? t("Demo student", "演示学生") : state?.user?.student;
const sim = () => state?.mode === "simulation";
const live = (s) =>
  ["queued", "running", "dispatching", "cancelling"].includes(s);
const time = (n) =>
  n
    ? new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en-GB", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(n * 1000)
    : "—";
const icon = (text) =>
  '<span class="iconbox" aria-hidden="true">' + text + "</span>";
const button = (act, text, cls = "btn") =>
  '<button type="button" data-do="' +
  act +
  '" class="' +
  cls +
  '">' +
  text +
  "</button>";
const errors = () => ({
  invalid_suggestion: t(
    "Choose a category and enter up to 2,000 characters.",
    "请选择类别，建议内容限 2,000 字。",
  ),
  forbidden: t("This view requires a TA account.", "此视图需要助教账号。"),
  bad_login: t("Check your student ID and password.", "请检查学号和密码。"),
  active_job: t(
    "You already have an active training job.",
    "你已有一个活跃训练任务。",
  ),
  zip_size: t("The ZIP must be 8 MiB or smaller.", "ZIP 文件不能超过 8 MiB。"),
  zip_format: t("Please upload a ZIP archive.", "请上传 ZIP 代码包。"),
  zip_required: t("Attach your project ZIP first.", "请先选择项目 ZIP。"),
  rate_limit: t(
    "Too many attempts. Try again in 10 minutes.",
    "尝试次数过多，请在 10 分钟后重试。",
  ),
  invalid_job: t(
    "Check the job name, runtime and card count.",
    "请检查任务名称、运行环境和卡数。",
  ),
  sign_in: t("Please sign in again.", "请重新登录。"),
  not_ready: t("This file is not available yet.", "该文件暂时不可用。"),
});
async function api(path, body, method) {
  const options = {
    method: method || (body ? "POST" : "GET"),
    headers: { "X-Workspace": "1" },
  };
  if (body instanceof FormData) options.body = body;
  else if (body) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const res = await fetch("/api/" + path, options);
  const data = await res.json();
  if (!res.ok)
    throw Error(
      errors()[data.error] ||
        t("Request failed. Please try again.", "请求失败，请稍后再试。"),
    );
  return data;
}
async function refresh() {
  const seq = ++fetchSeq;
  try {
    const next = await api("state");
    if (seq !== fetchSeq) return;
    state = next;
    if (!state.staff) {
      consoleData = null;
      ++consoleSeq;
    }
    if (
      (location.hash === "#ta" && !state.staff) ||
      (state.staff && !["#ta", "#feedback"].includes(location.hash))
    )
      history.replaceState(null, "", "#" + (state.staff ? "ta" : "overview"));
    if (page() === "ta") await loadConsole();
    render();
  } catch (e) {
    if (!state)
      by("content").innerHTML =
        '<div class="pane">' +
        esc(
          t(
            "Workspace unavailable. Refresh to retry.",
            "工作区暂时不可用，请刷新重试。",
          ),
        ) +
        "</div>";
    else notify(e.message);
  }
}
let consoleSection = "queue",
  consoleOffset = 0,
  consoleData = null,
  consoleSeq = 0;
async function loadConsole() {
  const seq = ++consoleSeq;
  try {
    const data = await api(
      "ta?section=" +
        consoleSection +
        "&offset=" +
        consoleOffset +
        "&sample=" +
        Number(consoleSection === "queue" && sampleQueue && sim()),
    );
    if (seq === consoleSeq) consoleData = data;
  } catch (error) {
    if (seq === consoleSeq) consoleData = { error: error.message };
  }
}
function notify(msg) {
  by("toast").textContent = msg;
  clearTimeout(notify.timer);
  notify.timer = setTimeout(() => (by("toast").textContent = ""), 4000);
}
function pool(debug) {
  const n = debug ? 16 : 48,
    title = debug ? t("Debug pool", "调试池") : t("Training pool", "训练池");
  return (
    '<article class="card ' +
    (debug ? "debug" : "train") +
    '"><div class="cardtop">' +
    icon(debug ? "›_" : "▦") +
    '<span class="pill">' +
    (debug ? t("Shared SSH", "共享 SSH") : t("Job queue", "任务队列")) +
    "</span></div><h3>" +
    title +
    '</h3><p class="description">' +
    (debug
      ? t(
          "Interactive debugging on shared hardware.",
          "在共享设备上进行交互式代码调试。",
        )
      : t(
          "Submit training jobs with 1–4 cards per run.",
          "提交训练任务，每次使用 1–4 张卡。",
        )) +
    '</p><div class="caprow"><div><strong>' +
    n +
    "</strong><small>" +
    t("NPU cards", "张 NPU 卡") +
    '</small></div><span class="matrix" aria-hidden="true">' +
    "<i></i>".repeat(n) +
    '</span></div><a class="actionlink" href="#' +
    (debug ? "debug" : "training") +
    '">' +
    (debug
      ? t("Open debug access", "进入调试区")
      : t("View training jobs", "查看训练任务")) +
    '<span class="arrow">↗</span></a></article>'
  );
}
function table(jobs) {
  const head = [
    t("Job name", "任务名"),
    t("Cards", "卡数"),
    t("Status", "状态"),
    t("Submitted", "提交时间"),
    "",
  ];
  return (
    '<div class="tablebox"><div class="table-scroll"><table><thead><tr>' +
    head.map((h) => "<th>" + h + "</th>").join("") +
    "</tr></thead><tbody>" +
    jobs
      .map(
        (j) =>
          "<tr><td><b>" +
          esc(j.name) +
          "</b></td><td>" +
          j.cards +
          '</td><td><span class="status">' +
          statusName(j.status) +
          "</span></td><td>" +
          time(j.created) +
          '</td><td><button class="linkbtn" data-id="' +
          esc(j.id) +
          '">' +
          t("Details", "详情") +
          " →</button></td></tr>",
      )
      .join("") +
    "</tbody></table></div>" +
    (!jobs.length
      ? '<div class="empty">' +
        icon("≡") +
        "<div><strong>" +
        t("No training jobs yet", "暂无训练任务") +
        "</strong><small>" +
        (state.user
          ? t(
              "Your submitted jobs will appear here.",
              "提交的训练任务将在此显示。",
            )
          : t(
              "Sign in to see your training history.",
              "登录后可查看自己的训练记录。",
            )) +
        "</small></div></div>"
      : "") +
    "</div>"
  );
}
function hero() {
  return (
    '<div class="hero"><div class="herotext"><span class="herochip">' +
    (sim() ? t("SIMULATION", "模拟环境") : t("COMPUTE ADAPTER", "算力接口")) +
    "</span><h1>" +
    t("Compute workspace", "算力工作区") +
    "</h1><p>" +
    t(
      "Shared debugging and scheduled training on the course Ascend 910C cluster.",
      "在课程昇腾 910C 集群上进行共享调试与训练任务调度。",
    ) +
    '</p></div><canvas id="chip" aria-hidden="true"></canvas></div>'
  );
}
function art() {
  const canvas = by("chip");
  if (!canvas) return;
  const w = 500,
    h = 250;
  canvas.width = w * 2;
  canvas.height = h * 2;
  const c = canvas.getContext("2d");
  c.scale(2, 2);
  const poly = (v, fill, stroke) => {
    c.beginPath();
    v.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
    c.closePath();
    if (fill) {
      c.fillStyle = fill;
      c.fill();
    }
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = 1;
      c.stroke();
    }
  };
  const iso = (x, y, z) => [248 + (x - y) * 1.12, 151 + (x + y) * 0.43 - z];
  const quad = (r, z) => [
    iso(-r, -r, z),
    iso(r, -r, z),
    iso(r, r, z),
    iso(-r, r, z),
  ];
  for (let i = -5; i <= 5; i++) {
    for (const flip of [false, true]) {
      const l = [-113, -90, -72],
        v = l.map((x, k) =>
          flip
            ? iso(i * 12 + (k === 0 ? 12 : 0), x, -8)
            : iso(x, i * 12 + (k === 0 ? 12 : 0), -8),
        );
      c.beginPath();
      v.forEach(([x, y], k) => (k ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.strokeStyle = "#639f80";
      c.stroke();
      c.fillStyle = "#91ba91";
      c.fillRect(v[0][0] - 1, v[0][1] - 1, 3, 3);
    }
  }
  function slab(r, z, height, top, left, right) {
    const q = quad(r, z),
      b = quad(r, z - height);
    poly([q[3], q[2], b[2], b[3]], left, "#41806c");
    poly([q[2], q[1], b[1], b[2]], right, "#477c69");
    poly(q, top, "#82bca0");
  }
  slab(72, 0, 8, "#2a5347", "#183b32", "#356a55");
  slab(65, 12, 6, "#34614e", "#265342", "#37735a");
  for (let i = -55; i <= 55; i += 6) {
    for (const [a, b] of [
      [iso(i, 57, 15), iso(i, 66, 15)],
      [iso(57, i, 15), iso(66, i, 15)],
    ]) {
      c.beginPath();
      c.moveTo(...a);
      c.lineTo(...b);
      c.strokeStyle = "#ccca94";
      c.lineWidth = 3;
      c.stroke();
    }
  }
  slab(56, 26, 10, "#43745d", "#254339", "#396650");
  slab(47, 36, 5, "#24463c", "#18392f", "#264b3c");
  poly(quad(42, 36.5), null, "#7fbf94");
  c.save();
  c.setTransform(
    2.24,
    0.86,
    -2.24,
    0.86,
    ...iso(-31, -20, 38).map((n) => n * 2),
  );
  c.fillStyle = "#d8efcc";
  c.font = "bold 12px monospace";
  c.fillText("ASCEND", 0, 14);
  c.font = "bold 16px monospace";
  c.fillText("910C", 0, 33);
  c.restore();
}
function render() {
  document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  by("lang").setAttribute("aria-label", t("Language", "语言"));
  for (const option of by("lang").querySelectorAll("button")) {
    option.setAttribute("aria-pressed", String(option.dataset.lang === lang));
  }
  by("account").textContent = userName() || t("Sign in", "登录");
  by("close").setAttribute("aria-label", t("Close", "关闭"));
  by("nav").innerHTML = Object.entries(names())
    .filter(([k]) =>
      state?.staff ? ["ta", "feedback"].includes(k) : k !== "ta",
    )
    .map(
      ([k, v]) =>
        '<a href="#' +
        k +
        '" class="' +
        (page() === k ? "current" : "") +
        '">' +
        v +
        "</a>",
    )
    .join("");
  by("foot").textContent = sim()
    ? t("Simulated compute environment", "模拟算力环境")
    : t("Compute service", "算力服务");
  if (!state) return;
  const crumb =
    '<div class="crumb">' +
    t("Workspace", "工作区") +
    "<span>/</span>" +
    names()[page()] +
    "</div>";
  if (page() === "feedback") {
    const owner = state.user?.student || "";
    const existing = by("feedback-page");
    if (existing?.lang === lang && existing.dataset.owner === owner) return;
    const draft = existing?.dataset.owner === owner ? by("stext")?.value : null;
    const category = by("scat")?.value;
    by("content").innerHTML =
      crumb +
      '<section id="feedback-page" class="feedback-page"><div class="pagetitle"><h1>' +
      names().feedback +
      '</h1></div><div class="pane">' +
      feedbackForm() +
      "</div></section>";
    by("feedback-page").lang = lang;
    by("feedback-page").dataset.owner = owner;
    if (draft != null && by("stext")) {
      by("stext").value = draft;
      by("scat").value = category;
    }
    return;
  }
  if (page() === "overview")
    by("content").innerHTML =
      crumb +
      hero() +
      '<div class="sectionhead"><h2>' +
      t("Resource pools", "资源池") +
      '</h2><span class="meta">ASCEND 910C</span></div><div class="pools">' +
      pool(true) +
      pool(false) +
      '</div><div class="sectionhead"><h2>' +
      t("Recent training jobs", "近期训练任务") +
      '</h2><a class="linkbtn" href="#training">' +
      t("View all", "查看全部") +
      " →</a></div>" +
      table(state.jobs.slice(0, 3));
  if (page() === "ta")
    by("content").innerHTML =
      crumb +
      operationsView({
        t,
        esc,
        time,
        section: consoleSection,
        data: consoleData,
        staff: state.staff,
        canSwitchQueue: sim(),
      });
  if (page() === "training") {
    const metrics = [
      [
        t("Available cards", "可用卡数"),
        (state.free ?? "—") + " / " + (state.total ?? "—"),
      ],
      [t("Running jobs", "运行任务"), state.running],
      [t("Queued jobs", "排队任务"), state.queued],
    ];
    by("content").innerHTML =
      crumb +
      '<div class="pagetitle"><div><h1>' +
      names().training +
      '</h1><p class="muted">' +
      t(
        "One active job per student · 1–4 cards per job",
        "每人一个活跃任务 · 每任务 1–4 张卡",
      ) +
      "</p></div>" +
      button("new", t("+ New job", "＋ 新建任务")) +
      '</div><div class="metrics">' +
      metrics
        .map(
          ([k, v]) =>
            '<div class="metric"><span class="meta">' +
            k +
            "</span><strong>" +
            v +
            "</strong></div>",
        )
        .join("") +
      '</div><div class="sectionhead"><h2>' +
      t("My training jobs", "我的训练任务") +
      '</h2><span class="meta">' +
      (sim()
        ? t("SIMULATION", "模拟环境")
        : t("RESOURCE SERVICE", "算力服务")) +
      "</span></div>" +
      table(state.jobs);
  }
  if (page() === "debug") {
    by("content").innerHTML =
      crumb +
      '<div class="pagetitle"><div><h1>' +
      names().debug +
      '</h1><p class="muted">' +
      t(
        "16 shared Ascend 910C cards for interactive debugging.",
        "16 张共享昇腾 910C 卡，用于交互式调试。",
      ) +
      '</p></div></div><div class="pane">' +
      icon("›_") +
      "<h3>" +
      t("SSH connection", "SSH 连接") +
      '</h3><p class="muted">' +
      (state.ssh
        ? t(
            "Connect using your enrolled course SSH identity.",
            "请使用已登记的课程 SSH 身份连接。",
          )
        : t(
            "The debug endpoint will appear here when the course hardware is connected.",
            "课程硬件接入后，此处将显示调试节点的 SSH 入口。",
          )) +
      "</p>" +
      (state.ssh
        ? '<pre class="code">' +
          esc(state.ssh) +
          "</pre>" +
          button("copy", t("Copy command", "复制命令"))
        : !state.user
          ? button("login", t("Student sign in", "学生登录"))
          : "") +
      '</div><div class="pane"><h3>' +
      t("Shared pool rules", "共享调试规则") +
      "</h3><ul><li>" +
      t(
        "Use your personal course SSH account. No card reservation is required.",
        "使用个人课程 SSH 账号登录，无需预约卡。",
      ) +
      "</li><li>" +
      t(
        "Debugging only. Long training runs belong in the training pool.",
        "仅用于调试，长时间训练请提交至训练池。",
      ) +
      "</li><li>" +
      t(
        "Processes using a debug NPU are checked hourly. After one hour, the owner receives an email warning.",
        "每小时巡检正在使用调试 NPU 的进程；进程超过 1 小时后邮件提醒。",
      ) +
      "</li><li>" +
      t(
        "Processes older than two hours may be stopped at inspection unless a TA has approved an extension.",
        "巡检时运行超过 2 小时且无助教延期记录的进程将被终止。",
      ) +
      "</li></ul></div>";
  }
  art();
}
function openModal(type, id) {
  if (type === "login") loginRole = "student";
  modalType = type;
  chosen = id;
  drawModal();
  if (!by("modal").open) by("modal").showModal();
}
function close() {
  by("modal").close();
  modalType = null;
  chosen = null;
}
function feedbackForm() {
  if (!state.user)
    return (
      '<p class="help">' +
      t(
        "Sign in to send a suggestion to course operations.",
        "登录后即可向课程运维提交建议。",
      ) +
      "</p>" +
      button("login", t("Sign in", "登录"))
    );
  else
    return (
      '<form id="suggest"><label for="scat">' +
      t("Category", "类别") +
      '</label><select name="category" id="scat">' +
      [
        ["website", t("Website", "网站")],
        ["training", t("Training pool", "训练池")],
        ["debug", t("Debug pool", "调试池")],
        ["other", t("Other", "其他")],
      ]
        .map(([key, v]) => '<option value="' + key + '">' + v + "</option>")
        .join("") +
      '</select><label for="stext">' +
      t("What could we improve?", "你希望我们改进什么？") +
      '</label><textarea id="stext" name="message" rows="5" maxlength="2000" required></textarea><p class="help">' +
      t(
        "Course operations can see your suggestion and account ID.",
        "课程运维可查看你的建议及提交账号。",
      ) +
      '</p><button class="btn">' +
      t("Submit suggestion", "提交建议") +
      "</button></form>"
    );
}

function drawModal() {
  const type = modalType;
  const j = state.jobs.find((v) => v.id === chosen);
  const titles = {
    login: t("Sign in", "登录"),
    account: t("Your account", "个人账号"),
    new: t("New training job", "新建训练任务"),
    details: t("Job details", "任务详情"),
  };
  by("mt").textContent = titles[type] || "";
  let html = "";
  if (type === "login")
    html =
      '<div class="ops-nav" role="group" aria-label="' +
      t("Sign-in role", "登录身份") +
      '">' +
      [
        ["student", t("Student login", "学生端登录")],
        ["ta", t("TA login", "管理端登录")],
      ]
        .map(
          ([v, label]) =>
            '<button type="button" data-login-role="' +
            v +
            '" aria-pressed="' +
            (loginRole === v) +
            '">' +
            label +
            "</button>",
        )
        .join("") +
      '</div><form id="signin"><label for="student">' +
      (loginRole === "ta"
        ? t("TA account", "助教账号")
        : t("Student ID", "学号")) +
      '</label><input id="student" name="student" autocomplete="username" required maxlength="40"><label for="pw">' +
      t("Password", "密码") +
      '</label><input id="pw" name="password" type="password" autocomplete="current-password" required><div class="actions"><button class="btn">' +
      t("Sign in", "登录") +
      "</button>" +
      (sim() && loginRole === "student"
        ? button("demo", t("Try a demo account", "试用演示账号"), "btn light")
        : "") +
      "</div></form>";
  if (type === "account")
    html =
      "<p>" +
      esc(userName()) +
      '</p><p class="help">' +
      (state.user.demo
        ? t(
            "Your demo jobs run in a simulation.",
            "你的演示任务在模拟环境中运行。",
          )
        : t("Enrolled course account", "已登记的课程账号")) +
      "</p>" +
      button("logout", t("Sign out", "退出登录"), "btn light");
  if (type === "new")
    html =
      '<form id="job"><label for="jn">' +
      t("Job name", "任务名称") +
      '</label><input id="jn" name="name" maxlength="80" required placeholder="' +
      t("e.g. Baseline training", "例如：基线训练") +
      '"><label for="cards">' +
      t("Requested cards", "申请卡数") +
      '</label><select id="cards" name="cards">' +
      [1, 2, 3, 4].map((i) => "<option>" + i + "</option>").join("") +
      '</select><label for="runtime">' +
      t("Runtime", "运行环境") +
      '</label><select id="runtime" name="runtime"><option value="course-base">' +
      t("Course base image", "课程基础镜像") +
      '</option><option value="dockerfile">' +
      t("Dockerfile in project ZIP", "项目 ZIP 中的 Dockerfile") +
      '</option></select><label for="zip">' +
      t("Project ZIP", "项目 ZIP") +
      '</label><input id="zip" type="file" name="file" accept=".zip"><p class="help">' +
      t(
        "Up to 8 MiB. Include run.sh at the archive root.",
        "最大 8 MiB，压缩包根目录需包含 run.sh。",
      ) +
      " " +
      (sim()
        ? t(
            "Leave empty to simulate the course example with the base image.",
            "使用课程基础镜像时可留空，以示例项目模拟运行。",
          )
        : "") +
      '</p><button class="btn">' +
      t("Submit job", "提交任务") +
      "</button></form>";
  if (type === "details" && j) {
    const wait =
      j.status === "queued"
        ? "<p>" +
          t("Jobs ahead", "前方任务") +
          " · " +
          (j.ahead ?? "—") +
          "<br>" +
          t("Estimated time to start", "预计等待时间") +
          " · " +
          (j.wait == null
            ? t("Collecting runtime data", "正在收集运行数据")
            : Math.ceil(j.wait / 60) + " " + t("min", "分钟")) +
          "</p>"
        : "";
    html =
      "<h3>" +
      esc(j.name) +
      '</h3><span class="status">' +
      statusName(j.status) +
      '</span><p class="help">' +
      j.cards +
      " " +
      t("cards", "张卡") +
      " · " +
      time(j.created) +
      "</p>" +
      wait +
      '<p class="help">ID · ' +
      esc(j.id) +
      '</p><div class="actions">' +
      button("log", t("View log", "查看日志"), "btn light") +
      (j.status === "succeeded"
        ? '<a class="btn" href="/api/jobs/' +
          j.id +
          '/result">' +
          t("Download result", "下载结果") +
          "</a>"
        : "") +
      (live(j.status) && j.status !== "cancelling"
        ? button("cancel", t("Cancel job", "取消任务"), "btn light")
        : "") +
      '</div><div id="logarea"></div>';
  }
  by("mb").innerHTML = html + '<p id="err" class="error" role="alert"></p>';
}
async function act(k) {
  if (k === "login") return openModal("login");
  if (k === "new")
    return openModal(
      state.user
        ? state.jobs.some((j) => live(j.status))
          ? "details"
          : "new"
        : "login",
      state.jobs.find((j) => live(j.status))?.id,
    );
  if (k === "copy") {
    await navigator.clipboard.writeText(state.ssh);
    return notify(t("Copied", "已复制"));
  }
  if (k === "demo" || k === "logout") {
    await api(k, {});
    consoleData = null;
    close();
    await refresh();
    return;
  }
  if (k === "cancel") {
    if (!confirm(t("Cancel this training job?", "确认取消此训练任务？")))
      return;
    await api("jobs/" + chosen + "/cancel", {});
    await refresh();
    drawModal();
    return;
  }
  if (k === "log") {
    const d = await api("jobs/" + chosen + "/log");
    const pre = document.createElement("pre");
    pre.className = "code";
    pre.textContent = d.simulation
      ? [
          t("Simulated execution", "模拟执行"),
          t("Submitted", "已提交") + " · " + time(d.created),
          d.started ? t("Started", "已开始") + " · " + time(d.started) : "",
          statusName(d.status) + (d.finished ? " · " + time(d.finished) : ""),
        ]
          .filter(Boolean)
          .join("\n")
      : d.text;
    by("logarea").replaceChildren(pre);
  }
}
function showError(e) {
  if (by("modal").open) by("err").textContent = e.message;
  else notify(e.message);
}
document.addEventListener("click", async (e) => {
  const role = e.target.closest("[data-login-role]");
  if (role && !pending) {
    loginRole = role.dataset.loginRole;
    drawModal();
    return;
  }
  const view = e.target.closest("[data-section],[data-offset],[data-sample]");
  if (view) {
    if (view.hasAttribute("data-sample")) {
      sampleQueue = !sampleQueue;
      consoleOffset = 0;
    } else if (view.dataset.section) {
      consoleSection = view.dataset.section;
      consoleOffset = 0;
    } else consoleOffset = Number(view.dataset.offset);
    consoleData = null;
    render();
    await loadConsole();
    render();
    return;
  }
  const b = e.target.closest("[data-do],[data-id]");
  if (!b || pending) return;
  if (b.dataset.id) return openModal("details", b.dataset.id);
  pending = true;
  b.disabled = true;
  try {
    await act(b.dataset.do);
  } catch (ex) {
    showError(ex);
  } finally {
    pending = false;
    b.disabled = false;
  }
});
document.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (pending) return;
  pending = true;
  const form = e.target,
    submit = form.querySelector("button");
  submit.disabled = true;
  try {
    const data = new FormData(form);
    if (form.id === "signin")
      await api("login", { ...Object.fromEntries(data), role: loginRole });
    else if (form.id === "suggest") {
      const receipt = await api("suggestions", Object.fromEntries(data));
      form.reset();
      notify(t("Suggestion received · #", "建议已收到 · #") + receipt.id);
    } else await api("jobs", data);
    close();
    await refresh();
    if (form.id === "job") notify(t("Job submitted", "任务已提交"));
  } catch (ex) {
    showError(ex);
  } finally {
    pending = false;
    submit.disabled = false;
  }
});
by("lang").onclick = (event) => {
  const option = event.target.closest("button[data-lang]");
  if (!option || option.dataset.lang === lang) return;
  lang = option.dataset.lang;
  localStorage.setItem("course-language", lang);
  render();
  if (modalType) drawModal();
};
by("account").onclick = () => {
  if (state) openModal(state.user ? "account" : "login");
};
by("close").onclick = close;
by("modal").onclose = () => {
  modalType = null;
  chosen = null;
};
window.onhashchange = async () => {
  render();
  if (page() === "ta" && state) {
    await loadConsole();
    render();
  }
};
render();
refresh();
setInterval(async () => {
  if (!document.hidden && !pending) {
    await refresh();
    if (modalType === "details" && !by("logarea")?.textContent) drawModal();
  }
}, 6000);
