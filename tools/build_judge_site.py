"""Export the key-free, browser-local FinPilot judge build without changing web/."""
import argparse
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parents[1]
TEXT = {'.js', '.mjs', '.html', '.json', '.css', '.md'}


def export(output):
    output = Path(output).resolve()
    if output.exists():
        raise SystemExit('Choose a new output directory; existing files are never overwritten.')
    source = ROOT / 'web'
    if output == ROOT or source == output or source in output.parents or output in ROOT.parents:
        raise SystemExit('Output must be separate from the source tree.')
    output.mkdir(parents=True)
    for path in source.rglob('*'):
        if not path.is_file() or path.is_symlink():
            continue
        if any(part in {'.runtime', '__pycache__', 'node_modules'} for part in path.relative_to(source).parts):
            continue
        if path.name.startswith('.env') or path.suffix.lower() in {'.db', '.sqlite', '.sqlite3', '.log', '.key', '.pem', '.pyc'}:
            continue
        relative = path.relative_to(source)
        if path.suffix == '.mjs':
            relative = relative.with_suffix('.js')
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if path.suffix in TEXT:
            target.write_text(path.read_text(encoding='utf-8').replace('.mjs', '.js'), encoding='utf-8')
        else:
            shutil.copyfile(path, target)
    overrides = ROOT / 'tools' / 'judge-site'
    for path in overrides.rglob('*'):
        if path.is_file() and not path.is_symlink():
            target = output / path.relative_to(overrides)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(path, target)
    (output / 'judge-data').mkdir(exist_ok=True)
    shutil.copyfile(ROOT / 'demo' / 'judge-site-fixtures.json', output / 'judge-data' / 'fixtures.json')
    (output / 'judge-data' / 'source-demo').mkdir(exist_ok=True)
    shutil.copyfile(ROOT / 'demo' / 'positions.synthetic.json', output / 'judge-data' / 'source-demo' / 'positions.synthetic.json')
    shutil.copyfile(ROOT / 'docs' / 'DEMO-PROMPTS.zh-CN.md', output / 'DEMO-PROMPTS.zh-CN.md')
    print(f'Exported browser-local judge build to {output}')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True)
    export(parser.parse_args().output)
