"""Course NPU resource API simulator. No submitted code is executed."""

import argparse
import json
import math
import re
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


JOB_PATH = re.compile(r"/v1/jobs/([A-Za-z0-9_-]{1,80})")


class Provider:
    def __init__(self, cards, seconds, clock=time.monotonic):
        self.cards = cards
        self.seconds = seconds
        self.clock = clock
        self.lock = threading.Lock()
        self.jobs = {}

    def _refresh(self):
        now = self.clock()
        for job in self.jobs.values():
            if job["status"] == "running" and now >= job["deadline"]:
                job["status"] = "succeeded"

    @staticmethod
    def _view(job_id, job):
        done = job["status"] == "succeeded"
        return {
            "id": job_id,
            "status": job["status"],
            "log_id": f"log-{job_id}" if job["spec"] else None,
            "result_id": f"result-{job_id}" if done else None,
        }

    def _free(self):
        return self.cards - sum(j["status"] == "running" for j in self.jobs.values())

    def capacity(self):
        with self.lock:
            self._refresh()
            return 200, {"total": self.cards, "free": self._free()}

    def submit(self, job_id, spec):
        if (not isinstance(spec, dict) or set(spec) != {"cards", "artifact_id", "runtime"}
                or type(spec["cards"]) is not int or spec["cards"] != 1
                or not isinstance(spec["artifact_id"], str)
                or not re.fullmatch(r"[A-Za-z0-9_-]{1,128}", spec["artifact_id"])
                or not isinstance(spec["runtime"], str)
                or not (spec["runtime"] == "course-base"
                        or re.fullmatch(r"sha256:[0-9a-f]{64}", spec["runtime"]))):
            return 400, {"error": "invalid_spec"}
        with self.lock:
            self._refresh()
            if job_id in self.jobs:
                job = self.jobs[job_id]
                if job["spec"] is not None and job["spec"] != spec:
                    return 409, {"error": "id_conflict"}
                return 200, self._view(job_id, job)
            if self._free() == 0:
                return 409, {"error": "no_capacity"}
            job = {"spec": spec.copy(), "status": "running",
                   "deadline": self.clock() + self.seconds}
            self.jobs[job_id] = job
            return 201, self._view(job_id, job)

    def get(self, job_id):
        with self.lock:
            self._refresh()
            if job_id not in self.jobs:
                return 404, {"error": "unknown_job"}
            return 200, self._view(job_id, self.jobs[job_id])

    def cancel(self, job_id):
        with self.lock:
            self._refresh()
            job = self.jobs.setdefault(job_id, {"spec": None, "status": "cancelled"})
            if job["status"] == "running":
                job["status"] = "cancelled"
            return 200, self._view(job_id, job)


class Handler(BaseHTTPRequestHandler):
    def _send(self, status, data):
        body = json.dumps(data).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/v1/capacity":
            self._send(*self.server.provider.capacity())
        elif match := JOB_PATH.fullmatch(self.path):
            self._send(*self.server.provider.get(match[1]))
        else:
            self._send(404, {"error": "unknown_route"})

    def do_PUT(self):
        match = JOB_PATH.fullmatch(self.path)
        if not match:
            return self._send(404, {"error": "unknown_route"})
        if self.headers.get_content_type() != "application/json":
            return self._send(415, {"error": "expected_json"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 8192:
                raise ValueError
            spec = json.loads(self.rfile.read(length))
        except (ValueError, RecursionError):
            return self._send(400, {"error": "invalid_body"})
        self._send(*self.server.provider.submit(match[1], spec))

    def do_DELETE(self):
        if match := JOB_PATH.fullmatch(self.path):
            self._send(*self.server.provider.cancel(match[1]))
        else:
            self._send(404, {"error": "unknown_route"})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--cards", type=int, default=2)
    parser.add_argument("--seconds", type=float, default=10)
    parser.add_argument("--port", type=int, default=8090)
    args = parser.parse_args()
    if args.cards < 0 or not math.isfinite(args.seconds) or args.seconds <= 0:
        parser.error("Require cards >= 0 and a finite runtime > 0 seconds.")
    with ThreadingHTTPServer(("127.0.0.1", args.port), Handler) as server:
        server.provider = Provider(args.cards, args.seconds)
        print(f"Mock resource API at http://127.0.0.1:{server.server_port}/v1", flush=True)
        server.serve_forever()


if __name__ == "__main__":
    main()
