using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace DeepSeekPersonaSetup
{
    static class Program
    {
        [DllImport("user32.dll")]
        private static extern bool SetProcessDPIAware();

        public const string AppName = "DeepSeek Persona";
        public const string AppVersion = "__APP_VERSION__";
        public const string Publisher = "DeepSeek Persona";
        public const string UninstallRegPath = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\DeepSeekPersona";

        [STAThread]
        static int Main(string[] args)
        {
            try { SetProcessDPIAware(); } catch { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            bool silent = false;
            bool noLaunch = false;
            string customDir = null;

            foreach (string arg in args)
            {
                if (arg.Equals("/S", StringComparison.OrdinalIgnoreCase) || arg.Equals("--silent", StringComparison.OrdinalIgnoreCase))
                    silent = true;
                else if (arg.Equals("/NOLAUNCH", StringComparison.OrdinalIgnoreCase) || arg.Equals("--no-launch", StringComparison.OrdinalIgnoreCase))
                    noLaunch = true;
                else if (arg.StartsWith("/D=", StringComparison.OrdinalIgnoreCase))
                    customDir = arg.Substring(3).Trim().Trim('"');
            }

            string defaultDir = string.IsNullOrEmpty(customDir)
                ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DeepSeekPersona")
                : Path.GetFullPath(customDir);

            if (silent)
            {
                try
                {
                    InstallerEngine.Install(defaultDir, true, true, null);
                    if (!noLaunch)
                    {
                        InstallerEngine.LaunchApp(defaultDir);
                    }
                    return 0;
                }
                catch (Exception ex)
                {
                    Console.Error.WriteLine("Install failed: " + ex.Message);
                    return 1;
                }
            }

            Application.Run(new SetupForm(defaultDir, !noLaunch));
            return 0;
        }
    }

    static class InstallerEngine
    {
        public static void Install(
            string installDir,
            bool createDesktopShortcut,
            bool createStartMenuShortcut,
            Action<int, string> onProgress)
        {
            Report(onProgress, 2, "正在检查是否已有运行中的实例...");
            StopExistingProcesses(installDir);
            Thread.Sleep(300);

            Directory.CreateDirectory(installDir);

            Assembly asm = Assembly.GetExecutingAssembly();
            using (Stream payloadStream = asm.GetManifestResourceStream("payload.zip"))
            {
                if (payloadStream == null)
                    throw new InvalidOperationException("安装包内嵌资源 payload.zip 丢失。");

                using (ZipArchive archive = new ZipArchive(payloadStream, ZipArchiveMode.Read))
                {
                    int total = Math.Max(1, archive.Entries.Count);
                    int done = 0;
                    string fullRoot = Path.GetFullPath(installDir);
                    if (!fullRoot.EndsWith("\\")) fullRoot += "\\";

                    foreach (ZipArchiveEntry entry in archive.Entries)
                    {
                        done++;
                        string rel = entry.FullName.Replace('/', '\\').TrimStart('\\');
                        if (string.IsNullOrEmpty(rel)) continue;

                        string targetPath = Path.GetFullPath(Path.Combine(installDir, rel));
                        if (!targetPath.StartsWith(fullRoot, StringComparison.OrdinalIgnoreCase))
                            continue;

                        if (entry.FullName.EndsWith("/"))
                        {
                            Directory.CreateDirectory(targetPath);
                        }
                        else
                        {
                            Directory.CreateDirectory(Path.GetDirectoryName(targetPath));
                            entry.ExtractToFile(targetPath, true);
                        }

                        if (done == total || done % 6 == 0)
                        {
                            int pct = 5 + (int)(done * 82.0 / total);
                            Report(onProgress, pct, "正在解压应用与内置运行时 (" + done + "/" + total + ")...");
                        }
                    }
                }
            }

            string exePath = Path.Combine(installDir, "DeepSeekPersona.exe");
            string uninstallPath = Path.Combine(installDir, "Uninstall.exe");

            Report(onProgress, 90, "正在创建快捷方式...");
            if (createDesktopShortcut)
            {
                string desktopLink = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
                    Program.AppName + ".lnk"
                );
                CreateShortcut(desktopLink, exePath, installDir, "启动 DeepSeek Persona（内置免费模型池与本地记忆）");
            }

            if (createStartMenuShortcut)
            {
                string startFolder = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.Programs),
                    Program.AppName
                );
                Directory.CreateDirectory(startFolder);
                CreateShortcut(
                    Path.Combine(startFolder, Program.AppName + ".lnk"),
                    exePath,
                    installDir,
                    "启动 DeepSeek Persona"
                );
                CreateShortcut(
                    Path.Combine(startFolder, "卸载 " + Program.AppName + ".lnk"),
                    uninstallPath,
                    installDir,
                    "卸载 DeepSeek Persona"
                );
            }

            Report(onProgress, 96, "正在写入 Windows 应用注册信息...");
            RegisterUninstallEntry(installDir, exePath, uninstallPath);

            Report(onProgress, 100, "安装完成！点击按钮即可立即开始对话。");
        }

        public static void LaunchApp(string installDir)
        {
            string exePath = Path.Combine(installDir, "DeepSeekPersona.exe");
            if (File.Exists(exePath))
            {
                Process.Start(new ProcessStartInfo(exePath)
                {
                    WorkingDirectory = installDir,
                    UseShellExecute = true,
                });
            }
        }

        private static void Report(Action<int, string> onProgress, int pct, string text)
        {
            if (onProgress != null) onProgress(pct, text);
        }

        private static void StopExistingProcesses(string installDir)
        {
            string prefix = Path.GetFullPath(installDir).TrimEnd('\\') + "\\";
            foreach (Process p in Process.GetProcesses())
            {
                try
                {
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

        private static void CreateShortcut(string shortcutPath, string targetPath, string workingDir, string description)
        {
            try
            {
                Type shellType = Type.GetTypeFromProgID("WScript.Shell");
                if (shellType == null) return;
                object shell = Activator.CreateInstance(shellType);
                object shortcut = shellType.InvokeMember(
                    "CreateShortcut",
                    BindingFlags.InvokeMethod,
                    null,
                    shell,
                    new object[] { shortcutPath }
                );
                Type scType = shortcut.GetType();
                scType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { targetPath });
                scType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { workingDir });
                scType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { description });
                scType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { targetPath + ",0" });
                scType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
            }
            catch { }
        }

        private static void RegisterUninstallEntry(string installDir, string exePath, string uninstallPath)
        {
            try
            {
                long bytes = 0;
                foreach (string f in Directory.GetFiles(installDir, "*", SearchOption.AllDirectories))
                {
                    try { bytes += new FileInfo(f).Length; } catch { }
                }
                int kb = (int)(bytes / 1024);

                using (RegistryKey key = Registry.CurrentUser.CreateSubKey(Program.UninstallRegPath))
                {
                    if (key == null) return;
                    key.SetValue("DisplayName", Program.AppName);
                    key.SetValue("DisplayVersion", Program.AppVersion);
                    key.SetValue("Publisher", Program.Publisher);
                    key.SetValue("DisplayIcon", exePath);
                    key.SetValue("InstallLocation", installDir);
                    key.SetValue("UninstallString", "\"" + uninstallPath + "\"");
                    key.SetValue("QuietUninstallString", "\"" + uninstallPath + "\" /S");
                    key.SetValue("EstimatedSize", kb, RegistryValueKind.DWord);
                    key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                    key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                }
            }
            catch { }
        }
    }

    sealed class SetupForm : Form
    {
        private readonly TextBox _dirBox;
        private readonly Button _browseBtn;
        private readonly CheckBox _desktopChk;
        private readonly CheckBox _startMenuChk;
        private readonly CheckBox _launchChk;
        private readonly ProgressBar _progressBar;
        private readonly Label _statusLabel;
        private readonly Button _installBtn;
        private readonly Button _cancelBtn;

        private bool _installing;
        private bool _completed;

        public SetupForm(string defaultDir, bool launchAfter)
        {
            Text = Program.AppName + " 安装向导";
            ClientSize = new Size(540, 395);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(248, 249, 252);
            Font = new Font("Microsoft YaHei UI", 9.5f, FontStyle.Regular);

            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }

            // 顶部品牌横幅
            Panel header = new Panel
            {
                Dock = DockStyle.Top,
                Height = 104,
                BackColor = Color.FromArgb(20, 26, 40),
                Padding = new Padding(24, 20, 24, 16),
            };
            Label title = new Label
            {
                Text = Program.AppName + "  v" + Program.AppVersion,
                ForeColor = Color.White,
                Font = new Font("Microsoft YaHei UI", 16f, FontStyle.Bold),
                AutoSize = true,
                Location = new Point(24, 20),
            };
            Label subtitle = new Label
            {
                Text = "开箱即用 · 内置免费模型池 · 人格问卷 / 导入 · 本地记忆 · 自定义 LLM / 向量 / TTS 克隆",
                ForeColor = Color.FromArgb(174, 188, 214),
                Font = new Font("Microsoft YaHei UI", 8.8f, FontStyle.Regular),
                AutoSize = false,
                Size = new Size(492, 36),
                Location = new Point(25, 56),
            };
            header.Controls.Add(title);
            header.Controls.Add(subtitle);
            Controls.Add(header);

            // 主内容区
            Label infoLabel = new Label
            {
                Text = "无需安装 Node.js、无需管理员权限。安装完成后双击桌面图标即可直接使用。",
                ForeColor = Color.FromArgb(74, 85, 104),
                Location = new Point(24, 122),
                Size = new Size(492, 22),
            };
            Controls.Add(infoLabel);

            Label dirTitle = new Label
            {
                Text = "安装目录：",
                ForeColor = Color.FromArgb(30, 41, 59),
                Font = new Font("Microsoft YaHei UI", 9.5f, FontStyle.Bold),
                Location = new Point(24, 154),
                AutoSize = true,
            };
            Controls.Add(dirTitle);

            _dirBox = new TextBox
            {
                Text = defaultDir,
                Location = new Point(24, 178),
                Size = new Size(406, 26),
            };
            Controls.Add(_dirBox);

            _browseBtn = new Button
            {
                Text = "浏览...",
                Location = new Point(438, 176),
                Size = new Size(78, 29),
                FlatStyle = FlatStyle.System,
            };
            _browseBtn.Click += (s, e) => PickDirectory();
            Controls.Add(_browseBtn);

            _desktopChk = new CheckBox
            {
                Text = "创建桌面快捷方式",
                Checked = true,
                Location = new Point(24, 218),
                AutoSize = true,
            };
            _startMenuChk = new CheckBox
            {
                Text = "创建开始菜单快捷方式",
                Checked = true,
                Location = new Point(195, 218),
                AutoSize = true,
            };
            _launchChk = new CheckBox
            {
                Text = "安装完成后立即启动 DeepSeek Persona",
                Checked = launchAfter,
                Location = new Point(24, 248),
                AutoSize = true,
            };
            Controls.Add(_desktopChk);
            Controls.Add(_startMenuChk);
            Controls.Add(_launchChk);

            _progressBar = new ProgressBar
            {
                Location = new Point(24, 290),
                Size = new Size(492, 18),
                Minimum = 0,
                Maximum = 100,
                Value = 0,
                Style = ProgressBarStyle.Continuous,
            };
            Controls.Add(_progressBar);

            _statusLabel = new Label
            {
                Text = "准备就绪，点击「一键安装」开始部署。",
                ForeColor = Color.FromArgb(100, 116, 139),
                Location = new Point(24, 314),
                Size = new Size(492, 20),
            };
            Controls.Add(_statusLabel);

            _cancelBtn = new Button
            {
                Text = "取消",
                Location = new Point(320, 346),
                Size = new Size(88, 32),
                FlatStyle = FlatStyle.System,
            };
            _cancelBtn.Click += (s, e) => Close();
            Controls.Add(_cancelBtn);

            _installBtn = new Button
            {
                Text = "一键安装",
                Location = new Point(416, 346),
                Size = new Size(100, 32),
                BackColor = Color.FromArgb(77, 107, 254),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat,
                Font = new Font("Microsoft YaHei UI", 9.5f, FontStyle.Bold),
            };
            _installBtn.FlatAppearance.BorderSize = 0;
            _installBtn.Click += (s, e) => OnInstallClick();
            Controls.Add(_installBtn);
            AcceptButton = _installBtn;
        }

        private void PickDirectory()
        {
            using (FolderBrowserDialog dlg = new FolderBrowserDialog())
            {
                dlg.Description = "请选择 DeepSeek Persona 的安装目录";
                dlg.SelectedPath = _dirBox.Text;
                if (dlg.ShowDialog(this) == DialogResult.OK && !string.IsNullOrEmpty(dlg.SelectedPath))
                {
                    string selected = dlg.SelectedPath;
                    if (!selected.EndsWith("DeepSeekPersona", StringComparison.OrdinalIgnoreCase))
                        selected = Path.Combine(selected, "DeepSeekPersona");
                    _dirBox.Text = selected;
                }
            }
        }

        private void OnInstallClick()
        {
            if (_completed)
            {
                if (_launchChk.Checked)
                    InstallerEngine.LaunchApp(_dirBox.Text.Trim());
                Close();
                return;
            }
            if (_installing) return;

            string dir = _dirBox.Text.Trim();
            if (string.IsNullOrEmpty(dir))
            {
                MessageBox.Show(this, "请填写有效的安装目录。", Program.AppName, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            _installing = true;
            _dirBox.Enabled = false;
            _browseBtn.Enabled = false;
            _desktopChk.Enabled = false;
            _startMenuChk.Enabled = false;
            _installBtn.Enabled = false;
            _cancelBtn.Enabled = false;

            bool desktop = _desktopChk.Checked;
            bool startMenu = _startMenuChk.Checked;

            ThreadPool.QueueUserWorkItem(_ =>
            {
                try
                {
                    InstallerEngine.Install(dir, desktop, startMenu, (pct, msg) =>
                    {
                        if (!IsDisposed)
                        {
                            BeginInvoke((Action)(() =>
                            {
                                _progressBar.Value = Math.Min(100, Math.Max(0, pct));
                                _statusLabel.Text = msg;
                            }));
                        }
                    });

                    if (!IsDisposed)
                    {
                        BeginInvoke((Action)(() =>
                        {
                            _installing = false;
                            _completed = true;
                            _installBtn.Enabled = true;
                            _installBtn.Text = _launchChk.Checked ? "完成并启动" : "完成";
                            _cancelBtn.Enabled = false;
                            if (_launchChk.Checked)
                            {
                                InstallerEngine.LaunchApp(dir);
                                Close();
                            }
                        }));
                    }
                }
                catch (Exception ex)
                {
                    if (!IsDisposed)
                    {
                        BeginInvoke((Action)(() =>
                        {
                            _installing = false;
                            _dirBox.Enabled = true;
                            _browseBtn.Enabled = true;
                            _desktopChk.Enabled = true;
                            _startMenuChk.Enabled = true;
                            _installBtn.Enabled = true;
                            _cancelBtn.Enabled = true;
                            _statusLabel.Text = "安装失败：" + ex.Message;
                            MessageBox.Show(this, "安装失败：\n" + ex.Message, Program.AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
                        }));
                    }
                }
            });
        }
    }
}
