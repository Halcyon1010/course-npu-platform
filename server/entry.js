export default {
  async fetch(req, env, ctx) {
    if (env.SITE_PAUSED === "1") {
      return new Response("Course Compute is temporarily closed.\n课程算力平台已暂时关闭。", {
        status: 503,
        headers: {"Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store"},
      });
    }
    try {
      const path = new URL(req.url).pathname;
      if (path === "/api/scheduler" && req.method === "POST") {
        if (
          !env.COMPUTE_TOKEN ||
          req.headers.get("Authorization") !== "Bearer " + env.COMPUTE_TOKEN
        )
          return reject("forbidden", 403);
        await tick(env);
        return reply({ ok: true });
      }
      if (path.startsWith("/api/")) {
        if (path === "/api/state" && modeFor(env) === "remote")
          ctx.waitUntil(tick(env));
        return await api(req, env);
      }
      const asset = assets[path];
      if (!asset || req.method !== "GET") return reject("missing", 404);
      return new Response(asset[1], {
        headers: {
          "Content-Type": asset[0] + "; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
          "Referrer-Policy": "same-origin",
          "Cache-Control": "no-cache",
        },
      });
    } catch (err) {
      console.error("Workspace request failed", err.name);
      return reject("unavailable", 503);
    }
  },
  async scheduled(event, env, ctx) {
    if (env.SITE_PAUSED !== "1") ctx.waitUntil(tick(env));
  },
};
export { tick, passwordHash };
