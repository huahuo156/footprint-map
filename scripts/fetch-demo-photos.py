"""Refresh the bundled example photos from the original landmark dataset."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote
from urllib.request import urlopen

PHOTOS = [
    ('浙江', '西湖', 'west-lake'), ('浙江', '乌镇', 'wuzhen'),
    ('上海', '东方明珠', 'shanghai'), ('北京', '故宫', 'palace'),
    ('北京', '天坛', 'temple'), ('北京', '颐和园', 'summer-palace'),
    ('北京', '八达岭', 'great-wall'), ('四川', '九寨沟', 'jiuzhaigou'),
    ('四川', '黄龙', 'huanglong'), ('四川', '峨眉山', 'emei'),
    ('四川', '乐山大佛', 'leshan'),
]
DESTINATION = Path(__file__).resolve().parents[1] / 'public' / 'journal-demo'

def download(photo):
    region, name, slug = photo
    url = 'https://cdn.jsdelivr.net/gh/marksui/China-Travel-Map@main/assets/images/' + quote(region) + '/' + quote(name) + '.jpg'
    with urlopen(url, timeout=30) as response:
        content = response.read(20 * 1024 * 1024)
    if not content.startswith(b'\xff\xd8\xff'):
        raise ValueError('Invalid JPEG: ' + slug)
    (DESTINATION / (slug + '.jpg')).write_bytes(content)
    return slug, len(content)

if __name__ == '__main__':
    DESTINATION.mkdir(parents=True, exist_ok=True)
    with ThreadPoolExecutor(max_workers=4) as executor:
        for slug, size in executor.map(download, PHOTOS):
            print(slug, size)
