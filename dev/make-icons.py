#!/usr/bin/env python3
"""Generuje ikony PWA: niebieskie tło #1a56db, biała tarcza zegara ze wskazówkami."""
import math, os
from PIL import Image, ImageDraw

BLUE = (26, 86, 219, 255)
WHITE = (255, 255, 255, 255)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'pwa', 'icons')

def icon(size, scale):
    """scale = promień tarczy względem połowy rozmiaru (mniejszy dla maskable: strefa bezpieczna)."""
    S = size * 4  # supersampling
    im = Image.new('RGBA', (S, S), BLUE)
    d = ImageDraw.Draw(im)
    c = S / 2
    r = c * scale
    d.ellipse([c - r, c - r, c + r, c + r], fill=WHITE)
    # znaczniki godzin
    for i in range(12):
        a = math.radians(i * 30)
        r1, r2 = r * (0.84 if i % 3 == 0 else 0.90), r * 0.96
        w = max(2, int(r * (0.05 if i % 3 == 0 else 0.03)))
        d.line([c + r1 * math.sin(a), c - r1 * math.cos(a), c + r2 * math.sin(a), c - r2 * math.cos(a)], fill=BLUE, width=w)
    # wskazówki: 10:10
    def hand(deg, length, width):
        a = math.radians(deg)
        d.line([c, c, c + r * length * math.sin(a), c - r * length * math.cos(a)], fill=BLUE, width=int(r * width))
        rr = r * width / 2
        d.ellipse([c + r * length * math.sin(a) - rr, c - r * length * math.cos(a) - rr, c + r * length * math.sin(a) + rr, c - r * length * math.cos(a) + rr], fill=BLUE)
    hand(305, 0.5, 0.075)   # godzinowa
    hand(60, 0.72, 0.055)   # minutowa
    rr = r * 0.07
    d.ellipse([c - rr, c - rr, c + rr, c + rr], fill=BLUE)
    return im.resize((size, size), Image.LANCZOS).convert('RGB')

os.makedirs(OUT, exist_ok=True)
icon(192, 0.72).save(os.path.join(OUT, 'icon-192.png'))
icon(512, 0.72).save(os.path.join(OUT, 'icon-512.png'))
icon(512, 0.5).save(os.path.join(OUT, 'maskable-512.png'))
icon(180, 0.72).save(os.path.join(OUT, 'apple-touch-icon.png'))
print('OK')
