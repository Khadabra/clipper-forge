from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_root_endpoint():
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert "Welcome to ClipForge Studio API" in data["message"]


def test_health_check():
    response = client.get("/api/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["app"] == "ClipForge Studio"
    assert "version" in data


def test_system_check_safe_execution():
    """Verify system check executes without crashing even if FFmpeg is not installed."""
    response = client.get("/api/system/check")
    assert response.status_code == 200
    data = response.json()
    assert "status" in data
    assert "ffmpeg" in data
    assert "ffprobe" in data
    assert "python" in data
    assert "disk_space" in data
    
    # Assert ffmpeg sub-dictionary structure
    assert "available" in data["ffmpeg"]
    assert isinstance(data["ffmpeg"]["available"], bool)
    
    # Assert python info
    assert "version" in data["python"]
    assert len(data["python"]["version"]) > 0
    
    # Assert disk space info
    assert "free_gb" in data["disk_space"]
    assert data["disk_space"]["free_gb"] >= 0
