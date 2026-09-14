/* Minimal inline-SVG line chart. No charting library, no external dependency. */

function renderLineChart(containerId, points, opts) {
  opts = opts || {};
  const width = opts.width || 760;
  const height = opts.height || 220;
  const padding = { top: 20, right: 20, bottom: 34, left: 56 };
  const innerW = width - padding.left - padding.right;
  const innerH = height - padding.top - padding.bottom;

  const values = points.map((p) => p.value);
  const maxV = Math.max(...values) * 1.12;
  const minV = 0;

  const x = (i) => padding.left + (innerW * i) / (points.length - 1);
  const y = (v) => padding.top + innerH - ((v - minV) / (maxV - minV)) * innerH;

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${x(points.length - 1).toFixed(1)},${(padding.top + innerH).toFixed(1)} L${x(0).toFixed(1)},${(padding.top + innerH).toFixed(1)} Z`;

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const gy = padding.top + innerH * (1 - f);
    const val = maxV * f;
    return `
      <line x1="${padding.left}" y1="${gy.toFixed(1)}" x2="${width - padding.right}" y2="${gy.toFixed(1)}" stroke="#dcd7ca" stroke-width="1" />
      <text x="${padding.left - 10}" y="${gy.toFixed(1)}" fill="#8b929a" font-size="11" text-anchor="end" dominant-baseline="middle">${opts.formatY ? opts.formatY(val) : Math.round(val)}</text>
    `;
  }).join("");

  const dots = points.map((p, i) => {
    const isLast = i === points.length - 1;
    return `<circle cx="${x(i).toFixed(1)}" cy="${y(p.value).toFixed(1)}" r="${isLast ? 4.5 : 3}" fill="#b9903f" opacity="${isLast ? 1 : 0.75}" />`;
  }).join("");

  const labels = points.map((p, i) => {
    if (i % 2 !== 0 && i !== points.length - 1) return "";
    return `<text x="${x(i).toFixed(1)}" y="${height - 10}" fill="#8b929a" font-size="11" text-anchor="middle">${p.label}</text>`;
  }).join("");

  const svg = `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" xmlns="http://www.w3.org/2000/svg">
      ${gridLines}
      <path d="${areaPath}" fill="rgba(16,49,90,0.06)" stroke="none" />
      <path d="${linePath}" fill="none" stroke="#10315a" stroke-width="2.5" />
      ${dots}
      ${labels}
    </svg>
  `;

  document.getElementById(containerId).innerHTML = svg;
}
