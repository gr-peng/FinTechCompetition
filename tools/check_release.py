"""Check publish candidates. Findings report names/types, never matched values."""
from pathlib import Path
import hashlib
import json
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def candidates():
    result = subprocess.run(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
                            cwd=ROOT, check=True, capture_output=True)
    return sorted(set(result.stdout.decode('utf-8').split('\0')) - {''})


def main():
    risks = []
    files = candidates()
    patterns = {
        'private-key': r'-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----',
        'github-token': r'\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{30,})\b',
        'provider-token': r'\bsk-[A-Za-z0-9_-]{20,}\b',
        'aws-access-key': r'\b(?:AKIA|ASIA)[A-Z0-9]{16}\b',
        'credential-in-url': r'https?://[^\s/@:]+:[^\s/@]+@',
        'workstation-path': r'(?:[A-Z]:[\\/]Users[\\/]|(?<![A-Za-z0-9_/.-])/(?:Users|home)/)[A-Za-z0-9_.-]+',
    }
    for name in files:
        path = Path(name)
        bad = (path.name.startswith('.env') or path.suffix.lower() in {'.db','.sqlite','.sqlite3','.pem','.key','.p12','.pfx','.pyc','.pyo','.log'}
               or any(part in {'__pycache__','node_modules','.venv','venv','checkpoints'} or part.startswith('qa-') for part in path.parts)
               or (path.parts[0] == '.runtime' and name != '.runtime/.gitkeep'))
        if bad:
            risks.append({'path':name,'risk':'excluded-file-type'})
            continue
        content = (ROOT / name).read_bytes()
        if path.suffix.lower() == '.wav':
            if len(content) > 10 * 1024 * 1024 or content[:4] != b'RIFF' or content[8:12] != b'WAVE':
                risks.append({'path':name,'risk':'unexpected-audio-format'})
            continue
        if path.suffix.lower() == '.mp4':
            if len(content) > 30 * 1024 * 1024 or content[4:8] != b'ftyp':
                risks.append({'path':name,'risk':'unexpected-video-format'})
            continue
        if path.suffix.lower() in {'.pdf','.png','.jpg','.jpeg','.ico','.woff','.woff2'}:
            continue
        try:
            text = content.decode('utf-8')
        except UnicodeDecodeError:
            risks.append({'path':name,'risk':'unexpected-binary'})
            continue
        for kind, pattern in patterns.items():
            matches = list(re.finditer(pattern, text, re.I if kind in {'private-key','credential-in-url'} else 0))
            if kind == 'provider-token':
                matches = [m for m in matches if not (name.startswith('tests/') and m.group().startswith(('sk-test-','sk-fake-','sk-demo-')))]
            if kind == 'credential-in-url' and name == 'tests/voice-demo.test.mjs':
                # Exact synthetic negative fixture: the adapter must reject URL credentials.
                matches = [m for m in matches if m.group() != ''.join(('http', '://demo-user:demo-password@'))]
            if matches:
                risks.append({'path':name,'risk':kind})
        literal = re.finditer(r'''(?ix)(?<![A-Za-z0-9_-])["']?(api_key|api-key|password|secret|token|key)["']?\s*[:=]\s*["']([^"'\n]{16,})["']''', text)
        for match in literal:
            field, value = match.group(1).lower(), match.group(2)
            if field == 'key' and value.startswith(('finpilot-', 'finpilot_')):
                continue
            if name.startswith('tests/') and re.fullmatch(r'[a-z]+(?:-[a-z]+)+', value):
                # Human-readable exclusion sentinels are explicit synthetic fixtures.
                # Provider/GitHub/AWS token signatures above remain independently checked.
                continue
            if name == 'web/baseline/manual-capture.js' and field == 'key' and value.isidentifier() and 'capture' in value.lower():
                # This unchanged public createManualCapture default names a UI state field.
                # Confirm its complete bytes against the published R5 base before excluding it.
                prior = subprocess.run(['git','show','2ea8500e5b1013d1843312eda22826567f8159fa:'+name],
                                       cwd=ROOT,capture_output=True)
                if prior.returncode == 0 and prior.stdout == content:
                    continue
            if any(part in value.lower() for part in ('placeholder','example','test','fake','demo','your_','your-','replace','not-a-real','fixtures')):
                continue
            if '${' in value or not re.fullmatch(r'[A-Za-z0-9_+/.=-]{20,}', value):
                continue
            risks.append({'path':name,'risk':'literal-credential-candidate'})
    manifest = json.loads((ROOT / 'RELEASE-MANIFEST.json').read_text(encoding='utf-8'))
    for name, expected in manifest['source_files'].items():
        if hashlib.sha256((ROOT / name).read_bytes()).hexdigest() != expected:
            risks.append({'path':name,'risk':'source-hash-mismatch'})
    print(json.dumps({'candidate_files':len(files),'findings':risks}, ensure_ascii=True, indent=2))
    if risks:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
