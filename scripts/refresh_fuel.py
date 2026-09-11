"""Build the dashboard's small public FuelWatch snapshot; no private calendars."""
import json
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import Request, urlopen
import xml.etree.ElementTree as ET

CENTRE = {"name": "Burns Beach", "latitude": -31.7206, "longitude": 115.7205}
# The dashboard shows the cheapest price anywhere in the Perth metro area
# alongside the cheapest ones close to home, so the snapshot keeps every
# nearby station plus a short metro-wide leaderboard.
LOCAL_RADIUS_KM = 20
PERTH_KEEP = 12
PERTH = timezone(timedelta(hours=8))
OUTPUT = Path(__file__).resolve().parents[1] / "data" / "fuel.json"


def distance_km(latitude, longitude):
    lat1, lat2 = map(math.radians, [CENTRE["latitude"], latitude])
    dlat = lat2 - lat1
    dlon = math.radians(longitude - CENTRE["longitude"])
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin(dlon / 2) ** 2
    return 6371 * 2 * math.asin(min(1, math.sqrt(a)))


def parse_prices(xml, expected_date):
    root = ET.fromstring(xml)
    if root.tag != "rss":
        raise ValueError("FuelWatch did not return RSS")
    stations, seen = [], set()
    for item in root.findall("./channel/item"):
        def field(name):
            return (item.findtext(name) or "").strip()
        if field("date") != expected_date:
            continue
        try:
            lat, lon, price = map(float, [field("latitude"), field("longitude"), field("price")])
        except ValueError:
            continue
        if not all(map(math.isfinite, [lat, lon, price])) or not (0 < price < 1000):
            continue
        distance = distance_km(lat, lon)
        key = (field("trading-name"), field("address"))
        if key in seen:
            continue
        seen.add(key)
        # Keep membership / restricted prices out of the public-price ranking.
        restricted = field("restrictions") or ("Membership required" if "costco" in field("brand").lower() else "")
        stations.append({
            "name": key[0], "address": key[1], "suburb": field("location").title(),
            "price": price, "distanceKm": round(distance, 1), "latitude": lat, "longitude": lon,
            "restrictions": restricted,
        })
    return sorted(stations, key=lambda s: (s["price"], s["distanceKm"], s["name"]))


def select_stations(stations):
    """Everything near home, plus the cheapest handful anywhere in the metro.

    Keeping the whole metro list would bloat the public snapshot, but the card
    needs a true Perth-wide cheapest price, so the leaderboard rides along.
    Restricted (membership) prices are never eligible for that headline.
    """
    kept, seen = [], set()
    local = [s for s in stations if s["distanceKm"] <= LOCAL_RADIUS_KM]
    cheapest = [s for s in stations if not s["restrictions"]][:PERTH_KEEP]
    for station in local + cheapest:
        key = (station["name"], station["address"])
        if key in seen:
            continue
        seen.add(key)
        kept.append(station)
    return sorted(kept, key=lambda s: (s["price"], s["distanceKm"], s["name"]))


def fetch_day(day, expected_date):
    # No Region filter means all Perth metro regions; num prevents the default
    # top-ten truncation before the metro-wide cheapest price is chosen.
    url = "https://www.fuelwatch.wa.gov.au/fuelwatch/fuelWatchRSS?Product=2&num=999&Day=" + day
    req = Request(url, headers={"User-Agent": "WeldonHub/2.0 (FuelWatch RSS consumer)"})
    with urlopen(req, timeout=15) as response:
        return select_stations(parse_prices(response.read(), expected_date))


def main():
    now = datetime.now(PERTH)
    today, tomorrow = now.date().isoformat(), (now.date() + timedelta(days=1)).isoformat()
    current = fetch_day("today", today)
    if not current:
        raise RuntimeError("No current local prices; keeping the previous snapshot")
    next_prices = []
    if (now.hour, now.minute) >= (14, 30):
        next_prices = fetch_day("tomorrow", tomorrow)
    data = {
        "updatedAt": now.isoformat(), "source": "FuelWatch WA", "product": 2,
        "fuel": "Premium 95", "centre": CENTRE, "localRadiusKm": LOCAL_RADIUS_KM,
        "days": {today: current, tomorrow: next_prices},
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8", newline="\n")
    near = sum(1 for s in current if s["distanceKm"] <= LOCAL_RADIUS_KM)
    print(f"Premium 95: {len(current)} stations today ({near} within {LOCAL_RADIUS_KM} km), {len(next_prices)} tomorrow")


if __name__ == "__main__":
    main()
