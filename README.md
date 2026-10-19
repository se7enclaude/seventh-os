# Seventh OS

Toutes les applis se7en au même endroit : chaque appli a sa fiche, et les boutons **Installer**, **Ouvrir**,
**Mettre à jour** et **Désinstaller**.

| Appli | Dépôt | Type |
|---|---|---|
| se7en IA (se7en studio) | `se7en-ia-agent-after-effect` (privé) | installateur Inno Setup |
| se7en Download | `se7en-download` | installateur Inno Setup |
| se7en Clip | `se7en-clip` | installateur Inno Setup |
| se7en DualSense | `se7en-dualsense` | un seul `.exe`, copié dans `%LOCALAPPDATA%\Programs\se7en DualSense` |
| se7en Voice | `se7en-voice` | un seul `.exe`, copié dans `%LOCALAPPDATA%\Programs\se7en Voice` |

## Pour tes amis

1. Lancer `SeventhOS-Setup-<version>.exe`, depuis la dernière release de ce dépôt.
2. Entrer le code d'accès. Il n'est demandé qu'une fois et débloque aussi les applis privées.
3. Installer les applis voulues. Ensuite, Seventh OS propose leurs mises à jour et les siennes.

## Ajouter une appli

Ajouter une entrée dans `apps.json`, mettre son icône dans `ui/icons/<id>.png`, puis pousser sur `main`. Pas besoin de
republier le hub : il relit la liste à chaque lancement.

Champs de chaque entrée :
- `id`, `name`, `subtitle`, `tagline`, `description[]`, `features[]`, `requires`, `keeps` ;
- `repo`, `private` ;
- `kind` : `inno` ou `portable` ;
- pour `inno` :
  - `manifest` et `manifestKey` : le fichier `latest.json` de la release, et la clé de l'installateur dedans ;
  - `uninstallKey` : la clé `{AppId}_is1` d'Inno Setup ;
  - `exe` ;
- pour `portable` :
  - `asset` : le nom du `.exe` dans la release ; l'empreinte se lit dans les notes, sous la forme « SHA-256 : … » ;
  - `installDir`, `exe`, `shortcuts`.
  - `replaces` (si l'appli change de nom) : la liste de ses anciens emplacements `{ name, installDir, exe }`. Une ancienne installation est reconnue, la mise à jour installe sous le nouveau nom et met l'ancienne à la Corbeille.

## Développement

```
node tools/extract-electron.js      Electron 44.5.1 depuis le cache du PC -> .electron
node tools/run.js [--dev]           lancer (--dev : sans code d'accès)
python tools/make_icons.py          icône du hub ; --app <id> <fichier.ico> : icône d'une appli
node tools/build.js                 -> dist/release/SeventhOS-Setup-<version>.exe
node tools/release.js publish "…"   release v<version> : installateur + latest.json
```

L'accès est le même que pour se7en studio : `data/access.json` contient la clé GitHub en lecture seule, **chiffrée** avec
le code d'accès (AES-256-GCM, PBKDF2). Une fois débloquée, elle est protégée par Windows (DPAPI) dans
`%APPDATA%\Seventh OS\licence.json`.
