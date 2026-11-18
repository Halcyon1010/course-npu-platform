import json
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from mock_provider import Handler, Provider, ThreadingHTTPServer


class ProviderTests(unittest.TestCase):
    def setUp(self):
        self.now = 0
        self.provider = Provider(1, 10, lambda: self.now)
        self.spec = {"artifact_id": "demo", "cards": 1, "runtime": "course-base"}

    def test_concurrent_allocation(self):
        with ThreadPoolExecutor(max_workers=8) as pool:
            replies = list(pool.map(lambda i: self.provider.submit(str(i), self.spec), range(24)))
        self.assertEqual(sum(code == 201 for code, _ in replies), 1)
        self.assertEqual(replies.count((409, {"error": "no_capacity"})), 23)

    def test_retries_and_completion(self):
        self.assertEqual(self.provider.submit("a", self.spec)[0], 201)
        self.assertEqual(self.provider.submit("a", self.spec)[0], 200)
        self.assertEqual(self.provider.submit("a", dict(self.spec, artifact_id="other")),
                         (409, {"error": "id_conflict"}))
        self.assertEqual(self.provider.submit("b", self.spec)[0], 409)
        self.now = 10
        self.assertEqual(self.provider.submit("a", self.spec)[1]["status"], "succeeded")
        self.assertEqual(self.provider.cancel("a")[1]["status"], "succeeded")
        self.assertEqual(self.provider.capacity()[1]["free"], 1)
        self.assertEqual(self.provider.submit("b", self.spec)[0], 201)

    def test_cancel_before_and_after_submission(self):
        self.provider.cancel("a")
        self.assertEqual(self.provider.submit("a", self.spec)[1]["status"], "cancelled")
        self.assertEqual(self.provider.submit("b", self.spec)[0], 201)
        self.provider.cancel("b")
        self.assertEqual(self.provider.cancel("b")[1]["status"], "cancelled")
        self.assertEqual(self.provider.capacity()[1]["free"], 1)

    def test_single_card_validation(self):
        for cards in (True, 0, 1.0, 4, "1"):
            with self.subTest(cards=cards):
                self.assertEqual(self.provider.submit("a", dict(self.spec, cards=cards))[0], 400)

    def test_http_round_trip(self):
        with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
            server.provider = self.provider
            base = f"http://127.0.0.1:{server.server_port}/v1"
            worker = threading.Thread(target=server.serve_forever)
            worker.start()
            try:
                def request(path, method="GET", body=None):
                    req = Request(base + path, data=body, method=method,
                                  headers={"Content-Type": "application/json"})
                    with urlopen(req, timeout=3) as response:
                        return response.status, json.load(response)

                self.assertEqual(request("/capacity")[1], {"free": 1, "total": 1})
                with self.assertRaises(HTTPError) as error:
                    request("/jobs/missing")
                self.assertEqual(error.exception.code, 404)
                self.assertEqual(request("/jobs/demo", "PUT", json.dumps(self.spec).encode())[0], 201)
                self.assertEqual(request("/jobs/demo")[1]["status"], "running")
                self.assertEqual(request("/jobs/demo", "DELETE")[1]["status"], "cancelled")
                self.assertEqual(request("/capacity")[1]["free"], 1)
            finally:
                server.shutdown()
                worker.join()


if __name__ == "__main__":
    unittest.main()
