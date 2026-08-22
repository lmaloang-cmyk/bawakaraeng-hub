const fs = require('fs');
const path = 'E:/OpenCode/bawakaraeng-hub/index.html';
let content = fs.readFileSync(path, 'utf8');

// Get current patterns
const iconMatches = content.match(/maps-btn-icon">[^<]+/g) || [];
console.log('Current icon patterns:');
iconMatches.forEach(m => console.log('  ', m));

// Replace all broken patterns
const patterns = [
  /maps-btn-icon">dY"/g,
  /maps-btn-icon">‽/g,
  /maps-btn-icon">dYZ_/g,
  /maps-btn-icon">dY'_/g,
  /maps-btn-icon">dY�_/g,
  /maps-btn-icon">dY-/g,
];
const emojis = ['📍', '⏺', '📌', '🎯', '💾', '🥾', '🧭'];

let emojiIdx = 0;
patterns.forEach(pattern => {
  content = content.replace(pattern, `maps-btn-icon">${emojis[emojiIdx] || '📍'}`);
  emojiIdx++;
});

// Also fix the legend title
content = content.replace(/maps-legend-title">[^<]+Keterangan Peta/, 'maps-legend-title">🗺️ Keterangan Peta');

fs.writeFileSync(path, content, 'utf8');
console.log('\nFixed!');
