; Seventh OS — installateur Windows (Inno Setup 6), construit par tools/build.js.
;
;   ISCC /DAppVersion=1.0.0 /DStage=<dist\build> installer.iss   ->  SeventhOS-Setup-1.0.0.exe
;
; Pour l'utilisateur courant (pas de droits administrateur) : %LOCALAPPDATA%\Programs\Seventh OS, raccourcis Bureau
; et menu Démarrer. Le même .exe sert de mise à jour (lancé en silencieux par le hub, /RELAUNCH=1 le rouvre).
; Données gardées à la désinstallation : %APPDATA%\Seventh OS (licence, liste des applis). Les applis installées
; depuis le hub restent installées (chacune a sa propre désinstallation).

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef Stage
  #define Stage "dist\build"
#endif
#define AppName "Seventh OS"
#define AppExe "Seventh OS.exe"

[Setup]
AppId={{0702F1B3-F7A6-4657-B8CB-142BF56B139D}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=se7en
VersionInfoVersion={#AppVersion}
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=lowest
OutputBaseFilename=SeventhOS-Setup-{#AppVersion}
SetupIconFile=build\icon.ico
UninstallDisplayIcon={app}\resources\app\build\icon.ico
UninstallDisplayName={#AppName}
WizardStyle=modern
WizardImageFile=build\wizard-large.bmp
WizardSmallImageFile=build\wizard-small.bmp
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
CloseApplications=yes
RestartApplications=no
Compression=lzma2/max
SolidCompression=yes

[Languages]
Name: "fr"; MessagesFile: "compiler:Languages\French.isl"

[CustomMessages]
fr.Launch=Ouvrir Seventh OS

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[InstallDelete]
; le hub est remplacé en entier (pas de vieux fichiers après une mise à jour)
Type: filesandordirs; Name: "{app}\resources\app"

[Files]
Source: "{#Stage}\app\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"; IconFilename: "{app}\resources\app\build\icon.ico"
Name: "{group}\{cm:UninstallProgram,{#AppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; IconFilename: "{app}\resources\app\build\icon.ico"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:Launch}"; Flags: nowait postinstall skipifsilent
Filename: "{app}\{#AppExe}"; Flags: nowait; Check: ShouldRelaunch

[UninstallDelete]
Type: filesandordirs; Name: "{app}"

[Code]
function ShouldRelaunch(): Boolean;
begin
  Result := ExpandConstant('{param:RELAUNCH|0}') = '1';
end;
