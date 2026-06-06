import pytest
from services.leaderboard import get_user_rank

# Mocking the redis_client for testing
class MockRedis:
    def __init__(self, data):
        self.data = data
        
    async def zrevrank(self, key, member):
        if key in self.data and member in self.data[key]:
            # Simple mock: sort the dict values descending and find index
            sorted_members = sorted(self.data[key].keys(), key=lambda k: self.data[key][k], reverse=True)
            try:
                return sorted_members.index(member)
            except ValueError:
                return None
        return None

@pytest.mark.asyncio
async def test_get_user_rank(monkeypatch):
    mock_redis_data = {
        "leaderboard:1": {
            "100": 50,
            "101": 75,
            "102": 25
        }
    }
    
    mock_redis = MockRedis(mock_redis_data)
    
    # Patch the redis_client in leaderboard service
    import services.leaderboard
    monkeypatch.setattr(services.leaderboard, "redis_client", mock_redis)
    
    rank_101 = await get_user_rank(1, 101)
    assert rank_101 == 1  # 75 pts, highest
    
    rank_100 = await get_user_rank(1, 100)
    assert rank_100 == 2  # 50 pts, 2nd
    
    rank_102 = await get_user_rank(1, 102)
    assert rank_102 == 3  # 25 pts, 3rd
    
    rank_missing = await get_user_rank(1, 999)
    assert rank_missing is None
