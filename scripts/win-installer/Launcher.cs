using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace DeepSeekPersonaLauncher
{
    static class Program
    {
        [STAThread]
        static void Main(string[] args)
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string dataDir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "DeepSeekPersona"
            );
            int preferredPort = 8090;
            bool openBrowser = true;

            for (int i = 0; i < args.Length; i++)
            {
                string arg = args[i];
                if (arg.Equals("--no-browser", StringComparison.OrdinalIgnoreCase))
                {
                    openBrowser = false;
                }
                else if (arg.Equals("--port", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
                {
                    int parsed;
                    if (int.TryParse(args[++i], out parsed) && parsed > 0 && parsed < 65535)
                        preferredPort = parsed;
                }
                else if (arg.Equals("--data-dir", StringComparison.OrdinalIgnoreCase) && i + 1 < args.Length)
                {
                    dataDir = Path.GetFullPath(args[++i]);
                }
            }

            Directory.CreateDirectory(dataDir);
            string mutexName = "Local\\DeepSeekPersona_" + ComputeShortHash(dataDir.ToLowerInvariant());
            bool createdNew;
            using (Mutex mutex = new Mutex(true, mutexName, out createdNew))
            {
                if (!createdNew)
                {
                    string existingUrl = ReadRuntimeUrl(Path.Combine(dataDir, "runtime.json"));
                    if (string.IsNullOrEmpty(existingUrl))
                        existingUrl = "http://127.0.0.1:" + preferredPort + "/";
                    if (openBrowser)
                        OpenUrl(existingUrl);
                    return;
                }

                using (TrayAppContext ctx = new TrayAppContext(baseDir, dataDir, preferredPort, openBrowser))
                {
                    Application.Run(ctx);
                }
            }
        }

        internal static string ComputeShortHash(string input)
        {
            using (SHA256 sha = SHA256.Create())
            {
                byte[] bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(input));
                StringBuilder sb = new StringBuilder(16);
                for (int i = 0; i < 8; i++) sb.Append(bytes[i].ToString("x2"));
                return sb.ToString();
            }
        }

        internal static string ReadJsonField(string json, string key)
        {
            if (string.IsNullOrEmpty(json)) return "";
            Match m = Regex.Match(json, "\"" + Regex.Escape(key) + "\"\\s*:\\s*\"([^\"]*)\"");
            return m.Success ? m.Groups[1].Value : "";
        }

        internal static int ReadJsonInt(string json, string key)
        {
            if (string.IsNullOrEmpty(json)) return 0;
            Match m = Regex.Match(json, "\"" + Regex.Escape(key) + "\"\\s*:\\s*(\\d+)");
            int val;
            return m.Success && int.TryParse(m.Groups[1].Value, out val) ? val : 0;
        }

        internal static string ReadRuntimeUrl(string runtimeFile)
        {
            try
            {
                if (!File.Exists(runtimeFile)) return "";
                string text = File.ReadAllText(runtimeFile, Encoding.UTF8);
                return ReadJsonField(text, "url");
            }
            catch { return ""; }
        }

        internal static void OpenUrl(string url)
        {
            if (string.IsNullOrEmpty(url)) return;
            try
            {
                Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
            }
            catch { }
        }
    }

    sealed class TrayAppContext : ApplicationContext
    {
        private readonly string _baseDir;
        private readonly string _dataDir;
        private readonly string _logFile;
        private readonly string _runtimeFile;
        private readonly int _preferredPort;
        private readonly bool _openBrowserOnReady;
        private readonly NotifyIcon _trayIcon;
        private readonly ToolStripMenuItem _openItem;
        private readonly ToolStripMenuItem _ofmItem;
        private readonly object _sync = new object();

        private Process _nodeProcess;
        private string _shutdownToken;
        private string _appUrl = "";
        private string _managementUrl = "";
        private bool _exiting;

        public TrayAppContext(string baseDir, string dataDir, int preferredPort, bool openBrowserOnReady)
        {
            _baseDir = baseDir;
            _dataDir = dataDir;
            _preferredPort = preferredPort;
            _openBrowserOnReady = openBrowserOnReady;
            _runtimeFile = Path.Combine(dataDir, "runtime.json");
            string logDir = Path.Combine(dataDir, "logs");
            Directory.CreateDirectory(logDir);
            _logFile = Path.Combine(logDir, "app.log");

            Icon appIcon = null;
            try { appIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
            if (appIcon == null) appIcon = SystemIcons.Application;

            ContextMenuStrip menu = new ContextMenuStrip();
            _openItem = new ToolStripMenuItem("打开 DeepSeek Persona", null, (s, e) => OpenApp());
            _openItem.Font = new Font(_openItem.Font, FontStyle.Bold);
            _ofmItem = new ToolStripMenuItem("打开免费模型控制台 (OurFreeModel)", null, (s, e) => OpenOfmConsole());
            ToolStripMenuItem restartItem = new ToolStripMenuItem("重启后台服务", null, (s, e) => RestartService());
            ToolStripMenuItem logItem = new ToolStripMenuItem("查看运行日志", null, (s, e) => OpenLogs());
            ToolStripMenuItem exitItem = new ToolStripMenuItem("退出 DeepSeek Persona", null, (s, e) => ExitGracefully());

            menu.Items.Add(_openItem);
            menu.Items.Add(_ofmItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(restartItem);
            menu.Items.Add(logItem);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(exitItem);

            _trayIcon = new NotifyIcon
            {
                Icon = appIcon,
                Text = "DeepSeek Persona（启动中...）",
                ContextMenuStrip = menu,
                Visible = true,
            };
            _trayIcon.DoubleClick += (s, e) => OpenApp();
            _trayIcon.MouseClick += (s, e) =>
            {
                if (e.Button == MouseButtons.Left) OpenApp();
            };

            SystemEvents.SessionEnding += OnSessionEnding;
            StartServiceAsync(_openBrowserOnReady);
        }

        private void OnSessionEnding(object sender, SessionEndingEventArgs e)
        {
            StopNodeProcess();
        }

        private void AppendLog(string line)
        {
            try
            {
                lock (_sync)
                {
                    File.AppendAllText(
                        _logFile,
                        "[" + DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "] " + line + Environment.NewLine,
                        Encoding.UTF8
                    );
                }
            }
            catch { }
        }

        private void StartServiceAsync(bool openBrowser)
        {
            ThreadPool.QueueUserWorkItem(_ => StartServiceWorker(openBrowser));
        }

        private void StartServiceWorker(bool openBrowser)
        {
            string nodeExe = Path.Combine(_baseDir, "runtime", "node.exe");
            string scriptPath = Path.Combine(_baseDir, "app", "scripts", "start-app.mjs");

            if (!File.Exists(nodeExe) || !File.Exists(scriptPath))
            {
                AppendLog("ERROR: Missing runtime or app files: " + nodeExe + " / " + scriptPath);
                MessageBox.Show(
                    "未找到内置运行环境文件，请重新运行 DeepSeek Persona 安装程序进行修复。",
                    "DeepSeek Persona",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                ExitGracefully();
                return;
            }

            try
            {
                if (File.Exists(_runtimeFile)) File.Delete(_runtimeFile);
            }
            catch { }

            _shutdownToken = Guid.NewGuid().ToString("N");
            string ofmDataDir = Path.Combine(_dataDir, "ofm-data");
            Directory.CreateDirectory(ofmDataDir);

            ProcessStartInfo psi = new ProcessStartInfo
            {
                FileName = nodeExe,
                Arguments = "\"" + scriptPath + "\"",
                WorkingDirectory = Path.Combine(_baseDir, "app"),
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };
            psi.EnvironmentVariables["PORT"] = _preferredPort.ToString();
            psi.EnvironmentVariables["OFM_DATA_DIR"] = ofmDataDir;
            psi.EnvironmentVariables["APP_SHUTDOWN_TOKEN"] = _shutdownToken;
            psi.EnvironmentVariables["APP_RUNTIME_INFO_FILE"] = _runtimeFile;
            psi.EnvironmentVariables["NODE_ENV"] = "production";

            Process proc = new Process { StartInfo = psi, EnableRaisingEvents = true };
            proc.OutputDataReceived += (s, e) =>
            {
                if (!string.IsNullOrEmpty(e.Data)) AppendLog(e.Data);
            };
            proc.ErrorDataReceived += (s, e) =>
            {
                if (!string.IsNullOrEmpty(e.Data)) AppendLog("[STDERR] " + e.Data);
            };

            try
            {
                proc.Start();
                proc.BeginOutputReadLine();
                proc.BeginErrorReadLine();
            }
            catch (Exception ex)
            {
                AppendLog("ERROR starting node: " + ex.Message);
                MessageBox.Show(
                    "启动后台服务失败：" + ex.Message,
                    "DeepSeek Persona",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                ExitGracefully();
                return;
            }

            lock (_sync)
            {
                _nodeProcess = proc;
            }

            // 等待服务就绪（最多 25 秒）
            DateTime deadline = DateTime.UtcNow.AddSeconds(25);
            string readyUrl = "";
            string mgmtUrl = "";

            while (DateTime.UtcNow < deadline && !_exiting)
            {
                if (proc.HasExited)
                {
                    AppendLog("ERROR: Node process exited unexpectedly with code " + proc.ExitCode);
                    break;
                }

                try
                {
                    if (File.Exists(_runtimeFile))
                    {
                        string content = File.ReadAllText(_runtimeFile, Encoding.UTF8);
                        string url = Program.ReadJsonField(content, "url");
                        if (!string.IsNullOrEmpty(url))
                        {
                            string infoJson = FetchText(url.TrimEnd('/') + "/__app/info", 2000);
                            if (!string.IsNullOrEmpty(infoJson) && infoJson.Contains("\"ok\":true"))
                            {
                                readyUrl = url;
                                mgmtUrl = Program.ReadJsonField(infoJson, "managementUrl");
                                break;
                            }
                        }
                    }
                }
                catch { }

                Thread.Sleep(250);
            }

            if (_exiting) return;

            if (string.IsNullOrEmpty(readyUrl))
            {
                AppendLog("ERROR: Timed out waiting for DeepSeek Persona server.");
                MessageBox.Show(
                    "后台服务启动超时，请点击托盘「查看运行日志」排查原因。",
                    "DeepSeek Persona",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Warning
                );
                return;
            }

            _appUrl = readyUrl;
            _managementUrl = mgmtUrl;
            string portLabel = readyUrl.Replace("http://127.0.0.1:", "").TrimEnd('/');
            _trayIcon.Text = "DeepSeek Persona（运行中 :" + portLabel + "）";

            if (openBrowser)
            {
                Program.OpenUrl(_appUrl);
                try
                {
                    _trayIcon.ShowBalloonTip(
                        2800,
                        "DeepSeek Persona 已启动",
                        "已在浏览器打开对话界面，点击托盘图标可随时切回或退出。",
                        ToolTipIcon.Info
                    );
                }
                catch { }
            }
        }

        private string FetchText(string url, int timeoutMs)
        {
            try
            {
                HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url);
                req.Method = "GET";
                req.Timeout = timeoutMs;
                req.ReadWriteTimeout = timeoutMs;
                req.Proxy = null;
                using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                using (Stream stream = resp.GetResponseStream())
                using (StreamReader reader = new StreamReader(stream, Encoding.UTF8))
                {
                    return reader.ReadToEnd();
                }
            }
            catch { return ""; }
        }

        private void OpenApp()
        {
            if (!string.IsNullOrEmpty(_appUrl))
                Program.OpenUrl(_appUrl);
        }

        private void OpenOfmConsole()
        {
            string url = _managementUrl;
            if (string.IsNullOrEmpty(url) && !string.IsNullOrEmpty(_appUrl))
            {
                string status = FetchText(_appUrl.TrimEnd('/') + "/__ofm/status", 2000);
                url = Program.ReadJsonField(status, "managementUrl");
                if (!string.IsNullOrEmpty(url)) _managementUrl = url;
            }
            if (!string.IsNullOrEmpty(url))
            {
                Program.OpenUrl(url);
            }
            else
            {
                MessageBox.Show(
                    "内置 OurFreeModel 服务正在初始化中，请稍候再试。",
                    "DeepSeek Persona",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Information
                );
            }
        }

        private void OpenLogs()
        {
            try
            {
                if (!File.Exists(_logFile)) File.WriteAllText(_logFile, "", Encoding.UTF8);
                Process.Start(new ProcessStartInfo("notepad.exe", "\"" + _logFile + "\"") { UseShellExecute = true });
            }
            catch { }
        }

        private void RestartService()
        {
            _trayIcon.Text = "DeepSeek Persona（重启中...）";
            ThreadPool.QueueUserWorkItem(_ =>
            {
                StopNodeProcess();
                StartServiceWorker(true);
            });
        }

        private void StopNodeProcess()
        {
            Process proc;
            string url = _appUrl;
            string token = _shutdownToken;
            lock (_sync)
            {
                proc = _nodeProcess;
                _nodeProcess = null;
            }

            if (!string.IsNullOrEmpty(url))
            {
                try
                {
                    HttpWebRequest req = (HttpWebRequest)WebRequest.Create(url.TrimEnd('/') + "/__app/shutdown");
                    req.Method = "POST";
                    req.Timeout = 1500;
                    req.Proxy = null;
                    if (!string.IsNullOrEmpty(token)) req.Headers["x-app-token"] = token;
                    req.ContentLength = 0;
                    using (req.GetResponse()) { }
                }
                catch { }
            }

            if (proc != null)
            {
                try
                {
                    if (!proc.HasExited)
                    {
                        proc.WaitForExit(2500);
                    }
                    if (!proc.HasExited)
                    {
                        proc.Kill();
                    }
                }
                catch { }
                finally
                {
                    try { proc.Dispose(); } catch { }
                }
            }

            try
            {
                if (File.Exists(_runtimeFile)) File.Delete(_runtimeFile);
            }
            catch { }
        }

        private void ExitGracefully()
        {
            if (_exiting) return;
            _exiting = true;
            SystemEvents.SessionEnding -= OnSessionEnding;
            _trayIcon.Visible = false;
            _trayIcon.Dispose();
            StopNodeProcess();
            ExitThread();
        }
    }
}
