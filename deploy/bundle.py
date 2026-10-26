#!/usr/bin/env python3
"""Build a delta from a complete, Git-exported release directory."""

import argparse
import io
import json
from pathlib import Path
import tarfile

from release import MANIFEST_NAME, REQUIRED_FILES, allowed_file, file_record, validate_manifest


def build(root, baseline, output):
    baseline = validate_manifest(baseline)['files']
    if not REQUIRED_FILES <= baseline.keys():
        raise ValueError('Incomplete baseline; automatic full transfer is disabled')
    files = {}
    for path in sorted(root.rglob('*')):
        name = path.relative_to(root).as_posix()
        if path.is_symlink():
            raise ValueError(f'Symlinks are not release files: {name}')
        if not path.is_file():
            continue
        if not allowed_file(name):
            raise ValueError(f'Unexpected release file: {name}')
        files[name] = file_record(path)
    document = validate_manifest({'version': 1, 'files': files})
    if not REQUIRED_FILES <= files.keys():
        raise ValueError('Incomplete target release')
    changed = [name for name, value in files.items() if baseline.get(name) != value]
    with tarfile.open(output, mode='w:gz') as archive:
        data = json.dumps(document, sort_keys=True).encode()
        member = tarfile.TarInfo(MANIFEST_NAME)
        member.size = len(data)
        archive.addfile(member, io.BytesIO(data))
        for name in changed:
            archive.add(root / name, arcname=name, recursive=False)
    print(f'Incremental bundle: changed={len(changed)} reused={len(files) - len(changed)} '
          f'bytes={output.stat().st_size}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--base', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    build(args.root, json.loads(args.base.read_text()), args.output)
