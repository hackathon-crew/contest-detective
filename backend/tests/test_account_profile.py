from test_accounts import app_client


def test_profile_preserves_each_skill_source(tmp_path):
    with app_client(tmp_path) as client:
        credentials = {'email': 'profile@example.com', 'password': 'long-password-123'}
        client.post('/auth/register', json=credentials)
        client.post('/auth/login', json=credentials)
        profile = {'skills': ['Python', 'Figma', 'React'],
                   'skill_sources': {'Python': ['github'], 'Figma': ['resume'], 'React': ['manual']}}
        response = client.put('/user/profile', json=profile).json()
        assert response['data']['profile'].get('skill_sources') == profile['skill_sources']
        assert client.get('/auth/me').json()['data']['profile']['skill_sources'] == profile['skill_sources']


def test_profile_rejects_an_unknown_source(tmp_path):
    with app_client(tmp_path) as client:
        credentials = {'email': 'profile@example.com', 'password': 'long-password-123'}
        client.post('/auth/register', json=credentials)
        client.post('/auth/login', json=credentials)
        result = client.put('/user/profile', json={'skills': ['Python'], 'skill_sources': {'Python': ['made-up']}})
        assert result.json()['code'] == 400
