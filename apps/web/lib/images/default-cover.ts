const defaultCoverSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="surface" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#181818"/>
      <stop offset="0.55" stop-color="#111111"/>
      <stop offset="1" stop-color="#0c0c0c"/>
    </linearGradient>
    <radialGradient id="light" cx="0" cy="0" r="1" gradientTransform="translate(118 86) rotate(42) scale(420)">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.045"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="42" fill="url(#surface)"/>
  <rect width="512" height="512" rx="42" fill="url(#light)"/>
  <rect x="1" y="1" width="510" height="510" rx="41" fill="none" stroke="#ffffff" stroke-opacity="0.06" stroke-width="2"/>
</svg>`;

export const defaultCover = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(defaultCoverSvg)}`;
