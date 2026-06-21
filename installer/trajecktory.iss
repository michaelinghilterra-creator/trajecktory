; trajecktory.iss — Inno Setup script for the trajecktory Windows installer.
;
; Compile with the Inno Setup Compiler (iscc.exe) AFTER running build-bundle.ps1,
; which stages .\payload. Produces Output\TrajecktorySetup.exe.
;
;   "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\trajecktory.iss
;
; UNTESTED: authored without a build machine. Compile + clean-VM test before use.
; TODO before shipping: decide code signing (an unsigned .exe shows a SmartScreen
; "unknown publisher" warning). App icon is wired below (assets\trajecktory.ico).

#define AppName "trajecktory"
#define AppVersion "1.7.12"
#define AppPublisher "trajecktory"

[Setup]
; Stable AppId so a newer version installs OVER the existing one (in-place upgrade)
; that preserves the user's data, rather than a second copy. NEVER change this GUID.
AppId={{7A3F1E2C-8B4D-4E9A-AF12-3C5D7E9B1A04}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
; Per-user install in the user's home folder (C:\Users\<you>\trajecktory): easy to
; find, no admin prompt, and the app dir stays writable so onboarding can create
; data/ and reports/ in place.
DefaultDirName={%USERPROFILE}\{#AppName}
DefaultGroupName={#AppName}
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
OutputBaseFilename=trajecktory-setup-v{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile=assets\trajecktory.ico
; SignTool=signtool $f                            ; configure if code-signing

[Files]
; The staged offline payload: portable Node, the trajecktory tree with installed
; node_modules + Claude Code + bundled Chromium.
Source: "payload\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs
; The launcher scripts (sit alongside node\ and trajecktory\ under {app}).
Source: "launch-trajecktory.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "stop-trajecktory.ps1";   DestDir: "{app}"; Flags: ignoreversion
; App icon for the shortcuts (so they show the trajecktory mark, not PowerShell's).
Source: "assets\trajecktory.ico"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\launch-trajecktory.ps1"""; \
  WorkingDir: "{app}"; IconFilename: "{app}\trajecktory.ico"
Name: "{group}\Stop {#AppName}"; Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\stop-trajecktory.ps1"""; \
  WorkingDir: "{app}"; IconFilename: "{app}\trajecktory.ico"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\launch-trajecktory.ps1"""; \
  WorkingDir: "{app}"; Tasks: desktopicon; IconFilename: "{app}\trajecktory.ico"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"

[Run]
Filename: "powershell.exe"; \
  Parameters: "-ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\launch-trajecktory.ps1"""; \
  Description: "Launch {#AppName} now"; Flags: postinstall nowait skipifsilent

[Code]
var
  ApiKeyPage: TInputQueryWizardPage;

procedure InitializeWizard;
begin
  ApiKeyPage := CreateInputQueryPage(wpSelectDir,
    'Anthropic API key (optional)',
    'Used only for tailored resumes, cover letters, and outreach drafts.',
    'Evaluate and Scan run on your own Claude sign-in and need no key.' + #13#10 +
    'To also generate resumes / cover letters / outreach, paste your Anthropic API key' + #13#10 +
    '(starts with sk-ant-). You can leave this blank and add it later in the dashboard.');
  ApiKeyPage.Add('Anthropic API key:', False);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var
  key: String;
begin
  Result := True;
  if CurPageID = ApiKeyPage.ID then
  begin
    key := Trim(ApiKeyPage.Values[0]);
    // Allow blank ("add later"); only nudge if a non-key string was pasted.
    if (key <> '') and (Pos('sk-ant-', key) <> 1) then
      Result := (MsgBox('That does not look like an Anthropic key (they start with "sk-ant-"). Continue anyway?',
        mbConfirmation, MB_YESNO) = IDYES);
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  envPath, key: String;
begin
  if CurStep = ssPostInstall then
  begin
    key := Trim(ApiKeyPage.Values[0]);
    if key <> '' then
    begin
      envPath := ExpandConstant('{app}\trajecktory\dashboard-web\.env');
      SaveStringToFile(envPath, 'ANTHROPIC_API_KEY=' + key + #13#10, False);
    end;
  end;
end;

// On uninstall, offer to keep the user's job-search data (created after install).
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  dataDir: String;
begin
  if CurUninstallStep = usUninstall then
  begin
    dataDir := ExpandConstant('{app}\trajecktory\data');
    if DirExists(dataDir) then
      if MsgBox('Delete your job-search data (tracker, reports, config) too? Choose No to keep it.',
        mbConfirmation, MB_YESNO) = IDYES then
        DelTree(ExpandConstant('{app}\trajecktory'), True, True, True);
  end;
end;
