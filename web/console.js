// Rendering uses the same language, date formatter and HTML escaping as the student workspace.
export function operationsView({
  t,
  esc,
  time,
  section,
  data,
  staff,
  canSwitchQueue,
}) {
  const titles = {
    queue: t("Training queue", "训练队列"),
    processes: t("Debug processes", "调试进程"),
    inbox: t("Suggestion inbox", "建议收件箱"),
  };
  const tabs = Object.entries(titles)
    .map(
      ([key, label]) =>
        '<button type="button" data-section="' +
        key +
        '" aria-pressed="' +
        (section === key) +
        '">' +
        label +
        "</button>",
    )
    .join("");
  const intro = staff
    ? t("Course operations", "课程运维")
    : t("Sample workspace", "模拟工作区");
  const heading =
    '<div class="ops-heading"><div><span class="ops-kicker">' +
    intro +
    "</span><h1>" +
    t("TA console", "助教管理端") +
    '</h1></div><span class="ops-emblem" aria-hidden="true">›_</span></div>';
  const nav =
    '<div class="ops-nav" role="group" aria-label="' +
    t("Console views", "管理视图") +
    '">' +
    tabs +
    "</div>";
  if (!data)
    return (
      heading + nav + '<div class="pane">' + t("Loading…", "加载中…") + "</div>"
    );
  if (data.error)
    return (
      heading +
      nav +
      '<div class="pane" role="alert">' +
      esc(data.error) +
      "</div>"
    );
  const { records, offset, total, pageSize, at } = data;
  const kind = (key) =>
    ({
      training: t("Training", "训练"),
      debug: t("Debug", "调试"),
      website: t("Website", "网站"),
      other: t("Other", "其他"),
    })[key] || key;
  const label = (text, style = "") =>
    '<span class="op-label ' + style + '">' + text + "</span>";
  const id = t("Student ID", "学号");
  let headers, body;
  if (section === "queue") {
    headers = [
      t("Position", "队位"),
      t("Job name", "任务名"),
      id,
      t("Requested cards", "申请卡数"),
      t("Submitted", "提交时间"),
    ];
    body = records.map((r, i) => [
      label("#" + (offset + i + 1)),
      esc(r.name),
      esc(r.student),
      "<b>" + r.cards + "</b> NPU",
      time(r.created),
    ]);
  } else if (section === "processes") {
    headers = [
      id,
      t("Node", "节点"),
      "PID",
      t("Runtime", "运行时长"),
      t("Inspection", "巡检状态"),
      t("Extension", "延期情况"),
    ];
    body = records.map((r) => {
      const mins = Math.floor((at - r.started) / 60),
        extended = r.until > at;
      const elapsed =
        Math.floor(mins / 60) +
        t("h ", " 小时 ") +
        (mins % 60) +
        t("m", " 分钟");
      const status = extended
        ? label(t("Covered", "延期有效"), "ok")
        : mins > 120
          ? label(t("Over 2 hours", "超过 2 小时"), "late")
          : mins > 60
            ? label(t("Over 1 hour", "超过 1 小时"), "warn")
            : label(t("Within 1 hour", "1 小时内"));
      const ext =
        r.until == null
          ? t("None", "无延期")
          : (extended ? t("Until ", "有效至 ") : t("Expired ", "已到期 ")) +
            time(r.until);
      return [
        esc(r.student),
        esc(r.node),
        "<code>" + r.pid + "</code>",
        elapsed,
        status,
        ext,
      ];
    });
  } else {
    headers = [
      t("Reference", "编号"),
      t("Category", "类别"),
      t("Suggestion", "建议内容"),
      id,
      t("Submitted", "提交时间"),
    ];
    body = records.map((r) => [
      "#" + esc(r.id),
      label(esc(kind(r.category))),
      '<span class="op-message">' +
        esc(r.zh ? t(r.message, r.zh) : r.message) +
        "</span>",
      esc(r.student),
      time(r.created),
    ]);
  }
  const caption =
    '<div class="sectionhead"><h2>' +
    titles[section] +
    ' <small class="op-count">' +
    total +
    '</small></h2><span class="meta">' +
    (data.sample
      ? t("SAMPLE SNAPSHOT", "模拟快照")
      : t("COURSE RECORDS", "课程记录")) +
    "</span></div>";
  const details = data.sample
    ? '<p class="op-note">' +
      t("Sample data as of ", "模拟数据时间 ") +
      time(at) +
      "</p>"
    : "";
  const empty = !data.connected
    ? t(
        "Debug telemetry is awaiting hardware integration.",
        "等待接入调试节点的进程数据。",
      )
    : section === "inbox"
      ? t("No suggestions received yet.", "暂未收到建议。")
      : t("No jobs waiting for training cards.", "目前没有等待训练卡的任务。");
  const table =
    '<div class="tablebox"><div class="table-scroll"><table><thead><tr>' +
    headers.map((h) => '<th scope="col">' + h + "</th>").join("") +
    "</tr></thead><tbody>" +
    body
      .map(
        (cells) =>
          "<tr>" + cells.map((v) => "<td>" + v + "</td>").join("") + "</tr>",
      )
      .join("") +
    "</tbody></table></div>" +
    (!body.length ? '<div class="empty">' + empty + "</div>" : "") +
    "</div>";
  const pager =
    total > pageSize || offset > 0
      ? '<div class="actions"><button data-offset="' +
        Math.max(0, offset - pageSize) +
        '" class="btn light" ' +
        (!offset ? "disabled" : "") +
        ">" +
        t("Previous", "上一页") +
        '</button><button data-offset="' +
        (offset + pageSize) +
        '" class="btn light" ' +
        (offset + pageSize >= total ? "disabled" : "") +
        ">" +
        t("Next", "下一页") +
        "</button></div>"
      : "";
  const switchQueue =
    section === "queue" && canSwitchQueue
      ? '<p><button class="linkbtn" data-sample>' +
        (data.sample
          ? t("Show submitted jobs", "查看实际提交")
          : t("Show sample queue", "查看模拟队列")) +
        "</button></p>"
      : "";
  return heading + nav + caption + details + table + pager + switchQueue;
}
