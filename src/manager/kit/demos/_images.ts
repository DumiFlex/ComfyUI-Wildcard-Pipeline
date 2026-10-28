/** Demo images drawn as SVG data URLs, so the kit page needs no files or network. */
export function demoImage(i: number, w = 512, h = 512): string {
  const a = (i * 47) % 360;
  const b = (a + 60) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${a} 60% 55%)"/>`
    + `<stop offset="1" stop-color="hsl(${b} 55% 30%)"/></linearGradient></defs>`
    + `<rect width="100%" height="100%" fill="url(#g)"/>`
    + `<circle cx="${w * 0.66}" cy="${h * 0.34}" r="${Math.min(w, h) * 0.14}" fill="hsl(${a} 90% 92% / 0.8)"/>`
    + `<path d="M0 ${h * 0.8} L${w * 0.35} ${h * 0.5} L${w * 0.6} ${h * 0.72} L${w} ${h * 0.45} V${h} H0Z" fill="hsl(${b} 40% 18% / 0.75)"/>`
    + `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
