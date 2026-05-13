using System.Diagnostics;
using System.Runtime.InteropServices;

const string appFolderName = "resources";
const string appExeName = "GitHub Deploy Tool Core.exe";

var baseDirectory = AppContext.BaseDirectory;
var appDirectory = Path.Combine(baseDirectory, appFolderName);
var appPath = Path.Combine(appDirectory, appExeName);

if (!File.Exists(appPath))
{
    ShowMessage(
        $"起動に必要なファイルが見つかりません。\n\n{appPath}",
        "GitHub Deploy Tool");
    return;
}

try
{
    var startInfo = new ProcessStartInfo
    {
        FileName = appPath,
        WorkingDirectory = appDirectory,
        UseShellExecute = false
    };

    foreach (var arg in args)
    {
        startInfo.ArgumentList.Add(arg);
    }

    Process.Start(startInfo);
}
catch (Exception ex)
{
    ShowMessage(
        $"アプリの起動に失敗しました。\n\n{ex.Message}",
        "GitHub Deploy Tool");
}

//-------------------------------------------------------------------------------
// エラー内容をメッセージボックスで表示する処理
//-------------------------------------------------------------------------------
static void ShowMessage(string message, string title)
{
    MessageBoxW(IntPtr.Zero, message, title, 0x00000010);
}

[DllImport("user32.dll", CharSet = CharSet.Unicode)]
static extern int MessageBoxW(IntPtr hWnd, string text, string caption, uint type);
