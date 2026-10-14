// Lance Seventh OS depuis les sources (développement) : node tools/run.js [--dev] [--shot fichier.png]
//   --dev  : sans code d'accès (les applis des dépôts privés restent verrouillées)
//   --shot : capture de la fenêtre après chargement, puis fermeture (vérifications)
const cp = require('child_process');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const env = Object.assign({}, process.env);
if (process.argv.includes('--dev')) env.OS_DEV = '1';
const i = process.argv.indexOf('--shot');
if (i > 0) env.OS_SHOT = path.resolve(process.argv[i + 1]);
const j = process.argv.indexOf('--sheet');
if (j > 0) env.OS_SHEET = process.argv[j + 1];
cp.spawn(path.join(ROOT, '.electron', 'electron.exe'), [ROOT], { stdio: 'inherit', env }).on('exit', c => process.exit(c || 0));
