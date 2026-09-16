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

"""Unit tests for in-memory bounded LRU caches."""

from server.core.cache import ByteBoundedLRU, CountBoundedLRU, image_cache, window_cache, road_cache, description_cache


class TestByteBoundedLRU:
    def test_basic_put_get(self):
        cache = ByteBoundedLRU(max_bytes=100)
        cache.put("img1", b"hello", size_bytes=5)
        assert cache.get("img1") == b"hello"
        assert cache.get("missing") is None

    def test_eviction_when_bytes_exceeded(self):
        cache = ByteBoundedLRU(max_bytes=10)
        cache.put("a", "val_a", size_bytes=6)
        cache.put("b", "val_b", size_bytes=6)
        # Total is 12 > 10, so 'a' must be evicted
        assert cache.get("a") is None
        assert cache.get("b") == "val_b"
        assert len(cache) == 1

    def test_lru_ordering_on_access(self):
        cache = ByteBoundedLRU(max_bytes=15)
        cache.put("a", "val_a", size_bytes=5)
        cache.put("b", "val_b", size_bytes=5)
        # Access 'a' so 'a' becomes MRU and 'b' is LRU
        assert cache.get("a") == "val_a"
        # Add 'c' of 6 bytes (total 16 > 15), 'b' must be evicted, not 'a'
        cache.put("c", "val_c", size_bytes=6)
        assert cache.get("b") is None
        assert cache.get("a") == "val_a"
        assert cache.get("c") == "val_c"

    def test_update_existing_key_adjusts_size(self):
        cache = ByteBoundedLRU(max_bytes=20)
        cache.put("a", "short", size_bytes=5)
        assert cache.current_bytes == 5
        cache.put("a", "longer_content", size_bytes=14)
        assert cache.current_bytes == 14
        assert cache.get("a") == "longer_content"


class TestCountBoundedLRU:
    def test_basic_put_get(self):
        cache = CountBoundedLRU(max_items=3)
        cache.put("k1", "v1")
        cache.put("k2", "v2")
        assert cache.get("k1") == "v1"
        assert cache.get("k2") == "v2"

    def test_eviction_on_max_items(self):
        cache = CountBoundedLRU(max_items=2)
        cache.put("k1", "v1")
        cache.put("k2", "v2")
        cache.put("k3", "v3")
        # 'k1' was oldest, should be evicted
        assert cache.get("k1") is None
        assert cache.get("k2") == "v2"
        assert cache.get("k3") == "v3"

    def test_lru_ordering_on_access(self):
        cache = CountBoundedLRU(max_items=2)
        cache.put("k1", "v1")
        cache.put("k2", "v2")
        # Access k1 so it becomes MRU
        assert cache.get("k1") == "v1"
        # Add k3, k2 must be evicted
        cache.put("k3", "v3")
        assert cache.get("k2") is None
        assert cache.get("k1") == "v1"
        assert cache.get("k3") == "v3"


class TestGlobalCaches:
    def test_global_instances_active(self):
        assert image_cache.max_bytes > 0
        assert window_cache.max_items > 0
        assert road_cache.max_items > 0
        assert description_cache.max_items > 0

    def test_clear_cache(self):
        from server.index import clear_cache
        image_cache.put("img_test", b"abc", 3)
        window_cache.put("win_test", [1, 2])
        road_cache.put("road_test", [{"id": 1}])
        description_cache.put("desc_test", "a street scene")

        assert len(image_cache) == 1
        assert len(window_cache) == 1
        assert len(road_cache) == 1
        assert len(description_cache) == 1

        clear_cache()

        assert len(image_cache) == 0
        assert len(window_cache) == 0
        assert len(road_cache) == 0
        assert len(description_cache) == 0


class TestRoadCache:
    def test_exact_match(self):
        from server.core.cache import RoadCache
        cache = RoadCache(max_items=10)
        bbox = (47.60, -122.31, 47.62, -122.29)
        cache.put(bbox, [{"id": 101, "name": "Main St"}])
        res = cache.get(bbox)
        assert res == [{"id": 101, "name": "Main St"}]

    def test_spatial_containment_hit_when_center_inside_cached_bbox(self):
        from server.core.cache import RoadCache
        cache = RoadCache(max_items=10)
        cache.put((47.60, -122.31, 47.62, -122.29), [{"id": 101, "name": "Main St"}])

        # New request shifted by 15 meters (center is 47.611, -122.300, inside the cached bbox)
        shifted_bbox = (47.601, -122.310, 47.621, -122.290)
        res = cache.get(shifted_bbox)
        assert res is not None
        assert len(res) == 1
        assert res[0]["id"] == 101

    def test_spatial_containment_miss_when_center_outside_cached_bbox(self):
        from server.core.cache import RoadCache
        cache = RoadCache(max_items=10)
        cache.put((47.60, -122.31, 47.62, -122.29), [{"id": 101, "name": "Main St"}])

        # New request far away (center is 47.70, -122.30)
        far_bbox = (47.69, -122.31, 47.71, -122.29)
        assert cache.get(far_bbox) is None

    def test_spatial_containment_merges_overlapping_bboxes(self):
        from server.core.cache import RoadCache
        cache = RoadCache(max_items=10)
        cache.put((47.60, -122.31, 47.62, -122.29), [{"id": 101}, {"id": 102}])
        cache.put((47.61, -122.31, 47.63, -122.29), [{"id": 102}, {"id": 103}])

        # Request centered at (47.615, -122.30), which is inside BOTH bboxes
        query_bbox = (47.605, -122.31, 47.625, -122.29)
        res = cache.get(query_bbox)
        assert res is not None
        assert len(res) == 3
        ids = {w["id"] for w in res}
        assert ids == {101, 102, 103}


class TestDiskCache:
    def test_disk_cache_basic_put_get(self):
        from server.core.cache import DiskCache
        cache = DiskCache(db_path=":memory:", max_bytes=1000)
        cache.put("image", "key1", b"image_bytes_here", 16)
        assert cache.get("image", "key1") == b"image_bytes_here"
        assert cache.get("image", "missing") is None

    def test_disk_cache_eviction_when_bytes_exceeded(self):
        from server.core.cache import DiskCache
        cache = DiskCache(db_path=":memory:", max_bytes=50)
        cache.put("image", "k1", b"12345678901234567890", 20)
        cache.put("image", "k2", b"12345678901234567890", 20)
        assert cache.count() == 2

        # Adding k3 (20 bytes) brings total to 60 > 50, k1 must be evicted
        cache.put("image", "k3", b"12345678901234567890", 20)
        assert cache.get("image", "k1") is None
        assert cache.get("image", "k2") is not None
        assert cache.get("image", "k3") is not None
        assert cache.count() == 2

    def test_disk_cache_spatial_roads(self):
        import json
        from server.core.cache import DiskCache
        cache = DiskCache(db_path=":memory:", max_bytes=10000)
        ways = [{"id": 999, "name": "Broadway"}]
        payload = json.dumps(ways).encode("utf-8")
        cache.put(
            tier="road",
            key="47.6,-122.31,47.62,-122.29",
            data=payload,
            size_bytes=len(payload),
            min_lat=47.60,
            min_lng=-122.31,
            max_lat=47.62,
            max_lng=-122.29,
        )

        # Query shifted 10 meters inside bbox
        roads = cache.get_spatial_roads(47.601, -122.309, 47.621, -122.289)
        assert roads is not None
        assert len(roads) == 1
        assert roads[0]["id"] == 999

        # Query far outside bbox
        assert cache.get_spatial_roads(47.70, -122.31, 47.72, -122.29) is None

    def test_disk_cache_persistence_across_instances(self, tmp_path):
        from server.core.cache import DiskCache, RoadCacheAdapter
        db_file = str(tmp_path / "test_persist.db")
        cache1 = DiskCache(db_path=db_file, max_bytes=50000)
        road_adapter1 = RoadCacheAdapter(cache1)
        road_adapter1.put((47.60, -122.31, 47.62, -122.29), [{"id": 555, "name": "Persistent Way"}])

        # Create new DiskCache instance pointing to same file (simulating server restart)
        cache2 = DiskCache(db_path=db_file, max_bytes=50000)
        road_adapter2 = RoadCacheAdapter(cache2)
        recovered = road_adapter2.get((47.605, -122.305, 47.625, -122.285))
        assert recovered is not None
        assert recovered[0]["id"] == 555
