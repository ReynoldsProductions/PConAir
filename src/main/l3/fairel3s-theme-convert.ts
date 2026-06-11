/**
 * Convert a FaireL3s style JSON (Pillow-rendered geometry) into a PConAir L3
 * CSS theme. Geometry semantics ported from FaireL3s/generate_lowerthirds.py:
 * panel at (margins.left, canvas.height - margins.bottom - panel.height),
 * text x = padding_left + bar.width + gap_x_after_bar, name_y/title_y are top
 * offsets from the panel top (Pillow top-left anchor).
 */

export interface FaireL3sStyle {
  canvas: { width: number; height: number };
  margins: { left: number; bottom: number };
  panel: {
    width: number;
    height: number;
    radius: number;
    fill_rgba: [number, number, number, number];
    border_rgb: [number, number, number];
    border_alpha: number;
    border_width: number;
    padding_left: number;
    padding_right: number;
    padding_y: number;
  };
  accent_bar: { x: number; y: number; width: number; height: number; rgb: [number, number, number]; alpha: number };
  text: {
    name: { size: number; rgb: [number, number, number]; alpha: number };
    title: { size: number; rgb: [number, number, number]; alpha: number };
    gap_x_after_bar: number;
    name_y: number;
    title_y: number;
  };
}

function rgba(rgb: [number, number, number], alpha: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${Number((alpha / 255).toFixed(3))})`;
}

export function fairel3sStyleToCss(style: FaireL3sStyle): string {
  const p = style.panel;
  const bar = style.accent_bar;
  const t = style.text;
  const textX = p.padding_left + bar.width + t.gap_x_after_bar;

  return `/* PConAir L3 theme — generated from a FaireL3s style */
body {
  margin: 0; padding: 0;
  width: ${style.canvas.width}px; height: ${style.canvas.height}px;
  background: transparent;
  font-family: 'Inter', 'Helvetica Neue', Arial, sans-serif;
  overflow: hidden;
}
.lower-third {
  position: fixed;
  left: ${style.margins.left}px;
  bottom: ${style.margins.bottom}px;
  width: ${p.width}px;
  height: ${p.height}px;
  background: ${rgba([p.fill_rgba[0], p.fill_rgba[1], p.fill_rgba[2]], p.fill_rgba[3])};
  border: ${p.border_width}px solid ${rgba(p.border_rgb, p.border_alpha)};
  border-radius: ${p.radius}px;
  box-sizing: border-box;
}
.lower-third::before {
  content: '';
  position: absolute;
  left: ${bar.x}px;
  top: ${bar.y}px;
  width: ${bar.width}px;
  height: ${bar.height}px;
  background: ${rgba(bar.rgb, bar.alpha)};
}
.name {
  position: absolute;
  left: ${textX}px;
  top: ${t.name_y}px;
  right: ${p.padding_right}px;
  margin: 0; padding: 0;
  font-size: ${t.name.size}px;
  line-height: 1.1;
  font-weight: 600;
  color: ${rgba(t.name.rgb, t.name.alpha)};
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.title {
  position: absolute;
  left: ${textX}px;
  top: ${t.title_y}px;
  right: ${p.padding_right}px;
  margin: 0; padding: 0;
  font-size: ${t.title.size}px;
  line-height: 1.1;
  font-weight: 400;
  color: ${rgba(t.title.rgb, t.title.alpha)};
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.subtitle { display: none; }
`;
}
