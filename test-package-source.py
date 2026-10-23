import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('packager', Path(__file__).with_name('package-source.py'))
packager = importlib.util.module_from_spec(spec)
spec.loader.exec_module(packager)


class SourceSafety(unittest.TestCase):
    def test_rejects_runtime_and_nonregular_members(self):
        for name, mode in [('apps/app/.env', '100644'), ('apps/api/uploads/customer.json', '100644'), ('apps/api/node_modules/x.js', '100644'), ('apps/app/link', '120000')]:
            with self.subTest(name=name), self.assertRaises(ValueError):
                packager.check(name, mode, b'candidate')

    def test_rejects_real_key_material_and_tokens(self):
        key = b'-----BEGIN ' + b'PRIVATE KEY-----\n' + b'A' * 64
        for data in [key, b'ghp_' + b'A' * 40]:
            with self.assertRaises(ValueError):
                packager.check('apps/api/src/config.ts', '100644', data)

    def test_does_not_reject_parser_delimiters(self):
        packager.check('packages/parser.ts', '100644', b'const marker = "-----BEGIN RSA ' + b'PRIVATE KEY-----\\n";')


if __name__ == '__main__':
    unittest.main()
