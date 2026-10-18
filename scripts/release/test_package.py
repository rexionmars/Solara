"""Release identities must be safe for both native metadata and asset names."""
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('release_package', Path(__file__).with_name('package.py'))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class Versions(unittest.TestCase):
    def test_stable_and_prerelease_identity(self):
        self.assertEqual(release.version('v1.2.3'), ('1.2.3', '1.2.3', False))
        self.assertEqual(release.version('v1.2.3-rc.1+build.7'), ('1.2.3-rc.1+build.7', '1.2.3', True))

    def test_reject_unsafe_names_and_non_semver_tags(self):
        for tag in ('1.2.3', 'v01.2.3', 'v1.2', 'v1.2.3-01', 'v1.2.3/../../file', 'v1.2.3\n', 'v1.2.3;echo x'):
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                release.version(tag)


if __name__ == '__main__':
    unittest.main()
