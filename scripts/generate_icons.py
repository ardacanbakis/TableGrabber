#!/usr/bin/env python3
"""Generate icons for TableGrabber Chrome extension."""

from PIL import Image, ImageDraw
import os

def draw_rounded_rect(draw, xy, radius, fill):
    """Draw a rounded rectangle."""
    x1, y1, x2, y2 = xy
    draw.rectangle([x1 + radius, y1, x2 - radius, y2], fill=fill)
    draw.rectangle([x1, y1 + radius, x2, y2 - radius], fill=fill)
    draw.pieslice([x1, y1, x1 + radius * 2, y1 + radius * 2], 180, 270, fill=fill)
    draw.pieslice([x2 - radius * 2, y1, x2, y1 + radius * 2], 270, 360, fill=fill)
    draw.pieslice([x1, y2 - radius * 2, x1 + radius * 2, y2], 90, 180, fill=fill)
    draw.pieslice([x2 - radius * 2, y2 - radius * 2, x2, y2], 0, 90, fill=fill)

def create_icon(size, output_path):
    """Create a table icon with the given size."""
    # Create image with transparency
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # Colors
    bg_color = (37, 99, 235, 255)  # Blue #2563eb
    white = (255, 255, 255, 255)
    header_color = (255, 255, 255, 77)  # Semi-transparent white

    # Draw rounded background
    radius = int(size * 0.15)
    draw_rounded_rect(draw, (0, 0, size, size), radius, bg_color)

    # Table dimensions
    padding = int(size * 0.18)
    grid_size = size - (padding * 2)
    cell_width = grid_size // 3
    cell_height = grid_size // 3
    line_width = max(1, int(size * 0.05))

    # Draw header row highlight
    header_rect = [
        padding,
        padding,
        padding + grid_size,
        padding + cell_height
    ]
    draw.rectangle(header_rect, fill=header_color)

    # Draw table grid - outer border
    draw.rectangle(
        [padding, padding, padding + grid_size, padding + grid_size],
        outline=white,
        width=line_width
    )

    # Draw vertical lines
    for i in range(1, 3):
        x = padding + (cell_width * i)
        draw.line([(x, padding), (x, padding + grid_size)], fill=white, width=line_width)

    # Draw horizontal lines
    for i in range(1, 3):
        y = padding + (cell_height * i)
        draw.line([(padding, y), (padding + grid_size, y)], fill=white, width=line_width)

    # Save the image
    img.save(output_path, 'PNG')
    print(f"Created {output_path}")

def main():
    # Ensure icons directory exists
    icons_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'icons')
    os.makedirs(icons_dir, exist_ok=True)

    # Create icons in different sizes
    sizes = [16, 48, 128]
    for size in sizes:
        output_path = os.path.join(icons_dir, f'icon{size}.png')
        create_icon(size, output_path)

    print("All icons generated successfully!")

if __name__ == '__main__':
    main()
