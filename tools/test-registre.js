// Test autonome : lecture du registre (Désinstallation) avec accents. node tools/test-registre.js
//  1) analyse de la sortie de reg.exe (chemin « Zoé ») ;
//  2) sur ce PC : les valeurs lues par regValues (reg.exe en UTF-8) = celles lues par PowerShell (Unicode),
//     pour les clés Uninstall de HKCU qui contiennent des accents (s'il y en a) et pour une clé sans accent.
// Ne modifie rien (lecture seule).
'use strict';
const assert = require('assert');
const cp = require('child_process');
const O = require('../ui/lib/apps.js');

let fails = 0;
async function t(name, fn) {
  try { await fn(); console.log('ok   ' + name); } catch (e) { fails++; console.log('ÉCHEC ' + name + '\n     ' + e.message); }
}

const sample = [
  '',
  'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\{ABC}_is1',
  '    InstallLocation    REG_SZ    C:\\Users\\Zoé\\AppData\\Local\\Programs\\se7en Clip\\',
  '    DisplayVersion    REG_SZ    0.5.2',
  '    UninstallString    REG_SZ    "C:\\Users\\Zoé\\AppData\\Local\\Programs\\se7en Clip\\unins000.exe"',
  '    NoModify    REG_DWORD    0x1',
  '',
].join('\r\n');

// PowerShell : valeurs texte d'une liste de clés, en JSON UTF-8 (la référence)
function psValues(script) {
  const r = cp.spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8; ' + script], { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  if (r.status !== 0) throw new Error('PowerShell : ' + r.stderr);
  const j = JSON.parse(r.stdout || '[]');
  return Array.isArray(j) ? j : [j];
}
const LIST = (filter) => '$out = @(); foreach ($k in ' + filter + ') { $v = @{}; foreach ($n in $k.GetValueNames()) { $x = $k.GetValue($n, $null, "DoNotExpandEnvironmentNames"); if ($n -and $x -is [string]) { $v[$n] = $x.Trim() } }; $out += @{ key = $k.Name; values = $v } }; ConvertTo-Json -InputObject $out -Depth 4 -Compress';

async function compare(list) {
  for (const { key, values } of list) {
    const got = await O.regValues(key.replace(/^HKEY_CURRENT_USER/, 'HKCU'));
    assert(got, 'clé non lue : ' + key);
    for (const [n, v] of Object.entries(values)) {
      if (/\s/.test(n) || /[\r\n]/.test(v)) continue; // hors du format lu (noms sans espace, une ligne)
      assert.strictEqual(got[n], v, key + ' › ' + n);
    }
  }
}

(async () => {
  await t('analyse : chemin avec accents intact', () => {
    const v = O.parseReg(sample);
    assert.strictEqual(v.InstallLocation, 'C:\\Users\\Zoé\\AppData\\Local\\Programs\\se7en Clip\\');
    assert.strictEqual(v.DisplayVersion, '0.5.2');
    assert.strictEqual(v.UninstallString, '"C:\\Users\\Zoé\\AppData\\Local\\Programs\\se7en Clip\\unins000.exe"');
    assert.strictEqual(v.NoModify, '0x1');
  });
  await t('clé absente -> null', async () => {
    assert.strictEqual(await O.regValues('HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\seventh-os-test-cle-absente'), null);
  });
  await t('clé sans accent : même lecture que PowerShell', async () => {
    await compare(psValues(LIST('@(Get-Item "HKCU:\\Control Panel\\Desktop")')));
  });
  await t('clés Uninstall avec accents : même lecture que PowerShell', async () => {
    const list = psValues(LIST('@(Get-ChildItem "HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall" | Where-Object { $k = $_; @($k.GetValueNames() | Where-Object { "$($k.GetValue($_))" -match "[^\\x00-\\x7F]" }).Count -gt 0 })'));
    if (!list.length) { console.log('     (aucune clé avec accents sur ce PC : vérifié seulement par l\'analyse)'); return; }
    await compare(list);
    console.log('     ' + list.length + ' clé(s) avec accents comparée(s)');
  });
  console.log(fails ? fails + ' échec(s)' : 'tout est bon');
  process.exit(fails ? 1 : 0);
})();
