from fastapi.testclient import TestClient

from contest_detective.web.bootstrap.app import create_app


def test_missing_route_uses_response_envelope():
    response = TestClient(create_app()).get('/does-not-exist')
    assert response.status_code == 200
    assert response.json()['code'] == 404
    assert response.json()['data'] is None


def test_wrong_method_uses_response_envelope():
    response = TestClient(create_app()).post('/health')
    assert response.status_code == 200
    assert response.json()['code'] == 405
