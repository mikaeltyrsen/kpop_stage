import pathlib
import sys

import pytest

ROOT_DIR = pathlib.Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

pytest.importorskip("flask")

import app as app_module


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch):
    video_config = {
        "default_video": "default.mp4",
        "videos": [
            {
                "id": "public",
                "name": "Public Song",
                "file": "videos/public.mp4",
            },
            {
                "id": "intro",
                "name": "Intro",
                "file": "videos/intro.mp4",
                "admin_only": True,
            },
        ],
    }
    monkeypatch.setattr(app_module, "video_config", video_config)
    monkeypatch.setattr(app_module, "user_registry", app_module.UserRegistry())
    if not hasattr(app_module.app, "test_client"):
        pytest.skip("Flask test client not available")
    return app_module.app.test_client()


def test_videos_api_hides_admin_only_videos(client):
    response = client.get("/api/videos")
    assert response.status_code == 200
    payload = response.get_json()
    assert payload == {
        "videos": [
            {
                "id": "public",
                "name": "Public Song",
                "file": "videos/public.mp4",
                "video_url": "/media/videos/public.mp4",
            }
        ]
    }


def test_videos_api_includes_admin_only_for_admins(client):
    register_response = client.post("/api/register", json={"admin": True})
    assert register_response.status_code == 200
    admin_key = register_response.get_json()["key"]

    response = client.get(f"/api/videos?key={admin_key}")
    assert response.status_code == 200
    payload = response.get_json()

    ids = {video["id"] for video in payload["videos"]}
    assert ids == {"public", "intro"}
