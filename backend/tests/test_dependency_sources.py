import tomllib
import unittest
from pathlib import Path


BACKEND = Path(__file__).resolve().parents[1]
MIRROR = 'https://mirrors.cloud.tencent.com/pypi/'


class ProductionDependencySourcesTest(unittest.TestCase):
    """生产机无法稳定访问 PyPI，项目配置和锁定的下载地址必须同时保留镜像。"""

    def test_default_index_uses_the_production_mirror(self):
        project = tomllib.loads((BACKEND / 'pyproject.toml').read_text())
        indexes = project.get('tool', {}).get('uv', {}).get('index', [])
        defaults = [index['url'] for index in indexes if index.get('default')]
        self.assertEqual(defaults, [MIRROR + 'simple/'])

    def test_locked_registry_artifacts_use_the_production_mirror(self):
        lock = tomllib.loads((BACKEND / 'uv.lock').read_text())
        registry_packages = [
            package for package in lock['package'] if 'registry' in package['source']
        ]
        self.assertTrue(registry_packages)
        for package in registry_packages:
            with self.subTest(package=package['name']):
                self.assertEqual(package['source']['registry'], MIRROR + 'simple/')
                artifacts = package.get('wheels', []) + (
                    [package['sdist']] if 'sdist' in package else []
                )
                for artifact in artifacts:
                    self.assertTrue(artifact['url'].startswith(MIRROR + 'packages/'), artifact['url'])
