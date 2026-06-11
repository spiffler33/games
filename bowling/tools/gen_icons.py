#!/usr/bin/env python3
"""Generate app icons (bowling ball + pin on purple gradient) without external deps."""
import math
import struct
import zlib


def png_write(path, w, h, rgb):
    raw = b''.join(b'\x00' + bytes(rgb[y * w * 3:(y + 1) * w * 3]) for y in range(h))

    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c))

    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)))
        f.write(chunk(b'IDAT', zlib.compress(raw, 9)))
        f.write(chunk(b'IEND', b''))


def lerp(a, b, t):
    return a + (b - a) * t


def pin_radius(t):
    """Half-width profile of a bowling pin, t in [0,1] from head to base."""
    pts = [(0.0, 0.10), (0.08, 0.15), (0.22, 0.115), (0.38, 0.13), (0.62, 0.215), (0.85, 0.20), (1.0, 0.15)]
    for i in range(len(pts) - 1):
        (t0, r0), (t1, r1) = pts[i], pts[i + 1]
        if t0 <= t <= t1:
            u = (t - t0) / (t1 - t0)
            u = (1 - math.cos(u * math.pi)) / 2  # smooth
            return lerp(r0, r1, u)
    return pts[-1][1]


def render(size):
    img = bytearray(size * size * 3)
    s = size

    # pin geometry (right of center, vertical)
    pin_cx, pin_top, pin_h = 0.60, 0.13, 0.62
    # ball geometry (lower left, on top of pin base)
    ball_cx, ball_cy, ball_r = 0.40, 0.66, 0.26

    for y in range(s):
        for x in range(s):
            u, v = (x + 0.5) / s, (y + 0.5) / s
            # background: radial-ish purple gradient
            d = math.hypot(u - 0.5, v - 0.35)
            t = min(d / 0.85, 1.0)
            r = lerp(0x6d, 0x21, t)
            g = lerp(0x28, 0x10, t)
            b = lerp(0xd9, 0x4f, t)

            # pin
            pt = (v - pin_top) / pin_h
            if 0.0 <= pt <= 1.0:
                pr = pin_radius(pt) * pin_h
                dx = abs(u - pin_cx)
                if dx < pr:
                    shade = 1.0 - 0.45 * (dx / pr) ** 2
                    if (u - pin_cx) < -pr * 0.3:
                        shade *= 0.92
                    if 0.30 < pt < 0.36 or 0.40 < pt < 0.46:  # red stripes
                        r, g, b = 0xef * shade, 0x44 * shade, 0x44 * shade
                    else:
                        r, g, b = 0xff * shade, 0xff * shade, 0xf2 * shade

            # ball (drawn over pin)
            bd = math.hypot(u - ball_cx, v - ball_cy)
            if bd < ball_r:
                hx, hy = (u - (ball_cx - 0.09)) / ball_r, (v - (ball_cy - 0.10)) / ball_r
                hl = max(0.0, 1.0 - math.hypot(hx, hy))
                shade = 0.55 + 0.45 * (1.0 - (bd / ball_r) ** 2)
                r = min(255, lerp(0xea, 0xff, hl * 0.9) * shade + 60 * hl)
                g = lerp(0x58, 0xc8, hl) * shade
                b = lerp(0x0c, 0x9a, hl) * shade
                # finger holes
                for ox, oy in ((-0.05, -0.07), (0.05, -0.09), (0.0, -0.16)):
                    if math.hypot(u - (ball_cx + ox), v - (ball_cy + oy)) < 0.028:
                        r, g, b = r * 0.3, g * 0.3, b * 0.3

            i = (y * s + x) * 3
            img[i], img[i + 1], img[i + 2] = int(r), int(g), int(b)
    return img


def downscale(img, src, dst):
    out = bytearray(dst * dst * 3)
    ratio = src / dst
    for y in range(dst):
        for x in range(dst):
            sx0, sy0 = int(x * ratio), int(y * ratio)
            sx1, sy1 = max(sx0 + 1, int((x + 1) * ratio)), max(sy0 + 1, int((y + 1) * ratio))
            n = (sx1 - sx0) * (sy1 - sy0)
            for c in range(3):
                tot = 0
                for sy in range(sy0, sy1):
                    for sx in range(sx0, sx1):
                        tot += img[(sy * src + sx) * 3 + c]
                out[(y * dst + x) * 3 + c] = tot // n
    return out


if __name__ == '__main__':
    big = render(512)
    png_write('icon-512.png', 512, 512, big)
    png_write('icon-180.png', 180, 180, downscale(big, 512, 180))
    print('icons written')
