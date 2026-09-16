"""
 Copyright 2026 Google LLC

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

      https://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 """

import json
import os
import sqlite3
import threading
import time
from collections import OrderedDict
from typing import Any, List, Optional, Tuple

from server.core.config import config
from server.core.logger import logger

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_DB_PATH = os.path.join(REPO_ROOT, "server", ".cache", "streetreaderai.db")


class DiskCache:
    """Thread-safe, bounded SQLite cache with LRU eviction and spatial containment."""

    def __init__(self, db_path: Optional[str] = None, max_bytes: int = 200 * 1024 * 1024):
        self.db_path = db_path or getattr(config, "SERVER_CACHE_DB_PATH", "") or DEFAULT_DB_PATH
        self.max_bytes = max_bytes
        self._lock = threading.Lock()

        if self.db_path != ":memory:":
            os.makedirs(os.path.dirname(os.path.abspath(self.db_path)), exist_ok=True)

        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode = WAL;")
        self._conn.execute("PRAGMA synchronous = NORMAL;")
        self._conn.execute("PRAGMA cache_size = -32000;")  # 32MB SQLite page cache in RAM
        self._conn.execute("PRAGMA busy_timeout = 5000;")

        with self._conn:
            self._conn.execute("""
                CREATE TABLE IF NOT EXISTS cache_entries (
                    tier TEXT NOT NULL,
                    key TEXT NOT NULL PRIMARY KEY,
                    data BLOB NOT NULL,
                    size_bytes INTEGER NOT NULL,
                    last_accessed REAL NOT NULL,
                    min_lat REAL,
                    min_lng REAL,
                    max_lat REAL,
                    max_lng REAL
                );
            """)
            self._conn.execute("CREATE INDEX IF NOT EXISTS idx_cache_tier_accessed ON cache_entries(tier, last_accessed);")
            self._conn.execute("CREATE INDEX IF NOT EXISTS idx_cache_roads ON cache_entries(tier, min_lat, max_lat, min_lng, max_lng);")

        cursor = self._conn.cursor()
        cursor.execute("SELECT COALESCE(SUM(size_bytes), 0) FROM cache_entries;")
        self._current_bytes = int(cursor.fetchone()[0])

    @property
    def current_bytes(self) -> int:
        with self._lock:
            return self._current_bytes

    def get(self, tier: str, key: str) -> Optional[bytes]:
        with self._lock:
            cursor = self._conn.cursor()
            cursor.execute("SELECT data FROM cache_entries WHERE tier = ? AND key = ?", (tier, key))
            row = cursor.fetchone()
            if row is None:
                return None
            data = row[0]
            now = time.time()
            cursor.execute("UPDATE cache_entries SET last_accessed = ? WHERE tier = ? AND key = ?", (now, tier, key))
            self._conn.commit()
            return data

    def get_spatial_roads(self, min_lat: float, min_lng: float, max_lat: float, max_lng: float) -> Optional[List[dict]]:
        with self._lock:
            center_lat = (min_lat + max_lat) / 2.0
            center_lng = (min_lng + max_lng) / 2.0
            cursor = self._conn.cursor()

            # 1. Exact match check
            exact_key = f"{round(min_lat, 5)},{round(min_lng, 5)},{round(max_lat, 5)},{round(max_lng, 5)}"
            cursor.execute("SELECT data FROM cache_entries WHERE tier = 'road' AND key = ?", (exact_key,))
            row = cursor.fetchone()
            if row:
                now = time.time()
                cursor.execute("UPDATE cache_entries SET last_accessed = ? WHERE tier = 'road' AND key = ?", (now, exact_key))
                self._conn.commit()
                return json.loads(row[0].decode("utf-8"))

            # 2. Spatial containment: find all cached road bboxes that contain (center_lat, center_lng)
            cursor.execute("""
                SELECT key, data FROM cache_entries
                WHERE tier = 'road'
                  AND min_lat <= ? AND ? <= max_lat
                  AND min_lng <= ? AND ? <= max_lng
                ORDER BY last_accessed DESC
            """, (center_lat, center_lat, center_lng, center_lng))
            rows = cursor.fetchall()
            if not rows:
                return None

            now = time.time()
            matched_keys = [r[0] for r in rows]
            placeholders = ",".join("?" * len(matched_keys))
            cursor.execute(f"UPDATE cache_entries SET last_accessed = ? WHERE key IN ({placeholders})", [now] + matched_keys)
            self._conn.commit()

            seen_ids = set()
            merged_ways = []
            for _, data in rows:
                ways = json.loads(data.decode("utf-8"))
                if isinstance(ways, list):
                    for w in ways:
                        wid = w.get("id") if isinstance(w, dict) else None
                        if wid is not None and wid not in seen_ids:
                            seen_ids.add(wid)
                            merged_ways.append(w)
                        elif wid is None:
                            merged_ways.append(w)
            return merged_ways

    def put(
        self,
        tier: str,
        key: str,
        data: bytes,
        size_bytes: int,
        min_lat: Optional[float] = None,
        min_lng: Optional[float] = None,
        max_lat: Optional[float] = None,
        max_lng: Optional[float] = None,
    ) -> None:
        with self._lock:
            cursor = self._conn.cursor()
            cursor.execute("SELECT size_bytes FROM cache_entries WHERE key = ?", (key,))
            existing = cursor.fetchone()
            if existing:
                self._current_bytes -= existing[0]

            # Evict until space is available
            while self._current_bytes + size_bytes > self.max_bytes:
                cursor.execute("SELECT key, size_bytes FROM cache_entries ORDER BY last_accessed ASC LIMIT 1")
                oldest = cursor.fetchone()
                if not oldest:
                    break
                del_key, freed = oldest
                cursor.execute("DELETE FROM cache_entries WHERE key = ?", (del_key,))
                self._current_bytes -= freed

            now = time.time()
            cursor.execute("""
                INSERT OR REPLACE INTO cache_entries
                (tier, key, data, size_bytes, last_accessed, min_lat, min_lng, max_lat, max_lng)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (tier, key, data, size_bytes, now, min_lat, min_lng, max_lat, max_lng))
            self._conn.commit()
            self._current_bytes += size_bytes

    def count(self, tier: Optional[str] = None) -> int:
        with self._lock:
            cursor = self._conn.cursor()
            if tier:
                cursor.execute("SELECT COUNT(*) FROM cache_entries WHERE tier = ?", (tier,))
            else:
                cursor.execute("SELECT COUNT(*) FROM cache_entries")
            return int(cursor.fetchone()[0])

    def clear(self, tier: Optional[str] = None) -> None:
        with self._lock:
            cursor = self._conn.cursor()
            if tier:
                cursor.execute("SELECT COALESCE(SUM(size_bytes), 0) FROM cache_entries WHERE tier = ?", (tier,))
                freed = int(cursor.fetchone()[0])
                cursor.execute("DELETE FROM cache_entries WHERE tier = ?", (tier,))
                self._current_bytes -= freed
            else:
                cursor.execute("DELETE FROM cache_entries")
                self._current_bytes = 0
            self._conn.commit()


# --- Tier Adapters ---

class ImageCacheAdapter:
    def __init__(self, backend: DiskCache):
        self.backend = backend

    @property
    def max_bytes(self) -> int:
        return self.backend.max_bytes

    def get(self, key: str) -> Optional[bytes]:
        return self.backend.get("image", str(key))

    def put(self, key: str, val: bytes, size_bytes: Optional[int] = None) -> None:
        sb = size_bytes if size_bytes is not None else len(val)
        self.backend.put("image", str(key), val, sb)

    def clear(self) -> None:
        self.backend.clear("image")

    def __len__(self) -> int:
        return self.backend.count("image")


class WindowCacheAdapter:
    def __init__(self, backend: DiskCache):
        self.backend = backend

    @property
    def max_items(self) -> int:
        return 12000

    def get(self, key: Any) -> Optional[Any]:
        raw = self.backend.get("window", str(key))
        if raw is None:
            return None
        return json.loads(raw.decode("utf-8"))

    def put(self, key: Any, val: Any) -> None:
        payload = json.dumps(val).encode("utf-8")
        self.backend.put("window", str(key), payload, len(payload))

    def clear(self) -> None:
        self.backend.clear("window")

    def __len__(self) -> int:
        return self.backend.count("window")


class RoadCacheAdapter:
    def __init__(self, backend: DiskCache):
        self.backend = backend

    @property
    def max_items(self) -> int:
        return 1000

    def get(self, key: Any) -> Optional[Any]:
        if isinstance(key, (tuple, list)) and len(key) == 4:
            min_lat, min_lng, max_lat, max_lng = key
            return self.backend.get_spatial_roads(float(min_lat), float(min_lng), float(max_lat), float(max_lng))
        raw = self.backend.get("road", str(key))
        if raw is None:
            return None
        return json.loads(raw.decode("utf-8"))

    def put(self, key: Any, val: Any) -> None:
        payload = json.dumps(val).encode("utf-8")
        min_lat = min_lng = max_lat = max_lng = None
        if isinstance(key, (tuple, list)) and len(key) == 4:
            min_lat, min_lng, max_lat, max_lng = [float(x) for x in key]
            key_str = f"{round(min_lat, 5)},{round(min_lng, 5)},{round(max_lat, 5)},{round(max_lng, 5)}"
        else:
            key_str = str(key)
        self.backend.put(
            tier="road",
            key=key_str,
            data=payload,
            size_bytes=len(payload),
            min_lat=min_lat,
            min_lng=min_lng,
            max_lat=max_lat,
            max_lng=max_lng,
        )

    def clear(self) -> None:
        self.backend.clear("road")

    def __len__(self) -> int:
        return self.backend.count("road")


class DescriptionCacheAdapter:
    def __init__(self, backend: DiskCache):
        self.backend = backend

    @property
    def max_items(self) -> int:
        return 1000

    def get(self, key: str) -> Optional[str]:
        raw = self.backend.get("description", str(key))
        if raw is None:
            return None
        return raw.decode("utf-8")

    def put(self, key: str, val: str) -> None:
        payload = str(val).encode("utf-8")
        self.backend.put("description", str(key), payload, len(payload))

    def clear(self) -> None:
        self.backend.clear("description")

    def __len__(self) -> int:
        return self.backend.count("description")



# --- In-Memory Standalone Classes (retained for backward compatibility and standalone tests) ---

class ByteBoundedLRU:
    def __init__(self, max_bytes: int):
        self.max_bytes = max_bytes
        self.current_bytes = 0
        self._cache: OrderedDict[str, Tuple[Any, int]] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: str) -> Optional[Any]:
        with self._lock:
            if key not in self._cache:
                return None
            val, size = self._cache.pop(key)
            self._cache[key] = (val, size)
            return val

    def put(self, key: str, val: Any, size_bytes: int) -> None:
        with self._lock:
            if key in self._cache:
                _, old_size = self._cache.pop(key)
                self.current_bytes -= old_size
            self._cache[key] = (val, size_bytes)
            self.current_bytes += size_bytes
            while self.current_bytes > self.max_bytes and self._cache:
                _, (_, evicted_size) = self._cache.popitem(last=False)
                self.current_bytes -= evicted_size

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()
            self.current_bytes = 0

    def __len__(self) -> int:
        with self._lock:
            return len(self._cache)


class CountBoundedLRU:
    def __init__(self, max_items: int):
        self.max_items = max(1, max_items)
        self._cache: OrderedDict[Any, Any] = OrderedDict()
        self._lock = threading.Lock()

    def get(self, key: Any) -> Optional[Any]:
        with self._lock:
            if key not in self._cache:
                return None
            val = self._cache.pop(key)
            self._cache[key] = val
            return val

    def put(self, key: Any, val: Any) -> None:
        with self._lock:
            if key in self._cache:
                self._cache.pop(key)
            self._cache[key] = val
            while len(self._cache) > self.max_items:
                self._cache.popitem(last=False)

    def clear(self) -> None:
        with self._lock:
            self._cache.clear()

    def __len__(self) -> int:
        with self._lock:
            return len(self._cache)


class RoadCache(CountBoundedLRU):
    def get(self, key: Any) -> Optional[Any]:
        with self._lock:
            if key in self._cache:
                val = self._cache.pop(key)
                self._cache[key] = val
                return val

            if isinstance(key, (tuple, list)) and len(key) == 4:
                req_min_lat, req_min_lng, req_max_lat, req_max_lng = key
                center_lat = (req_min_lat + req_max_lat) / 2.0
                center_lng = (req_min_lng + req_max_lng) / 2.0

                matching_keys = []
                for cached_key in list(self._cache.keys()):
                    if isinstance(cached_key, (tuple, list)) and len(cached_key) == 4:
                        c_min_lat, c_min_lng, c_max_lat, c_max_lng = cached_key
                        if (c_min_lat <= center_lat <= c_max_lat and 
                            c_min_lng <= center_lng <= c_max_lng):
                            matching_keys.append(cached_key)

                if matching_keys:
                    seen_ids = set()
                    merged_ways = []
                    for k in matching_keys:
                        ways = self._cache.pop(k)
                        self._cache[k] = ways
                        if isinstance(ways, list):
                            for w in ways:
                                wid = w.get("id") if isinstance(w, dict) else None
                                if wid is not None and wid not in seen_ids:
                                    seen_ids.add(wid)
                                    merged_ways.append(w)
                                elif wid is None:
                                    merged_ways.append(w)
                        elif ways is not None:
                            merged_ways.append(ways)
                    return merged_ways

            return None


# --- Global Cache Allocation ---

_total_mb = float(getattr(config, 'SERVER_CACHE_MAX_MB', 200.0))
_max_bytes = int(_total_mb * 1024 * 1024)

_global_disk_cache = DiskCache(max_bytes=_max_bytes)

image_cache = ImageCacheAdapter(_global_disk_cache)
window_cache = WindowCacheAdapter(_global_disk_cache)
road_cache = RoadCacheAdapter(_global_disk_cache)
description_cache = DescriptionCacheAdapter(_global_disk_cache)

logger.info(
    f'Initialized disk-backed SQLite cache at {_global_disk_cache.db_path} '
    f'with {_total_mb:.0f}MB total budget'
)


def clear_all_caches() -> None:
    """Clears all disk-backed in-memory/SQLite caches across all tiers."""
    _global_disk_cache.clear()
    logger.info("Cleared all server caches on disk and in memory.")

