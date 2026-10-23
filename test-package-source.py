import importlib.util
import hashlib
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

    def test_only_deployed_work_and_build_source_are_selected(self):
        for name in ['apps/app/src/app/layout.tsx', 'apps/api/src/main.ts', 'apps/portal/src/app/layout.tsx', 'packages/db/prisma/schema/main.prisma', 'vendor-source/dub-embeds/LICENSE.md']:
            self.assertTrue(packager.selected(name), name)
        for name in ['apps/browser-extension/extension.ts', 'apps/device-agent/main.go', 'apps/app/ee/private.ts', 'node_modules/fixture/index.js', 'dependency-packages/unused.tgz', 'apps/api/.env']:
            self.assertFalse(packager.selected(name), name)

    def test_public_unchanged_build_inputs_are_directions_not_redistributed_archives(self):
        data = b'{"packages":{"fixture":["fixture@1.0.0","",{},"sha512-fixture"]}}'
        result = packager.dependency_directions({'app': data})
        self.assertEqual(result['packages'][0]['archive'], 'https://registry.npmjs.org/fixture/-/fixture-1.0.0.tgz')
        self.assertEqual(result['packages'][0]['integrity'], 'sha512-fixture')
        self.assertNotIn('license', result['packages'][0])

    def test_private_or_modified_dependency_inputs_cannot_be_silently_omitted(self):
        with self.assertRaisesRegex(ValueError, 'integrity proof'):
            packager.dependency_directions({'app': b'{"packages":{"private":["private@1.0.0","",{}]}}'})
        with self.assertRaisesRegex(ValueError, 'patches/source'):
            packager.dependency_directions({'app': b'{"packages":{},"patchedDependencies":{"fixture":"patches/fixture.patch"}}'})

    def test_deployed_frontends_use_exact_inter_and_original_terms(self):
        root = Path(__file__).resolve().parent
        for name in ['app', 'portal']:
            directory = root/'apps'/name/'public/fonts'
            self.assertEqual(hashlib.sha256((directory/'Inter.woff2').read_bytes()).hexdigest(), '2dcd3612039a9aaa2660c0c9edd0f4b982e19d317af5ffe4161c37ddc803b5d0')
            self.assertEqual(hashlib.sha256((directory/'Inter-OFL.txt').read_bytes()).hexdigest(), '5b9321a4298cfeb6b34354164a1c3afc3db114569984c502b9b35d988fd58c57')
            self.assertFalse(list(directory.glob('GeneralSans*')))
            self.assertIn('Inter.woff2', (root/'apps'/name/'src/app/layout.tsx').read_text())


if __name__ == '__main__':
    unittest.main()
