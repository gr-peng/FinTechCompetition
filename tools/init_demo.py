"""Initialize synthetic positions in this clone only; never overwrite a database."""
from pathlib import Path
import argparse
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.baseline_api import create_demo_db

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, help='Optional new database path for isolated validation')
    args = parser.parse_args()
    result = create_demo_db(args.output or ROOT / '.runtime' / 'positions.sqlite3')
    if result is None:
        print('Database already exists; preserved without modification.')
        return
    print(json.dumps(result, ensure_ascii=False))

if __name__ == '__main__':
    main()
