import path from 'node:path';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const APPLICATION_ENV = 'GAJAE_INTERNAL_JOB_APPLICATION';
const COMMAND_LINE_ENV = 'GAJAE_INTERNAL_JOB_COMMAND_LINE';
const WORKING_DIRECTORY_ENV = 'GAJAE_INTERNAL_JOB_WORKING_DIRECTORY';
const OWNER_PROCESS_ENV = 'GAJAE_INTERNAL_JOB_OWNER_PROCESS';
const JOB_NAME_ENV = 'GAJAE_INTERNAL_JOB_NAME';
const REAP_ENV = 'GAJAE_INTERNAL_JOB_REAP';

export const GJC_WINDOWS_JOB_GUARD_READY = 'gajae-job-guard-ready-v1';
export const GJC_WINDOWS_JOB_GUARD_ACK = 'gajae-job-guard-ack-v1';

/** Compiles trusted constant C# without CodeDom's ANSI elevated-temp helper. */
export function windowsCodeDomCompileScript(typeDefinition: string, diagnostics = false): string {
  return String.raw`
$compilerIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
$compilerSid = $compilerIdentity.User.Value
$compilerPrincipal = [Security.Principal.WindowsPrincipal]::new($compilerIdentity)
$compilerElevated = $compilerPrincipal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$compilerTemp = [IO.Path]::Combine([IO.Path]::GetTempPath(), ('gajae-code-dom-' + [Guid]::NewGuid().ToString('N')))
$compilerParameters = $null
$compilerTempCreated = $false
try {
    if ($compilerElevated) {
        # Exact SDDL used by .NET TempFileCollection.CreateTempDirectoryWithAce:
        # inherited deny-delete, administrator access, and a high-integrity label.
        $compilerSddl = 'D:(D;OI;SD;;;' + $compilerSid + ')(A;OICI;FA;;;BA)S:(ML;OI;NW;;;HI)'
    } else {
        $compilerSddl = 'D:P(A;OICI;FA;;;' + $compilerSid + ')(A;OICI;FA;;;SY)'
    }
    # DirectorySecurity canonicalizes its SystemAcl as auditing ACEs and drops
    # the mandatory label, producing an empty SACL that needs SeSecurityPrivilege.
    # Preserve the raw descriptor and call the wide API directly instead. Emit
    # imports without Add-Type, which is the compiler we are bootstrapping.
    if (-not ('GajaeCodeDomFileApi' -as [type])) {
        $compilerAssembly = [AppDomain]::CurrentDomain.DefineDynamicAssembly([Reflection.AssemblyName]::new('GajaeCodeDomFileApi'), [Reflection.Emit.AssemblyBuilderAccess]::Run)
        $compilerModule = $compilerAssembly.DefineDynamicModule('GajaeCodeDomFileApi')
        $compilerType = $compilerModule.DefineType('GajaeCodeDomFileApi', [Reflection.TypeAttributes]::Public -bor [Reflection.TypeAttributes]::Sealed -bor [Reflection.TypeAttributes]::Abstract)
        function Add-GajaeCompilerImport($builder, [string]$name, [string]$library, [type[]]$parameters) {
            $method = $builder.DefineMethod($name, [Reflection.MethodAttributes]::Public -bor [Reflection.MethodAttributes]::Static -bor [Reflection.MethodAttributes]::PinvokeImpl, [bool], $parameters)
            $attributeType = [Runtime.InteropServices.DllImportAttribute]
            $constructor = $attributeType.GetConstructor([type[]]@([string]))
            $fields = [Reflection.FieldInfo[]]@($attributeType.GetField('EntryPoint'), $attributeType.GetField('CharSet'), $attributeType.GetField('ExactSpelling'), $attributeType.GetField('SetLastError'), $attributeType.GetField('CallingConvention'))
            $values = [object[]]@($name, [Runtime.InteropServices.CharSet]::Unicode, $true, $true, [Runtime.InteropServices.CallingConvention]::Winapi)
            $method.SetCustomAttribute([Reflection.Emit.CustomAttributeBuilder]::new($constructor, [object[]]@($library), $fields, $values))
            $method.SetImplementationFlags([Reflection.MethodImplAttributes]::PreserveSig)
            if ($name -eq 'GetFileSecurityW') { $null = $method.DefineParameter(3, [Reflection.ParameterAttributes]::Out, 'securityDescriptor') }
        }
        Add-GajaeCompilerImport $compilerType 'CreateDirectoryW' 'kernel32.dll' ([type[]]@([string], [IntPtr]))
        Add-GajaeCompilerImport $compilerType 'GetFileSecurityW' 'advapi32.dll' ([type[]]@([string], [uint32], [byte[]], [uint32], [uint32].MakeByRefType()))
        $null = $compilerType.CreateType()
    }
    $compilerSecurity = [Security.AccessControl.RawSecurityDescriptor]::new($compilerSddl)
    $compilerDescriptorBytes = [byte[]]::new($compilerSecurity.BinaryLength)
    $compilerSecurity.GetBinaryForm($compilerDescriptorBytes, 0)
    $compilerDescriptorPointer = [IntPtr]::Zero
    $compilerAttributesPointer = [IntPtr]::Zero
    try {
        $compilerDescriptorPointer = [Runtime.InteropServices.Marshal]::AllocHGlobal($compilerDescriptorBytes.Length)
        [Runtime.InteropServices.Marshal]::Copy($compilerDescriptorBytes, 0, $compilerDescriptorPointer, $compilerDescriptorBytes.Length)
        # SECURITY_ATTRIBUTES has pointer-aligned length, descriptor and BOOL
        # fields: 24 bytes on x64, 12 on x86. Zero padding and handle inheritance.
        $compilerAttributesLength = 3 * [IntPtr]::Size
        $compilerAttributesPointer = [Runtime.InteropServices.Marshal]::AllocHGlobal($compilerAttributesLength)
        [Runtime.InteropServices.Marshal]::Copy([byte[]]::new($compilerAttributesLength), 0, $compilerAttributesPointer, $compilerAttributesLength)
        [Runtime.InteropServices.Marshal]::WriteInt32($compilerAttributesPointer, $compilerAttributesLength)
        [Runtime.InteropServices.Marshal]::WriteIntPtr($compilerAttributesPointer, [IntPtr]::Size, $compilerDescriptorPointer)
        if (-not [GajaeCodeDomFileApi]::CreateDirectoryW($compilerTemp, $compilerAttributesPointer)) {
            throw [ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error())
        }
    } finally {
        if ($compilerAttributesPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($compilerAttributesPointer) }
        if ($compilerDescriptorPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::FreeHGlobal($compilerDescriptorPointer) }
    }
    $compilerTempCreated = $true
    # Query DACL + LABEL, not auditing SACL: label-only access requires no
    # SeSecurityPrivilege, and RawSecurityDescriptor retains the mandatory ACE.
    [uint32]$compilerSecurityLength = 0
    $null = [GajaeCodeDomFileApi]::GetFileSecurityW($compilerTemp, 0x14, $null, 0, [ref]$compilerSecurityLength)
    if ($compilerSecurityLength -eq 0 -or $compilerSecurityLength -gt 65536) { throw 'Could not size compiler directory security descriptor.' }
    $compilerActualBytes = [byte[]]::new($compilerSecurityLength)
    if (-not [GajaeCodeDomFileApi]::GetFileSecurityW($compilerTemp, 0x14, $compilerActualBytes, $compilerActualBytes.Length, [ref]$compilerSecurityLength)) {
        throw [ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error())
    }
    $compilerActualSecurity = [Security.AccessControl.RawSecurityDescriptor]::new($compilerActualBytes, 0)
    $compilerActualSddl = $compilerActualSecurity.GetSddlForm([Security.AccessControl.AccessControlSections]::All)
    $compilerSecurityReport = (@{ compilerTemp = $compilerTemp; elevated = $compilerElevated; requestedCompilerSddl = $compilerSddl; compilerSddl = $compilerActualSddl } | ConvertTo-Json -Compress)
    ${diagnostics ? '[Console]::Out.WriteLine($compilerSecurityReport)' : ''}
    # String.raw preserves the single backslash required by PowerShell/.NET.
    if ($compilerElevated -and $compilerActualSddl -notmatch '\(ML;[^;]*;NW;;;HI\)') {
        throw ('Compiler directory high-integrity label was not preserved. ' + $compilerSecurityReport)
    }
    $compilerParameters = [CodeDom.Compiler.CompilerParameters]::new()
    $compilerParameters.GenerateInMemory = $true
    $compilerParameters.ReferencedAssemblies.AddRange([string[]]@('System.dll', 'System.Core.dll'))
    $compilerParameters.TempFiles = [CodeDom.Compiler.TempFileCollection]::new($compilerTemp, $false)
    $null = Add-Type -CompilerParameters $compilerParameters -TypeDefinition @'
${typeDefinition}
'@
} finally {
    try {
        if ($compilerTempCreated) {
            # Restore deletion rights only after compilation. Change the DACL
            # alone so high integrity remains in force until removal completes.
            $compilerCleanupSecurity = [Security.AccessControl.DirectorySecurity]::new()
            $compilerCleanupSecurity.SetSecurityDescriptorSddlForm(('D:(A;OICI;FA;;;' + $compilerSid + ')(A;OICI;FA;;;BA)'), [Security.AccessControl.AccessControlSections]::Access)
            [IO.Directory]::SetAccessControl($compilerTemp, $compilerCleanupSecurity)
            if ($null -ne $compilerParameters) { $compilerParameters.TempFiles.Delete() }
            [IO.Directory]::Delete($compilerTemp, $true)
        }
    } finally {
        $compilerIdentity.Dispose()
    }
}
`.trim();
}

const WINDOWS_JOB_GUARD_SCRIPT = `$ErrorActionPreference = 'Stop'
${windowsCodeDomCompileScript(String.raw`
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

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
    private struct JOBOBJECT_BASIC_ACCOUNTING_INFORMATION
    {
        public long TotalUserTime;
        public long TotalKernelTime;
        public long ThisPeriodTotalUserTime;
        public long ThisPeriodTotalKernelTime;
        public uint TotalPageFaultCount;
        public uint TotalProcesses;
        public uint ActiveProcesses;
        public uint TotalTerminatedProcesses;
    }

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

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr OpenJobObject(uint access, bool inheritHandle, string name);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool TerminateJobObject(IntPtr job, uint exitCode);

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryInformationJobObject(
        IntPtr job, int informationClass,
        ref JOBOBJECT_BASIC_ACCOUNTING_INFORMATION information,
        uint informationLength, IntPtr returnLength);

    public static void Reap(string name)
    {
        // Called only after the guard has exited, so it cannot create a job
        // after this lookup. A job survives until all handles and processes
        // are gone; ERROR_FILE_NOT_FOUND therefore also proves termination.
        IntPtr job = OpenJobObject(0x0004 | 0x0008, false, name);
        if (job == IntPtr.Zero)
        {
            int error = Marshal.GetLastWin32Error();
            if (error == 2) return;
            throw new Win32Exception(error, "OpenJobObject failed.");
        }
        try
        {
            if (!TerminateJobObject(job, 1))
                throw new Win32Exception(Marshal.GetLastWin32Error(), "TerminateJobObject failed.");
            for (int attempt = 0; attempt < 200; attempt++)
            {
                var accounting = new JOBOBJECT_BASIC_ACCOUNTING_INFORMATION();
                if (!QueryInformationJobObject(job, 1, ref accounting,
                    (uint)Marshal.SizeOf<JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>(), IntPtr.Zero))
                    throw new Win32Exception(Marshal.GetLastWin32Error(), "QueryInformationJobObject failed.");
                if (accounting.ActiveProcesses == 0) return;
                Thread.Sleep(25);
            }
            throw new TimeoutException("Windows job termination timed out.");
        }
        finally { CloseHandle(job); }
    }

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
        string jobName,
        IntPtr owner)
    {
        IntPtr job = CreateJobObject(IntPtr.Zero, jobName);
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
`.trim())}
${String.raw`
$jobName = [Environment]::GetEnvironmentVariable('${JOB_NAME_ENV}', 'Process')
$reap = [Environment]::GetEnvironmentVariable('${REAP_ENV}', 'Process')
[Environment]::SetEnvironmentVariable('${JOB_NAME_ENV}', $null, 'Process')
[Environment]::SetEnvironmentVariable('${REAP_ENV}', $null, 'Process')
if ([String]::IsNullOrWhiteSpace($jobName)) { throw 'Missing Windows job name.' }
if ($reap -eq '1') {
    [GajaeWindowsJobGuard]::Reap($jobName)
    exit 0
}
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
    $exitCode = [GajaeWindowsJobGuard]::Run($application, $commandLine, $workingDirectory, $jobName, $ownerHandle)
    exit $exitCode
} finally {
    [GajaeWindowsJobGuard]::CloseOwner($ownerHandle)
}
`.trim()}`;

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
  jobName: string;
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
  const systemRootKey = Object.keys(environment).find((key) => key.toLowerCase() === 'systemroot')
    ?? Object.keys(environment).find((key) => key.toLowerCase() === 'windir');
  const systemRoot = systemRootKey ? environment[systemRootKey] : undefined;
  if (!systemRoot) throw new Error('Windows SystemRoot is unavailable.');
  const jobName = `Local\\gajae-worker-${randomUUID()}`;

  return {
    jobName,
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
      [JOB_NAME_ENV]: jobName,
      [REAP_ENV]: '0',
    },
  };
}

type WindowsJobChild = {
  exitCode?: number | null;
  signalCode?: NodeJS.Signals | null;
  kill(signal: NodeJS.Signals): boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
};

function confirmWindowsJobTermination(launch: WindowsJobLaunch): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(launch.command, launch.args, {
      env: { ...launch.env, [REAP_ENV]: '1' },
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 64 * 1024,
    }, (error) => {
      if (error) reject(new Error('Windows job termination could not be verified.', { cause: error }));
      else resolve();
    });
  });
}

/** Kill the owner handle, then verify the named job has no remaining processes. */
export async function killWindowsJobGuard(
  child: WindowsJobChild,
  launch: WindowsJobLaunch,
  confirmTermination = confirmWindowsJobTermination,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const exited = () => child.exitCode != null || child.signalCode != null;
    const timer = setTimeout(() => reject(new Error('Windows job guard termination timed out.')), 5_000);
    timer.unref?.();
    const finish = () => { clearTimeout(timer); resolve(); };
    child.on('close', finish);
    if (exited()) { finish(); return; }
    try {
      if (!child.kill('SIGKILL') && !exited()) {
        clearTimeout(timer);
        reject(new Error('Windows job guard could not be terminated.'));
      }
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
  await confirmTermination(launch);
}
