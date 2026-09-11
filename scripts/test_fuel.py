import unittest
from refresh_fuel import parse_prices, distance_km


def item(name="Test", price="180.9", lat="-31.7206", lon="115.7205", date="2026-09-11", restrictions=""):
    return f"""<item><trading-name>{name}</trading-name><price>{price}</price>
    <latitude>{lat}</latitude><longitude>{lon}</longitude><date>{date}</date>
    <address>1 Test Road</address><location>Burns Beach</location>
    <restrictions>{restrictions}</restrictions></item>"""


class FuelTests(unittest.TestCase):
    def test_radius_date_sort_and_dedup(self):
        xml = "<rss><channel>" + item("Higher", "210") + item("Lower", "190") + item("Lower", "190") + item("Far", "100", "-32.5") + item("Old", "100", date="2025-01-01") + "</channel></rss>"
        result = parse_prices(xml, "2026-09-11")
        self.assertEqual([x["name"] for x in result], ["Lower", "Higher"])
        self.assertAlmostEqual(distance_km(-31.7206, 115.7205), 0)

    def test_invalid_price_and_restrictions(self):
        xml = "<rss><channel>" + item("Invalid", "nan") + item("Members", restrictions="Members only") + "</channel></rss>"
        result = parse_prices(xml, "2026-09-11")
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["restrictions"], "Members only")

    def test_reject_html(self):
        with self.assertRaises(ValueError):
            parse_prices("<html/>", "2026-09-11")


if __name__ == "__main__":
    unittest.main()
