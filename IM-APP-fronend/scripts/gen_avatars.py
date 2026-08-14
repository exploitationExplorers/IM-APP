from PIL import Image, ImageDraw, ImageFont
import os

out_dir = r"D:\接单\IM\IM-APP-fronend\src\static"
os.makedirs(out_dir, exist_ok=True)

font_candidates = [
    r"C:\Windows\Fonts\msyh.ttc",
    r"C:\Windows\Fonts\msyhbd.ttc",
    r"C:\Windows\Fonts\simhei.ttf",
    r"C:\Windows\Fonts\simsun.ttc",
]
font_path = next((p for p in font_candidates if os.path.exists(p)), None)
print("font:", font_path)


def make_avatar(path, bg, text, size=192):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.ellipse((0, 0, size - 1, size - 1), fill=bg)
    font = (
        ImageFont.truetype(font_path, size=int(size * 0.42))
        if font_path
        else ImageFont.load_default()
    )
    bbox = draw.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (size - tw) / 2 - bbox[0]
    y = (size - th) / 2 - bbox[1] - size * 0.02
    draw.text((x, y), text, fill=(255, 255, 255, 255), font=font)
    img.save(path, "PNG")
    print("wrote", path)


avatars = [
    ("avatar-me.png", (52, 66, 86, 255), "张"),
    ("avatar-1.png", (255, 148, 35, 255), "李"),
    ("avatar-2.png", (88, 178, 92, 255), "王"),
    ("avatar-3.png", (41, 123, 251, 255), "赵"),
]
for name, color, text in avatars:
    make_avatar(os.path.join(out_dir, name), color, text)

for name, color, text in [
    ("group-1.png", (41, 123, 251, 255), "群"),
    ("group-2.png", (248, 98, 150, 255), "讨"),
    ("group-3.png", (255, 148, 35, 255), "产"),
]:
    make_avatar(os.path.join(out_dir, name), color, text)

print("done")
