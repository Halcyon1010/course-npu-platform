import unittest

from queue_forecast import forecast


class QueueForecastTests(unittest.TestCase):
    def test_burst_and_reduced_capacity(self):
        for cards in (64, 48):
            with self.subTest(cards=cards):
                estimates = forecast(cards, [], ["x"] * 1000, {"x": [20]}, trials=2)
                for index, item in enumerate(estimates):
                    wait = index // cards * 20
                    self.assertEqual((item.position, item.p10, item.p50, item.p90),
                                     (index + 1, wait, wait, wait))

    def test_conditional_residual_and_job_class(self):
        estimates = forecast(0, [("long", 20)], ["short", "long"],
                             {"long": [10, 20, 35], "short": [3]})
        self.assertEqual([item.p50 for item in estimates], [15, 18])

    def test_unavailable_forecast(self):
        self.assertEqual(forecast(0, [], [], {}), [])
        self.assertEqual(forecast(1, [("new", 15)], ["new"], {})[0].p90, 0)
        self.assertIsNone(forecast(0, [], ["x"], {}))
        self.assertIsNone(forecast(0, [("x", 15)], ["x"], {"x": [10, 15]}))
        self.assertIsNone(forecast(1, [], ["new", "known"], {"known": [10]}))

    def test_repeatability_and_variation(self):
        args = (0, [("x", 4)], ["x"] * 5, {"x": [5, 10, 30]})
        result = forecast(*args)
        self.assertEqual(result, forecast(*args))
        self.assertLess(result[0].p10, result[0].p90)
        for before, after in zip(result, result[1:]):
            self.assertLessEqual(before.p50, after.p50)
