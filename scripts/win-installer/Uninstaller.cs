using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace DeepSeekPersonaUninstaller
{
    static class Program
    {
        private const string UninstallRegPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\DeepSeekPersona";

        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool silent = false;
            bool removeUserData = false;
            foreach (string arg in args)
            {
                if (arg.Equals("/S", StringComparison.OrdinalIgnoreCase) || arg.Equals("--silent", StringComparison.OrdinalIgnoreCase))
                    silent = true;
                if (arg.Equals("--purge-data", StringComparison.OrdinalIgnoreCase))
                    removeUserData = true;
            }

            string installDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            string userDataDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "DeepSeekPersona"
            );

            if (!silent)
            {
                DialogResult confirm = MessageBox.Show(
                    "确定要卸载 DeepSeek Persona 吗？\n\n安装位置：" + installDir,
                    "卸载 DeepSeek Persona",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question
                );
                if (confirm != DialogResult.Yes) return;

                DialogResult dataConfirm = MessageBox.Show(
                    "是否同时删除本地免费模型配置与日志（" + userDataDir + "）？\n\n选择「否」将保留个人配置，便于日后重装继续使用。",
                    "清理本地数据",
                    MessageBoxButtons.YesNo,
                    MessageBoxIcon.Question,
                    MessageBoxDefaultButton.Button2
                );
                removeUserData = (dataConfirm == DialogResult.Yes);
            }

            StopProcessesUnder(installDir);
            Thread.Sleep(500);

            // 删除快捷方式
            try
            {
                string desktopLink = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                    "DeepSeek Persona.lnk"
                );
                if (File.Exists(desktopLink)) File.Delete(desktopLink);
            }
            catch { }

            try
            {
                string startMenuDir = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.Programs),
                    "DeepSeek Persona"
                );
                if (Directory.Exists(startMenuDir)) Directory.Delete(startMenuDir, true);
            }
            catch { }

            // 清理注册表卸载项
            try
            {
                Registry.CurrentUser.DeleteSubKeyTree(UninstallRegPath, false);
            }
            catch { }

            // 清理安装目录下的所有子目录与文件（除自身外）
            string selfPath = Process.GetCurrentProcess().MainModule.FileName;
            CleanDirectoryExcept(installDir, selfPath);

            if (removeUserData && !string.Equals(installDir, userDataDir, StringComparison.OrdinalIgnoreCase))
            {
                try
                {
                    if (Directory.Exists(userDataDir)) Directory.Delete(userDataDir, true);
                }
                catch { }
            }

            // 延迟自删除自身与安装目录
            try
            {
                string cmdArgs = "/c ping 127.0.0.1 -n 2 >nul & del /f /q \"" + selfPath + "\" & rmdir /s /q \"" + installDir + "\"";
                if (removeUserData && string.Equals(installDir, userDataDir, StringComparison.OrdinalIgnoreCase))
                {
                    cmdArgs = "/c ping 127.0.0.1 -n 2 >nul & rmdir /s /q \"" + installDir + "\"";
                }
                Process.Start(new ProcessStartInfo("cmd.exe", cmdArgs)
                {
                    CreateNoWindow = true,
                    UseShellExecute = false,
                    WindowStyle = ProcessWindowStyle.Hidden,
                });
            }
            catch { }

            if (!silent)
            {
                MessageBox.Show(
                    "DeepSeek Persona 已成功卸载。",
                    "卸载完成",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );
            }
        }

        private static void StopProcessesUnder(string installDir)
        {
            int selfPid = Process.GetCurrentProcess().Id;
            string prefix = installDir.TrimEnd('\\') + "\\";
            foreach (Process p in Process.GetProcesses())
            {
                try
                {
                    if (p.Id == selfPid) continue;
                    string path = p.MainModule.FileName;
                    if (!string.IsNullOrEmpty(path) && path.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                    {
                        p.Kill();
                        p.WaitForExit(2000);
                    }
                }
                catch { }
                finally
                {
                    try { p.Dispose(); } catch { }
                }
            }
        }

        private static void CleanDirectoryExcept(string dir, string exceptFile)
        {
            if (!Directory.Exists(dir)) return;
            foreach (string file in Directory.GetFiles(dir))
            {
                if (string.Equals(file, exceptFile, StringComparison.OrdinalIgnoreCase)) continue;
                try { File.Delete(file); } catch { }
            }
            foreach (string sub in Directory.GetDirectories(dir))
            {
                // 若数据目录就在安装目录内且不删除数据，保留 ofm-data
                string name = Path.GetFileName(sub);
                if (name.Equals("ofm-data", StringComparison.OrdinalIgnoreCase)) continue;
                try { Directory.Delete(sub, true); } catch { }
            }
        }
    }
}
