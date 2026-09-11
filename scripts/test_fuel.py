import unittest
from refresh_fuel import parse_prices, distance_km, select_stations


def item(name="Test", price="180.9", lat="-31.7206", lon="115.7205", date="2026-09-11", restrictions=""):
    return f"""<item><trading-name>{name}</trading-name><price>{price}</price>
    <latitude>{lat}</latitude><longitude>{lon}</longitude><date>{date}</date>
    <address>1 Test Road</address><location>Burns Beach</location>
    <restrictions>{restrictions}</restrictions></item>"""


class FuelTests(unittest.TestCase):
    def test_date_sort_and_dedup(self):
        xml = "<rss><channel>" + item("Higher", "210") + item("Lower", "190") + item("Lower", "190") + item("Far", "100", "-32.5") + item("Old", "100", date="2025-01-01") + "</channel></rss>"
        result = parse_prices(xml, "2026-09-11")
        # Metro-wide now: the distant station stays, stale dates and duplicates go.
        self.assertEqual([x["name"] for x in result], ["Far", "Lower", "Higher"])
        self.assertAlmostEqual(distance_km(-31.7206, 115.7205), 0)

    def test_select_keeps_local_and_metro_cheapest(self):
        near_dear = {"name": "NearDear", "address": "b", "price": 260.0, "distanceKm": 12.0, "restrictions": ""}
        far_cheap = {"name": "FarCheap", "address": "c", "price": 150.0, "distanceKm": 45.0, "restrictions": ""}
        # Enough distant stations to push the expensive ones off the leaderboard.
        filler = [{"name": f"Far{i}", "address": str(i), "price": 160.0 + i, "distanceKm": 40.0, "restrictions": ""}
                  for i in range(20)]
        names = [s["name"] for s in select_stations([far_cheap, near_dear] + filler)]
        self.assertEqual(names[0], "FarCheap", "Metro-wide cheapest must survive")
        self.assertIn("NearDear", names, "Nearby stations are kept whatever the price")
        self.assertIn("Far0", names)
        self.assertNotIn("Far19", names, "Distant, expensive stations are dropped")

    def test_select_excludes_restricted_from_metro_leaderboard(self):
        members_only = {"name": "Club", "address": "a", "price": 100.0, "distanceKm": 60.0, "restrictions": "Members only"}
        open_far = {"name": "Open", "address": "b", "price": 180.0, "distanceKm": 60.0, "restrictions": ""}
        result = select_stations([members_only, open_far])
        self.assertEqual([s["name"] for s in result], ["Open"])

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
