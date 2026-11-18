#!/usr/bin/env python3
"""Extract nested page bundles from a Claude artifact '__bundler' HTML file."""
import base64, gzip, json, re, sys, os

SRC = '/home/z/my-project/upload/FAIDA Predict Redesign.html'
OUT = '/home/z/my-project/redesign_pages'
os.makedirs(OUT, exist_ok=True)

html = open(SRC, encoding='utf-8').read()

def grab(tag):
    m = re.search(r'<script type="__bundler/%s">(.*?)</script>' % tag, html, re.S)
    return m.group(1) if m else None

manifest = json.loads(grab('manifest'))
page_order = json.loads(grab('page_order')) if grab('page_order') else []
template = json.loads(grab('template'))

print('assets in manifest:', len(manifest))
print('page order:', page_order)

def decode(uuid):
    e = manifest[uuid]
    b = base64.b64decode(e['data'])
    if e.get('compressed'):
        b = gzip.decompress(b)
    return b.decode('utf-8'), e.get('mime', '?')

names = {}
for i, uuid in enumerate(page_order, 1):
    text, mime = decode(uuid)
    # find a title for the filename
    t = re.search(r'<title>(.*?)</title>', text, re.S)
    title = (t.group(1).strip() if t else 'untitled').replace(' ', '_').replace('/', '-')[:60]
    fn = f'{OUT}/page-{i:02d}.html'
    open(fn, 'w', encoding='utf-8').write(text)
    names[i] = title
    print(f'page {i}: uuid={uuid} mime={mime} bytes={len(text)} title={title!r} -> {fn}')

# Check for nested iframes inside pages (sub-page bundles)
marker = re.compile(r'about:blank#([0-9a-f-]{36})')
for i, uuid in enumerate(page_order, 1):
    text, _ = decode(uuid)
    nested = set(marker.findall(text))
    print(f'page {i} nested frame uuids:', nested or '-')

# Also dump non-page assets info
for uuid, e in manifest.items():
    if uuid not in page_order:
        try:
            text, mime = decode(uuid)
            kind = mime
            print('asset:', uuid[:8], mime, len(text) if isinstance(text, str) else '?')
        except Exception as ex:
            print('asset:', uuid[:8], e.get('mime'), '(binary)', ex)

# root template: what wraps the pages?
m = re.findall(r'iframe[^>]*', template)
print('root iframes:', len(m))
for x in m[:8]:
    print('  ', x[:160])
