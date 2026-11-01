"""Adapter for copied 65271 owner-position components. No network or bank tools."""
from pathlib import Path
from urllib.parse import urlsplit
import json
from baseline_backend.personal_positions import PersonalPositionStore, PositionConflict
from baseline_backend.market_reference import MarketReference

ROOT = Path(__file__).resolve().parents[1]
_positions = None
_market = None


def services():
    global _positions, _market
    if _positions is None:
        _positions = PersonalPositionStore(ROOT / '.runtime' / 'positions.sqlite3')
    if _market is None:
        _market = MarketReference(ROOT / 'web' / 'assets' / 'research')
    return _positions, _market


def create_demo_db(target):
    """Write the synthetic fixture to a new database; return None if one already exists."""
    target = Path(target).resolve()
    if target.exists():
        return None
    fixture = json.loads((ROOT / 'demo' / 'positions.synthetic.json').read_text(encoding='utf-8'))
    if fixture.get('kind') != 'synthetic-demo':
        raise SystemExit('Expected explicit synthetic fixture')
    store = PersonalPositionStore(target)
    revision = store.list()['revision']
    for position in fixture['positions']:
        revision = store.save(position, revision)['revision']
    return {'synthetic_positions': len(store.list()['holdings']), 'database_created': True}


def read(path):
    positions, market = services()
    if path == '/api/positions':
        return market.closing_portfolio(positions)
    if path == '/api/reference/watchlist':
        return market.watchlist()
    raise KeyError(path)


def mutate(method, path, data):
    positions, _ = services()
    if path == '/api/positions' and method == 'POST':
        return positions.save(data['position'], data['expected_revision'])
    if path.startswith('/api/positions/'):
        identifier = path.rsplit('/', 1)[1]
        if method == 'PUT':
            return positions.save(data['position'], data['expected_revision'], identifier)
        if method == 'DELETE':
            return positions.delete(identifier, data['expected_revision'])
    if path == '/api/position-imports/preview' and method == 'POST':
        return positions.preview_csv(data['content'])
    if path.startswith('/api/position-imports/') and path.endswith('/confirm') and method == 'POST':
        return positions.confirm_import(path.split('/')[-2], data['expected_revision'])
    raise KeyError(path)
