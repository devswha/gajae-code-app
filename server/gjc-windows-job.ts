import path from 'node:path';
import { gzipSync } from 'node:zlib';

const APPLICATION_ENV = 'GAJAE_INTERNAL_JOB_APPLICATION';
const COMMAND_LINE_ENV = 'GAJAE_INTERNAL_JOB_COMMAND_LINE';
const WORKING_DIRECTORY_ENV = 'GAJAE_INTERNAL_JOB_WORKING_DIRECTORY';
const OWNER_PROCESS_ENV = 'GAJAE_INTERNAL_JOB_OWNER_PROCESS';

export const GJC_WINDOWS_JOB_GUARD_READY = 'gajae-job-guard-ready-v1';
export const GJC_WINDOWS_JOB_GUARD_ACK = 'gajae-job-guard-ack-v1';

const WINDOWS_JOB_GUARD_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$null = Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class GajaeWindowsJobGuard
{
    private const uint CREATE_NO_WINDOW = 0x08000000;
    private const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
    private const uint STARTF_USESTDHANDLES = 0x00000100;
    private const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    private const uint PROC_THREAD_ATTRIBUTE_JOB_LIST = 0x0002000D;
    private const int JobObjectExtendedLimitInformation = 9;
    private const uint INFINITE = 0xFFFFFFFF;
    private const uint WAIT_FAILED = 0xFFFFFFFF;
    private const uint WAIT_OBJECT_0 = 0x00000000;
    private const uint SYNCHRONIZE = 0x00100000;

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IO_COUNTERS
    {
        public ulong ReadOperationCount;
        public ulong WriteOperationCount;
        public ulong OtherOperationCount;
        public ulong ReadTransferCount;
        public ulong WriteTransferCount;
        public ulong OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public uint dwX;
        public uint dwY;
        public uint dwXSize;
        public uint dwYSize;
        public uint dwXCountChars;
        public uint dwYCountChars;
        public uint dwFillAttribute;
        public uint dwFlags;
        public short wShowWindow;
        public short cbReserved2;
        public IntPtr lpReserved2;
        public IntPtr hStdInput;
        public IntPtr hStdOutput;
        public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct STARTUPINFOEX
    {
        public STARTUPINFO StartupInfo;
        public IntPtr lpAttributeList;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION
    {
        public IntPtr hProcess;
        public IntPtr hThread;
        public uint dwProcessId;
        public uint dwThreadId;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObject(IntPtr jobAttributes, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool SetInformationJobObject(
        IntPtr job,
        int informationClass,
        ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION information,
        uint informationLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool InitializeProcThreadAttributeList(
        IntPtr attributeList,
        int attributeCount,
        int flags,
        ref IntPtr size);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UpdateProcThreadAttribute(
        IntPtr attributeList,
        uint flags,
        IntPtr attribute,
        IntPtr value,
        IntPtr size,
        IntPtr previousValue,
        IntPtr returnSize);

    [DllImport("kernel32.dll")]
    private static extern void DeleteProcThreadAttributeList(IntPtr attributeList);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateProcess(
        string applicationName,
        StringBuilder commandLine,
        IntPtr processAttributes,
        IntPtr threadAttributes,
        [MarshalAs(UnmanagedType.Bool)] bool inheritHandles,
        uint creationFlags,
        IntPtr environment,
        string currentDirectory,
        ref STARTUPINFOEX startupInfo,
        out PROCESS_INFORMATION processInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool TerminateProcess(IntPtr process, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(
        uint desiredAccess,
        [MarshalAs(UnmanagedType.Bool)] bool inheritHandle,
        uint processId);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern uint WaitForMultipleObjects(
        uint count,
        IntPtr[] handles,
        [MarshalAs(UnmanagedType.Bool)] bool waitAll,
        uint milliseconds);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetExitCodeProcess(IntPtr process, out uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int standardHandle);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool ReadFile(
        IntPtr file,
        [Out] byte[] buffer,
        uint bytesToRead,
        out uint bytesRead,
        IntPtr overlapped);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);

    public static IntPtr OpenOwner(uint ownerProcessId)
    {
        IntPtr owner = OpenProcess(SYNCHRONIZE, false, ownerProcessId);
        if (owner == IntPtr.Zero)
            throw new Win32Exception(Marshal.GetLastWin32Error(), "OpenProcess failed.");
        return owner;
    }

    public static void CloseOwner(IntPtr owner)
    {
        if (owner != IntPtr.Zero)
            CloseHandle(owner);
    }

    public static bool ReadAcknowledgement(string expected)
    {
        if (String.IsNullOrEmpty(expected) || expected.Length > 64)
            throw new ArgumentException("Invalid acknowledgement.", "expected");
        IntPtr input = GetStdHandle(-10);
        if (input == IntPtr.Zero || input == new IntPtr(-1))
            throw new Win32Exception(Marshal.GetLastWin32Error(), "Invalid standard input.");

        byte[] expectedBytes = Encoding.ASCII.GetBytes(expected + "\n");
        byte[] current = new byte[1];
        for (int index = 0; index < expectedBytes.Length; index++)
        {
            uint bytesRead;
            if (!ReadFile(input, current, 1, out bytesRead, IntPtr.Zero))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "ReadFile failed.");
            if (bytesRead != 1)
                throw new InvalidOperationException("Job guard input closed.");
            if (current[0] != expectedBytes[index])
                return false;
        }
        return true;
    }

    public static int Run(
        string application,
        string commandLine,
        string workingDirectory,
        IntPtr owner)
    {
        IntPtr job = CreateJobObject(IntPtr.Zero, null);
        if (job == IntPtr.Zero)
            throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateJobObject failed.");

        IntPtr attributeList = IntPtr.Zero;
        bool attributeListInitialized = false;
        IntPtr jobList = IntPtr.Zero;
        PROCESS_INFORMATION process = new PROCESS_INFORMATION();
        bool processCreated = false;
        try
        {
            var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if (!SetInformationJobObject(
                job,
                JobObjectExtendedLimitInformation,
                ref limits,
                (uint)Marshal.SizeOf<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>()))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "SetInformationJobObject failed.");

            IntPtr attributeListSize = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref attributeListSize);
            if (attributeListSize == IntPtr.Zero)
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Attribute sizing failed.");
            attributeList = Marshal.AllocHGlobal(attributeListSize);
            if (!InitializeProcThreadAttributeList(attributeList, 1, 0, ref attributeListSize))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Attribute initialization failed.");
            attributeListInitialized = true;

            jobList = Marshal.AllocHGlobal(IntPtr.Size);
            Marshal.WriteIntPtr(jobList, job);
            if (!UpdateProcThreadAttribute(
                attributeList,
                0,
                new IntPtr(unchecked((long)PROC_THREAD_ATTRIBUTE_JOB_LIST)),
                jobList,
                new IntPtr(IntPtr.Size),
                IntPtr.Zero,
                IntPtr.Zero))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "Job-list assignment failed.");

            var startup = new STARTUPINFOEX();
            startup.StartupInfo.cb = Marshal.SizeOf<STARTUPINFOEX>();
            startup.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
            startup.StartupInfo.hStdInput = GetStdHandle(-10);
            startup.StartupInfo.hStdOutput = GetStdHandle(-11);
            startup.StartupInfo.hStdError = GetStdHandle(-12);
            startup.lpAttributeList = attributeList;

            if (!CreateProcess(
                application,
                new StringBuilder(commandLine),
                IntPtr.Zero,
                IntPtr.Zero,
                true,
                EXTENDED_STARTUPINFO_PRESENT | CREATE_NO_WINDOW,
                IntPtr.Zero,
                workingDirectory,
                ref startup,
                out process))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "CreateProcess failed.");
            processCreated = true;

            uint waitResult = WaitForMultipleObjects(
                2,
                new IntPtr[] { process.hProcess, owner },
                false,
                INFINITE);
            if (waitResult == WAIT_FAILED)
                throw new Win32Exception(Marshal.GetLastWin32Error(), "WaitForMultipleObjects failed.");
            if (waitResult == WAIT_OBJECT_0 + 1)
                return 1;
            if (waitResult != WAIT_OBJECT_0)
                throw new Win32Exception("WaitForMultipleObjects returned an unexpected result.");
            uint exitCode;
            if (!GetExitCodeProcess(process.hProcess, out exitCode))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "GetExitCodeProcess failed.");
            return unchecked((int)exitCode);
        }
        catch
        {
            if (processCreated)
                TerminateProcess(process.hProcess, 1);
            throw;
        }
        finally
        {
            if (process.hThread != IntPtr.Zero)
                CloseHandle(process.hThread);
            if (process.hProcess != IntPtr.Zero)
                CloseHandle(process.hProcess);
            if (attributeListInitialized)
                DeleteProcThreadAttributeList(attributeList);
            if (jobList != IntPtr.Zero)
                Marshal.FreeHGlobal(jobList);
            if (attributeList != IntPtr.Zero)
                Marshal.FreeHGlobal(attributeList);
            CloseHandle(job);
        }
    }
}
'@

$application = [Environment]::GetEnvironmentVariable('${APPLICATION_ENV}', 'Process')
$commandLine = [Environment]::GetEnvironmentVariable('${COMMAND_LINE_ENV}', 'Process')
$workingDirectory = [Environment]::GetEnvironmentVariable('${WORKING_DIRECTORY_ENV}', 'Process')
$ownerProcessId = [Environment]::GetEnvironmentVariable('${OWNER_PROCESS_ENV}', 'Process')
[Environment]::SetEnvironmentVariable('${APPLICATION_ENV}', $null, 'Process')
[Environment]::SetEnvironmentVariable('${COMMAND_LINE_ENV}', $null, 'Process')
[Environment]::SetEnvironmentVariable('${WORKING_DIRECTORY_ENV}', $null, 'Process')
[Environment]::SetEnvironmentVariable('${OWNER_PROCESS_ENV}', $null, 'Process')
if ([String]::IsNullOrWhiteSpace($application) -or [String]::IsNullOrWhiteSpace($commandLine) -or [String]::IsNullOrWhiteSpace($ownerProcessId)) {
    throw 'Missing guarded process configuration.'
}
$ownerHandle = [IntPtr]::Zero
try {
    $ownerHandle = [GajaeWindowsJobGuard]::OpenOwner([UInt32]$ownerProcessId)
    [Console]::Out.WriteLine('${GJC_WINDOWS_JOB_GUARD_READY}')
    [Console]::Out.Flush()
    if (![GajaeWindowsJobGuard]::ReadAcknowledgement('${GJC_WINDOWS_JOB_GUARD_ACK}')) {
        throw 'Invalid job guard acknowledgement.'
    }
    $exitCode = [GajaeWindowsJobGuard]::Run($application, $commandLine, $workingDirectory, $ownerHandle)
    exit $exitCode
} finally {
    [GajaeWindowsJobGuard]::CloseOwner($ownerHandle)
}
`.trim();

const WINDOWS_JOB_GUARD_COMMAND = (() => {
  const compressed = gzipSync(
    Buffer.from(WINDOWS_JOB_GUARD_SCRIPT, 'utf8'),
    { level: 9 },
  ).toString('base64');
  const loader = [
    `$b=[Convert]::FromBase64String('${compressed}')`,
    '$m=New-Object IO.MemoryStream(,$b)',
    '$g=New-Object IO.Compression.GzipStream($m,[IO.Compression.CompressionMode]::Decompress)',
    '$r=New-Object IO.StreamReader($g)',
    '& ([ScriptBlock]::Create($r.ReadToEnd()))',
  ].join(';');
  return Buffer.from(loader, 'utf16le').toString('base64');
})();

/** Quotes one argv value using the Windows CommandLineToArgvW-compatible rules. */
export function quoteWindowsArgument(value: string): string {
  if (value.length > 0 && !/[\s"]/u.test(value)) return value;

  let result = '"';
  let backslashes = 0;
  for (const character of value) {
    if (character === '\\') {
      backslashes += 1;
      continue;
    }
    if (character === '"') {
      result += `${'\\'.repeat(backslashes * 2 + 1)}"`;
      backslashes = 0;
      continue;
    }
    result += `${'\\'.repeat(backslashes)}${character}`;
    backslashes = 0;
  }
  return `${result}${'\\'.repeat(backslashes * 2)}"`;
}

export type WindowsJobLaunch = {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
};

/**
 * Starts a PowerShell guard that proves the app still owns its inherited pipes,
 * then atomically creates the worker inside a kill-on-close Job Object.
 */
export function createWindowsJobLaunch(
  application: string,
  args: string[],
  environment: NodeJS.ProcessEnv,
  workingDirectory: string,
): WindowsJobLaunch {
  const systemRoot = environment.SystemRoot ?? environment.WINDIR;
  if (!systemRoot) throw new Error('Windows SystemRoot is unavailable.');

  return {
    command: path.win32.join(
      systemRoot,
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    ),
    args: [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-EncodedCommand',
      WINDOWS_JOB_GUARD_COMMAND,
    ],
    env: {
      ...environment,
      [APPLICATION_ENV]: application,
      [COMMAND_LINE_ENV]: [application, ...args].map(quoteWindowsArgument).join(' '),
      [WORKING_DIRECTORY_ENV]: workingDirectory,
      [OWNER_PROCESS_ENV]: String(process.pid),
    },
  };
}
